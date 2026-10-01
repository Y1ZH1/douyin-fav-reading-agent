# -*- coding: utf-8 -*-
"""DeepSeek AI 模块：视频文稿总结 + 中英翻译。

配置优先级：环境变量 DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
              > 本地 config.json（已在 .gitignore 中，不会上传）
接口为 OpenAI 兼容：POST {base_url}/chat/completions
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"

DEFAULT_BASE = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"
MAX_CHARS = 24000          # 单次送入的最大字符数（超长则截断，避免超上下文）


# ---------------- 配置 ----------------
def load_config() -> dict:
    cfg: dict = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            cfg = {}
    if os.environ.get("DEEPSEEK_API_KEY"):
        cfg["api_key"] = os.environ["DEEPSEEK_API_KEY"]
    if os.environ.get("DEEPSEEK_BASE_URL"):
        cfg["base_url"] = os.environ["DEEPSEEK_BASE_URL"]
    if os.environ.get("DEEPSEEK_MODEL"):
        cfg["model"] = os.environ["DEEPSEEK_MODEL"]
    return cfg


def save_config(api_key: str = "", base_url: str = "", model: str = "") -> None:
    cfg = load_config()
    for k, v in (("api_key", api_key), ("base_url", base_url), ("model", model)):
        if v:
            cfg[k] = v
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def is_configured() -> bool:
    return bool(load_config().get("api_key"))


def masked_key() -> str:
    k = load_config().get("api_key") or ""
    if len(k) <= 8:
        return "*" * len(k)
    return k[:4] + "*" * 8 + k[-4:]


# ---------------- 调用 ----------------
def chat(messages: list[dict], *, temperature: float = 0.3,
         max_tokens: int = 4096, timeout: float = 240) -> str:
    cfg = load_config()
    key = cfg.get("api_key")
    if not key:
        raise RuntimeError(
            "未配置 DeepSeek API key：请在 GUI「AI 设置」里填写，"
            "或设置环境变量 DEEPSEEK_API_KEY。"
        )
    base = (cfg.get("base_url") or DEFAULT_BASE).rstrip("/")
    model = cfg.get("model") or DEFAULT_MODEL
    url = f"{base}/chat/completions"
    # trust_env=False：绕过系统/沙箱 HTTP(S)_PROXY，直连 API
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        resp = client.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages,
                  "temperature": temperature, "max_tokens": max_tokens, "stream": False},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"DeepSeek HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except Exception:
        raise RuntimeError(f"DeepSeek 返回异常: {str(data)[:300]}")


def _clip(text: str) -> str:
    t = (text or "").strip()
    if len(t) <= MAX_CHARS:
        return t
    return t[:MAX_CHARS] + "\n\n…（内容过长，已截断）"


# ---------------- 业务能力 ----------------
def summarize(title: str, transcript: str, folder: str = "", author: str = "") -> str:
    """把视频文稿总结为结构化中文笔记（Markdown 正文，不含 frontmatter）。"""
    sys_prompt = (
        "你是一个严谨、克制的中文内容整理助手。"
        "只根据用户提供的视频文稿做总结，绝不编造文稿里没有的信息；"
        "文稿是语音转写，可能有同音错别字，请结合上下文理解，必要时纠正明显错别字。"
        "输出纯 Markdown，不要加代码块围栏。"
    )
    user_prompt = f"""请总结下面这段抖音视频的文稿，按以下结构输出 Markdown：

## 一句话概括
（一句话说清这条视频在讲什么）

## 核心要点
- （3~6 条，每条一句话，覆盖主要论点/步骤/结论）

## 金句摘录
> （摘 1~3 句原文里最有价值、最值得记录的话；没有则省略本节）

## 行动建议
（如果内容是方法/教程类，给出可执行的 2~4 条建议；如果纯观点类，写"无"）

---
视频标题：{title}
作者：{author}
所属收藏夹：{folder or "（无）"}

文稿：
{_clip(transcript)}
"""
    return chat([{"role": "system", "content": sys_prompt},
                 {"role": "user", "content": user_prompt}])


def translate_to_zh(text: str, title: str = "") -> str:
    """把外文（通常英文）文稿翻译成通顺中文，保留段落结构。"""
    sys_prompt = (
        "你是专业的中文字幕翻译。把用户给的外文稿件翻译成自然流畅的简体中文，"
        "忠实原意、口语化、不要逐字硬译，不要添加原文没有的内容，不要输出解释。"
    )
    user_prompt = f"""请把下面这段视频文稿翻译成简体中文，保留段落结构，只输出译文：

（标题：{title}）

