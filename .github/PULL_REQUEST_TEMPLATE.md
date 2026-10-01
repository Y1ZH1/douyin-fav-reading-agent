## 改了什么

<!-- 一段话说清，别贴 diff -->

## 为什么

<!-- 哪个痛点 / 哪条规格 -->

## 碰没碰这些红线

- [ ] 没有把对话写进笔记库（对话只在浏览器 IndexedDB）
- [ ] 没有用向量替换全文检索（向量只能是叠加，挂了要能退回 FTS）
- [ ] 没有让 Agent 自动写 memory.md（必须用户确认）
- [ ] 没有让 Agent 自动钉检索结果（必须用户勾选）
- [ ] 没有删掉旧导师页面的源码（只从导航隐藏）
- [ ] 写笔记的路径仍受白名单限制

## 验过没有

- [ ] `npm run test`（Node 31 例 + Python 19 例）
- [ ] `cd client && npm run build` 通过
- [ ] 手动跑过：起两个服务，划线 → 解释 → 入笔记
- [ ] 如果改了高亮格式：Python 与 Node 两侧的格式契约测试都过
      （`douyin-fav-transcribe/tests/fixtures/note_with_highlight.md` 是共用夹具）

## 备注
