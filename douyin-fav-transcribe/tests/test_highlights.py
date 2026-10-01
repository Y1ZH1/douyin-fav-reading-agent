# -*- coding: utf-8 -*-
"""划线指纹 / stale 重匹配 / 检索评测的单测。

跑法（在本目录下）：
    python -m unittest discover -s tests -v
或用项目根的脚本：npm run test:py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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
第二段内容，换了个说法接着说同一件事，重点在于是不是每天都能做到。
第三段内容，收个尾。
"""


class TestFrontmatter(unittest.TestCase):
    def test_split_and_join_roundtrip(self):
        inner, body, nl = highlights.split_frontmatter(NOTE)
        self.assertIn('aweme_id: "7300000000000000001"', inner)
        self.assertTrue(body.startswith("# 测试视频"))
        self.assertEqual(highlights.join_frontmatter(inner, body, nl), NOTE)

    def test_no_frontmatter(self):
        inner, body, _nl = highlights.split_frontmatter("# 只有正文")
        self.assertEqual(inner, "")
        self.assertEqual(body, "# 只有正文")


class TestHighlightWriteRead(unittest.TestCase):
    def test_upsert_adds_block_and_keeps_other_keys(self):
        text, hl, stats = highlights.upsert(NOTE, "保持稳定的注意力")
        self.assertEqual(stats["added"], 1)
        self.assertGreaterEqual(hl["start"], 0)
        inner, _body, _nl = highlights.split_frontmatter(text)
        self.assertIn("highlights:", inner)
        self.assertIn('aweme_id: "7300000000000000001"', inner)
        self.assertIn("folders:", inner)
        # 正文没被改动
        self.assertIn("第三段内容，收个尾。", text)

    def test_upsert_is_idempotent(self):
        once, _hl, _s = highlights.upsert(NOTE, "保持稳定的注意力")
        twice, _hl2, stats = highlights.upsert(once, "保持稳定的注意力")
        self.assertEqual(stats["added"], 0)
        self.assertEqual(stats["reused"], 1)
        self.assertEqual(once, twice)

    def test_roundtrip_parse(self):
        text, hl, _s = highlights.upsert(NOTE, "换了个说法接着说同一件事")
        items = highlights.parse_highlights(text)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["quote"], "换了个说法接着说同一件事")
        self.assertEqual(items[0]["id"], hl["id"])
        self.assertEqual(items[0]["status"], "ok")

    def test_quote_not_in_body_is_stale_not_fake_ok(self):
        text, hl, _s = highlights.upsert(NOTE, "这段原文根本不在正文里")
        self.assertEqual(hl["status"], "stale")
        self.assertEqual(hl["start"], -1)
        self.assertEqual(highlights.parse_highlights(text)[0]["status"], "stale")

    def test_multiline_quote_matches_across_newlines(self):
        text, hl, _s = highlights.upsert(NOTE, "讲的是一个人怎么\n在长期里保持稳定的注意力")
        self.assertEqual(hl["status"], "ok")
        self.assertGreaterEqual(hl["start"], 0)
        self.assertEqual(highlights.parse_highlights(text)[0]["quote"],
                         "讲的是一个人怎么 在长期里保持稳定的注意力")

    def test_empty_block_when_no_highlights(self):
        self.assertEqual(highlights.serialize_highlights([]), "highlights: []")


