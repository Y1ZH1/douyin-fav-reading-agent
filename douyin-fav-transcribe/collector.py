# -*- coding: utf-8 -*-
"""抖音【收藏 + 喜欢】采集器（Playwright 驱动真实 Chrome + 官方接口）。

共抓三样东西：
  1. 收藏列表  POST /aweme/v1/web/aweme/listcollection/   （cursor 翻页）
  2. 喜欢列表  GET  /aweme/v1/web/aweme/favorite/         （max_cursor 翻页，需先取 sec_uid）
  3. 收藏夹分组 GET /aweme/v1/web/collects/list/ + collects/video/list/

正确采集"收藏"的姿势（来自 coco8talk/obsidian-douyin-collector 实证 + 本机实测）：
  打开抖音个人主页收藏页签 URL，然后在页面上下文里直接 POST 官方收藏接口
    /aweme/v1/web/aweme/listcollection/?device_platform=webapp&aid=6383&channel=channel_pc_web
    body: count=20&cursor=<游标>   （credentials: include，同源带登录 cookie）
  用返回的 cursor 循环翻页，直到 has_more=0。全程无需签名参数、无需手动滚动。

「喜欢」不是收藏夹，抓回来后统一打上虚拟分组名 LIKED_TAG（"喜欢"）放进 folders，
这样 GUI 筛选 / Obsidian tag / AI 总结全流程都能直接复用，无需额外改动。

为什么之前会抓到"推荐/热门"而不是收藏？
  旧版脚本是打开首页后"监听页面所有含 aweme 的接口"，首页是推荐 feed，人人可见，
  脚本一开就把它当数据存了。本版改为**只打指定官方接口**，抓的必是收藏/喜欢。

用法：
  python collector.py
  弹真实 Chrome，若未登录则扫码；脚本自动抓收藏、喜欢、收藏夹分组，
  实时存 state/collected.json（aweme_id 去重），完成后自动退出。登录态存 state/profile 复用。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / "state"
STATE_DIR.mkdir(exist_ok=True)
USER_DATA_DIR = STATE_DIR / "profile"
COLLECTED_PATH = STATE_DIR / "collected.json"

VIEWPORT = {"width": 1440, "height": 900}

# 收藏页签与收藏接口（关键，勿改 URL，探针实测唯一）
COLLECTION_PAGE_URL = "https://www.douyin.com/user/self?showTab=favorite_collection"
LISTCOLLECTION_URL = (
    "/aweme/v1/web/aweme/listcollection/"
    "?device_platform=webapp&aid=6383&channel=channel_pc_web"
)

# 收藏夹分组接口（GET！探针实测：必须 GET，POST 会 404 Unsupported path）
_WEB_QUERY = (
    "device_platform=webapp&aid=6383&channel=channel_pc_web"
    "&pc_client_type=1&version_code=170400&version_name=17.4.0"
    "&cookie_enabled=true&platform=PC&browser_language=zh-CN"
    "&browser_platform=Win32&browser_name=Chrome&browser_version=120.0.0.0"
)
COLLECTS_LIST_URL = f"/aweme/v1/web/collects/list/?{_WEB_QUERY}"
COLLECTS_VIDEO_URL = f"/aweme/v1/web/collects/video/list/?{_WEB_QUERY}"

# 「喜欢」(点赞) 列表接口（探针实测）
#   1) 先 GET /aweme/v1/web/user/profile/self/ 拿 sec_uid
#   2) 再 GET /aweme/v1/web/aweme/favorite/?sec_user_id=<sec>&max_cursor=<游标>&count=20
#   返回 has_more / max_cursor(下一页游标) / aweme_list
PROFILE_SELF_URL = (
    f"/aweme/v1/web/user/profile/self/?{_WEB_QUERY}&publish_video_strategy_type=2"
)
FAVORITE_URL = (
    "/aweme/v1/web/aweme/favorite/?device_platform=webapp&aid=6383"
    "&channel=channel_pc_web&publish_video_strategy_type=2&cut_version=1"
)
LIKED_TAG = "喜欢"          # 历史遗留的虚拟分组名：新版已不再写入 folders，仅用于兼容旧数据

COUNT_PER_PAGE = 30
COUNT_PER_PAGE_LIKED = 20
COUNT_PER_PAGE_FOLDER = 50   # 收藏夹列表一次多拿点
COUNT_PER_PAGE_FOLDER_VIDEO = 30
MAX_PAGES = 400          # 硬顶防死循环（400*30=12000 条，远超正常收藏量）
MAX_LIKED_PAGES = 5000   # 「喜欢」翻页硬顶（5000*20=10 万条）——只是防死循环，正常按 has_more 结束
MAX_FOLDER_PAGES = 200   # 单个收藏夹翻页硬顶
PAUSE_BETWEEN_PAGES = 0.8

FOLDERS_PATH = STATE_DIR / "folders.json"
LIKED_PATH = STATE_DIR / "liked.json"              # 「喜欢」单独存：量级可达数万，不混进收藏
LIKED_CURSOR_PATH = STATE_DIR / "liked_cursor.json"  # 翻页断点，支持中断后从断点续采


@dataclass
class FavItem:
    aweme_id: str = ""
    title: str = ""
    author: str = ""
    author_uid: str = ""
    published: str = ""
    duration: int = 0
    video_url: str = ""
    play_addr: str = ""
    play_addr_wm: str = ""
    cover: str = ""
    desc: str = ""
    collected_at: str = ""
    folders: list[str] = field(default_factory=list)   # 所属收藏夹分组名
    liked: bool = False                                # 是否在「喜欢」(点赞) 列表里

    def merge(self, o: "FavItem") -> None:
        for k, v in asdict(o).items():
            if v and not getattr(self, k):
                setattr(self, k, v)
        # folders 取并集
        merged = list(dict.fromkeys((self.folders or []) + (o.folders or [])))
        self.folders = merged
        self.liked = bool(self.liked or o.liked)


def _clean_env():
    env = os.environ.copy()
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
              "ALL_PROXY", "all_proxy"):
        env.pop(k, None)
    return env


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _load_existing() -> dict[str, FavItem]:
    if not COLLECTED_PATH.exists():
        return {}
    try:
        data = json.loads(COLLECTED_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, FavItem] = {}
    for raw in data:
        kwargs: dict = {}
        for k in FavItem.__dataclass_fields__:
            v = raw.get(k)
            if k == "folders":
                kwargs[k] = v if isinstance(v, list) else []
            elif k == "liked":
                kwargs[k] = bool(v) or (LIKED_TAG in (kwargs.get("folders") or []))
            else:
                kwargs[k] = "" if v is None else v
        it = FavItem(**kwargs)
        if it.aweme_id:
            out[it.aweme_id] = it
    return out


def _save(store: dict[str, FavItem]) -> None:
    arr = [asdict(it) for it in sorted(store.values(), key=lambda x: x.aweme_id)]
    COLLECTED_PATH.write_text(
        json.dumps(arr, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ---- 「喜欢」独立存储（几万条级别，支持断点续采） ----
def _load_liked() -> dict[str, FavItem]:
    if not LIKED_PATH.exists():
        return {}
    try:
        data = json.loads(LIKED_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, FavItem] = {}
    for raw in data if isinstance(data, list) else []:
        kwargs: dict = {}
        for k in FavItem.__dataclass_fields__:
            v = raw.get(k)
            if k == "folders":
                kwargs[k] = [f for f in (v if isinstance(v, list) else []) if f != LIKED_TAG]
            elif k == "liked":
                kwargs[k] = True
            else:
                kwargs[k] = "" if v is None else v
        it = FavItem(**kwargs)
        if it.aweme_id:
            out[it.aweme_id] = it
    return out


def _save_liked(store: dict[str, FavItem]) -> None:
    arr = [asdict(it) for it in sorted(store.values(), key=lambda x: x.aweme_id)]
    for row in arr:
        row["liked"] = True
        row["folders"] = [f for f in (row.get("folders") or []) if f != LIKED_TAG]
    LIKED_PATH.write_text(
        json.dumps(arr, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _load_liked_cursor() -> dict:
    if not LIKED_CURSOR_PATH.exists():
        return {}
    try:
        d = json.loads(LIKED_CURSOR_PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save_liked_cursor(cursor: int, done: bool, count: int) -> None:
    LIKED_CURSOR_PATH.write_text(json.dumps({
        "max_cursor": int(cursor), "done": bool(done), "count": int(count),
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_aweme(raw: dict) -> FavItem | None:
    aweme_id = str(raw.get("aweme_id") or "").strip()
    if not aweme_id:
        return None
    item = FavItem(aweme_id=aweme_id, collected_at=_now())
    item.desc = str(raw.get("desc") or "")
    item.title = item.desc or aweme_id

    author = raw.get("author") or {}
    item.author = author.get("nickname") or ""
    item.author_uid = str(author.get("uid") or author.get("sec_uid") or "")

    ct = raw.get("create_time")
    if ct:
        try:
            item.published = datetime.fromtimestamp(int(ct)).strftime("%Y-%m-%d")
        except Exception:
            item.published = str(ct)
    try:
        item.duration = int(raw.get("duration") or 0)
    except Exception:
        item.duration = 0

    item.video_url = f"https://www.douyin.com/video/{aweme_id}"

    video = raw.get("video") or {}
    play = video.get("play_addr") or {}
    urls = play.get("url_list") or []
    # 无水印 /play/ 优先
    for u in urls:
        if isinstance(u, str) and "/play/" in u and "/playwm/" not in u:
            item.play_addr = u
            break
    if not item.play_addr and urls:
        cand = urls[0]
        if isinstance(cand, str):
            item.play_addr_wm = cand
            if "/playwm/" in cand:
                item.play_addr = cand.replace("/playwm/", "/play/")
    if not item.play_addr and play.get("url"):
        item.play_addr = play.get("url")

    # 封面：优先 cover(裁剪 323:430 卡片图)，其次 origin_cover(原图)
    for ck in ("cover", "origin_cover", "dynamic_cover"):
        cv = (video.get(ck) or {})
        cu = cv.get("url_list") or []
        if cu and isinstance(cu[0], str):
            item.cover = cu[0]
            break
    return item


def build_fetch_snippet(cursor: int) -> str:
    """返回一段 JS：POST 收藏接口并返回**原始文本**。

    注意：必须在 Python 侧 JSON.parse，不能让 JS 解析后回传——
    抖音的 collects_id / 部分 id 是 19 位大整数，超过 JS 安全整数(2^53)会被四舍五入。
    """
    body = f"count={COUNT_PER_PAGE}&cursor={cursor}"
    return (
        "(async () => {"
        f"const res = await fetch({json.dumps(LISTCOLLECTION_URL)}, {{"
        "method:'POST', credentials:'include',"
        "headers:{'Content-Type':'application/x-www-form-urlencoded'},"
        f"body:{json.dumps(body)}"
        "});"
        "return { status: res.status, text: await res.text() };"
        "})()"
    )


def collect(page, store: dict[str, FavItem], headless: bool) -> int:
    """自动翻页抓收藏。返回新增条数。"""
    cursor = 0
    total_added = 0
    last_err = ""
    for page_i in range(1, MAX_PAGES + 1):
        if not headless:
            sys.stdout.write(f"\r[翻页] 第 {page_i} 页 @cursor={cursor} | 累计 {len(store)} 条")
            sys.stdout.flush()
        try:
            r = page.evaluate(build_fetch_snippet(cursor))
        except Exception as e:
            last_err = f"evaluate 失败: {e}"
            print("\n[evaluate失败]", last_err)
            break

        if not r or r.get("status") not in (200, 0, None):
            last_err = f"HTTP {r.get('status') if r else None}"
            print(f"\n[接口异常] 第{page_i}页: {last_err}")
            break
        try:
            j = json.loads(r["text"])
        except Exception:
            last_err = (r.get("text") or "")[:200]
            print(f"\n[非JSON] 第{page_i}页: {last_err}")
            break
        if j.get("status_code") != 0:
            last_err = f"status_code={j.get('status_code')} (可能登录态失效)"
            print(f"\n[登录态] {last_err}")
            break

        lst = j.get("aweme_list") or []
        added = 0
        for raw in lst:
            it = parse_aweme(raw)
            if it and it.aweme_id:
                if it.aweme_id in store:
                    store[it.aweme_id].merge(it)
                else:
                    store[it.aweme_id] = it
                    added += 1
        if added:
            _save(store)
            total_added += added

        has_more = j.get("has_more")
        nc = j.get("cursor")
        if not has_more or not lst:
            print(f"\n[完成] 第{page_i}页后无更多 (has_more={has_more})，共 {len(store)} 条")
            break
        # 翻页：用返回 cursor；若为 0/异常则用计数累加兜底
        new_cursor = nc if nc else cursor + len(lst)
        if new_cursor == cursor:
            print("\n[完成] cursor 不再前进，停止")
            break
        cursor = new_cursor
        time.sleep(PAUSE_BETWEEN_PAGES)

    if total_added == 0 and len(store) == 0 and last_err:
        print(f"\n未采集到任何数据：{last_err}")
    return total_added


# ---------------- 「喜欢」(点赞) 列表 ----------------
def fetch_sec_user_id(page) -> str:
    """GET 自己的 profile 拿 sec_uid —— 调 favorite 接口必须要它。"""
    j = _get_json(page, PROFILE_SELF_URL)
    if not j:
        return ""
    if j.get("status_code") != 0:
        print(f"[喜欢] profile/self status_code={j.get('status_code')}（登录态可能失效）")
        return ""
    return ((j.get("user") or {}).get("sec_uid") or "")


def collect_liked(page, headless: bool, reset: bool = False) -> dict:
    """自动翻页抓「喜欢」列表，写入 liked.json（与收藏分开存）。

    几万条的场景要点：
      - 游标每页落盘 liked_cursor.json，中断/关窗后下次从断点继续，已采的不重复
      - 不设人为条数上限（MAX_LIKED_PAGES 只是防死循环的硬顶），按 has_more 自然结束
      - reset=True 才从头重采
    返回 {added, total, scanned, done, resumed}
    """
    print("\n开始抓取「喜欢」列表……")
    store = {} if reset else _load_liked()
    if reset and LIKED_PATH.exists():
        LIKED_PATH.unlink()
    if reset and LIKED_CURSOR_PATH.exists():
        LIKED_CURSOR_PATH.unlink()

    sec = fetch_sec_user_id(page)
    if not sec:
        print("[喜欢] 未能获取 sec_user_id（登录态可能失效），跳过")
        return {"added": 0, "total": len(store), "scanned": 0, "done": False, "resumed": False}

    ck = _load_liked_cursor()
    cursor = 0
    resumed = False
    if ck and not ck.get("done") and ck.get("max_cursor"):
        cursor = int(ck["max_cursor"])
        resumed = True
        print(f"[喜欢] 发现断点：从第 {cursor} 游标继续（本地已有 {len(store)} 条）")
    elif ck and ck.get("done"):
        print(f"[喜欢] 上次已抓完（{len(store)} 条）。如需更新请点「全文重采」。")

    total_added = 0
    total_scanned = 0
    done = False

    for page_i in range(1, MAX_LIKED_PAGES + 1):
        url = (f"{FAVORITE_URL}&sec_user_id={sec}&max_cursor={cursor}"
               f"&min_cursor=0&count={COUNT_PER_PAGE_LIKED}")
        j = _get_json(page, url)
        if j is None:
            print(f"\n[喜欢] 第{page_i}页无响应，已保存断点，可稍后续采")
            break
        if j.get("status_code") != 0:
            print(f"\n[喜欢] 第{page_i}页 status_code={j.get('status_code')}，已保存断点")
            break

        lst = j.get("aweme_list") or []
        added = 0
        for raw in lst:
            it = parse_aweme(raw)
            if not it or not it.aweme_id:
                continue
            it.liked = True
            it.folders = [f for f in (it.folders or []) if f != LIKED_TAG]
            if it.aweme_id in store:
                store[it.aweme_id].merge(it)   # 补全封面/直链等可能变化的字段
            else:
                store[it.aweme_id] = it
                added += 1
        total_scanned += len(lst)
        total_added += added

        nc = j.get("max_cursor") or cursor
        has_more = bool(j.get("has_more")) and bool(lst) and nc != cursor

        # 每页都落盘：数据 + 游标断点
        _save_liked(store)
        _save_liked_cursor(nc, not has_more, len(store))

        if not headless:
            sys.stdout.write(f"\r[喜欢] 第 {page_i} 页 | 本页 {len(lst)} | "
                             f"新增 {added} | 累计 {len(store)} 条   ")
            sys.stdout.flush()
        else:
            # 无头（GUI 触发）时也要逐页输出：上层要 parse 这行来显示实时进度，
            # 否则几万条的采集过程在界面上会一直显示"已采 0 条"
            print(f"[喜欢] 第 {page_i} 页 | 本页 {len(lst)} | "
                  f"新增 {added} | 累计 {len(store)} 条", flush=True)

        if not has_more:
            done = True
            print(f"\n[喜欢] 抓取完成：共扫描 {total_scanned} 条，新增 {total_added}，"
                  f"本地共 {len(store)} 条")
            break
        cursor = nc
        time.sleep(PAUSE_BETWEEN_PAGES)
    else:
        print(f"\n[喜欢] 达到翻页硬顶 {MAX_LIKED_PAGES} 页，已抓 {total_scanned} 条"
              f"（断点已保存，可再次运行继续）")

    return {"added": total_added, "total": len(store), "scanned": total_scanned,
            "done": done, "resumed": resumed}


# ---------------- 收藏夹分组 ----------------
_JS_FETCH_GET = (
    "(async (url) => {"
    "const r = await fetch(url, {method:'GET', credentials:'include'});"
    "return { status: r.status, text: await r.text() };"
    "})"
)


def _get_json(page, url: str) -> dict | None:
    """GET 并在 Python 侧解析返回 dict——绝不能走 JS 解析，否则大整数 id 会精度丢失。"""
    try:
        r = page.evaluate(_JS_FETCH_GET, url)
    except Exception as e:
        print(f"[GET失败] {e}")
        return None
    if not r:
        return None
    try:
        return json.loads(r.get("text") or "")
    except Exception:
        return None


def fetch_folders(page) -> list[dict]:
    """GET 收藏夹列表并翻页取全，返回 [{id, name, count}]。"""
    out: list[dict] = []
    cursor = 0
    for _ in range(20):
        url = f"{COLLECTS_LIST_URL}&cursor={cursor}&count={COUNT_PER_PAGE_FOLDER}"
        j = _get_json(page, url)
        if j is None:
            print("[收藏夹] 列表接口无响应")
            break
        if j.get("status_code") != 0:
            print(f"[收藏夹] status_code={j.get('status_code')}（登录态可能失效）")
            break
        lst = j.get("collects_list") or []
        for c in lst:
            cid = str(c.get("collects_id") or c.get("id") or "")
            name = c.get("collects_name") or c.get("name") or ""
            if cid:
                out.append({
                    "id": cid,
                    "name": name,
                    "count": int(c.get("total_number") or c.get("aweme_count") or 0),
                })
        if not j.get("has_more") or not lst:
            break
        nc = j.get("cursor")
        if not nc or nc == cursor:
            break
        cursor = nc
        time.sleep(0.5)
    return out


def fetch_folder_video_ids(page, collects_id: str) -> list[str]:
    """GET 某个收藏夹内的全部 aweme_id（翻页到 has_more=0）。"""
    ids: list[str] = []
    cursor = 0
    for _ in range(MAX_FOLDER_PAGES):
        url = (f"{COLLECTS_VIDEO_URL}&collects_id={collects_id}"
               f"&cursor={cursor}&count={COUNT_PER_PAGE_FOLDER_VIDEO}")
        j = _get_json(page, url)
        if j is None or j.get("status_code") != 0:
            break
        lst = j.get("aweme_list") or []
        for a in lst:
            aid = str(a.get("aweme_id") or "")
            if aid:
                ids.append(aid)
        if not j.get("has_more") or not lst:
            break
        nc = j.get("cursor")
        if not nc or nc == cursor:
            break
        cursor = nc
        time.sleep(0.4)
    return ids


def sync_folders(page, store: dict[str, FavItem], headless: bool = True) -> list[dict]:
    """抓收藏夹列表 + 每夹视频，回填 store[aid].folders，写 state/folders.json。"""
    print("\n开始抓取收藏夹分组……")
    folders = fetch_folders(page)
    if not folders:
        print("[收藏夹] 未获取到收藏夹（账号可能没有自建收藏夹）")
        return []
    print(f"[收藏夹] 共 {len(folders)} 个")

    # 重置收藏夹归属（「喜欢」已单独存 liked.json，不在这个 store 里，无需保留）
    for it in store.values():
        it.folders = []

    for i, f in enumerate(folders, 1):
        ids = fetch_folder_video_ids(page, f["id"])
        f["video_ids"] = ids
        for aid in ids:
            if aid in store and f["name"] not in store[aid].folders:
                store[aid].folders.append(f["name"])
        if not headless:
            sys.stdout.write(f"\r[收藏夹 {i}/{len(folders)}] {f['name']} -> {len(ids)} 条   ")
            sys.stdout.flush()
        time.sleep(0.4)
    print()

    meta = [{"id": f["id"], "name": f["name"], "count": f["count"],
             "video_ids": f.get("video_ids", [])} for f in folders]
    FOLDERS_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    in_folder = sum(1 for it in store.values() if it.folders)
    print(f"[收藏夹] 完成：{len(folders)} 个夹，{in_folder}/{len(store)} 条收藏已归类 -> {FOLDERS_PATH}")
    return folders


def main() -> None:
    ap = argparse.ArgumentParser(description="抖音收藏夹采集（官方收藏接口自动翻页）")
    ap.add_argument("--headless", action="store_true", help="无头（若已有登录态可用）")
    ap.add_argument("--reset", action="store_true", help="清空旧 collected.json 重新采")
    ap.add_argument("--no-folders", action="store_true", help="跳过收藏夹分组抓取")
    ap.add_argument("--folders-only", action="store_true", help="只刷新收藏夹分组，不重采收藏与喜欢")
    ap.add_argument("--no-liked", action="store_true", help="跳过「喜欢」(点赞) 列表抓取")
    ap.add_argument("--liked-only", action="store_true", help="只抓「喜欢」列表，不动收藏与分组")
    ap.add_argument("--liked-reset", action="store_true",
                    help="「喜欢」从头重采（默认从断点续采；已采到的不会丢）")
    args = ap.parse_args()

    if args.reset and COLLECTED_PATH.exists():
        COLLECTED_PATH.unlink()

    store = _load_existing()
    liked_store = _load_liked()
    print("=" * 62)
    print("  抖音收藏 + 喜欢 采集器（只抓你真正收藏/点赞的视频）")
    print("  将弹出真实 Chrome。若未登录请扫码；已登录则自动开始抓取。")
    print(f"  现有本地记录：收藏 {len(store)} 条 / 喜欢 {len(liked_store)} 条"
          f"（--reset/--liked-reset 可清空重采）")
    print("=" * 62)

    import sys as _sys
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            channel="chrome",
            headless=args.headless,
            viewport=VIEWPORT,
            env=_clean_env(),
            args=["--disable-blink-features=AutomationControlled", "--start-maximized"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(COLLECTION_PAGE_URL, wait_until="domcontentloaded")
        except Exception as e:
            print("导航提示:", e)
        time.sleep(4)

        # 等待用户登录：探测收藏接口，sc=0 视为已登录
        if not args.headless:
            print("\n等待登录（如已登录会自动继续）……")
        for _ in range(120):
            try:
                pr = page.evaluate(build_fetch_snippet(0))
                pj = json.loads((pr or {}).get("text") or "{}")
                if pj.get("status_code") == 0:
                    break
            except Exception:
                pass
            if args.headless:
                print("无头模式探测失败，可能未登录。")
                break
            time.sleep(2)
        else:
            print("\n等待登录超时，请确认在 Chrome 里完成了扫码。")

        added = 0
        if not (args.folders_only or args.liked_only):
            print("开始抓取收藏……")
            added = collect(page, store, headless=args.headless)
            _save(store)
            print(f"\n收藏采集完成：新增 {added}，共 {len(store)} 条 -> {COLLECTED_PATH}")

        liked_res = {"added": 0, "total": len(liked_store), "done": False}
        if not args.no_liked:
            liked_res = collect_liked(page, headless=args.headless,
                                      reset=args.liked_reset)

        if not (args.no_folders or args.liked_only):
            sync_folders(page, store, headless=args.headless)
            _save(store)

        fav_n = len(_load_existing())
        liked_n = len(_load_liked())
        tail = "" if liked_res.get("done", True) else "（未抓完，可再次运行从断点继续）"
        if args.liked_only:
            print(f"\n完成：喜欢 {liked_n} 条（本次新增 {liked_res.get('added', 0)}）{tail}")
        else:
            print(f"\n全部完成：收藏 {fav_n} 条（新增 {added}）｜"
                  f"喜欢 {liked_n} 条（新增 {liked_res.get('added', 0)}）{tail}")
        try:
            ctx.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
