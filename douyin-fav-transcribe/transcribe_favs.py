# -*- coding: utf-8 -*-
"""CLI：抖音收藏 -> 本地 Whisper 转写 -> Obsidian。薄封装，逻辑见 core.py。
GUI 请跑 app.py（网页界面），功能相同还带封面/状态渲染。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import core


def main() -> None:
    ap = argparse.ArgumentParser(description="抖音收藏视频本地转写（CLI）")
    ap.add_argument("--obsidian", type=str, default=str(core.DEFAULT_OBSIDIAN))
    ap.add_argument("--model", type=str, default=core.DEFAULT_MODEL,
                    help="tiny/base/small/medium/large-v3（默认 large-v3，中文最准；small 更快）")
    ap.add_argument("--only", type=str, default="", help="只处理指定 aweme_id(逗号分隔)")
    ap.add_argument("--retry-fail", action="store_true", help="只重跑上次失败条目")
    ap.add_argument("--force", action="store_true",
                    help="重新转录：连已提取(ok)的条目也重跑并覆盖旧笔记")
    ap.add_argument("--translate-mode", type=str, default="",
                    choices=["", "aligned", "whole"],
                    help="外文视频翻译模式：aligned 逐句对照(默认) / whole 整段翻译")
    args = ap.parse_args()

    obsidian_dir = Path(args.obsidian)
    items = core.load_all()   # 收藏 + 喜欢 联合视图（按 aweme_id 去重）
    if not items:
        print(f"未找到 {core.COLLECTED_PATH} 或为空。请先运行 collector.py。")
        sys.exit(1)

    status = core.load_status()
    only_set = {s.strip() for s in args.only.split(",") if s.strip()}
    ok_ids = set(status.ok)
    fail_ids = set(status.fail)

    queue = []
    for it in items:
        aid = str(it.get("aweme_id", ""))
        if only_set and aid not in only_set:
            continue
        if args.retry_fail and aid not in fail_ids:
            continue
        if aid in ok_ids and not (args.retry_fail or only_set or args.force):
            continue
        queue.append(it)

    if not queue:
        print("没有需要处理的条目（都已转写或不在筛选内）。用 GUI 或指定 --only/--retry-fail。")
        return

    mode = args.translate_mode or core.TRANSLATE_MODE
    print(f"待处理 {len(queue)} 条，模型 {args.model}，翻译模式 {mode}，落库 {obsidian_dir}\n")
    res = core.transcribe_many(queue, obsidian_dir=obsidian_dir, model=args.model,
                               force=args.force, translate_mode=args.translate_mode or None)
    ok = sum(1 for r in res if r.get("ok"))
    fail = sum(1 for r in res if not r.get("ok") and r.get("state") == "fail")
    skip = sum(1 for r in res if r.get("state") == "skipped")
    dup = sum(1 for r in res if r.get("skipped_dup"))
    print(f"\n完成：成功 {ok}，失败 {fail}，跳过(无语音) {skip}，已存在跳过 {dup}。")


if __name__ == "__main__":
    main()
