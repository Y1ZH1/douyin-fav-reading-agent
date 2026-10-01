# -*- coding: utf-8 -*-
"""分区落库规则的单测。

core 依赖 cap-backend 的 script 包（本机不一定装了），所以先把两个桩模块塞进
sys.modules 再导入 core —— 这样 note_dirs_for / write_note 这些纯逻辑不依赖
whisper 也能测。测的是「落点算得对不对」「重跑会不会造出重复文件」「划线会不会丢」。
"""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent        # douyin-fav-transcribe/
sys.path.insert(0, str(HERE))


def _install_script_stub() -> None:
    """把 cap-backend 的 script 包换成最小桩，只为满足 core 的 import。"""
    if "script" in sys.modules:
        return

    def sanitize_filename(name: str) -> str:
        s = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", str(name or ""))
        s = re.sub(r"\s+", " ", s).strip()
        return s.strip(" .")[:80]

    pkg = types.ModuleType("script")
    pkg.__path__ = []                                # 让它看起来像个包
    tr = types.ModuleType("script.transcriber")
    tr.transcribe_audio = lambda *a, **k: None       # type: ignore[attr-defined]
    ut = types.ModuleType("script.utils")
    ut.sanitize_filename = sanitize_filename         # type: ignore[attr-defined]
    pkg.transcriber = tr                             # type: ignore[attr-defined]
    pkg.utils = ut                                   # type: ignore[attr-defined]
    sys.modules["script"] = pkg
    sys.modules["script.transcriber"] = tr
    sys.modules["script.utils"] = ut


_install_script_stub()
import core  # noqa: E402
import highlights as highlights_mod  # noqa: E402


def item_of(aid: str = "1001", title: str = "标题", folders=None,
            liked: bool = False, in_collection: bool = True) -> dict:
    it = {
        "aweme_id": aid,
        "title": title,
        "author": "某人",
        "video_url": f"https://www.douyin.com/video/{aid}",
        "published": "2026-01-01",
        "folders": list(folders or []),
    }
    it["liked"] = liked
    if in_collection is not None:
        it["in_collection"] = in_collection
    return it


class TestBucketRules(unittest.TestCase):
    """哪些进「收藏」，哪些进「喜欢」。"""

    def test_liked_only_when_not_in_collection(self):
        self.assertTrue(core.is_liked_only(item_of(liked=True, in_collection=False)))

    def test_both_liked_and_collected_goes_to_collection(self):
        self.assertFalse(core.is_liked_only(item_of(liked=True, in_collection=True)))

    def test_legacy_row_without_flag_falls_back_conservatively(self):
        """老数据没有 in_collection 字段：有 liked 就按「喜欢」处理。"""
        legacy = item_of(liked=True)
        legacy.pop("in_collection")
        self.assertTrue(core.is_liked_only(legacy))

    def test_not_liked_is_never_liked_only(self):
        self.assertFalse(core.is_liked_only(item_of(liked=False, in_collection=False)))


