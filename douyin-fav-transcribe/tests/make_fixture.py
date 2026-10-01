# -*- coding: utf-8 -*-
"""生成两端共用的 fixture：Python 写、Node 读，用来卡住格式漂移。

跑法：python tests/make_fixture.py
产物：tests/fixtures/note_with_highlight.md
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import highlights  # noqa: E402

NOTE = """---
aweme_id: "7300000000000000001"
title: "测试视频"
folders:
  - 认知
liked: false
---

# 测试视频

第一段内容，讲的是一个人怎么在长期里保持稳定的注意力。
第二段内容，换了个说法接着说同一件事。
第三段内容，收个尾。
"""


def main() -> None:
    text, hl, _stats = highlights.upsert(NOTE, "换了个说法接着说同一件事")
    text, _hl2, _s2 = highlights.upsert(text, "第一段内容，讲的是一个人\n怎么在长期里保持稳定的注意力")
    out = HERE / "fixtures" / "note_with_highlight.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out}")
    print(f"highlight#1 start={hl['start']} end={hl['end']} status={hl['status']}")


if __name__ == "__main__":
    main()
