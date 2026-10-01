# -*- coding: utf-8 -*-
"""抖音【取消收藏 / 取消喜欢】(取消点赞)。

接口来源：从抖音前端 JS 里反查出的**真实调用签名**（探针见工作日志），
不是猜的 —— 三处互相印证（前端 bundle / 收藏页批量管理链路 / 第三方 SDK 文档）。

  ┌────────────┬──────────────────────────────────────────┬───────────────────────────────┐
  │ 动作       │ 接口                                      │ body                          │
  ├────────────┼──────────────────────────────────────────┼───────────────────────────────┤
  │ 取消收藏   │ POST /aweme/v1/web/aweme/collect/         │ aweme_id&action=0&aweme_type=0│
  │ 收藏       │ 同上                                      │ action=1                      │
  │ 取消点赞   │ POST /aweme/v1/web/commit/item/digg/      │ aweme_id&item_type=0&type=0   │
  │ 点赞       │ 同上                                      │ type=1                        │
  └────────────┴──────────────────────────────────────────┴───────────────────────────────┘

复核：详情接口 GET /aweme/v1/web/aweme/detail/?aweme_id=xxx 返回
  collect_stat (1=已收藏) / user_digged (1=已点赞)
用它逐条验证「取消」是否真的生效，而不是只看 status_code。

⚠️ 这是**不可逆**的账号写操作：取消后要重新手动收藏/点赞才能恢复。
   抖音对这些接口有风控，可能弹滑块验证 → 无头模式会失败，此时请用 --headed。

用法：
  # 取消收藏 3 条
  python uncollect.py --src fav --ids 123,456,789
  # 从文件读 id（每行一个，或逗号分隔）
  python uncollect.py --src like --ids-file ids.txt
  # 只看会发什么请求，绝不真的发（网络层拦截）
  python uncollect.py --src fav --ids 123 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / "state"
USER_DATA_DIR = STATE_DIR / "profile"
sys.path.insert(0, str(ROOT))

import core  # noqa: E402
from collector import (  # noqa: E402
    VIEWPORT, _WEB_QUERY, _clean_env, _get_json, build_fetch_snippet,
)

# ---- 写接口 ----
CANCEL_COLLECT_URL = f"/aweme/v1/web/aweme/collect/?{_WEB_QUERY}"
CANCEL_DIGG_URL = f"/aweme/v1/web/commit/item/digg/?{_WEB_QUERY}"
# ---- 复核接口（只读）----
DETAIL_URL = "/aweme/v1/web/aweme/detail/"

AWEME_TYPE_NORMAL = 0     # 普通视频；抖音前端 item_type 默认值也是 0
ITEM_TYPE_AWEME = 0

SRC_FAV = "fav"
SRC_LIKE = "like"

DEFAULT_DELAY = 1.0       # 每条之间的间隔（秒）：给风控留缓冲，别打太急


def _src_name(src: str) -> str:
    return "喜欢" if src == SRC_LIKE else "收藏"


# ---------------- 页面内请求 ----------------
_JS_POST_FORM = (
    "(async ([url, body]) => {"
    "try {"
    "  const r = await fetch(url, {method:'POST', credentials:'include',"
    "    headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},"
    "    body: body});"
    "  return { status: r.status, text: await r.text() };"
    "} catch (e) { return { status: -1, text: String(e) }; }"
    "})"
)


def _post_form(page, url: str, params: dict) -> dict:
    """POST form-urlencoded 并在 Python 侧解析（大整数 id 不能交给 JS 解析）。"""
    body = "&".join(f"{k}={v}" for k, v in params.items())
    try:
        r = page.evaluate(_JS_POST_FORM, [url, body])
    except Exception as e:  # noqa: BLE001
        return {"http": -1, "data": None, "error": f"evaluate 失败: {e}"}
    if not r:
        return {"http": -1, "data": None, "error": "无返回"}
    http = r.get("status")
    try:
        return {"http": http, "data": json.loads(r.get("text") or ""), "error": ""}
    except Exception:
        return {"http": http, "data": None,
                "error": f"非 JSON 响应: {(r.get('text') or '')[:160]}"}


def set_collect(page, aweme_id: str, on: bool) -> dict:
    """收藏(on=True) / 取消收藏(on=False)。"""
    r = _post_form(page, CANCEL_COLLECT_URL, {
        "aweme_id": aweme_id,
        "action": 1 if on else 0,
        "aweme_type": AWEME_TYPE_NORMAL,
    })
    d = r.get("data") or {}
    sc = d.get("status_code")
    return {"ok": (sc == 0), "status_code": sc,
            "msg": d.get("status_msg") or r.get("error") or ("HTTP " + str(r.get("http"))),
            "raw": d}


def set_digg(page, aweme_id: str, on: bool) -> dict:
    """点赞(on=True) / 取消点赞(on=False)。"""
    r = _post_form(page, CANCEL_DIGG_URL, {
        "aweme_id": aweme_id,
        "item_type": ITEM_TYPE_AWEME,
        "type": 1 if on else 0,
    })
    d = r.get("data") or {}
    sc = d.get("status_code")
    return {"ok": (sc == 0), "status_code": sc,
            "msg": d.get("status_msg") or r.get("error") or ("HTTP " + str(r.get("http"))),
            "raw": d}


def cancel_collect(page, aweme_id: str) -> dict:
    """取消收藏（action=0）。"""
    return set_collect(page, aweme_id, False)


def cancel_like(page, aweme_id: str) -> dict:
    """取消点赞（type=0）。"""
    return set_digg(page, aweme_id, False)


def check_state(page, aweme_id: str) -> dict:
    """只读复核：返回 {collect: bool|None, digged: bool|None}。取不到字段就是 None。"""
    url = f"{DETAIL_URL}?aweme_id={aweme_id}&{_WEB_QUERY}"
    j = _get_json(page, url)
    if not isinstance(j, dict) or j.get("status_code") != 0:
        return {"collect": None, "digged": None}
    det = j.get("aweme_detail") or {}
    cs = det.get("collect_stat")
    ud = det.get("user_digged")
    return {
        "collect": (bool(cs) if cs is not None else None),
        "digged": (bool(ud) if ud is not None else None),
    }


# ---------------- 主流程 ----------------
def _install_dry_run(page) -> list:
    """dry-run：在网络层把写请求拦下来，记录后直接回一个假的成功响应。

    页面根本收不到真实响应、服务器也收不到请求 → 账号零改动。
    用来端到端验证「我们会发什么请求」。
    """
    seen: list = []

    def handler(route, request):
        try:
            if request.method == "POST" and "/aweme/v1/web/" in request.url:
                seen.append({
                    "url": request.url,
                    "body": request.post_data,
                })
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"status_code": 0, "status_msg": ""}))
                return
        except Exception as e:  # noqa: BLE001
            seen.append({"error": str(e)})
        route.continue_()

    page.route("**/aweme/v1/web/**", handler)
    return seen


def run(items: list[dict], src: str = SRC_FAV, *,
        headless: bool = True,
        verify: bool = True,
        delay: float = DEFAULT_DELAY,
        dry_run: bool = False,
        progress=None,
        should_stop=None,
        log=print) -> dict:
    """批量取消。items 至少要有 aweme_id（可带 title）。

    返回：
      {ok, fail, total, done, stopped, dropped, results:{aid:{...}}, message}
    """
    items = [it for it in items if str(it.get("aweme_id") or "")]
    total = len(items)
    name = _src_name(src)
    tag = "[DRY-RUN] " if dry_run else ""
    log(f"{tag}准备取消{name}：{total} 条"
        f"（间隔 {delay}s{'，逐条复核' if verify else '，不复核'}）")
    if total == 0:
        return {"ok": 0, "fail": 0, "total": 0, "done": 0, "stopped": False,
                "dropped": {"before": 0, "after": 0, "removed": 0},
                "results": {}, "message": "没有需要取消的条目"}

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    results: dict[str, dict] = {}
    done = ok_n = fail_n = 0
    stopped = False
    message = ""
    seen_requests: list = []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            channel="chrome",
            headless=headless,
            viewport=VIEWPORT,
            env=_clean_env(),
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto("https://www.douyin.com/user/self?showTab=favorite_collection",
                      wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            log(f"导航提示: {e}")
        time.sleep(4)

        if dry_run:
            seen_requests = _install_dry_run(page)

        # 登录态探测：收藏接口 status_code=0 即视为已登录
        logged_in = False
        for _ in range(20):
            try:
                pr = page.evaluate(build_fetch_snippet(0))
                pj = json.loads((pr or {}).get("text") or "{}")
                if pj.get("status_code") == 0:
                    logged_in = True
                    break
            except Exception:  # noqa: BLE001
                pass
            if headless:
                break
            time.sleep(2)

        if not logged_in:
            message = ("登录态不可用：请先双击 start-collect.bat 用真实 Chrome 扫码登录一次"
                       "（登录态会存到 state/profile 复用）。")
            log("[中止] " + message)
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass
            return {"ok": 0, "fail": 0, "total": total, "done": 0, "stopped": False,
                    "dropped": {"before": 0, "after": 0, "removed": 0},
                    "results": {}, "message": message}

        for idx, it in enumerate(items, start=1):
            if should_stop and should_stop():
                stopped = True
                log(f"[停止] 已按请求中断（完成 {done}/{total}）")
                break

            aid = str(it.get("aweme_id"))
            title = (it.get("title") or aid)[:60]
            try:
                r = cancel_like(page, aid) if src == SRC_LIKE else cancel_collect(page, aid)
            except Exception as e:  # noqa: BLE001
                r = {"ok": False, "status_code": None, "msg": f"异常: {e}", "raw": {}}

            confirmed = None
            if r["ok"] and verify and not dry_run:
                try:
                    st = check_state(page, aid)
                    key = "digged" if src == SRC_LIKE else "collect"
                    confirmed = (st.get(key) is False)
                    if not confirmed:
                        # 接口说成功、复核说还在 → 以复核为准
                        r = {"ok": False, "status_code": r.get("status_code"),
                             "msg": f"接口报成功但复核显示仍在{name}列表（可能被风控拦截）",
                             "raw": r.get("raw") or {}}
                except Exception as e:  # noqa: BLE001
                    confirmed = None
                    log(f"[{aid}] ⚠ 复核失败（忽略）: {e}")

            res = {
                "aweme_id": aid,
                "title": title,
                "ok": bool(r["ok"]),
                "status_code": r.get("status_code"),
                "confirmed": confirmed,      # True 已确认取消 / False 仍在 / None 未复核
                "error": "" if r["ok"] else (r.get("msg") or "失败"),
                "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            results[aid] = res
            done += 1
            ok_n += 1 if r["ok"] else 0
            fail_n += 1 if not r["ok"] else 0

            mark = "✓" if r["ok"] else "✗"
            extra = ""
            if r["ok"] and confirmed is True:
                extra = "（已复核确认）"
            elif r["ok"] and confirmed is None and verify and not dry_run:
                extra = "（未复核）"
            log(f"[{idx}/{total}] {mark} {title}{extra}" +
                ("" if r["ok"] else f" — {res['error'][:80]}"))
            if progress:
                try:
                    progress(done, total, it, res)
                except Exception:  # noqa: BLE001
                    pass

            if idx < total and not stopped:
                time.sleep(max(0.0, delay))

        try:
            ctx.close()
        except Exception:  # noqa: BLE001
            pass

    if dry_run:
        log(f"[DRY-RUN] 共捕获 {len(seen_requests)} 个写请求（全部被拦截，未发送）：")
        for s in seen_requests:
            log("   POST " + str(s.get("url"))[:110] + "  body=" + str(s.get("body")))
        return {"ok": ok_n, "fail": fail_n, "total": total, "done": done,
                "stopped": stopped, "dropped": {"before": 0, "after": 0, "removed": 0},
                "results": results, "requests": seen_requests,
                "message": f"dry-run：捕获 {len(seen_requests)} 个写请求，未真正发送"}

    # ---- 本地同步：只有接口确认成功的才从列表里移除 ----
    good = [aid for aid, r in results.items() if r["ok"]]
    dropped = core.drop_items(src, good)
    core.log_removed([
        {"aweme_id": r["aweme_id"], "src": src, "title": r["title"],
         "ok": r["ok"], "confirmed": r["confirmed"], "error": r["error"], "at": r["at"]}
        for r in results.values()
    ])

    if not message:
        message = (f"取消{name}：成功 {ok_n} / 失败 {fail_n}"
                   f"（本地由 {dropped['before']} → {dropped['after']} 条）")
        if stopped:
            message = f"已停止，{message}"
    log("[完成] " + message)
    return {"ok": ok_n, "fail": fail_n, "total": total, "done": done,
            "stopped": stopped, "dropped": dropped, "results": results,
            "message": message}


# ---------------- CLI ----------------
def _parse_ids(args) -> list[str]:
    ids: list[str] = []
    if args.ids:
        ids += [x.strip() for x in args.ids.split(",") if x.strip()]
    if args.ids_file:
        raw = Path(args.ids_file).read_text(encoding="utf-8")
        for line in raw.replace(",", "\n").splitlines():
            line = line.strip()
            if line:
                ids.append(line)
    seen, out = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="抖音 取消收藏 / 取消喜欢")
    ap.add_argument("--src", choices=["fav", "like"], default="fav",
                    help="fav=取消收藏（默认）；like=取消喜欢")
    ap.add_argument("--ids", default="", help="aweme_id，逗号分隔")
    ap.add_argument("--ids-file", default="", help="从文件读 aweme_id（每行一个）")
    ap.add_argument("--no-verify", action="store_true", help="不做逐条复核（更快，但只看接口返回值）")
    ap.add_argument("--headed", action="store_true", help="有头模式（触发风控验证码时用）")
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="每条间隔秒数，默认 1.0")
    ap.add_argument("--dry-run", action="store_true",
                    help="只打印将要发送的请求，网络层拦截，绝不真的发")
    args = ap.parse_args()

    ids = _parse_ids(args)
    if not ids:
        print("没有指定 aweme_id。用 --ids a,b,c 或 --ids-file ids.txt")
        return

    pool = {str(x.get("aweme_id", "")): x
            for x in (core.load_liked() if args.src == "like" else core.load_collected())}
    items, missing = [], []
    for i in ids:
        if i in pool:
            items.append(pool[i])
        else:
            missing.append(i)
    if missing:
        print(f"提示：{len(missing)} 条不在本地列表中（仍会尝试取消）：{missing[:5]}")
        items += [{"aweme_id": i} for i in missing]

    print("=" * 62)
    print(f"  取消{'喜欢' if args.src == 'like' else '收藏'} · {len(items)} 条"
          f"{'  [DRY-RUN 不会真发]' if args.dry_run else ''}")
    print("  ⚠ 不可逆：取消后需重新手动操作才能恢复")
    print("=" * 62)

    r = run(items, args.src, headless=not args.headed, verify=not args.no_verify,
            delay=args.delay, dry_run=args.dry_run)
    print(json.dumps({k: v for k, v in r.items() if k != "results"},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
