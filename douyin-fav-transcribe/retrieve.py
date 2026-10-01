# -*- coding: utf-8 -*-
"""SQLite FTS over Obsidian markdown notes. Local-only.

检索策略（P0 定稿，别改）：

1. **全文检索永远是默认路径**，向量只是可选叠加。向量没装、装坏、
   加载失败、算不出向量 —— 任何一步出问题都静默退回全文检索，绝不
   因为向量挂了就让「搜不到」。
2. 命中排序先做作用域加权：同一条视频（score 2.0）> 同一个收藏夹（1.5）
   > 全库（1.0）。有作用域内的命中就只给作用域内的，否则才给全库。
3. 向量命中只做**补充**：同 aweme_id 去重后取分数高的那条，不会
   把全文命中的结果挤掉。
4. 检索结果为空的诚实性由调用方（Node agent）保证：空就是空，
   不允许编出处。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

STATE_DIR = Path(__file__).resolve().parent / "state"
DB_PATH = STATE_DIR / "retrieve-index.sqlite"
VENV_DIR = STATE_DIR / "venv-vector"
MODEL_DIR = STATE_DIR / "vector-models"
DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
PIP_INDEX = os.environ.get("DOUYIN_PIP_INDEX") or "https://pypi.tuna.tsinghua.edu.cn/simple"
HF_ENDPOINT = os.environ.get("HF_ENDPOINT") or "https://hf-mirror.com"

_FM = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?", re.S)


def _parse_fm(text: str) -> tuple[dict, str]:
    meta: dict = {}
    m = _FM.match(text)
    body = text
    if m:
        raw = m.group(1)
        body = text[m.end():]
        aid = re.search(r'aweme_id:\s*"([^"]*)"', raw)
        if aid:
            meta["aweme_id"] = aid.group(1)
        if "folders:" in raw:
            block = raw.split("folders:", 1)[1]
            stop = re.search(r"\n[a-zA-Z_]+:", block)
            chunk = block[: stop.start()] if stop else block
            meta["folders"] = [x.strip() for x in re.findall(r"-\s+(.+)", chunk) if x.strip() != "[]"]
        title = re.search(r"^#\s+(.+)$", body, re.M)
        if title:
            meta["title"] = title.group(1).strip()
    return meta, body


# --------------------------------------------------------------- 向量运行时

_embedder = None
_embed_failed = False
_embed_error = ""
_site_ready = False


def _activate_local_venv() -> bool:
    """把 state/venv-vector 的 site-packages 挂进 sys.path。

    这样「一键安装」装完就能在当前进程生效，不必手动换解释器重启。
    """
    global _site_ready
    if _site_ready:
        return True
    if not VENV_DIR.is_dir():
        return False
    cands = [
        VENV_DIR / "Lib" / "site-packages",            # Windows
        *sorted(VENV_DIR.glob("lib/python3.*/site-packages")),  # POSIX
    ]
    added = False
    for sp in cands:
        if sp.is_dir() and str(sp) not in sys.path:
            sys.path.insert(0, str(sp))
            added = True
    if added:
        import importlib

        importlib.invalidate_caches()
    _site_ready = True
    return added


def _model_ref() -> str:
    """优先用本地已下好的模型目录，其次用 HF 上的名字。"""
    want = os.environ.get("DOUYIN_EMBED_MODEL") or DEFAULT_MODEL
    local = MODEL_DIR / want.replace("/", "__")
    if local.is_dir() and any(local.iterdir()):
        return str(local)
    return want


def _embed(text: str) -> list[float] | None:
    """有本地句向量模型才用。没装或加载失败就返回 None，检索退回全文。"""
    global _embedder, _embed_failed, _embed_error
    if _embed_failed:
        return None
    _activate_local_venv()
    try:
        if _embedder is None:
            from sentence_transformers import SentenceTransformer

            _embedder = SentenceTransformer(_model_ref())
        vec = _embedder.encode((text or "")[:1500], normalize_embeddings=True)
        return [float(x) for x in vec]
    except Exception as exc:  # noqa: BLE001
        _embed_failed = True
        _embed_error = f"{type(exc).__name__}: {exc}"[:300]
        _embedder = None
        return None


def embed_available() -> bool:
    """向量能力是否真的可用（会尝试加载一次模型）。"""
    return _embed("探测") is not None


def vector_status() -> dict:
    _activate_local_venv()
    installed = False
    version = ""
    try:
        import importlib.metadata as md

        version = md.version("sentence-transformers")
        installed = True
    except Exception:  # noqa: BLE001
        installed = False
    local_model = MODEL_DIR / (os.environ.get("DOUYIN_EMBED_MODEL") or DEFAULT_MODEL).replace("/", "__")
    return {
        "installed": installed,
        "package_version": version,
        "venv": str(VENV_DIR),
        "venv_exists": VENV_DIR.is_dir(),
        "model": os.environ.get("DOUYIN_EMBED_MODEL") or DEFAULT_MODEL,
        "model_dir": str(local_model),
        "model_cached": local_model.is_dir() and any(local_model.iterdir()),
        "loaded": _embedder is not None,
        "failed": _embed_failed,
        "error": _embed_error,
        "pip_index": PIP_INDEX,
        "hf_endpoint": HF_ENDPOINT,
        # 关键约定：向量只是叠加，关掉/装不上都还有全文检索
        "fallback": "全文检索（FTS）",
    }


def reset_embedder() -> None:
    """装完向量包后清掉失败缓存，让下一次检索重新尝试加载。"""
    global _embedder, _embed_failed, _embed_error
    _embedder = None
    _embed_failed = False
    _embed_error = ""


def refresh_paths() -> None:
    """一键安装完成后调用：重扫本地 venv 路径 + 清加载缓存。"""
    global _site_ready
    _site_ready = False
    _activate_local_venv()
    reset_embedder()


# ------------------------------------------------------------------- 索引

def _conn() -> sqlite3.Connection:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.execute(
        """CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path, title, aweme_id, folders, body
    )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS notes_vec(
        path TEXT PRIMARY KEY, title TEXT, aweme_id TEXT, vec TEXT
    )"""
    )
    return c


def rebuild(obsidian_dir: Path) -> int:
    reset_embedder()
    c = _conn()
    c.execute("DELETE FROM notes_fts")
    c.execute("DELETE FROM notes_vec")
    n = 0
    if obsidian_dir.is_dir():
        for p in obsidian_dir.rglob("*.md"):
            if p.name.lower() == "memory.md":
                continue
            try:
                text = p.read_text(encoding="utf-8")
            except OSError:
                continue
            meta, body = _parse_fm(text)
            c.execute(
                "INSERT INTO notes_fts(path, title, aweme_id, folders, body) VALUES (?,?,?,?,?)",
                (
                    str(p),
                    meta.get("title") or p.stem,
                    meta.get("aweme_id") or "",
                    " ".join(meta.get("folders") or []),
                    body[:200_000],
                ),
            )
            n += 1
            vec = _embed(f"{meta.get('title') or p.stem}\n{body[:1500]}")
            if vec:
                c.execute(
                    "INSERT OR REPLACE INTO notes_vec(path, title, aweme_id, vec) VALUES (?,?,?,?)",
                    (str(p), meta.get("title") or p.stem, meta.get("aweme_id") or "", json.dumps(vec)),
                )
    c.commit()
    c.close()
    return n


def _dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _vector_hits(query: str, k: int) -> list[dict]:
    qv = _embed(query)
    if not qv:
        return []
    c = _conn()
    rows = list(c.execute("SELECT path, title, aweme_id, vec FROM notes_vec"))
    c.close()
    scored = []
    for path, title, aid, raw in rows:
        try:
            vec = json.loads(raw)
        except json.JSONDecodeError:
            continue
        scored.append((_dot(qv, vec), path, title, aid))
    scored.sort(key=lambda x: -x[0])
    return [
        {"path": path, "title": title, "aweme_id": aid, "span": "", "score": score, "via": "vector"}
        for score, path, title, aid in scored[:k]
        if score > 0.35
    ]


def _fts_query(q: str) -> str:
    cleaned = re.sub(r"[\"'*():^]", " ", q)
    parts = [p for p in cleaned.split() if p]
    if not parts:
        return ""
    return " OR ".join(f'"{p}"' for p in parts[:8])


def ensure_index(obsidian_dir: Path) -> None:
    if not obsidian_dir.is_dir():
        return
    c = _conn()
    n = c.execute("SELECT COUNT(*) FROM notes_fts").fetchone()[0]
    c.close()
    if n == 0:
        rebuild(obsidian_dir)


def fts_hits(query: str, k: int = 8, video_id: str = "", folder: str = "") -> list[dict]:
    """只走全文检索（评测时会单独调它）。"""
    q = (query or "").strip()
    if not q:
        return []
    c = _conn()
    try:
        sql = ("SELECT path, title, aweme_id, folders, "
               "snippet(notes_fts, 4, '[', ']', '…', 24) "
               "FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?")
        rows = list(c.execute(sql, (_fts_query(q), max(k * 4, 16))))
    except sqlite3.OperationalError:
        rows = []
    c.close()
    hits = []
    for path, title, aid, folders, span in rows:
        if video_id and aid == video_id:
            hits.append({"path": path, "title": title, "aweme_id": aid, "span": span, "score": 2.0, "via": "fts"})
        elif folder and folder in (folders or ""):
            hits.append({"path": path, "title": title, "aweme_id": aid, "span": span, "score": 1.5, "via": "fts"})
        else:
            hits.append({"path": path, "title": title, "aweme_id": aid, "span": span, "score": 1.0, "via": "fts"})
    hits.sort(key=lambda h: -h["score"])
    scoped = [h for h in hits if h["score"] >= 1.5]
    return (scoped if scoped else hits)[:k]


def search(
    query: str,
    k: int = 8,
    video_id: str = "",
    folder: str = "",
    use_vector: bool = True,
) -> list[dict]:
    chosen = fts_hits(query, k=k, video_id=video_id, folder=folder)
    if not use_vector:
        return chosen
    try:
        vectors = _vector_hits(query, k)
    except Exception:  # noqa: BLE001
        vectors = []
    if not vectors:
        return chosen
    merged: dict[str, dict] = {}
    for h in chosen + vectors:
        key = h.get("aweme_id") or h.get("path")
        prev = merged.get(key)
        if not prev or h["score"] > prev["score"]:
            merged[key] = h
        elif prev and h.get("span") and not prev.get("span"):
            prev["span"] = h["span"]
    out = sorted(merged.values(), key=lambda h: -h["score"])
    return out[:k]


# ------------------------------------------------------------------- 评测

def _eval_cases(obsidian_dir: Path, n: int) -> list[dict]:
    """自监督造题：从每篇笔记正文里取一段特征串当 query，期望命中它自己。

    不需要人工标注，能直接量出「向量到底有没有帮上忙」。
    取的是正文里最长的中文片段，避免拿标题这种全文检索必然命中的词。
    """
    notes = sorted(p for p in obsidian_dir.rglob("*.md") if p.name.lower() != "memory.md")
    if not notes:
        return []
    step = max(1, len(notes) // max(1, n))
    picked = notes[::step][:n]
    cases = []
    for p in picked:
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        _meta, body = _parse_fm(text)
        chunks = [c.strip() for c in re.split(r"[\n。！？!?；;]", body) if len(c.strip()) >= 18]
        if not chunks:
            continue
        chunks.sort(key=len, reverse=True)
        probe = chunks[0][:24]
        cases.append({"query": probe, "expect": p.stem, "path": str(p)})
    return cases


def evaluate(obsidian_dir: Path, k: int = 8, n: int = 20) -> dict:
    """对比「只 FTS」与「FTS + 向量」的 recall@k / MRR。"""
    ensure_index(obsidian_dir)
    cases = _eval_cases(obsidian_dir, n)
    if not cases:
        return {"ok": False, "error": "笔记库里没有可造题的正文", "cases": 0}

    def run(use_vector: bool) -> dict:
        hit = 0
        rr = 0.0
        miss: list[dict] = []
        for case in cases:
            hits = search(case["query"], k=k, use_vector=use_vector)
            rank = 0
            for i, h in enumerate(hits, start=1):
                if h.get("title") == case["expect"] or (h.get("path") or "").endswith(case["expect"] + ".md"):
                    rank = i
                    break
            if rank:
                hit += 1
                rr += 1.0 / rank
            else:
                miss.append({"query": case["query"], "expect": case["expect"],
                             "got": [h.get("title") for h in hits[:3]]})
        return {
            "recall": round(hit / len(cases), 4),
            "mrr": round(rr / len(cases), 4),
            "hits": hit,
            "miss": miss[:5],
        }

    base = run(False)
    vec_status = vector_status()
    vector_ok = not vec_status["failed"] and embed_available()
    boosted = run(True) if vector_ok else None
    return {
        "ok": True,
        "cases": len(cases),
        "k": k,
        "fts": base,
        "vector": boosted,
        "vector_available": vector_ok,
        "vector_status": vec_status,
        "delta_recall": (round(boosted["recall"] - base["recall"], 4) if boosted else None),
        "note": ("FTS + 向量" if boosted else "只有 FTS：向量未安装或加载失败，检索本身不受影响"),
    }
