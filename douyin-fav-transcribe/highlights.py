# -*- coding: utf-8 -*-
"""划线（高亮）的落库格式与「重转写后的 stale 重匹配」。

设计要点（对应 docs/plans/douyin-fav-agent.md 的 Highlight anchors 一节）：

- 高亮写进笔记 frontmatter 的 `highlights:` 块，而不是正文里的裸引用块。
  这样：只读 md 的人能看到摘录，Agent 能拿到结构化数据，重转写时也不会
  把高亮当作正文一起冲掉。
- 每条高亮带三样东西：`quote`（摘录原文）、`prefix`/`suffix`（各 32 字指纹）、
  `start`/`end`（在 body 里的字符偏移）。
- 视频重转写会整篇覆盖 md。覆盖前先读出旧高亮，覆盖后按
  「prefix+quote+suffix → prefix+quote → quote」由强到弱重新定位；
  三条都没命中就把 status 标成 `stale`，只保留 quote，绝不假装还在原位。

匹配前统一做空白折叠（Whisper 换行、markdown 换行都不该让指纹失效），
再用折叠串的下标映射回原文偏移，保证 start/end 是原文坐标。
"""
from __future__ import annotations

import re
import time
import uuid

FINGERPRINT = 32
BLOCK_KEY = "highlights"
STATUS_OK = "ok"
STATUS_STALE = "stale"

_FM_OPEN = re.compile(r"^---\r?\n")
_KEY_LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")


# ---------------------------------------------------------------- frontmatter

def split_frontmatter(text: str) -> tuple[str, str, str]:
    """切成 (frontmatter 内部文本, body, 换行风格)。

    没有 frontmatter 时返回 ("", 原文, "\\n")。
    """
    if not text.startswith("---"):
        return "", text, "\n"
    nl = "\r\n" if "\r\n" in text[:200] else "\n"
    m = _FM_OPEN.match(text)
    if not m:
        return "", text, nl
    rest = text[m.end():]
    end = re.search(r"^(---|-{3,})\s*$", rest, re.M)
    if not end:
        return "", text, nl
    inner = rest[: end.start()]
    body = rest[end.end():]
    body = body.lstrip("\r\n")
    return inner.rstrip("\n"), body, nl


def join_frontmatter(inner: str, body: str, nl: str = "\n") -> str:
    if not inner.strip():
        return body
    return f"---{nl}{inner}{nl}---{nl}{nl}{body}"


# ----------------------------------------------------------- 折叠空白 + 下标映射

def collapse(s: str, keep_space: bool = True) -> tuple[str, list[int]]:
    """归一化空白，并给出归一化串下标 → 原文下标 的映射。

    两种模式都要有，因为中文和西文对「折行」的期望相反：
      keep_space=True   连续空白折成一个空格  → "hello\\nworld" 能匹配 "hello world"
      keep_space=False  空白全部去掉          → "怎么\\n在" 能匹配正文里的 "怎么在"
    只用其中一种，另一类摘录就会假性 stale。
    """
    out: list[str] = []
    idx: list[int] = []
    prev_space = False
    for i, ch in enumerate(s):
        if ch.isspace():
            if not keep_space or prev_space or not out:
                continue
            out.append(" ")
            idx.append(i)
            prev_space = True
        else:
            out.append(ch)
            idx.append(i)
            prev_space = False
    return "".join(out), idx


def _variants(s: str) -> list[tuple[str, list[int]]]:
    return [collapse(s, True), collapse(s, False)]


def find_normalized(haystack: str, needle: str, start_at: int = 0) -> tuple[int, int] | None:
    """在 haystack 里按归一化空白找 needle，返回原文坐标 (start, end)。

    空格模式先试（对英文更自然），不行再试去空白模式（对中文跨行更自然）。
    """
    if not needle:
        return None
    for keep_space in (True, False):
        h, hmap = collapse(haystack, keep_space)
        n, _ = collapse(needle, keep_space)
        if not n:
            continue
        pos = h.find(n, max(0, start_at))
        if pos < 0:
            continue
        lo = hmap[pos]
        hi = hmap[pos + len(n) - 1] + 1
        return lo, hi
    return None


def find_all(haystack: str, needle: str, variants=None) -> list[tuple[int, int]]:
    """找出 needle 在 haystack 里的所有归一化命中（用于跳过被占用的区间）。"""
    if not needle:
        return []
    vs = variants if variants is not None else _variants(haystack)
    found: list[tuple[int, int]] = []
    for keep_space, (h, hmap) in zip((True, False), vs):
        n, _ = collapse(needle, keep_space)
        if not n:
            continue
        pos = h.find(n)
        while pos >= 0:
            lo = hmap[pos]
            hi = hmap[pos + len(n) - 1] + 1
            if (lo, hi) not in found:
                found.append((lo, hi))
            pos = h.find(n, pos + 1)
    return found