{_clip(text)}
"""
    return chat([{"role": "system", "content": sys_prompt},
                 {"role": "user", "content": user_prompt}])


def translate_aligned(lines: list[str], title: str = "",
                      batch_chars: int = 5000) -> list[str]:
    """逐行对齐翻译：输入 N 行，输出长度同为 N 的中文行列表（顺序一一对应）。

    用于「中英对照」：原文一行、译文一行，必须严丝合缝地对齐，错位比不对照更糟。
    做法：给每行打 [n] 编号，按字符预算分批送译，再按编号解析回原文顺序。
    任何一批编号不齐 / 解析失败 / AI 报错 → 抛 RuntimeError，由调用方降级为整段翻译。
    """
    cleaned = [ln.strip() for ln in (lines or [])]
    cleaned = [ln for ln in cleaned if ln]
    if not cleaned:
        return []

    # 分批（保留全局序号，1-based）
    batches: list[list[tuple[int, str]]] = []
    cur: list[tuple[int, str]] = []
    cur_len = 0
    for i, ln in enumerate(cleaned, 1):
        if cur and cur_len + len(ln) > batch_chars:
            batches.append(cur)
            cur = []
            cur_len = 0
        cur.append((i, ln))
        cur_len += len(ln)
    if cur:
        batches.append(cur)

    sys_prompt = (
        "你是专业的中文字幕翻译。下面是一段视频字幕，已按行编号。"
        "请把每一行翻译成自然流畅的简体中文，保留原编号，"
        "一行译文对应一行原文、顺序不变；不要合并行、不要增删行、"
        "不要输出解释或额外内容，只输出带 [编号] 的译文。"
    )
    out: dict[int, str] = {}
    for batch in batches:
        expected = {i for i, _ in batch}
        numbered = "\n".join(f"[{i}] {t}" for i, t in batch)
        user_prompt = (
            f"视频标题：{title}\n\n请逐行翻译（保留 [编号]）：\n\n{numbered}"
        )
        try:
            resp = chat(
                [{"role": "system", "content": sys_prompt},
                 {"role": "user", "content": user_prompt}],
                temperature=0.2, max_tokens=6000, timeout=300,
            )
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"AI 调用失败: {e}") from e
        parsed = _parse_numbered(resp, expected)
        if parsed is None:
            raise RuntimeError("译文编号无法与原行对齐，放弃逐段对照")
        out.update(parsed)

    if len(out) != len(cleaned):
        return []
    return [out.get(i, "") for i in range(1, len(cleaned) + 1)]


def _parse_numbered(text: str, expected: set[int]) -> dict[int, str] | None:
    """从带 [n] 标记的输出里解析 {n: content}。

    按行首的 [n] 切分；允许内容跨多行（不跨越下一个 [n] 标记）。
    编号集合与 expected 不完全一致 → 返回 None（调用方据此降级）。
    """
    text = (text or "").strip()
    parts = re.split(r"(?m)^\[(\d+)\]\s*", text)
    # parts: ['', '1', 'body1', '2', 'body2', ...]
    if len(parts) < 3:
        return None
    mapping: dict[int, str] = {}
    i = 1
    while i < len(parts) - 1:
        try:
            num = int(parts[i])
        except ValueError:
            return None
        mapping[num] = parts[i + 1].strip()
        i += 2
    if set(mapping.keys()) != expected:
        return None
    return mapping


def summarize_many(notes: list[dict], topic: str = "") -> str:
    """把多篇已转写笔记汇总成一份主题综述。notes: [{title, author, content}]"""
    blocks = []
    for i, n in enumerate(notes, 1):
        blocks.append(
            f"### 笔记{i}：{n.get('title','')}\n"
            f"作者：{n.get('author','')}\n\n{_clip(n.get('content',''))}"
        )
    joined = "\n\n---\n\n".join(blocks)
    sys_prompt = (
        "你是严谨的中文知识整理助手。基于用户提供的多条视频笔记，"
        "做一份主题综述，只综合已有内容，不编造。输出纯 Markdown。"
    )
    user_prompt = f"""下面是同一个主题下的 {len(notes)} 条抖音视频笔记，请汇总成一份主题综述：

## 主题概述
（这一段整体在讲什么）

## 共识与要点
- （多条笔记共同提到的关键点）

## 各家观点差异
- （不同作者说法不一致的地方；没有则写"无"）

## 值得记录的金句
> （从原文里摘 2~5 句）

## 我的行动清单
- （综合后给出的 3~6 条可执行建议）

{f"（用户指定的主题/关注点：{topic}）" if topic else ""}

素材：
{joined}
"""
    return chat([{"role": "system", "content": sys_prompt},
                 {"role": "user", "content": user_prompt}], max_tokens=6000)
