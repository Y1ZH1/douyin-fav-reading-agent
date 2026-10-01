# -*- coding: utf-8 -*-
"""核心逻辑：状态管理 + 单条/批量转写。GUI(app.py) 与 CLI(transcribe_favs.py) 共用。

状态唯一权威 = state/progress.json：
  {"ok":[...aweme_id], "fail":[...], "skipped":[...]}
被转写成功(ok)视为"已提取"，GUI 渲染为已提取态并跳过重复转写。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / "state"
WORK_DIR = ROOT / "work"
STATE_DIR.mkdir(exist_ok=True)
WORK_DIR.mkdir(exist_ok=True)

COLLECTED_PATH = STATE_DIR / "collected.json"   # 收藏（含自建收藏夹归属）
LIKED_PATH = STATE_DIR / "liked.json"           # 「喜欢」(点赞)，单独存：量级可达数万
LIKED_CURSOR_PATH = STATE_DIR / "liked_cursor.json"   # 喜欢翻页断点，支持中断续采
PROGRESS_PATH = STATE_DIR / "progress.json"
REMOVED_PATH = STATE_DIR / "removed.json"       # 「取消收藏/喜欢」审计日志（追加，不删除）


# ---- 依赖注入：复用 cap-backend 的 venv + script 包 ----
def _locate_cap_backend() -> Path | None:
    cands = []
    if os.environ.get("CAP_BACKEND_DIR"):
        cands.append(Path(os.environ["CAP_BACKEND_DIR"]))
    cands += [
        Path(__file__).resolve().parent.parent / "cap-backend",
    ]
    for c in cands:
        if (c / "script" / "transcriber.py").is_file():
            return c
    return None


_CAP = _locate_cap_backend()
if _CAP is not None:
    sys.path.insert(0, str(_CAP))
    _sp = _CAP / ".venv" / "Lib" / "site-packages"
    if _sp.is_dir():
        sys.path.insert(0, str(_sp))

from script.transcriber import transcribe_audio  # noqa: E402
from script.utils import sanitize_filename  # noqa: E402

try:
    import ai as ai_mod  # DeepSeek 总结/翻译（httpx 缺失时降级为 None）
except Exception:  # noqa: BLE001
    ai_mod = None  # type: ignore

try:
    import highlights as highlights_mod  # 划线指纹：重转写时把旧高亮迁到新正文
except Exception:  # noqa: BLE001
    highlights_mod = None  # type: ignore

# 落库根目录：其下按来源分成两个桶，再按收藏夹分子目录。
#   收藏/            ← 收藏的视频；有自建收藏夹归属的落在 收藏/<收藏夹名>/，无归属的留在 收藏/ 顶层
#   喜欢/            ← 仅「喜欢」(点赞)、未收藏的视频
#   AI总结/          ← AI 总结/综述笔记（与两个桶同级）
DEFAULT_OBSIDIAN = Path(os.environ.get("DOUYIN_OBSIDIAN_DIR") or (Path(__file__).resolve().parent / "抖音"))
FAV_SUBDIR = "收藏"              # 收藏桶
LIKED_SUBDIR = "喜欢"            # 喜欢桶（仅点赞、未收藏）
SUMMARIES_PATH = STATE_DIR / "summaries.json"
SUMMARY_SUBDIR = "AI总结"        # 总结笔记落在这个子目录（区别于抖音里用户自建的"总结"收藏夹）
ZH_LANGS = {"zh", "yue", "wuu"}
LIKED_TAG = "喜欢"               # 「喜欢」(点赞) 的虚拟分组名，与 collector.LIKED_TAG 保持一致

# ---------------- 转写调优（实测结论见 README / 工作日志） ----------------
# 默认模型：small(0.24B) → large-v3(1.55B)。实测 large-v3 把大量术语/动词错误修对并消除幻觉，
# 耗时约 2.3 倍（78s 视频约 18s），GPU(RTX 4060) 已足以承担。
DEFAULT_MODEL = "large-v3"
BEAM_SIZE = 8

# ---------------- 外文视频的翻译模式 ----------------
# aligned：逐句对照（默认）——先按句末标点把 Whisper 碎片合并成整句，再逐句送译，
#          原文一句紧跟中文一句（「中英对照」块）。
# whole  ：整段翻译——整篇一次翻成中文，附在原文之后（「中文翻译」块）。
# 可用环境变量 DOUYIN_TRANSLATE_MODE 覆盖默认值；GUI 工具栏也可临时切换。
TRANSLATE_MODES = ("aligned", "whole")


def _norm_translate_mode(mode: str | None) -> str:
    m = (mode or os.environ.get("DOUYIN_TRANSLATE_MODE") or "aligned").strip().lower()
    return m if m in TRANSLATE_MODES else "aligned"


TRANSLATE_MODE = _norm_translate_mode(None)

# 提示词：Whisper 会模仿 initial_prompt 的风格 → 写标点即可让输出自动断句；
# 声明"简体中文"可减少繁体输出（zhconv 仍保留做兜底）。
PROMPT_TEMPLATE = (
    "以下是简体中文普通话内容，请用简体中文输出，使用中文标点。"
    "话题可能涉及：健身、体态矫正、含胸驼背、骨盆前倾、面部分析、"
    "哲学、心理学、自律、拖延、足球、摄影。"
)


def build_prompt(item: dict, lang: str = "") -> str:
    """initial_prompt 必须与目标语言一致 —— 提示词写错语言会把整段输出带偏。

    Whisper 会模仿提示词的语言与风格：
      中文（zh/yue/wuu）→ 固定中文提示词，实测能让输出自带标点、少出繁体；
      其它语言 → 留空，术语交给 hotwords，绝不用中文提示词去带英文音频。
    lang 留空（未知）时才回退到"标题含中文即当中文"的老判断。
    """
    if lang in ZH_LANGS:
        return PROMPT_TEMPLATE
    if not lang and _has_cjk(item.get("title") or ""):
        return PROMPT_TEMPLATE
    return ""


def _cleanup_work_dir(work_dir: Path) -> None:
    """清理单条的工作目录（音频只是缓存，清不掉也无所谓）。

    这里必须 catch BaseException，不能只 catch Exception：环境里的"安全删除"
    钩子（sitecustomize 把 os.remove / shutil.rmtree 改写成"移入回收站"）在
    批量删除超过阈值时会直接抛 SystemExit(1)，而 SystemExit 继承 BaseException，
    `except Exception` 拦不住 —— 它会一路穿透到 job worker 线程，
    且子线程里的 SystemExit 不打堆栈，表现为任务永远停在 running/done=0。
    """
    try:
        shutil.rmtree(work_dir, ignore_errors=True)
    except BaseException:  # noqa: BLE001  含 SystemExit / KeyboardInterrupt
        pass


def build_hotwords(item: dict) -> str:
    """术语加权表 = 视频标题 + 作者名。

    标题/作者里天然带着专有名词与领域词（实测能把"合围/赫维"修成"何为系列"、
    把"总肩脱背"修成"耸肩驼背"），顺带统一正文里对作者的称呼（如"孙新志"）。
    """
    title = re.sub(r"\s+", " ", (item.get("title") or "")).strip()
    author = re.sub(r"\s+", " ", (item.get("author") or "")).strip()
    parts = [p for p in (title, author) if p]
    return " ".join(parts)[:240]


def _has_cjk(s: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in s)



# ---------------- 状态 ----------------
@dataclass
class Status:
    ok: list[str] = field(default_factory=list)
    fail: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def state_of(self, aid: str) -> str:
        if aid in self.ok:
            return "ok"
        if aid in self.fail:
            return "fail"
        if aid in self.skipped:
            return "skipped"
        return "pending"


def load_status() -> Status:
    if PROGRESS_PATH.exists():
        try:
            d = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
            return Status(ok=d.get("ok", []), fail=d.get("fail", []), skipped=d.get("skipped", []))
        except Exception:
            pass
    return Status()


def save_status(s: Status) -> None:
    PROGRESS_PATH.write_text(
        json.dumps({"ok": s.ok, "fail": s.fail, "skipped": s.skipped},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---- 带 mtime 缓存的文件读取 ----
# 「喜欢」可能几万条，JSON 有几十 MB；GUI 每个请求都要读一次的话会卡死。
# 这里按 (路径, mtime) 缓存解析结果，文件没变就直接复用对象。
_FILE_CACHE: dict[str, tuple[float, object]] = {}


def _read_json_cached(path: Path, default):
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return default
    key = str(path)
    hit = _FILE_CACHE.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = default
    _FILE_CACHE[key] = (mtime, data)
    return data


def _drop_cache(path: Path) -> None:
    _FILE_CACHE.pop(str(path), None)


def load_collected() -> list[dict]:
    """收藏列表（collected.json）。"""
    data = _read_json_cached(COLLECTED_PATH, [])
    return data if isinstance(data, list) else []


def save_collected(items: list[dict]) -> None:
    COLLECTED_PATH.parent.mkdir(parents=True, exist_ok=True)
    COLLECTED_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(COLLECTED_PATH)


def _upsert_folders_frontmatter(text: str, folder_name: str) -> str:
    """把收藏夹名写进 frontmatter 的 folders 列表（已存在则不动）。"""
    name = folder_name.strip()
    if not name or not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end < 0:
        return text
    fm = text[3:end]
    body = text[end + 4 :]
    if re.search(rf"^\s*-\s+{re.escape(name)}\s*$", fm, re.M):
        return text
    if "folders: []" in fm:
        fm = fm.replace("folders: []", f"folders:\n  - {name}", 1)
    elif re.search(r"^folders:\s*$", fm, re.M):
        fm = re.sub(r"^folders:\s*$", f"folders:\n  - {name}", fm, count=1, flags=re.M)
    else:
        fm = fm.rstrip() + f"\nfolders:\n  - {name}\n"
    return "---" + fm + "\n---" + body


def assign_folder(aweme_id: str, folder_name: str, obsidian_dir: Path | None = None) -> dict:
    """把一条收藏归入收藏夹：写 collected.json，并尽量同步笔记 frontmatter。

    收藏夹归属变化会影响落点（见 note_dirs_for），所以这里同时改数据与已有笔记，
    下次转写/重跑时 write_note 会把文件搬到新目录。
    """
    aid = str(aweme_id or "").strip()
    name = str(folder_name or "").strip()
    if not aid:
        raise ValueError("aweme_id required")
    if not name:
        raise ValueError("folder required")
    rows = load_collected()
    folders: list[str] = []
    found = False
    for it in rows:
        if str(it.get("aweme_id", "")) == aid:
            found = True
            folders = [f for f in (it.get("folders") or []) if f]
            if name not in folders:
                folders.append(name)
            it["folders"] = folders
            break
    if found:
        save_collected(rows)
    note_path = None
    if obsidian_dir is not None:
        # 同一条视频可能因命中多个收藏夹而存了多份，全部同步
        for p in _find_notes_by_aweme_id(obsidian_dir, aid):
            if not p.is_file():
                continue
            p.write_text(
                _upsert_folders_frontmatter(p.read_text(encoding="utf-8"), name),
                encoding="utf-8")
            note_path = note_path or str(p)
    if not found and not note_path:
        raise ValueError("item not found")
    return {"ok": True, "aweme_id": aid, "folders": folders or [name], "path": note_path}


def load_liked() -> list[dict]:
    """「喜欢」(点赞) 列表（liked.json）。"""
    data = _read_json_cached(LIKED_PATH, [])
    return data if isinstance(data, list) else []


def save_liked(items: list[dict]) -> None:
    LIKED_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIKED_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(LIKED_PATH)


def load_liked_cursor() -> dict:
    """喜欢翻页断点：{max_cursor, done, count, updated_at}。"""
    data = _read_json_cached(LIKED_CURSOR_PATH, {})
    return data if isinstance(data, dict) else {}


def save_liked_cursor(cursor: int, done: bool, count: int = 0) -> None:
    LIKED_CURSOR_PATH.write_text(json.dumps({
        "max_cursor": int(cursor), "done": bool(done),
        "count": int(count), "updated_at": _now(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(LIKED_CURSOR_PATH)


def load_all() -> list[dict]:
    """收藏 + 喜欢 的联合视图，按 aweme_id 去重。

    同一视频既收藏又点赞时合并为一条：字段取收藏那份，folders 取并集，
    liked 只要出现在任一侧就为 True。
    """
    out: dict[str, dict] = {}
    for it in load_collected():
        aid = str(it.get("aweme_id", ""))
        if aid:
            row = dict(it)
            row["in_collection"] = True      # 落库分区用：来自「收藏」
            out[aid] = row
    for it in load_liked():
        aid = str(it.get("aweme_id", ""))
        if not aid:
            continue
        cur = out.get(aid)
        if cur is None:
            row = dict(it)
            row["liked"] = True
            row["in_collection"] = False     # 仅在「喜欢」里
            out[aid] = row
        else:
            cur["liked"] = True
            cur["in_collection"] = True
            merged = list(dict.fromkeys(
                (cur.get("folders") or []) + (it.get("folders") or [])))
            cur["folders"] = [f for f in merged if f and f != LIKED_TAG]
            for k, v in it.items():
                if v and not cur.get(k):
                    cur[k] = v
    return list(out.values())


def item_map() -> dict[str, dict]:
    return {str(it.get("aweme_id", "")): it for it in load_all()}


# ---- 取消收藏 / 取消喜欢 后的本地同步 ----
def load_removed() -> list[dict]:
    """取消操作的审计日志（时间倒序无关，按写入顺序追加）。"""
    data = _read_json_cached(REMOVED_PATH, [])
    return data if isinstance(data, list) else []


def log_removed(entries: list[dict]) -> None:
    """追加审计记录。

    只记「确实执行过」的条目（成功或失败都记），不记本地隐藏之类的无副作用操作。
    保留最近 5000 条，避免无限膨胀。
    """
    if not entries:
        return
    rows = load_removed()
    rows.extend(entries)
    REMOVED_PATH.write_text(
        json.dumps(rows[-5000:], ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(REMOVED_PATH)


def drop_items(src: str, ids: list[str]) -> dict:
    """把条目从本地列表里去掉。src=fav → collected.json；src=like → liked.json。

    只动指定来源那一份文件：一条视频既收藏又点赞时，取消收藏不会把它从「喜欢」里抹掉。
    """
    idset = {str(i) for i in ids if str(i)}
    if not idset:
        return {"before": 0, "after": 0, "removed": 0}
    if src == "like":
        path, rows = LIKED_PATH, load_liked()
    else:
        path, rows = COLLECTED_PATH, load_collected()
    before = len(rows)
    kept = [r for r in rows if str(r.get("aweme_id", "")) not in idset]
    path.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(path)
    return {"before": before, "after": len(kept), "removed": before - len(kept)}


# ---- 一次性迁移：把旧版混在 collected.json 里的「喜欢」搬到 liked.json ----
def migrate_liked_split() -> dict:
    """旧版把「喜欢」当成虚拟分组塞在 collected.json 的 folders 里。

    迁移规则：
      - liked=True 且没有真实收藏夹  → 移出 collected.json，只留 liked.json
      - liked=True 且有真实收藏夹    → 两边都留（收藏视图 + 喜欢视图都会出现）
      - 所有条目 folders 里清掉虚拟分组「喜欢」
    幂等：反复执行结果一致。
    """
    favs = load_collected()
    if not favs:
        return {"moved": 0, "kept": 0, "fav_left": 0, "liked_total": 0}

    liked_map = {str(it.get("aweme_id", "")): dict(it) for it in load_liked()}
    kept_favs: list[dict] = []
    moved = kept = 0

    for it in favs:
        aid = str(it.get("aweme_id", ""))
        folders = [f for f in (it.get("folders") or []) if f and f != LIKED_TAG]
        is_liked = bool(it.get("liked")) or LIKED_TAG in (it.get("folders") or [])
        row = dict(it)
        row["folders"] = folders
        if is_liked:
            row["liked"] = True
            liked_map.setdefault(aid, dict(row))
            if folders:
                kept_favs.append(row)      # 真收藏夹里的，保留在收藏视图
                kept += 1
            else:
                moved += 1                  # 纯点赞，移出收藏
        else:
            kept_favs.append(row)

    COLLECTED_PATH.write_text(
        json.dumps(kept_favs, ensure_ascii=False, indent=2), encoding="utf-8")
    _drop_cache(COLLECTED_PATH)
    save_liked(list(liked_map.values()))
    return {"moved": moved, "kept": kept,
            "fav_left": len(kept_favs), "liked_total": len(liked_map)}


# ---------------- 转写 ----------------
def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean_env() -> dict:
    env = os.environ.copy()
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
              "ALL_PROXY", "all_proxy"):
        env.pop(k, None)
    return env


def extract_audio_from_url(url: str, out_wav: Path, timeout_s: int = 600) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，请加入 PATH")
    cmd = [
        ffmpeg, "-y", "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "-referer", "https://www.douyin.com/",
        "-i", url,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(out_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s, env=_clean_env())
    if proc.returncode != 0 or not out_wav.exists() or out_wav.stat().st_size < 1024:
        tail = (proc.stderr or "")[-400:]
        raise RuntimeError(f"ffmpeg 抽音频失败: {tail}")


def build_markdown(item: dict, transcript: str, source_kind: str,
                   *, lang: str = "", translation: str = "",
                   pairs: list[tuple[str, str]] | None = None) -> str:
    """渲染笔记 Markdown。

    pairs 非空 → 输出「中英对照」：每段原文紧跟对应译文（逐段交替）；
    pairs 为空 → 输出原文整段，translation 非空时再补一节 AI 中文翻译。
    """
    all_folders = list(item.get("folders") or [])
    liked = bool(item.get("liked")) or LIKED_TAG in all_folders
    # 真实收藏夹 与「喜欢」虚拟分组分开：folders 字段只放真收藏夹，喜欢单独成字段/tag
    folders = [f for f in all_folders if f != LIKED_TAG]
    tag_extra = folders + ([LIKED_TAG] if liked else [])
    tags = list(dict.fromkeys(["抖音", "收藏", "转写"] + tag_extra))

    lines = [
        "---",
        "type: 抖音收藏转写",
        "source: 抖音收藏",
        f"aweme_id: \"{item.get('aweme_id','')}\"",
        f"url: {item.get('video_url','')}",
        f"author: \"{item.get('author','')}\"",
        f"published: {item.get('published','')}",
        f"duration: {item.get('duration','')}",
        f"lang: {lang or 'zh'}",
    ]
    if pairs:
        lines.append("bilingual: true")
    lines += [
        f"liked: {'true' if liked else 'false'}",
        f"transcribed_at: {_now()}",
        f"source_kind: {source_kind}",
    ]
    if folders:
        lines.append("folders:")
        for f in folders:
            lines.append(f"  - {f}")
    else:
        lines.append("folders: []")
    lines.append("tags:")
    for t in tags:
        lines.append(f"  - {t}")
    lines += [
        "---",
        "",
        f"# {item.get('title','')}",
        "",
        "> 作者：" + str(item.get("author", ""))
        + " ｜ " + str(item.get("published", ""))
        + " ｜ " + str(item.get("video_url", ""))
        + ("　｜　收藏夹：" + " / ".join(folders) if folders else "")
        + ("　｜　喜欢" if liked else ""),
        "",
        "---",
        "",
    ]
    if pairs:
        lines += ["## 📖 中英对照", ""]
        for src, zh in pairs:
            lines += [str(src).strip(), "", str(zh).strip(), ""]
    else:
        lines += [transcript.strip(), ""]
        if translation:
            lines += [
                "---",
                "",
                "## 🌐 中文翻译（AI）",
                "",
                translation.strip(),
                "",
            ]
    lines.append("")
    return "\n".join(lines)


def _iter_note_files(obsidian_root: Path):
    """递归遍历落库根下所有【转写】笔记。

    排除：
      - `AI总结/`（总结笔记的 frontmatter 也带 aweme_id，会被误当成转写笔记覆盖）
      - 任何以 `.` 开头的目录（Obsidian 配置、系统目录）
    """
    if not obsidian_root.exists():
        return
    try:
        paths = sorted(obsidian_root.rglob("*.md"))
    except OSError:
        return
    for p in paths:
        try:
            rel = p.relative_to(obsidian_root).parts
        except ValueError:
            continue
        parents = rel[:-1]
        if any(part == SUMMARY_SUBDIR or part.startswith(".") for part in parents):
            continue
        yield p


def _find_notes_by_aweme_id(obsidian_root: Path, aweme_id: str) -> list[Path]:
    """在落库根下按 frontmatter 的 aweme_id 找【所有】已有笔记（递归）。

    命中多个收藏夹时同一条视频会存多份，故返回列表。
    重跑同一条视频时直接覆盖原文件：否则去重逻辑会生成「标题_2.md」副本，
    越重跑越多，且旧笔记里的错误内容仍留在库里。
    """
    if not aweme_id:
        return []
    needle = f'aweme_id: "{aweme_id}"'
    hits: list[Path] = []
    for p in _iter_note_files(obsidian_root):
        try:
            with p.open(encoding="utf-8") as fh:
                head = "".join(fh.readlines()[:24])   # frontmatter 必在前 24 行内
        except (OSError, UnicodeDecodeError):
            continue
        if needle in head:
            hits.append(p)
    return hits


def _norm_dir_name(name: str) -> str:
    """把收藏夹名安全化成目录名（去掉路径分隔符等非法字符）。"""
    s = (sanitize_filename(str(name)) or "").strip().strip(".")
    return s or "_未命名分组"


def is_liked_only(item: dict) -> bool:
    """是否属于「喜欢」桶：仅点赞、未收藏。

    load_all() 会给收藏来的条目标 in_collection=True。老数据没有该字段时，
    退回「liked 且有收藏夹归属 → 视为收藏」的保守判断。
    """
    if "in_collection" in item:
        return (not item.get("in_collection")) and bool(item.get("liked"))
    return bool(item.get("liked"))


def note_dirs_for(obsidian_root: Path, item: dict) -> list[Path]:
    """算出该条目笔记应落的目录（可能多个：命中多个收藏夹时各存一份）。

    收藏 → 收藏/<收藏夹名>/；命中多个收藏夹则每个夹都存一份；无归属 → 收藏/ 顶层。
    仅喜欢 → 喜欢/。
    """
    folders = [f for f in (item.get("folders") or []) if f and f != LIKED_TAG]
    if folders:
        dirs: list[Path] = []
        for f in folders:
            d = obsidian_root / FAV_SUBDIR / _norm_dir_name(f)
            if d not in dirs:
                dirs.append(d)
        return dirs
    if is_liked_only(item):
        return [obsidian_root / LIKED_SUBDIR]
    return [obsidian_root / FAV_SUBDIR]


def _carry_highlights(old_path: Path, fresh: str, item: dict) -> str:
    """重转写会整篇覆盖。覆盖前把旧笔记里的划线迁到新正文上。

    指纹命中就更新偏移，四级规则都不中就标 stale —— 只留 quote，
    不假装它还停在原位。迁移失败一律返回新正文，绝不能挡住转写落库。
    """
    if highlights_mod is None:
        return fresh
    try:
        old_text = old_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return fresh
    if not old_text:
        return fresh
    try:
        merged, stats = highlights_mod.carry_over(old_text, fresh)
        if stats.get("total"):
            item.setdefault("_highlight_carry", {}).update(stats)
        return merged
    except Exception:  # noqa: BLE001
        return fresh


def write_note(obsidian_dir: Path, item: dict, transcript: str, source_kind: str,
               *, lang: str = "", translation: str = "",
               pairs: list[tuple[str, str]] | None = None) -> list[Path]:
    """按来源/收藏夹写入笔记，返回实际写入的文件路径列表。

    落点规则见 note_dirs_for()。重跑同一条视频时先递归找到旧笔记（含子目录），
    复用其文件名覆盖；归属发生变化时把旧副本「搬」到新目录，多余副本移除，
    因此不会产生「标题_2」之类的重复文件。
    """
    aid = str(item.get("aweme_id") or "")
    text = build_markdown(item, transcript, source_kind, lang=lang,
                          translation=translation, pairs=pairs)

    dirs = note_dirs_for(obsidian_dir, item)
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)

    existing = _find_notes_by_aweme_id(obsidian_dir, aid)
    written: list[Path] = []
    used: set[Path] = set()

    # 1) 目标目录里已有同 aweme_id 的笔记 → 原地覆盖（文件名保持不变）
    for d in dirs:
        hit = next((p for p in existing if p.parent == d and p not in used), None)
        if hit is not None:
            hit.write_text(_carry_highlights(hit, text, item), encoding="utf-8")
            used.add(hit)
            written.append(hit)

    # 2) 其余目标目录：优先把已有的旧副本「搬」过来（沿用旧文件名），否则新起名
    leftovers = [p for p in existing if p not in used]
    done_dirs = {p.parent for p in written}
    for d in dirs:
        if d in done_dirs:
            continue
        if leftovers:
            src = leftovers.pop(0)
            tgt = d / src.name
            if tgt.exists():
                counter = 1
                while (d / f"{src.stem}_{counter}{src.suffix}").exists():
                    counter += 1
                tgt = d / f"{src.stem}_{counter}{src.suffix}"
            # 先按旧副本算出「带划线」的新正文，再搬移（搬完 src 就没了）
            carried = _carry_highlights(src, text, item)
            try:
                shutil.move(str(src), str(tgt))
            except OSError:
                pass
            tgt.write_text(carried, encoding="utf-8")
        else:
            stem = sanitize_filename(item.get("title") or aid or "未命名") or aid
            name, counter = stem, 1
            while (d / f"{name}.md").exists():
                counter += 1
                name = f"{stem}_{counter}"
            tgt = d / f"{name}.md"
        tgt.write_text(text, encoding="utf-8")
        written.append(tgt)

    # 3) 归属变化后遗留的旧副本 → 移除（内容已在新位置重建；BaseException 兜底防删除钩子穿透）
    for p in leftovers:
        try:
            p.unlink()
        except BaseException:  # noqa: BLE001
            pass

    return written


# 句末标点切分：英文/西文需「标点 + 空白」，中日韩标点可直接切。
_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+|(?<=[。！？；])")


def _merge_sentences(text: str) -> list[str]:
    """把 Whisper 按停顿切碎的片段，合并回完整句子。

    逐句对照若直接按 Whisper 的 segment 对齐，会因「半句断行」而错位：
    翻译按整句语义回，行数对不上就降级。送译前先合并成完整句子，
    对齐单位从「碎片」变成「句子」——AI 只需保持句子数一致（比保持碎片数
    可靠得多），且每句都有完整上下文，译文也更准。
    """
    s = " ".join(ln.strip() for ln in (text or "").split("\n") if ln.strip())
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return []
    parts = [p.strip() for p in _SENT_SPLIT.split(s) if p and p.strip()]
    return parts or [s]


def _bilingual_pairs(text: str, title: str) -> list[tuple[str, str]]:
    """把外文稿件按【整句】逐句翻译，返回 [(原文句, 中文句)]。

    先合并成完整句子再逐句送译；句子数对不上（AI 报错 / 编号不齐）时
    返回空列表，由调用方降级为整段翻译 —— 宁可不做对照，也不做错位的对照。
    """
    sents = _merge_sentences(text)
    if not sents:
        return []
    try:
        zh = ai_mod.translate_aligned(sents, title)
    except Exception:  # noqa: BLE001  降级由调用方处理
        return []
    if len(zh) != len(sents):
        return []
    return list(zip(sents, zh))


def transcribe_one(
    item: dict,
    obsidian_dir: Path = DEFAULT_OBSIDIAN,
    model: str = DEFAULT_MODEL,
    log: callable = print,
    translate_mode: str | None = None,
) -> dict:
    """转写单条。返回 {aweme_id, ok, word_count, note_path, error}，并更新 progress.json。

    translate_mode: 外文视频的翻译模式，"aligned"(逐句对照) / "whole"(整段翻译)。
    留空则用 TRANSLATE_MODE（可由环境变量 DOUYIN_TRANSLATE_MODE 配置）。
    """
    aid = str(item.get("aweme_id", ""))
    status = load_status()
    play = item.get("play_addr") or item.get("play_addr_wm")

    work_dir = WORK_DIR / aid
    work_dir.mkdir(parents=True, exist_ok=True)
    wav = work_dir / "audio.wav"
    source_kind = "play_addr"
    url = play

    try:
        if not url:
            raise RuntimeError("无可用播放地址(play_addr 为空)")
        if wav.exists() and wav.stat().st_size > 4096:
            log(f"[{aid}] 复用已有音频")
        else:
            try:
                extract_audio_from_url(url, wav)
            except Exception:
                if url != item.get("play_addr_wm") and item.get("play_addr_wm"):
                    url = item["play_addr_wm"]
                    source_kind = "play_addr_wm"
                    extract_audio_from_url(url, wav)
                else:
                    raise
            log(f"[{aid}] 音频抽取完成 {wav.stat().st_size//1024}KB")

        # 语言判定：始终把 language 交给 Whisper 自动检测，不按标题写死。
        # 曾经的写法是"标题含中文 → language='zh'"，但英语学习类视频的标题恰恰是
        # 中文的（#英语 标签 + 中文标题），于是英文音频被按中文解码，输出一堆
        # 机翻腔乱码 + "请不吝点赞订阅转发"这类幻听复读，且 lang=zh 还会顺带
        # 跳过 AI 翻译 —— 既没英文原文也没中文译文。
        # 自动检测之外仍保留标题先验：标题像中文时先按中文风格解码；
        # 若检测出的语言与提示词语言冲突，再用检测到的语言重跑一次（只有这种
        # 少数情况才多花一趟，中文视频依旧只跑一趟）。
        hint_lang = "zh" if _has_cjk(item.get("title") or "") else ""
        res = transcribe_audio(
            wav,
            model_size=model,
            language=None,                      # 自动检测，不写死
            beam_size=BEAM_SIZE,
            initial_prompt=build_prompt(item, hint_lang) or None,
            hotwords=build_hotwords(item) or None,
            condition_on_previous_text=False,   # 短视频避免以上文为条件产生串词/复读
        )
        lang = (getattr(res, "language", "") or "").lower()
        if hint_lang and lang not in ZH_LANGS:
            log(f"[{aid}] 标题像中文但音频检测为『{lang or '未知'}』，按检测语言重跑…")
            try:
                res = transcribe_audio(
                    wav,
                    model_size=model,
                    language=lang or None,
                    beam_size=BEAM_SIZE,
                    initial_prompt=build_prompt(item, lang) or None,
                    hotwords=build_hotwords(item) or None,
                    condition_on_previous_text=False,
                )
                lang = (getattr(res, "language", "") or "").lower()
            except Exception as e:  # noqa: BLE001
                log(f"[{aid}] ⚠ 重跑失败，沿用首次结果: {e}")

        translation = ""
        pairs: list[tuple[str, str]] = []
        if lang and lang not in ZH_LANGS:
            mode = _norm_translate_mode(translate_mode)
            log(f"[{aid}] 检测到语言『{lang}』，翻译模式=『{mode}』，调用 AI…")
            if ai_mod is None:
                log(f"[{aid}] ⚠ 翻译失败（保留原文）: AI 模块不可用（httpx 缺失）")
            elif mode == "whole":
                # 用户显式选择整段翻译：整篇一次翻完，附在原文之后
                try:
                    translation = ai_mod.translate_to_zh(res.text, item.get("title", ""))
                    log(f"[{aid}] ✓ 整段中文翻译 {len(translation)} 字")
                except Exception as e:  # noqa: BLE001
                    log(f"[{aid}] ⚠ 翻译失败（保留原文）: {e}")
            else:
                # 默认逐句对照：按句合并 → 逐句翻译 → 结构对齐
                pairs = _bilingual_pairs(res.text, item.get("title", ""))
                if pairs:
                    log(f"[{aid}] ✓ 逐句中英对照 {len(pairs)} 句")
                else:
                    # 逐句对齐失败 → 仍以「有内容」优先，降级为整段翻译
                    try:
                        translation = ai_mod.translate_to_zh(res.text, item.get("title", ""))
                        log(f"[{aid}] ⚠ 逐句对齐失败，降级为整段翻译 {len(translation)} 字")
                    except Exception as e:  # noqa: BLE001
                        log(f"[{aid}] ⚠ 翻译失败（保留原文）: {e}")

        wc = len(res.text.replace("\n", ""))
        if wc == 0:
            if aid not in status.skipped:
                status.skipped.append(aid)
                save_status(status)
            log(f"[{aid}] 无语音内容，记为跳过")
            return {"aweme_id": aid, "ok": False, "state": "skipped", "word_count": 0,
                    "note_path": "", "error": "无语音内容"}

        note_paths = write_note(obsidian_dir, item, res.text, source_kind,
                                lang=lang, translation=translation, pairs=pairs)
        note_path = note_paths[0] if note_paths else None
        if aid not in status.ok:
            status.ok.append(aid)
        # 从 fail 里移除(若重跑成功)
        if aid in status.fail:
            status.fail.remove(aid)
        save_status(status)
        _cleanup_work_dir(work_dir)
        log(f"[{aid}] ✓ 转写成功 {wc} 字 -> {note_path}")
        if len(note_paths) > 1:
            log(f"[{aid}]   命中 {len(note_paths)} 个收藏夹，已各存一份："
                + " | ".join(str(p) for p in note_paths[1:]))
        return {"aweme_id": aid, "ok": True, "state": "ok", "word_count": wc,
                "note_path": str(note_path or ""), "error": ""}

    except Exception as e:  # noqa: BLE001
        msg = f"{e}"
        if aid not in status.fail:
            status.fail.append(aid)
        save_status(status)
        log(f"[{aid}] ✗ 失败: {msg}")
        return {"aweme_id": aid, "ok": False, "state": "fail", "word_count": 0,
                "note_path": "", "error": msg}


def transcribe_many(
    items: list[dict],
    obsidian_dir: Path = DEFAULT_OBSIDIAN,
    model: str = DEFAULT_MODEL,
    log: callable = print,
    force: bool = False,
    translate_mode: str | None = None,
) -> list[dict]:
    """按顺序转写列表。

    force=True 时连已是 ok 的条目也重跑并覆盖旧笔记（「重新转录」）。
    否则跳过已是 ok 的。
    """
    results = []
    status = load_status()
    for it in items:
        aid = str(it.get("aweme_id", ""))
        if not force and status.state_of(aid) == "ok":
            results.append({"aweme_id": aid, "ok": True, "state": "ok",
                            "word_count": 0, "note_path": "", "error": "", "skipped_dup": True})
            continue
        results.append(transcribe_one(it, obsidian_dir=obsidian_dir, model=model, log=log,
                                      translate_mode=translate_mode))
    return results


# ---------------- AI 总结 ----------------
def load_summaries() -> dict:
    if SUMMARIES_PATH.exists():
        try:
            return json.loads(SUMMARIES_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_summaries(d: dict) -> None:
    SUMMARIES_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def find_note(obsidian_dir: Path, aweme_id: str) -> Path | None:
    """按 frontmatter 里的 aweme_id 找到已生成的转写笔记（递归子目录）。"""
    hits = _find_notes_by_aweme_id(obsidian_dir, aweme_id)
    return hits[0] if hits else None


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return text.strip()


def _inherit_meta(note_text: str, item: dict) -> tuple[list[str], str]:
    """从源笔记的 frontmatter 继承 folders / lang（取不到则退回 item）。

    总结笔记本来只有「总结」一个 tag，带上 folders 后就能和转写笔记一样按收藏夹筛选。
    """
    folders = [f for f in (item.get("folders") or []) if f and f != LIKED_TAG]
    lang = ""
    m = re.match(r"^---\s*\n(.*?)\n---", note_text, re.S)
    if not m:
        return folders, lang
    fm = m.group(1)
    lm = re.search(r"^lang:\s*(.+)$", fm, re.M)
    if lm:
        lang = lm.group(1).strip().strip("\"'")
    if not folders:
        block = re.search(r"^folders:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)", fm, re.M)
        if block:
            folders = [ln.strip().lstrip("-").strip().strip("\"'")
                       for ln in block.group(1).splitlines()
                       if ln.strip() and ln.strip().lstrip("-").strip() != LIKED_TAG]
    return folders, lang


def _summary_frontmatter(item: dict, kind: str, extra: list[str] | None = None,
                         *, folders: list[str] | None = None, lang: str = "") -> str:
    liked = bool(item.get("liked")) or LIKED_TAG in (item.get("folders") or [])
    lines = [
        "---",
        f"type: {kind}",
        "source: 抖音收藏",
        f"aweme_id: \"{item.get('aweme_id','')}\"",
        f"url: {item.get('video_url','')}",
        f"author: \"{item.get('author','')}\"",
        f"summarized_at: {_now()}",
        f"lang: {lang or 'zh'}",
        f"liked: {'true' if liked else 'false'}",
    ]
    folders = [f for f in (folders or []) if f and f != LIKED_TAG]
    if folders:
        lines.append("folders:")
        lines += [f"  - {f}" for f in folders]
    if extra:
        lines += extra
    lines += ["tags:", "  - 抖音", "  - 总结"]
    lines += [f"  - {f}" for f in folders]
    if liked:
        lines.append(f"  - {LIKED_TAG}")
    lines += ["---", ""]
    return "\n".join(lines)


def summarize_one(item: dict, obsidian_dir: Path = DEFAULT_OBSIDIAN,
                  topic: str = "", log: callable = print) -> dict:
    """对单条视频生成 AI 总结笔记，落到 抖音收藏/AI总结/。"""
    aid = str(item.get("aweme_id", ""))
    if ai_mod is None:
        return {"aweme_id": aid, "ok": False, "state": "fail", "error": "AI 模块不可用"}
    note = find_note(obsidian_dir, aid)
    if note is None:
        return {"aweme_id": aid, "ok": False, "state": "fail",
                "error": "找不到转写笔记（请先转写这条）"}
    raw = note.read_text(encoding="utf-8", errors="ignore")
    body = strip_frontmatter(raw)
    folders, lang = _inherit_meta(raw, item)
    log(f"[{aid}] 调用 AI 总结…")
    try:
        summary = ai_mod.summarize(
            item.get("title", ""), body,
            folder=" / ".join(folders),
            author=item.get("author", ""),
        )
    except Exception as e:  # noqa: BLE001
        log(f"[{aid}] ✗ 总结失败: {e}")
        return {"aweme_id": aid, "ok": False, "state": "fail", "error": str(e)}

    out_dir = obsidian_dir / SUMMARY_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = sanitize_filename(item.get("title") or aid) or aid
    target = out_dir / f"{stem} - 总结.md"
    target.write_text(
        _summary_frontmatter(item, "抖音视频总结", folders=folders, lang=lang)
        + f"# {item.get('title','')} · 总结\n\n[[{note.stem}]]\n\n---\n\n{summary.strip()}\n",
        encoding="utf-8",
    )
    d = load_summaries()
    d[aid] = {"note": str(target), "at": _now(), "title": item.get("title", "")}
    save_summaries(d)
    log(f"[{aid}] ✓ 总结 -> {target}")
    return {"aweme_id": aid, "ok": True, "state": "ok", "note_path": str(target), "error": ""}


def summarize_notes(items: list[dict], obsidian_dir: Path = DEFAULT_OBSIDIAN,
                    topic: str = "", log: callable = print) -> dict:
    """把多条已转写笔记汇总成一篇主题综述。"""
    if ai_mod is None:
        return {"ok": False, "error": "AI 模块不可用"}
    notes, missing = [], []
    for it in items:
        aid = str(it.get("aweme_id", ""))
        p = find_note(obsidian_dir, aid)
        if p is None:
            missing.append(aid)
            continue
        notes.append({
            "title": it.get("title", ""),
            "author": it.get("author", ""),
            "content": strip_frontmatter(p.read_text(encoding="utf-8", errors="ignore")),
        })
    if not notes:
        return {"ok": False, "error": "选中的视频都还没转写，无法总结"}
    log(f"汇总 {len(notes)} 篇笔记…")
    try:
        text = ai_mod.summarize_many(notes, topic=topic)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}

    # 综述笔记继承所选条目的收藏夹（并集），便于按收藏夹筛选
    folders: list[str] = []
    liked = False
    for it in items:
        if it.get("liked") or LIKED_TAG in (it.get("folders") or []):
            liked = True
        for f in (it.get("folders") or []):
            if f and f != LIKED_TAG and f not in folders:
                folders.append(f)

    out_dir = obsidian_dir / SUMMARY_SUBDIR
    out_dir.mkdir(parents=True, exist_ok=True)
    name = topic or f"主题综述 {datetime.now().strftime('%Y%m%d-%H%M')}"
    target = out_dir / f"{sanitize_filename(name)}.md"
    fm_lines = ["---", "type: 抖音主题综述", f"summarized_at: {_now()}",
                f"source_count: {len(notes)}",
                f"liked: {'true' if liked else 'false'}"]
    if folders:
        fm_lines.append("folders:")
        fm_lines += [f"  - {f}" for f in folders]
    fm_lines += ["tags:", "  - 抖音", "  - 总结", "  - 主题综述"]
    fm_lines += [f"  - {f}" for f in folders]
    if liked:
        fm_lines.append(f"  - {LIKED_TAG}")
    fm_lines += ["---", ""]
    target.write_text(
        "\n".join(
            fm_lines
            + [
                f"# {name}",
                "",
                f"> 综合 {len(notes)} 条抖音视频笔记"
                + (f"（未转写跳过 {len(missing)} 条）" if missing else ""),
                "",
                "---",
                "",
                text.strip(),
                "",
            ]
        ),
        encoding="utf-8",
    )
    log(f"✓ 主题综述 -> {target}")
    return {"ok": True, "note_path": str(target), "count": len(notes), "error": ""}