class TestRematch(unittest.TestCase):
    def test_original_offset_still_valid(self):
        text, hl, _s = highlights.upsert(NOTE, "第三段内容")
        _inner, body, _nl = highlights.split_frontmatter(text)
        out, stats = highlights.rematch(highlights.parse_highlights(text), body)
        self.assertEqual(stats["ok"], 1)
        self.assertEqual(stats["moved"], 0)
        self.assertEqual(out[0]["start"], hl["start"])

    def test_fingerprint_moves_offset_after_retranscribe(self):
        text, hl, _s = highlights.upsert(NOTE, "第三段内容")
        items = highlights.parse_highlights(text)
        # 模拟重转写：正文前面插了一段，偏移整体后移
        new_body = "开头多了一段新的内容。\n\n" + highlights.split_frontmatter(NOTE)[1]
        out, stats = highlights.rematch(items, new_body)
        self.assertEqual(stats["moved"], 1)
        self.assertEqual(out[0]["status"], "ok")
        self.assertEqual(new_body[out[0]["start"]:out[0]["end"]], "第三段内容")

    def test_stale_when_quote_gone(self):
        text, _hl, _s = highlights.upsert(NOTE, "这句话在新版本里被删掉了")
        items = highlights.parse_highlights(text)
        # 先手工把它标成有偏移，模拟「原来定位过、现在正文变了」
        items[0]["start"], items[0]["end"] = 10, 30
        out, stats = highlights.rematch(items, highlights.split_frontmatter(NOTE)[1])
        self.assertEqual(stats["stale"], 1)
        self.assertEqual(out[0]["status"], "stale")
        self.assertEqual(out[0]["start"], -1)
        self.assertEqual(out[0]["quote"], "这句话在新版本里被删掉了")

    def test_carry_over_migrates_and_marks_stale(self):
        old = highlights.write_highlights(
            NOTE,
            [highlights.make_highlight("第三段内容", highlights.split_frontmatter(NOTE)[1]),
             highlights.make_highlight("已经消失的句子", highlights.split_frontmatter(NOTE)[1])],
        )
        new_body = "全新正文，只有一句：第三段内容 还在这里。"
        fresh = highlights.join_frontmatter("aweme_id: \"1\"", new_body)
        merged, stats = highlights.carry_over(old, fresh)
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["moved"], 1)
        self.assertEqual(stats["stale"], 1)
        items = highlights.parse_highlights(merged)
        self.assertEqual(len(items), 2)
        self.assertEqual({i["status"] for i in items}, {"ok", "stale"})
        self.assertIn('aweme_id: "1"', merged)

    def test_duplicate_span_marked_stale(self):
        body = highlights.split_frontmatter(NOTE)[1]
        items = [
            {"id": "a", "quote": "第三段内容", "prefix": "", "suffix": "", "start": -1, "end": -1},
            {"id": "b", "quote": "第三段内容", "prefix": "", "suffix": "", "start": -1, "end": -1},
        ]
        out, stats = highlights.rematch(items, body)
        self.assertEqual(stats["moved"], 1)
        self.assertEqual(stats["stale"], 1)


class TestFingerprintHelpers(unittest.TestCase):
    def test_fingerprint_32_chars(self):
        q = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五"
        pre, suf = highlights.fingerprint(q)
        self.assertEqual(len(pre), 32)
        self.assertEqual(len(suf), 32)

    def test_find_normalized_whitespace_insensitive(self):
        body = "前面  有\n\n多个空白  的目标词"
        found = highlights.find_normalized(body, "有 多个空白 的目标词")
        self.assertIsNotNone(found)
        lo, hi = found  # type: ignore[misc]
        self.assertEqual(highlights.collapse(body[lo:hi])[0], "有 多个空白 的目标词")

    def test_replace_block_keeps_other_keys_order(self):
        text, _hl, _s = highlights.upsert(NOTE, "第三段内容")
        text2 = highlights.write_highlights(text, highlights.parse_highlights(text))
        inner, _b, _n = highlights.split_frontmatter(text2)
        self.assertLess(inner.index("aweme_id"), inner.index("highlights"))
        self.assertEqual(len(highlights.parse_highlights(text2)), 1)


class TestRetrieveEval(unittest.TestCase):
    """检索评测：不需要向量也能跑通，且必须诚实标注「只有 FTS」。"""

    def setUp(self):
        import tempfile

        import retrieve

        self.retrieve = retrieve
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "a.md").write_text(
            "---\naweme_id: \"a\"\n---\n\n# 注意力\n\n长期保持稳定注意力的办法是把目标切小。\n",
            encoding="utf-8")
        (self.root / "b.md").write_text(
            "---\naweme_id: \"b\"\n---\n\n# 睡眠\n\n睡眠不足会让第二天判断力明显下降。\n",
            encoding="utf-8")
        self._db_backup = retrieve.DB_PATH
        self._state = retrieve.STATE_DIR
        retrieve.STATE_DIR = self.root / "state"
        retrieve.DB_PATH = retrieve.STATE_DIR / "idx.sqlite"

    def tearDown(self):
        self.retrieve.STATE_DIR = self._state
        self.retrieve.DB_PATH = self._db_backup
        self.retrieve.reset_embedder()
        self.tmp.cleanup()

    def test_fts_search_scores_scoped_hits_higher(self):
        self.retrieve.rebuild(self.root)
        hits = self.retrieve.search("注意力", k=5, use_vector=False)
        self.assertTrue(hits)
        self.assertEqual(hits[0]["title"], "注意力")

    def test_evaluate_reports_fts_only_when_vector_missing(self):
        report = self.retrieve.evaluate(self.root, k=5, n=10)
        self.assertTrue(report["ok"])
        self.assertIn("fts", report)
        self.assertGreaterEqual(report["fts"]["recall"], 0.0)
        self.assertEqual(report["vector"] is None, not report["vector_available"])

    def test_search_never_raises_when_vector_broken(self):
        self.retrieve.rebuild(self.root)
        orig = self.retrieve._embed
        self.retrieve._embed = lambda _t: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            hits = self.retrieve.search("睡眠", k=5, use_vector=True)
        finally:
            self.retrieve._embed = orig
        self.assertTrue(hits)


if __name__ == "__main__":
    unittest.main(verbosity=2)
