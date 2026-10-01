# -*- coding: utf-8 -*-
"""一次性迁移：把旧版平铺在「抖音收藏/」下的转写笔记，按新规则分类到
「抖音/收藏/<收藏夹名>/」与「抖音/喜欢/」。

用法：
    python migrate_notes.py            # 空跑，只打印计划
    python migrate_notes.py --apply    # 备份 + 实际搬移
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import core  # noqa: E402

# 落库根统一由 core 决定：DOUYIN_OBSIDIAN_DIR 优先，否则用项目下的 ./抖音。
# 这里不硬编码任何个人路径——仓库是公开的，路径只能来自环境变量或相对默认值。
DST = core.DEFAULT_OBSIDIAN
SRC = DST.parent / "抖音收藏"        # 旧版平铺目录（迁移的来源）
WORK = HERE / "work"

AWEME_RE = re.compile(r'aweme_id:\s*"?(\d+)"?')


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def build_plan():
    collected = {str(x["aweme_id"]): x for x in load_json(core.STATE_DIR / "collected.json")}
    liked = {str(x["aweme_id"]): x for x in load_json(core.STATE_DIR / "liked.json")}

    plan: list[tuple[Path, list[Path]]] = []
    notes: list[tuple[Path, str, str]] = []   # (path, bucket, note)
    skipped: list[tuple[Path, str]] = []

    for p in sorted(SRC.iterdir()):
        if not p.is_file() or p.suffix.lower() != ".md":
            continue
        head = p.read_text(encoding="utf-8", errors="ignore")[:1200]
        m = AWEME_RE.search(head)
        aid = m.group(1) if m else ""
        if not aid:
            skipped.append((p, "无 aweme_id（非转写笔记？）"))
            continue
        if aid in collected:
            item = dict(collected[aid])
            item["in_collection"] = True
            bucket = "收藏"
        elif aid in liked:
            item = dict(liked[aid])
            item["in_collection"] = False
            item["liked"] = True
            bucket = "喜欢"
        else:
            item = {"aweme_id": aid, "in_collection": True}
            bucket = "收藏"
            skipped.append((p, f"aweme_id {aid} 不在收藏/喜欢列表，按收藏顶层处理"))
        dirs = core.note_dirs_for(DST, item)
        plan.append((p, dirs))
        notes.append((p, bucket, " | ".join(str(d.relative_to(DST)) for d in dirs)))

    # 处理落点重名（不同视频标题相同）
    claimed: set[Path] = set()
    moves: list[tuple[Path, Path, bool]] = []
    for src, dirs in plan:
        for i, d in enumerate(dirs):
            tgt = d / src.name
            if tgt in claimed:
                c = 1
                while (d / f"{src.stem}_{c}{src.suffix}") in claimed:
                    c += 1
                tgt = d / f"{src.stem}_{c}{src.suffix}"
            claimed.add(tgt)
            moves.append((src, tgt, i == 0))
    return moves, notes, skipped


def main():
    apply = "--apply" in sys.argv
    moves, notes, skipped = build_plan()

    print(f"待搬移笔记：{len(notes)} 篇 -> {len(moves)} 个落点（多收藏夹会多存几份）")
    buckets: dict[str, int] = {}
    for _p, bucket, _d in notes:
        buckets[bucket] = buckets.get(bucket, 0) + 1
    print("  按来源：", buckets)
    dirs_count: dict[str, int] = {}
    for _s, t, _f in moves:
        k = str(t.parent.relative_to(DST))
        dirs_count[k] = dirs_count.get(k, 0) + 1
    print(f"目标目录 {len(dirs_count)} 个：")
    for k, v in sorted(dirs_count.items(), key=lambda x: -x[1]):
        print(f"    {v:4d}  {k}")

    if skipped:
        print("\n【未按常规分类 / 未处理】")
        for p, why in skipped:
            print(f"    - {p.name[:60]}  ← {why}")

    subdirs = [d for d in SRC.iterdir() if d.is_dir()]
    if subdirs:
        print("\n【旧目录下的子目录】")
        for d in subdirs:
            n = len(list(d.rglob("*")))
            print(f"    - {d.name}/  ({n} 个条目)")

    if not apply:
        print("\n（空跑模式，未做任何改动。加 --apply 执行）")
        return

    ts = time.strftime("%Y%m%d-%H%M%S")
    WORK.mkdir(exist_ok=True)
    backup = WORK / f"_backup_抖音收藏_{ts}"
    print(f"\n[1/4] 备份 -> {backup}")
    shutil.copytree(SRC, backup)
    print("      备份完成")

    print("[2/4] 搬移笔记…")
    done = 0
    # 先做「多收藏夹的额外副本」（此时源文件还在），最后再移动主副本，
    # 否则主副本一移走，后续 copy2 就找不到源文件了。
    ordered = [m for m in moves if not m[2]] + [m for m in moves if m[2]]
    for src, tgt, is_primary in ordered:
        tgt.parent.mkdir(parents=True, exist_ok=True)
        if is_primary:
            shutil.move(str(src), str(tgt))
        else:
            shutil.copy2(str(src), str(tgt))
        done += 1
    print(f"      完成 {done} 个落点")

    print("[3/4] 搬移旧子目录…")
    for d in list(SRC.iterdir()):
        if not d.is_dir():
            continue
        target = DST / d.name
        if target.exists():
            print(f"      {d.name}/ 目标已存在，跳过")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(target))
        print(f"      {d.name}/ -> {target}")

    print("[4/4] 写迁移清单…")
    manifest = WORK / f"_migrate_manifest_{ts}.json"
    manifest.write_text(json.dumps({
        "ts": ts,
        "src_root": str(SRC),
        "dst_root": str(DST),
        "backup": str(backup),
        "moves": [[str(s), str(t)] for s, t, _ in moves],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"      {manifest}")
    print("\n完成。回滚方式：按 manifest 的 moves 反向搬回，或直接从 backup 还原。")


if __name__ == "__main__":
    main()