# ------------------------------------------------------------------ YAML 片段

def _q(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _unq(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        raw = raw[1:-1]
        raw = raw.replace('\\"', '"').replace("\\\\", "\\")
    return raw


def serialize_highlights(items: list[dict]) -> str:
    if not items:
        return f"{BLOCK_KEY}: []"
    lines = [f"{BLOCK_KEY}:"]
    for h in items:
        lines.append(f'  - id: {_q(str(h.get("id") or ""))}')
        lines.append(f'    quote: {_q(str(h.get("quote") or ""))}')
        lines.append(f'    prefix: {_q(str(h.get("prefix") or ""))}')
        lines.append(f'    suffix: {_q(str(h.get("suffix") or ""))}')
        lines.append(f'    start: {int(h.get("start", -1))}')
        lines.append(f'    end: {int(h.get("end", -1))}')
        lines.append(f'    status: {h.get("status") or STATUS_OK}')
        if h.get("created"):
            lines.append(f'    created: {_q(str(h["created"]))}')
    return "\n".join(lines)


def parse_highlights(text: str) -> list[dict]:
    inner, _body, _nl = split_frontmatter(text)
    if not inner:
        return []
    out: list[dict] = []
    cur: dict | None = None
    in_block = False
    for line in inner.splitlines():
        if not in_block:
            head = _KEY_LINE.match(line)
            if head and head.group(1) == BLOCK_KEY:
                in_block = True
                rest = head.group(2).strip()
                if rest and rest not in ("[]", "~", "null"):
                    # 兼容行内写法 highlights: [{...}]（我们只认空表）
                    pass
            continue
        # 块内：缩进行
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")):
            in_block = False
            continue
        stripped = line.strip()
        if stripped.startswith("- "):
            if cur:
                out.append(cur)
            cur = {}
            body = stripped[2:]
            kv = _KEY_LINE.match(body)
            if kv:
                cur[kv.group(1)] = _unq(kv.group(2))
            continue
        kv = _KEY_LINE.match(stripped)
        if kv and cur is not None:
            cur[kv.group(1)] = _unq(kv.group(2))
    if cur:
        out.append(cur)

    cleaned: list[dict] = []
    for h in out:
        if not (h.get("quote") or "").strip():
            continue
        try:
            h["start"] = int(h.get("start", -1))
        except (TypeError, ValueError):
            h["start"] = -1
        try:
            h["end"] = int(h.get("end", -1))
        except (TypeError, ValueError):
            h["end"] = -1
        h["status"] = h.get("status") or STATUS_OK
        cleaned.append(h)
    return cleaned


def replace_block(inner: str, block: str) -> str:
    """把 frontmatter 里已有的 highlights 块替换掉（保留其它键的顺序与原文）。"""
    if not inner.strip():
        return block
    lines = inner.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        head = _KEY_LINE.match(line)
        if head and head.group(1) == BLOCK_KEY:
            i += 1
            while i < len(lines) and (lines[i].startswith((" ", "\t")) or not lines[i].strip()):
                i += 1
            continue
        out.append(line)
        i += 1
    joined = "\n".join(out).rstrip("\n")
    return f"{joined}\n{block}" if joined else block


def write_highlights(text: str, items: list[dict]) -> str:
    inner, body, nl = split_frontmatter(text)
    new_inner = replace_block(inner, serialize_highlights(items))
    return join_frontmatter(new_inner, body, nl)


# -------------------------------------------------------------------- 指纹

def fingerprint(quote: str, char: int = FINGERPRINT) -> tuple[str, str]:
    flat = " ".join((quote or "").split())
    return flat[:char], flat[-char:]


def new_id() -> str:
    return f"h-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


def make_highlight(quote: str, body: str = "", start: int | None = None,
                   end: int | None = None, **extra) -> dict:
    flat = " ".join((quote or "").split())
    prefix, suffix = fingerprint(flat)
    h = {
        "id": str(extra.pop("id", "") or new_id()),
        "quote": flat,
        "prefix": prefix,
        "suffix": suffix,
        "start": int(start) if start is not None else -1,
        "end": int(end) if end is not None else -1,
        "status": STATUS_OK,
        "created": str(extra.pop("created", "") or time.strftime("%Y-%m-%dT%H:%M:%S")),
    }
    # 只有拿到偏移才算已定位；没有就靠指纹在 body 里找
    if h["start"] < 0 and body:
        found = locate(h, body)
        if found:
            h["start"], h["end"] = found
    if h["start"] < 0 and body:
        h["status"] = STATUS_STALE
    h.update({k: v for k, v in extra.items() if v is not None})
    return h


def locate(h: dict, body: str, taken: list[tuple[int, int]] | None = None) -> tuple[int, int] | None:
    """由强到弱定位一条高亮的原文偏移。

    规则顺序不能变：指纹（前后 32 字）最可信，其次单侧指纹，最后才是
    裸 quote。裸 quote 在长转写里很容易撞车，所以放在最后兜底。
    """
    quote = (h.get("quote") or "").strip()
    if not quote or not body:
        return None
    prefix = (h.get("prefix") or "").strip()
    suffix = (h.get("suffix") or "").strip()
    taken = taken or []
    candidates: list[str] = []
    if prefix and suffix:
        candidates.append(f"{prefix} {quote} {suffix}")
    if prefix:
        candidates.append(f"{prefix} {quote}")
    candidates.append(quote)
    if suffix:
        candidates.append(f"{quote} {suffix}")

    variants = _variants(body)
    for needle in candidates:
        for span in find_all(body, needle, variants):
            # 已被更强规则占用的区间，让位给下一条
            if not any(span[0] == a and span[1] == b for a, b in taken):
                return span
    return None


def rematch(items: list[dict], body: str) -> tuple[list[dict], dict]:
    """对一批高亮在新 body 上重新定位。返回 (新高亮, 统计)。"""
    out: list[dict] = []
    stats = {"total": len(items), "ok": 0, "moved": 0, "stale": 0, "duplicate": 0}
    taken: list[tuple[int, int]] = []
    for h in items:
        quote = (h.get("quote") or "").strip()
        if not quote:
            continue
        old_start = int(h.get("start", -1))
        old_end = int(h.get("end", -1))
        prefix, suffix = fingerprint(quote)
        item = {
            "id": str(h.get("id") or new_id()),
            "quote": " ".join(quote.split()),
            "prefix": prefix,
            "suffix": suffix,
            "start": old_start,
            "end": old_end,
            "status": STATUS_OK,
            "created": str(h.get("created") or ""),
        }
        # 1) 原偏移还成立（两种空白归一化都算成立，跨行摘录才不会假性 moved）
        if 0 <= old_start < old_end <= len(body):
            chunk = body[old_start:old_end]
            same = (collapse(chunk, True)[0] == collapse(item["quote"], True)[0]
                    or collapse(chunk, False)[0] == collapse(item["quote"], False)[0])
            if same:
                if (old_start, old_end) in taken:
                    item["status"] = STATUS_STALE
                    stats["duplicate"] += 1
                else:
                    taken.append((old_start, old_end))
                out.append(item)
                if item["status"] == STATUS_OK:
                    stats["ok"] += 1
                else:
                    stats["stale"] += 1
                continue
        # 2) 指纹重匹配
        found = locate(item, body, taken)
        if found:
            item["start"], item["end"] = found
            taken.append(found)
            stats["moved"] += 1
        else:
            item["start"], item["end"] = -1, -1
            item["status"] = STATUS_STALE
            stats["stale"] += 1
        out.append(item)
    return out, stats


def upsert(text: str, quote: str, **extra) -> tuple[str, dict, dict]:
    """把一条摘录写进笔记。返回 (新全文, 这条高亮, 统计)。"""
    inner, body, nl = split_frontmatter(text)
    items = parse_highlights(text)
    flat = " ".join((quote or "").split())
    for existing in items:
        if existing.get("quote") == flat:
            return text, existing, {"total": len(items), "added": 0, "reused": 1}
    items, stats = rematch(items, body)
    hl = make_highlight(flat, body, **extra)
    items.append(hl)
    stats = dict(stats)
    stats["added"] = 1
    return write_highlights(join_frontmatter(inner, body, nl), items), hl, stats


def carry_over(old_text: str, new_text: str) -> tuple[str, dict]:
    """重转写场景：把旧笔记的高亮迁移到新正文上。"""
    items = parse_highlights(old_text)
    if not items:
        return new_text, {"total": 0, "ok": 0, "moved": 0, "stale": 0, "duplicate": 0}
    inner, body, nl = split_frontmatter(new_text)
    rematched, stats = rematch(items, body)
    return write_highlights(join_frontmatter(inner, body, nl), rematched), stats


def deco(text: str) -> dict:
    """给前端/Agent 用的摘要。"""
    items = parse_highlights(text)
    by_status: dict[str, int] = {}
    for h in items:
        by_status[h.get("status", STATUS_OK)] = by_status.get(h.get("status", STATUS_OK), 0) + 1
    return {"total": len(items), "byStatus": by_status, "items": items}
