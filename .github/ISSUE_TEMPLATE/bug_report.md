---
name: Bug 报告
about: 哪一步不对、期望是什么。请尽量带上两个服务的状态。
title: '[bug] '
labels: bug
---

## 现象

<!-- 一句话说清哪里不对 -->

## 怎么复现

1.
2.
3.

## 期望

<!-- 你以为会怎样 -->

## 两个服务的状态

跑一下这两个地址，把返回贴上来：

- `http://127.0.0.1:3001/api/agent/health`（Node）
- `http://127.0.0.1:8899/api/health`（Flask 转写服务）

```json
// 贴在这里
```

## 在哪一层

<!-- 不确定就勾「不清楚」，这条信息对定位很有用 -->

- [ ] 界面（Vue / 三栏 / 划线浮层）
- [ ] Agent 循环（SSE、工具调用、HITL）
- [ ] 转写与检索（Flask、Whisper、索引、向量）
- [ ] 笔记落库（frontmatter、划线指纹、memory.md）
- [ ] 不清楚

## 有没有动过笔记库

<!-- 划线写回 / 分类 / memory.md 都改磁盘上的 md，确认一下有没有被改坏 -->

- [ ] 没动过
- [ ] 动过，且有问题（贴一下 diff 或那段 frontmatter）

## 环境

- 系统：
- Node / Python 版本：
- 笔记库路径（`DOUYIN_OBSIDIAN_DIR`）：
- 向量装了吗：