class TestNoteDirs(unittest.TestCase):
    """落点目录怎么算。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="vault-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_collected_with_folder_goes_into_that_folder(self):
        dirs = core.note_dirs_for(self.root, item_of(folders=["认知"]))
        self.assertEqual(dirs, [self.root / "收藏" / "认知"])

    def test_multi_folder_gets_one_copy_each(self):
        dirs = core.note_dirs_for(self.root, item_of(folders=["认知", "健身"]))
        self.assertEqual(dirs, [self.root / "收藏" / "认知", self.root / "收藏" / "健身"])

    def test_collected_without_folder_stays_at_top_of_bucket(self):
        dirs = core.note_dirs_for(self.root, item_of(folders=[]))
        self.assertEqual(dirs, [self.root / "收藏"])

    def test_liked_only_goes_into_liked_bucket(self):
        dirs = core.note_dirs_for(
            self.root, item_of(folders=[], liked=True, in_collection=False))
        self.assertEqual(dirs, [self.root / "喜欢"])

    def test_liked_tag_alone_is_not_a_real_folder(self):
        """「喜欢」是虚拟分组，不算真收藏夹，不能建出 收藏/喜欢/。"""
        dirs = core.note_dirs_for(
            self.root, item_of(folders=[core.LIKED_TAG], liked=True, in_collection=False))
        self.assertEqual(dirs, [self.root / "喜欢"])

    def test_duplicate_folder_names_collapse(self):
        dirs = core.note_dirs_for(self.root, item_of(folders=["认知", "认知"]))
        self.assertEqual(len(dirs), 1)

    def test_illegal_chars_in_folder_name_are_sanitized(self):
        dirs = core.note_dirs_for(self.root, item_of(folders=["a/b:c"]))
        self.assertEqual(dirs, [self.root / "收藏" / "a b c"])

    def test_blank_folder_name_falls_back(self):
        self.assertEqual(
            core._norm_dir_name("..."),
            "_未命名分组",
        )


class TestWriteNote(unittest.TestCase):
    """真正落盘：覆盖、搬移、不产生重复文件、划线不丢。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="vault-"))
        self.old_obsidian = core.DEFAULT_OBSIDIAN

    def tearDown(self):
        core.DEFAULT_OBSIDIAN = self.old_obsidian
        shutil.rmtree(self.root, ignore_errors=True)

    def test_writes_into_bucket_then_folder(self):
        paths = core.write_note(self.root, item_of(folders=["认知"]), "正文", "收藏")
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0].parent, self.root / "收藏" / "认知")
        self.assertTrue(paths[0].is_file())

    def test_rerun_overwrites_in_place_without_title_2(self):
        it = item_of(folders=["认知"])
        first = core.write_note(self.root, it, "第一版正文", "收藏")[0]
        second = core.write_note(self.root, it, "第二版正文", "收藏")[0]
        self.assertEqual(first, second)
        self.assertIn("第二版正文", second.read_text(encoding="utf-8"))
        self.assertEqual(
            [p.name for p in (self.root / "收藏" / "认知").iterdir()],
            [first.name],
        )

    def test_folder_change_moves_file_and_leaves_no_duplicate(self):
        """归属从「无夹」变成「认知」：文件应该搬过去，旧位置不留副本。"""
        it = item_of(folders=[])
        old = core.write_note(self.root, it, "正文", "收藏")[0]
        self.assertEqual(old.parent, self.root / "收藏")

        it["folders"] = ["认知"]
        new = core.write_note(self.root, it, "正文", "收藏")[0]
        self.assertEqual(new.parent, self.root / "收藏" / "认知")
        self.assertEqual(new.name, old.name)
        self.assertFalse(old.exists())
        self.assertEqual(len(list((self.root / "收藏").glob("*.md"))), 0)

    def test_multi_folder_writes_two_copies(self):
        paths = core.write_note(self.root, item_of(folders=["认知", "健身"]), "正文", "收藏")
        self.assertEqual(len(paths), 2)
        self.assertEqual({p.parent.name for p in paths}, {"认知", "健身"})

    def test_highlights_survive_retranscribe(self):
        """重转写整篇覆盖，但旧划线必须先迁到新正文上。"""
        it = item_of(folders=["认知"])
        target = core.write_note(self.root, it, "原始正文内容。", "收藏")[0]

        text = target.read_text(encoding="utf-8")
        marked = highlights_mod.upsert(text, "原始正文内容")[0]
        target.write_text(marked, encoding="utf-8")
        self.assertEqual(len(highlights_mod.parse_highlights(marked)), 1)

        core.write_note(self.root, it, "重转写之后的正文内容。", "收藏")
        after = target.read_text(encoding="utf-8")
        items = highlights_mod.parse_highlights(after)
        self.assertEqual(len(items), 1)
        # 原句没了 → 如实标 stale，不许假装还在原位
        self.assertEqual(items[0]["status"], "stale")

    def test_highlight_follows_text_that_is_still_there(self):
        it = item_of(folders=["认知"])
        target = core.write_note(self.root, it, "开头。目标句子在这里。", "收藏")[0]
        text = target.read_text(encoding="utf-8")
        target.write_text(highlights_mod.upsert(text, "目标句子在这里")[0], encoding="utf-8")

        core.write_note(self.root, it, "新增了一句开头。目标句子在这里。", "收藏")
        items = highlights_mod.parse_highlights(target.read_text(encoding="utf-8"))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
