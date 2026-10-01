# -*- coding: utf-8 -*-
"""抖音收藏转写 - 本地网页 GUI

启动：  python app.py   （或双击 start-gui.bat）
访问：  http://127.0.0.1:8899   （端口可用环境变量 DOUYIN_PORT 覆盖）

功能：
  - 卡片网格展示全部收藏：封面缩略图 + 标题 + 作者 + 时长 + 状态徽章
  - 状态：未提取 / 已提取 ✓(盖灰提示,不可重复) / 失败(可重跑) / 跳过(无语音)
  - 搜索过滤、全选未提取、批量/单条转写、实时进度
  - 「重新采集」用已存登录态 headless 刷新收藏
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path

import core
import highlights as highlights_mod
import retrieve as retrieve_index
import vector_setup
from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / "state"
COLLECTED_PATH = STATE_DIR / "collected.json"
OBSIDIAN_DIR = core.DEFAULT_OBSIDIAN

app = Flask(__name__)

# 并发转写 job 表：{job_id: {...}}
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

# 停止标志：{job_id: True} 表示该 job 被请求中止，worker 会在当前条目结束后退出
STOP_FLAGS: dict[str, bool] = {}

# 采集类 job 的子进程句柄，供「停止」直接终止进程（几万条喜欢可能要跑很久）
PROC_HANDLES: dict[str, object] = {}

# 模型目录；可用环境变量 DOUYIN_MODELS_DIR 覆盖。默认值指向同级 cap-backend 的 models。
MODELS_DIR = Path(os.environ.get("DOUYIN_MODELS_DIR") or (Path(__file__).resolve().parent.parent / "cap-backend" / "models"))
ALL_MODELS = ["tiny", "base", "small", "medium", "large-v3"]
# 模型缺失时的下载提示（Systran 仓库里词表是 vocabulary.json / .txt，两者之一必须存在，
# 否则加载会报 "Cannot load the vocabulary from the model directory"）
MODEL_REQUIRED = ["model.bin", "config.json", "tokenizer.json"]
MODEL_VOCAB = ["vocabulary.json", "vocabulary.txt"]


def _is_model_ready(d: Path) -> bool:
    if not all((d / f).is_file() for f in MODEL_REQUIRED):
        return False
    return any((d / v).is_file() for v in MODEL_VOCAB)


def _local_models() -> dict[str, bool]:
    """返回 {模型名: 本地是否已就绪}。未就绪的会触发在线下载（很慢，可能失败）。"""
    return {m: _is_model_ready(MODELS_DIR / f"faster-whisper-{m}") for m in ALL_MODELS}


# ---------- 数据 ----------
# 「喜欢」可能几万条，绝不能每次请求都全量构建 + 全量下发。
# 这里把「按源构建好的快照」按相关文件的 mtime 缓存住，文件没变就直接复用。
_SNAP_CACHE: dict = {"key": None, "fav": [], "like": []}


def _mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def _snap_key():
    return (_mtime(core.COLLECTED_PATH), _mtime(core.LIKED_PATH),
            _mtime(core.PROGRESS_PATH), _mtime(core.SUMMARIES_PATH))


def _augment(item: dict, status: core.Status, summaries: dict | None = None) -> dict:
    summaries = summaries or {}
    aid = str(item.get("aweme_id", ""))
    state = status.state_of(aid)
    return {
        "aweme_id": aid,
        "title": item.get("title") or aid,
        "author": item.get("author") or "",
        "author_uid": item.get("author_uid") or "",
        "published": item.get("published") or "",
        "duration": item.get("duration") or 0,
        "cover": item.get("cover") or "",
        "video_url": item.get("video_url") or "",
        "desc": item.get("desc") or "",
        "folders": [f for f in (item.get("folders") or []) if f],
        "liked": bool(item.get("liked")),
        "summarized": aid in summaries,
        "state": state,
        "can_retry": state in ("fail", "skipped"),
    }


def _snapshots():
    """返回 (收藏快照, 喜欢快照)。两者都已做去重合并与状态附加。"""
    key = _snap_key()
    if _SNAP_CACHE["key"] == key:
        return _SNAP_CACHE["fav"], _SNAP_CACHE["like"]

    status = core.load_status()
    summaries = core.load_summaries()
    merged = {str(x.get("aweme_id", "")): x for x in core.load_all()}

    def build(ids):
        out = []
        for aid in ids:
            it = merged.get(aid)
            if it:
                out.append(_augment(it, status, summaries))
        return out

    fav_ids = [str(x.get("aweme_id", "")) for x in core.load_collected()]
    like_ids = [str(x.get("aweme_id", "")) for x in core.load_liked()]
    fav, like = build(fav_ids), build(like_ids)
    _SNAP_CACHE.update({"key": key, "fav": fav, "like": like})
    return fav, like


def _pick(src: str) -> list[dict]:
    fav, like = _snapshots()
    return fav if src == "fav" else like


def _filter(items: list[dict], folder: str, state: str, q: str) -> list[dict]:
    """服务端筛选：几万条时不能把全量丢给前端过滤。"""
    out = items
    if folder and folder != "all":
        if folder == "__none__":
            out = [it for it in out if not it["folders"]]
        else:
            out = [it for it in out if folder in it["folders"]]
    if state and state != "all":
        if state == "notsum":
            out = [it for it in out if it["state"] == "ok" and not it["summarized"]]
        elif state == "summed":
            out = [it for it in out if it["summarized"]]
        else:
            out = [it for it in out if it["state"] == state]
    if q:
        ql = q.lower()
        out = [it for it in out
               if ql in (it["title"] or "").lower()
               or ql in (it["author"] or "").lower()
               or ql in " ".join(it["folders"]).lower()]
    return out


def _stats_of(items: list[dict]) -> dict:
    n = len(items)
    ok = sum(1 for x in items if x["state"] == "ok")
    fail = sum(1 for x in items if x["state"] == "fail")
    skip = sum(1 for x in items if x["state"] == "skipped")
    return {
        "total": n, "ok": ok, "fail": fail, "skipped": skip,
        "pending": n - ok - fail - skip,
        "summarized": sum(1 for x in items if x["summarized"]),
        "folders": len({f for x in items for f in x["folders"]}),
    }


def _snapshot() -> list[dict]:
    """兼容旧调用：收藏 + 喜欢 的联合视图。"""
    return _pick("fav") + _pick("like")


# ---------- 页面 ----------
@app.route("/")
def index():
    html = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    return html


@app.route("/favicon.ico")
def favicon():
    return ("", 204)


# ---------- API ----------
@app.get("/api/favs")
def api_favs():
    """兼容旧前端：一次返回全部（几万条时不建议用）。"""
    items = _snapshot()
    return jsonify({"total": len(items), "items": items})


def _arg_int(name: str, default: int, lo: int = 0, hi: int = 1000) -> int:
    try:
        v = int(request.args.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


@app.get("/api/items")
def api_items():
    """分页取某一来源的数据。src=fav(收藏) | like(喜欢)。

    查询参数：offset / limit / folder / state / q
    返回 {total, offset, limit, has_more, items}
    """
    src = "like" if request.args.get("src") == "like" else "fav"
    offset = _arg_int("offset", 0, 0, 10_000_000)
    limit = _arg_int("limit", 60, 1, 300)
    hint_total = _arg_int("total_hint", -1, -1, 10_000_000)

    # 客户端已给出总数且筛选未变时，跳过重复的筛选计算（大列表下省时间）
    pool = _pick(src)
    folder = (request.args.get("folder") or "all").strip()
    state = (request.args.get("state") or "all").strip()
    q = (request.args.get("q") or "").strip()
    if folder == "all" and state == "all" and not q and hint_total == len(pool):
        page, total = pool[offset:offset + limit], len(pool)
    else:
        vis = _filter(pool, folder, state, q)
        total = len(vis)
        page = vis[offset:offset + limit]
    return jsonify({"total": total, "offset": offset, "limit": limit,
                    "has_more": offset + len(page) < total, "items": page})


@app.get("/api/stats")
def api_stats():
    """按来源统计。src=fav(默认) | like。"""
    src = "like" if request.args.get("src") == "like" else "fav"
    s = _stats_of(_pick(src))
    s["src"] = src
    if src == "like":
        ck = core.load_liked_cursor()
        s["cursor"] = ck
        s["liked_total"] = len(core.load_liked())
    return jsonify(s)


@app.get("/api/liked/meta")
def api_liked_meta():
    """「喜欢」本地状态：有没有采过、采到多少、断点在哪、是否正在采。"""
    liked = core.load_liked()
    ck = core.load_liked_cursor()
    running = any(j.get("kind") == "collect_liked" and j.get("status") == "running"
                  for j in JOBS.values())
    return jsonify({
        "exists": core.LIKED_PATH.exists(),
        "count": len(liked),
        "cursor": ck,
        "done": bool(ck.get("done")),
        "running": running,
    })


@app.get("/api/folders")
def api_folders():
    """收藏夹列表 + 各自数量 + 已转写数 + 未归类数量（只统计收藏，不含喜欢）。"""
    snap = _pick("fav")
    counts: dict[str, int] = {}
    done: dict[str, int] = {}
    for it in snap:
        for f in it.get("folders") or []:
            counts[f] = counts.get(f, 0) + 1
            if it.get("state") == "ok":
                done[f] = done.get(f, 0) + 1
    none_cnt = sum(1 for it in snap if not it.get("folders"))
    folders = [{"name": k, "count": v, "done": done.get(k, 0)}
               for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    return jsonify({"folders": folders, "uncategorized": none_cnt, "total": len(snap)})


@app.post("/api/transcribe")
def api_transcribe():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    model = body.get("model") or core.DEFAULT_MODEL
    translate_mode = (body.get("translate_mode") or "").strip().lower() or None
    force = bool(body.get("force"))          # 重新转录：连已提取的一起重跑并覆盖旧笔记
    ids = [str(i) for i in ids if str(i)]

    # 模型本地未就绪 → 直接拒绝，避免静默卡在在线下载（HF 直连常超时/401）
    if not _local_models().get(model, False):
        return jsonify({
            "error": f"模型 {model} 本地不存在，需先手动下载到 "
                     f"{MODELS_DIR}/faster-whisper-{model}/（可用 DOUYIN_MODELS_DIR 环境变量指定模型目录）。"
                     f"当前可用：{', '.join(m for m, ok in _local_models().items() if ok) or '无'}"
        }), 400

    items_by_id = {str(it.get("aweme_id", "")): it for it in core.load_all()}
    queue = []
    for aid in ids:
        if aid in items_by_id:
            queue.append(items_by_id[aid])
    if not queue:
        return jsonify({"error": "没有可转写的条目"}), 400

    # 过滤掉已经是 ok 的（已提取）；force=重新转录时不过滤，全部重跑覆盖
    status = core.load_status()
    if force:
        todo = list(queue)
    else:
        todo = [it for it in queue if status.state_of(str(it.get("aweme_id", ""))) != "ok"]
        if not todo:
            return jsonify({"error": "选中的都已提取过（可在卡片上点「重新转录」强制重跑）"}), 400

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "running",
            "total": len(todo),
            "done": 0,
            "ok": 0,
            "fail": 0,
            "skipped": 0,
            "current": "",
            "current_title": "",
            "model": model,
            "translate_mode": translate_mode or core.TRANSLATE_MODE,
            "results": {},
            "message": "",
            "log": [],
            "created": time.time(),
        }

    def worker():
        logs = JOBS[job_id]["log"]
        try:
            for idx, it in enumerate(todo, start=1):
                # 用户点了"停止"→ 在当前条目边界安全退出
                if STOP_FLAGS.get(job_id):
                    with JOBS_LOCK:
                        JOBS[job_id]["status"] = "stopped"
                        JOBS[job_id]["message"] = f"已手动停止（已完成 {idx - 1}/{len(todo)}）"
                    return
                aid = str(it.get("aweme_id", ""))
                with JOBS_LOCK:
                    JOBS[job_id]["current"] = aid
                    JOBS[job_id]["current_title"] = (it.get("title") or aid)[:60]
                try:
                    r = core.transcribe_one(
                        it, obsidian_dir=OBSIDIAN_DIR, model=model,
                        log=lambda m: logs.append(m),
                        translate_mode=translate_mode,
                    )
                except BaseException as e:  # noqa: BLE001
                    # BaseException：环境「安全删除」钩子可能抛 SystemExit，
                    # 必须接住，否则 daemon 线程被打死、job 永远 running/done=0
                    r = {"aweme_id": aid, "ok": False, "state": "fail",
                         "word_count": 0, "note_path": "", "error": str(e)}
                with JOBS_LOCK:
                    j = JOBS[job_id]
                    j["results"][aid] = r
                    j["done"] = idx
                    st = r.get("state")
                    if r.get("ok"):
                        j["ok"] += 1
                        try:
                            retrieve_index.rebuild(OBSIDIAN_DIR)
                        except Exception:
                            pass
                    elif st == "skipped":
                        j["skipped"] += 1
                    else:
                        j["fail"] += 1
                    j["current"] = ""
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "done"
                JOBS[job_id]["message"] = "全部完成"
        except BaseException as e:  # noqa: BLE001
            # BaseException：同上，线程级异常也要接住，保证 job 进入终态
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "total": len(todo)})


@app.get("/api/jobs/<job_id>")
def api_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "job 不存在"}), 404
    out = {k: job.get(k, "") for k in
           ("id", "kind", "src", "status", "total", "done", "ok", "fail", "skipped",
            "current", "current_title", "model", "message")}
    out["summary"] = job.get("summary") or {}
    return jsonify(out)


@app.get("/api/jobs/<job_id>/results")
def api_job_results(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "job 不存在"}), 404
    return jsonify({"results": job["results"], "log": job["log"][-80:]})


@app.post("/api/jobs/<job_id>/stop")
def api_job_stop(job_id):
    """请求停止某个 job。

    转写/总结：在当前条目结束后退出。
    采集喜欢：直接终止子进程（断点已落盘，下次可续采）。
    """
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"error": "job 不存在"}), 404
    STOP_FLAGS[job_id] = True

    p = PROC_HANDLES.get(job_id)
    if p is not None:
        try:
            p.terminate()
        except Exception:  # noqa: BLE001
            pass
        with JOBS_LOCK:
            JOBS[job_id]["message"] = "正在停止采集…（断点已保存）"
        return jsonify({"ok": True, "message": "已终止采集进程"})

    with JOBS_LOCK:
        kind = job.get("kind") or ""
        if kind == "uncollect":
            JOBS[job_id]["message"] = "正在停止…（当前这条处理完就停，已取消的不回滚）"
        elif kind == "summarize":
            JOBS[job_id]["message"] = "正在停止…（当前这条总结完就停）"
        else:
            JOBS[job_id]["message"] = "正在停止…（当前这条转完就停）"
    return jsonify({"ok": True, "message": "已发送停止请求"})


@app.get("/api/models")
def api_models():
    """本地模型可用性 + 推荐默认模型。"""
    avail = _local_models()
    # large-v3 优先；若本地没有则退到 small/tiny（避免默认值不可用）
    rec = core.DEFAULT_MODEL
    if not avail.get(rec):
        rec = next((m for m in ("small", "medium", "base", "tiny", "large-v3") if avail.get(m)), rec)
    return jsonify({
        "available": avail,
        "recommended": rec,
        "default": core.DEFAULT_MODEL,
        "sizes_mb": {"tiny": 75, "base": 145, "small": 483, "medium": 1530, "large-v3": 2944},
        "note": "large-v3 中文最准（约 2.3 倍耗时）；small 为快速档。",
    })


# ---------- AI（DeepSeek）----------
@app.get("/api/ai/status")
def api_ai_status():
    if core.ai_mod is None:
        return jsonify({"available": False, "configured": False, "error": "AI 模块未加载"})
    cfg = core.ai_mod.load_config()
    return jsonify({
        "available": True,
        "configured": core.ai_mod.is_configured(),
        "masked": core.ai_mod.masked_key() if core.ai_mod.is_configured() else "",
        "base_url": cfg.get("base_url") or core.ai_mod.DEFAULT_BASE,
        "model": cfg.get("model") or core.ai_mod.DEFAULT_MODEL,
    })


@app.post("/api/ai/config")
def api_ai_config():
    if core.ai_mod is None:
        return jsonify({"error": "AI 模块未加载"}), 500
    body = request.get_json(silent=True) or {}
    core.ai_mod.save_config(
        api_key=(body.get("api_key") or "").strip(),
        base_url=(body.get("base_url") or "").strip(),
        model=(body.get("model") or "").strip(),
    )
    return jsonify({"ok": True, "configured": core.ai_mod.is_configured()})


@app.post("/api/ai/test")
def api_ai_test():
    """用一句最小的请求测试 DeepSeek 连通性。"""
    if core.ai_mod is None:
        return jsonify({"ok": False, "error": "AI 模块未加载"})
    try:
        reply = core.ai_mod.chat([{"role": "user", "content": "只回复两个字：正常"}], max_tokens=20)
        return jsonify({"ok": True, "reply": reply})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)})


@app.post("/api/summarize")
def api_summarize():
    """AI 总结：mode=each 逐条总结；mode=topic 汇总成一篇主题综述。"""
    if core.ai_mod is None or not core.ai_mod.is_configured():
        return jsonify({"error": "未配置 DeepSeek API key，请先在「AI 设置」里填写"}), 400
    body = request.get_json(silent=True) or {}
    ids = [str(i) for i in (body.get("ids") or []) if str(i)]
    mode = body.get("mode") or "each"
    topic = (body.get("topic") or "").strip()
    if any(j.get("status") == "running" for j in JOBS.values()):
        return jsonify({"error": "已有任务在进行中"}), 400
    items_by_id = {str(it.get("aweme_id", "")): it for it in core.load_all()}
    queue = [items_by_id[a] for a in ids if a in items_by_id]
    if not queue:
        return jsonify({"error": "没有可总结的条目"}), 400

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "kind": "summarize", "status": "running",
                        "total": len(queue), "done": 0, "ok": 0, "fail": 0, "skipped": 0,
                        "current": "", "current_title": "", "model": "", "message": "",
                        "results": {}, "log": [], "created": time.time()}

    def worker():
        logs = JOBS[job_id]["log"]
        try:
            if mode == "topic":
                with JOBS_LOCK:
                    JOBS[job_id]["current_title"] = "正在生成主题综述…"
                r = core.summarize_notes(queue, obsidian_dir=OBSIDIAN_DIR, topic=topic,
                                         log=lambda m: logs.append(m))
                with JOBS_LOCK:
                    j = JOBS[job_id]
                    j["done"] = len(queue)
                    j["results"]["_topic"] = r
                    if r.get("ok"):
                        j["ok"] = 1
                        j["message"] = f"已生成主题综述（{r.get('count')} 条素材）"
                    else:
                        j["fail"] = 1
                        j["message"] = r.get("error", "失败")
                    j["status"] = "done"
                return

            for idx, it in enumerate(queue, start=1):
                if STOP_FLAGS.get(job_id):
                    with JOBS_LOCK:
                        JOBS[job_id]["status"] = "stopped"
                        JOBS[job_id]["message"] = f"已停止（完成 {idx - 1}/{len(queue)}）"
                    return
                aid = str(it.get("aweme_id", ""))
                with JOBS_LOCK:
                    JOBS[job_id]["current"] = aid
                    JOBS[job_id]["current_title"] = (it.get("title") or aid)[:60]
                try:
                    r = core.summarize_one(it, obsidian_dir=OBSIDIAN_DIR, topic=topic,
                                           log=lambda m: logs.append(m))
                except Exception as e:  # noqa: BLE001
                    r = {"aweme_id": aid, "ok": False, "state": "fail", "error": str(e)}
                with JOBS_LOCK:
                    j = JOBS[job_id]
                    j["results"][aid] = r
                    j["done"] = idx
                    if r.get("ok"):
                        j["ok"] += 1
                    else:
                        j["fail"] += 1
                    j["current"] = ""
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "done"
                JOBS[job_id]["message"] = "总结完成"
        except Exception as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "total": len(queue)})


@app.post("/api/open-summary-dir")
def api_open_summary_dir():
    import os
    d = OBSIDIAN_DIR / core.SUMMARY_SUBDIR
    os.makedirs(d, exist_ok=True)
    try:
        os.startfile(str(d))  # type: ignore[attr-defined]
        return jsonify({"ok": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.get("/api/obsidian-dir")
def api_obsidian_dir():
    return jsonify({"dir": str(OBSIDIAN_DIR)})


@app.get("/api/note")
def api_note():
    """按 aweme_id 取一篇转写笔记的全文与划线装饰信息。

    分区落库后同一条视频可能因命中多个收藏夹而存了多份，这里取第一个命中。
    """
    aid = (request.args.get("aweme_id") or "").strip()
    if not aid:
        return jsonify({"error": "aweme_id required"}), 400
    hits = core._find_notes_by_aweme_id(OBSIDIAN_DIR, aid)
    p = next((x for x in hits if x.is_file()), None)
    if p is None:
        return jsonify({"error": "note not found", "aweme_id": aid}), 404
    text = p.read_text(encoding="utf-8")
    return jsonify({
        "aweme_id": aid,
        "path": str(p),
        "text": text,
        "copies": [str(x) for x in hits],
        "highlights": highlights_mod.deco(text),
    })


# ---------- 划线（高亮）----------
@app.get("/api/highlights")
def api_highlights():
    """列出某篇笔记的划线，并顺带报一次 stale 统计。"""
    aid = (request.args.get("aweme_id") or "").strip()
    if not aid:
        return jsonify({"error": "aweme_id required"}), 400
    hits = core._find_notes_by_aweme_id(OBSIDIAN_DIR, aid)
    p = next((x for x in hits if x.is_file()), None)
    if p is None:
        return jsonify({"error": "note not found", "aweme_id": aid}), 404
    return jsonify(highlights_mod.deco(p.read_text(encoding="utf-8")))


def _rematch_one(target: Path) -> dict:
    """对单个笔记文件跑一次划线重定位，返回统计。"""
    text = target.read_text(encoding="utf-8")
    items = highlights_mod.parse_highlights(text)
    if not items:
        return {"total": 0, "ok": 0, "moved": 0, "stale": 0, "duplicate": 0}
    _inner, body_text, _nl = highlights_mod.split_frontmatter(text)
    rematched, stats = highlights_mod.rematch(items, body_text)
    target.write_text(highlights_mod.write_highlights(text, rematched), encoding="utf-8")
    return stats


@app.post("/api/highlights/rematch")
def api_highlights_rematch():
    """把笔记里已有的划线在当前正文上重新定位（重转写之后手动修一次）。

    body: {aweme_id} 或 {path}
    同一条视频有多份副本（命中多个收藏夹）时，全部一起修。
    返回 {ok, stats, files, highlights}
    """
    body = request.get_json(silent=True) or {}
    aid = str(body.get("aweme_id") or "").strip()
    raw_path = str(body.get("path") or "").strip()
    targets: list[Path] = []
    if raw_path:
        cand = Path(raw_path).resolve()
        root = OBSIDIAN_DIR.resolve()
        try:
            cand.relative_to(root)
        except ValueError:
            return jsonify({"error": "非法路径：只能操作笔记库目录内的文件"}), 400
        targets = [cand]
    elif aid:
        targets = core._find_notes_by_aweme_id(OBSIDIAN_DIR, aid)
    else:
        return jsonify({"error": "aweme_id or path required"}), 400
    targets = [p for p in targets if p.is_file()]
    if not targets:
        return jsonify({"error": "note not found"}), 404
    total = {"total": 0, "ok": 0, "moved": 0, "stale": 0, "duplicate": 0}
    for p in targets:
        for k, v in _rematch_one(p).items():
            total[k] = total.get(k, 0) + v
    return jsonify({
        "ok": True,
        "stats": total,
        "files": [str(p) for p in targets],
        "highlights": highlights_mod.deco(targets[0].read_text(encoding="utf-8")),
    })


@app.get("/api/health")
def api_health():
    """给前端开机自检用：转写服务活着、库在哪、索引与向量各是什么状态。"""
    db_ok = retrieve_index.DB_PATH.is_file()
    return jsonify({
        "service": "douyin-fav-transcribe",
        "ok": True,
        "port": int(os.environ.get("DOUYIN_PORT", "8899")),
        "obsidian_dir": str(OBSIDIAN_DIR),
        "obsidian_dir_exists": OBSIDIAN_DIR.is_dir(),
        "index_built": db_ok,
        "vector": retrieve_index.vector_status(),
        "highlight_supported": True,
    })


@app.post("/api/assign-folder")
def api_assign_folder():
    body = request.get_json(silent=True) or {}
    aid = str(body.get("aweme_id") or "")
    name = str(body.get("folder") or body.get("folderName") or "")
    try:
        data = core.assign_folder(aid, name, OBSIDIAN_DIR)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(data)


@app.post("/api/retrieve")
def api_retrieve():
    body = request.get_json(silent=True) or {}
    q = str(body.get("query") or "")
    k = int(body.get("k") or 8)
    video_id = str(body.get("videoId") or body.get("aweme_id") or "")
    folder = str(body.get("folderId") or body.get("folder") or "")
    try:
        retrieve_index.ensure_index(OBSIDIAN_DIR)
    except Exception as e:  # noqa: BLE001
        return jsonify({"code": "WorkerUnreachable", "error": str(e), "hits": []}), 503
    try:
        hits = retrieve_index.search(q, k=k, video_id=video_id, folder=folder,
                                     use_vector=body.get("useVector", True) is not False)
    except Exception as e:  # noqa: BLE001
        return jsonify({"code": "WorkerUnreachable", "error": str(e), "hits": []}), 503
    return jsonify({"hits": hits, "via": "fts+vector" if retrieve_index.vector_status()["installed"] else "fts"})


@app.post("/api/retrieve/rebuild")
def api_retrieve_rebuild():
    n = retrieve_index.rebuild(OBSIDIAN_DIR)
    return jsonify({"ok": True, "indexed": n})


@app.get("/api/retrieve/status")
def api_retrieve_status():
    """索引 + 向量的状态。前端用它决定要不要显示「一键装向量」。"""
    idx = 0
    try:
        c = retrieve_index._conn()
        idx = c.execute("SELECT COUNT(*) FROM notes_fts").fetchone()[0]
        c.close()
    except Exception:  # noqa: BLE001
        idx = 0
    return jsonify({
        "obsidian_dir": str(OBSIDIAN_DIR),
        "notes_indexed": idx,
        "vector": retrieve_index.vector_status(),
        "search": "FTS（默认）" + (" + 向量" if retrieve_index.vector_status()["installed"] else ""),
    })


@app.post("/api/retrieve/install-vector")
def api_retrieve_install_vector():
    """一键装向量：建 venv + 装 sentence-transformers + 下模型。

    长任务 → 走 job 机制，前端轮询 /api/jobs/<id> 看日志，可随时停止。
    body: {uninstall: false}
    """
    if _any_running():
        return jsonify({"error": "已有任务在进行中，请等它结束再操作"}), 400
    body = request.get_json(silent=True) or {}
    do_uninstall = bool(body.get("uninstall"))

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id, "kind": "vector_setup", "status": "running",
            "total": 1, "done": 0, "ok": 0, "fail": 0, "skipped": 0,
            "current": "", "current_title": "删向量环境…" if do_uninstall else "准备安装向量…",
            "model": "", "message": "", "results": {}, "log": [],
            "created": time.time(),
        }

    def worker():
        logs = JOBS[job_id]["log"]

        def _log(m: str):
            logs.append(str(m))
            if len(logs) > 400:
                del logs[:200]
            with JOBS_LOCK:
                JOBS[job_id]["current_title"] = str(m)[:80]

        try:
            if do_uninstall:
                r = vector_setup.uninstall(_log)
            else:
                r = vector_setup.install(_log)
            with JOBS_LOCK:
                j = JOBS[job_id]
                j["done"] = 1
                j["ok"] = 1 if r.get("ok") else 0
                j["fail"] = 0 if r.get("ok") else 1
                j["results"]["_vector"] = r
                j["status"] = "done"
                j["message"] = ("向量已可用" if r.get("ok")
                                else "装完了但自检没过，检索继续走全文检索")
                j["current_title"] = ""
        except BaseException as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = f"安装失败：{e}"
                JOBS[job_id]["fail"] = 1

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "uninstall": do_uninstall})


@app.post("/api/retrieve/eval")
def api_retrieve_eval():
    """对比「只 FTS」与「FTS + 向量」的 recall@k / MRR。

    题目是自监督造的：拿每篇笔记正文里最长的中文片段当 query，
    期望命中它自己。不需要人工标注，但能真实反映检索有没有用。
    """
    body = request.get_json(silent=True) or {}
    k = int(body.get("k") or 8)
    n = int(body.get("n") or 20)
    try:
        retrieve_index.ensure_index(OBSIDIAN_DIR)
        report = retrieve_index.evaluate(OBSIDIAN_DIR, k=k, n=n)
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 503
    return jsonify(report)


@app.post("/api/open-note-dir")
def api_open_note_dir():
    import os
    os.makedirs(OBSIDIAN_DIR, exist_ok=True)
    try:
        os.startfile(str(OBSIDIAN_DIR))  # type: ignore[attr-defined]  # Windows
        return jsonify({"ok": True})
    except Exception as e:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(e)}), 500


@app.post("/api/collect")
def api_collect():
    """headless 重新采集收藏(复用登录态)。若未登录会快速返回 error。"""
    if any(j["status"] == "running" for j in JOBS.values()):
        return jsonify({"error": "有转写在进行中，请稍后再采集"}), 400

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "collecting", "total": 0, "done": 0,
                        "ok": 0, "fail": 0, "skipped": 0, "current": "正在刷新收藏…",
                        "current_title": "", "model": "", "message": "",
                        "log": [], "created": time.time()}

    def worker():
        import subprocess
        py = sys.executable
        try:
            p = subprocess.run(
                [py, str(ROOT / "collector.py"), "--headless"],
                capture_output=True, text=True, timeout=1200,
                env=core._clean_env())
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "done"
                JOBS[job_id]["message"] = (p.stdout + p.stderr)[-800:]
        except Exception as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.post("/api/collect-liked")
def api_collect_liked():
    """单独采集「喜欢」(点赞) 列表。

    入口是懒加载的：只有用户主动点进「喜欢」Tab 才触发。
    支持断点续采（默认续采，reset=true 才从头），可随时停止。
    """
    if any(j.get("status") == "running" for j in JOBS.values()):
        return jsonify({"error": "已有任务在进行中"}), 400

    body = request.get_json(silent=True) or {}
    reset = bool(body.get("reset"))

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "kind": "collect_liked", "status": "running",
                        "total": 0, "done": 0, "ok": 0, "fail": 0, "skipped": 0,
                        "current": "正在采集喜欢…", "current_title": "",
                        "model": "", "message": "全文重采" if reset else "从断点续采",
                        "results": {}, "log": [], "created": time.time()}

    def worker():
        import re as _re
        import subprocess
        logs = JOBS[job_id]["log"]
        args = [sys.executable, str(ROOT / "collector.py"), "--headless", "--liked-only"]
        if reset:
            args.append("--liked-reset")
        try:
            p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, bufsize=1, encoding="utf-8",
                                 errors="replace", env=core._clean_env())
        except Exception as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)
            return
        PROC_HANDLES[job_id] = p

        try:
            for line in p.stdout:  # type: ignore[union-attr]
                line = line.rstrip()
                if line:
                    logs.append(line)
                    if len(logs) > 300:
                        del logs[:100]
                # 从进度行里解析：第 N 页 | 本页 X | 新增 Y | 累计 Z 条
                m = _re.search(r"第\s*(\d+)\s*页.*累计\s*(\d+)\s*条", line)
                if m:
                    with JOBS_LOCK:
                        JOBS[job_id]["done"] = int(m.group(1)) * 20
                        JOBS[job_id]["ok"] = int(m.group(2))
                        JOBS[job_id]["total"] = max(
                            JOBS[job_id]["total"], int(m.group(2)))
                        JOBS[job_id]["current_title"] = f"已采集 {m.group(2)} 条"
                elif ("全部完成" in line or "抓取完成" in line
                      or "未能获取" in line or line.startswith("完成：")):
                    with JOBS_LOCK:
                        JOBS[job_id]["message"] = line[:200]
            p.wait()
            stopped = STOP_FLAGS.get(job_id)
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "stopped" if stopped else "done"
                if stopped:
                    JOBS[job_id]["message"] = "已停止（断点已保存，可继续采）"
                elif not JOBS[job_id]["message"]:
                    JOBS[job_id]["message"] = "采集完成"
        except Exception as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = str(e)
        finally:
            PROC_HANDLES.pop(job_id, None)
            _SNAP_CACHE["key"] = None   # 让快照立刻失效，下次请求重建

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "reset": reset})


# ---------- 取消收藏 / 取消喜欢 ----------
def _any_running() -> bool:
    return any(j.get("status") in ("running", "collecting") for j in JOBS.values())


@app.post("/api/uncollect")
def api_uncollect():
    """在抖音上真正取消收藏 / 取消喜欢（不可逆）。

    body: {ids: [...], src: "fav"|"like", verify: bool}
    verify=true 时每条取消后会用详情接口复核一遍（多一次请求，更可靠）。
    """
    body = request.get_json(silent=True) or {}
    src = "like" if body.get("src") == "like" else "fav"
    ids = [str(i) for i in (body.get("ids") or []) if str(i)]
    verify = body.get("verify", True) is not False

    if not ids:
        return jsonify({"error": "没有选中要取消的条目"}), 400
    if _any_running():
        return jsonify({"error": "已有任务在进行中，请等它结束再操作"}), 400

    pool = {str(x.get("aweme_id", "")): x
            for x in (core.load_liked() if src == "like" else core.load_collected())}
    items = [pool[i] for i in ids if i in pool]
    if not items:
        return jsonify({"error": "选中的条目已不在本地列表里，刷新后再试"}), 400

    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id, "kind": "uncollect", "src": src, "status": "running",
            "total": len(items), "done": 0, "ok": 0, "fail": 0, "skipped": 0,
            "current": "", "current_title": "准备中…", "model": "",
            "message": f"取消{'喜欢' if src == 'like' else '收藏'}"
                       f"{'（逐条复核）' if verify else ''}",
            "results": {}, "log": [], "created": time.time(),
        }

    def worker():
        logs = JOBS[job_id]["log"]

        def _log(m: str):
            logs.append(str(m))
            if len(logs) > 400:
                del logs[:200]

        def _progress(done, total, item, res):
            with JOBS_LOCK:
                j = JOBS.get(job_id)
                if not j:
                    return
                j["done"] = done
                j["total"] = total
                j["current"] = res.get("aweme_id", "")
                j["current_title"] = (res.get("title") or res.get("aweme_id") or "")[:60]
                if res.get("ok"):
                    j["ok"] += 1
                else:
                    j["fail"] += 1
                j["results"][res["aweme_id"]] = res
                j["message"] = f"已处理 {done}/{total}"

        try:
            import uncollect  # 延迟导入：避免拖慢 GUI 启动
            r = uncollect.run(
                items, src,
                headless=True,
                verify=verify,
                progress=_progress,
                should_stop=lambda: bool(STOP_FLAGS.get(job_id)),
                log=_log,
            )
            with JOBS_LOCK:
                j = JOBS[job_id]
                j["summary"] = {k: v for k, v in r.items() if k != "results"}
                j["results"] = r.get("results") or j["results"]
                j["ok"] = r.get("ok", j["ok"])
                j["fail"] = r.get("fail", j["fail"])
                j["done"] = r.get("done", j["done"])
                if STOP_FLAGS.get(job_id) or r.get("stopped"):
                    j["status"] = "stopped"
                elif r.get("fail") == r.get("total") and r.get("total"):
                    j["status"] = "done"      # 全部失败也算跑完了，结果在 message 里说明
                else:
                    j["status"] = "done"
                j["message"] = r.get("message") or j["message"]
                j["current"] = ""
        except BaseException as e:  # noqa: BLE001
            with JOBS_LOCK:
                JOBS[job_id]["status"] = "error"
                JOBS[job_id]["message"] = f"执行失败：{e}"
        finally:
            PROC_HANDLES.pop(job_id, None)
            _SNAP_CACHE["key"] = None   # 本地列表已变，让快照立刻失效

    threading.Thread(target=worker, daemon=True).start()
    return jsonify({"job_id": job_id, "total": len(items), "src": src, "verify": verify})


@app.get("/api/removed")
def api_removed():
    """取消操作的审计日志（最近 N 条，默认 200）。"""
    rows = core.load_removed()
    try:
        n = int(request.args.get("limit", 200))
    except (TypeError, ValueError):
        n = 200
    return jsonify({"total": len(rows), "items": rows[-max(1, min(2000, n)):][::-1]})


def _pick_free_port(preferred: int) -> int:
    """挑一个能绑定的端口。

    Windows 上首选端口可能被划进 Hyper-V / WSL 的 TCP 保留段
    （用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看），
    这时绑定会失败并抛 WinError 10013：
    「以一种访问权限不允许的方式做了一个访问套接字的尝试」。
    先试首选端口，不可用就顺延，别让用户对着这句天书发愣。
    """
    import socket

    tried = [preferred]
    tried += [preferred + i for i in range(1, 11)]
    tried += [8800, 8000, 9000, 9090, 9999]   # 避开常见的 8853-8952 保留段
    for p in tried:
        if not 1024 <= p <= 65535:
            continue
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    return preferred


if __name__ == "__main__":
    # 改前端模板后刷新浏览器即生效，不必重启本程序（改 Python 代码仍需重启）
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.jinja_env.auto_reload = True
    _want = int(os.environ.get("DOUYIN_PORT", "8899"))
    _port = _pick_free_port(_want)
    print("=" * 58)
    if _port != _want:
        print(f"  端口 {_want} 不可用（被占用，或被 Windows 保留给 Hyper-V/WSL）。")
        print(f"  已自动改用 {_port}。")
    print(f"  浏览器打开：  http://127.0.0.1:{_port}/")
    print("=" * 58)
    app.run(host="127.0.0.1", port=_port, debug=False)
