# 收藏阅读 Agent

把你**已经转写好的抖音收藏**变成能对话的阅读材料：划线、解释、追问、入笔记、归类、检索。

它不是又一个 ChatGPT 壳，也不是重做一遍采集器 —— **转写是别人干的活，这里做的是「读完它」**。

> **一句话**：基于本地抖音收藏转写库的阅读 Agent。Vue 3 + Node 工具循环 / HITL / SSE，
> Python 负责转写与中文检索，**Obsidian markdown 是源真相**。

---

## 目录

- [1. 这是什么](#1-这是什么)
- [2. 能做什么](#2-能做什么)
- [3. 架构](#3-架构)
- [4. 快速开始](#4-快速开始)
- [5. 环境变量](#5-环境变量)
- [6. 目录结构](#6-目录结构)
- [7. 几个关键设计](#7-几个关键设计)
- [8. 测试](#8-测试)
- [9. 隐私与安全](#9-隐私与安全)
- [10. 常见问题](#10-常见问题)
- [11. 明确不做](#11-明确不做)
- [12. 仓库里的旧代码](#12-仓库里的旧代码)

---

## 1. 这是什么

先说清它**不在**哪一步：

```
   抖音收藏 ──采集──▶ 视频 ──Whisper 转写──▶ Obsidian 笔记 ──┐
                  ↑                                          │
        douyin-fav-transcribe/                              ▼
        （本仓库的 Python 部分）                      ┌──────────────┐
                                                      │  本项目      │
                                                      │  收藏阅读    │
                                                      │  Agent       │
                                                      └──────────────┘
                                                             │
                                        划线／解释／追问／入笔记／归类／检索
```

- **左边那半已经有人做了**：`douyin-fav-transcribe/` 负责登录抖音、拉收藏与「喜欢」列表、用 faster-whisper 转写成 markdown，按来源和收藏夹分好目录。
- **右边才是这个项目的主体**：把那一库 markdown 当成「材料」，在上面做阅读交互。

所以这里**没有**重新实现采集和转写，也没有把笔记搬进数据库 —— 笔记始终是 Obsidian 里那些 `.md`，
你在 Obsidian 里随时能读原文，Agent 只是另一个读写者。

---

## 2. 能做什么

界面上是三栏：**左**（对话列表 / 收藏夹树）｜**中**（转写正文）｜**右**（对话与工具轨迹）。

| 能力 | 怎么用 |
|---|---|
| **划线解释** | 在正文里选中一段 → 工具条上点「解释」。可以配自己的提示词，存进设置下次默认用 |
| **追问** | 每轮回答后自动给三条追问建议，点一下继续 |
| **入笔记** | 把选中的原句写回笔记的 `highlights` 块（**不是**把聊天记录写进笔记） |
| **归类** | 让 Agent 判断这条视频该进哪个收藏夹。高置信度自动写，拿不准就弹卡片让你选 |
| **检索** | 跨全库找相关片段（FTS5 全文，可选叠加向量）。**命中只提案，不自动塞进上下文** |
| **候选提案** | 开一个新对话、手上没选中文字时，点「给我一批候选」先看有什么，勾选后再 @ |
| **记忆** | Agent 从你的行为日志里「编译」出习惯草稿，你确认后才写进 `memory.md` |
| **开机自检** | 顶部横幅告诉你：转写服务开没开、索引建没建、向量装没装、两边库路径是否一致 |

---

## 3. 架构

```
┌─────────────────────────────────────────────────────────┐
│  Vue 3  :5173                                           │
│  三栏 UI ／ 划线工具条 ／ HITL 确认卡 ／ 候选托盘          │
│  对话存 IndexedDB（不进笔记库）                            │
└───────────────────────┬─────────────────────────────────┘
                        │  SSE（流式）+ REST（同源，走 Vite proxy）
┌───────────────────────▼─────────────────────────────────┐
│  Node + Express  :3001                                  │
│  Agent 循环：意图分派 → 工具调用 → HITL → 流式 → 行为日志  │
│  写库路径白名单（assertInsideVault）                       │
└──────────┬──────────────────────────┬───────────────────┘
           │ HTTP                     │ LLM（DeepSeek 等兼容接口）
┌──────────▼─────────────────┐        │
│  Python + Flask  :8899      │        │
│  收藏列表／Whisper／落库     │        │
│  FTS5 全文索引（+可选向量）  │        │
└──────────┬─────────────────┘        │
           │                          │
┌──────────▼─────────────────────────▼────────────────────┐
│  Obsidian markdown  ←  源真相（收藏/ 喜欢/ AI总结/ 分桶）   │
└─────────────────────────────────────────────────────────┘
```

### 为什么拆成两个后端

**「Agent 循环」不等于「模型推理」。** 循环里真正做的事是：

```
读 memory → 按意图分派 → 调工具 → 需要用户拍板就挂起 → 把 token 流回去 → 落行为日志
```

这一整套是 IO 密集的编排（长连接 + 外部 LLM HTTP），而 Whisper 转写和中文检索是 CPU / 本地 IO 重的活。
把它们放在同一个进程里，重活会拖住长连接；放在两个进程里，各自都能独立重启、独立替换：

- 换 LLM 供应商 → 只动 Node
- 换 ASR 方案 / 检索实现 → 只动 Python
- Python 没起来 → 阅读、划线、解释**照常能用**（读笔记优先直读磁盘，Flask 只是兜底）

---

## 4. 快速开始

### 4.1 前置条件

| 需要什么 | 说明 |
|---|---|
| Node.js ≥ 20 | 跑 Agent 与前端 |
| Python ≥ 3.10 | 跑转写与检索服务 |
| **`cap-backend` 项目** | ⚠️ **转写代码不在本仓库**。`douyin-fav-transcribe/core.py` 会 `from script.transcriber import ...`，这个 `script` 包来自另一个独立项目 `cap-backend`。把它克隆到与本仓库**同级**的目录，或设 `CAP_BACKEND_DIR` 指向它。详见 [douyin-fav-transcribe/README.md §0.1](douyin-fav-transcribe/README.md) |
| Obsidian 库 | markdown 落在这里。路径用 `DOUYIN_OBSIDIAN_DIR` 指定 |

### 4.2 装依赖

```bash
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

### 4.3 起服务

**最简单：双击 `start-reading.bat`。** 它会

1. 开两个窗口：转写服务（`:8899`）与阅读 Agent（`:3001` + `:5173`）
2. 轮询两个端口，都就绪后自动打开浏览器
3. 超时了会用人话告诉你卡在哪一步

手动起也行：

```bash
# 窗口 1 —— 转写与检索
cd douyin-fav-transcribe && start-gui.bat        # → http://127.0.0.1:8899

# 窗口 2 —— Agent + 阅读页
npm run dev                                       # → :3001 + :5173
```

然后打开 <http://127.0.0.1:5173>。**两个窗口都别关。**

> 在 Obsidian 里用 Web Viewer / Custom Frames 打开同一个地址也可以 —— 本项目
> **不做 Obsidian 插件**，也不把网页打包进笔记库。

### 4.4 先确认它活着

打开页面后看顶部横幅。它会告诉你四件事：转写服务在不在、索引建没建、
向量装没装、两边的笔记库路径是否一致。全绿就可以开始用了。

---

## 5. 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `DOUYIN_OBSIDIAN_DIR` | 笔记落库**根**目录（其下会自动分 `收藏/`、`喜欢/`、`AI总结/`） | 项目内的 `./抖音/` |
| `DOUYIN_FLASK_URL` | 转写服务地址（Node 侧用它找 Python） | `http://127.0.0.1:8899` |
| `AGENT_STATE_DIR` | 阅读 Agent 的行为日志目录（**不进笔记库**） | `server/.state/` |
| `DOUYIN_PORT` | 转写服务端口 | `8899`，被占用或被系统保留时自动顺延 |
| `DOUYIN_TRANSLATE_MODE` | 外文视频翻译模式：`aligned` 逐句对照 / `whole` 整段 | `aligned` |
| `CAP_BACKEND_DIR` | `cap-backend` 项目根目录 | 自动探测同级 `../cap-backend` |
| `DEEPSEEK_API_KEY` | AI 总结 / 翻译用的 key | 无（不填只影响 AI 功能） |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `AI_MODEL` | 阅读 Agent 用的模型（也可在设置页填） | 见 `server/.env.example` |
| `DOUYIN_PIP_INDEX` | 一键装向量时的 pip 源 | 清华源 |
| `HF_ENDPOINT` | 下 embedding 模型的镜像 | `hf-mirror.com` |

把 `.env.example`、`config.example.env` 复制成 `.env`、`config.env` 再填 —— 这两个真身都已被 `.gitignore` 忽略。

---

## 6. 目录结构

```
aicodetutor/
├─ client/                      # Vue 3 前端
│  └─ src/
│     ├─ views/AgentView.vue             # 三栏装配（只管布局）
│     ├─ components/agent/               # FolderTree / NotePane / ChatPane / HitlCard
│     │                                  # CandidateTray / HealthBanner / VectorPanel / MemoryPanel
│     ├─ composables/useAgentRun.ts      # SSE 事件 → 界面状态（只管事件，不管布局）
│     ├─ services/api/agent-api.ts       # 所有 REST 调用，返回 {ok, data, error} 不抛异常
│     └─ types/agent.ts
│
├─ server/                      # Node：Agent 循环
│  ├─ src/
│  │  ├─ agent.ts                        # 意图分派 + 状态机 + SSE（核心）
│  │  ├─ routes/agent.ts                 # REST 路由（memory / log / notes / health / proxy）
│  │  ├─ highlights.ts                   # 划线格式（与 Python 侧必须一致）
│  │  ├─ vault.ts                        # 笔记库读写 + 路径白名单
│  │  ├─ services/
│  │  │  ├─ agent-tools.ts               # 工具实现 + Jev 双门槛判定
│  │  │  └─ behavior-log.ts              # 行为日志 → memory 草稿编译
│  │  ├─ app.ts                          # 只装配
│  │  └─ index.ts                        # 只 listen
│  └─ test/                              # node --test
│
├─ douyin-fav-transcribe/       # Python：转写 + 检索工人（有独立完整 README）
│  ├─ app.py                    # Flask GUI 与 API
│  ├─ core.py                   # 采集合并 / 落库分区 / 转写
│  ├─ retrieve.py               # FTS5 全文索引 + 可选向量
│  ├─ highlights.py             # 划线落库格式 + stale 重匹配
│  ├─ vector_setup.py           # 一键装向量环境
│  ├─ _migrate_notes.py         # 旧版平铺笔记 → 新分区的一次性迁移
│  └─ tests/
│
├─ docs/                        # 规格 / 设计 / 计划 / 简历口径
├─ start-reading.bat            # 一键起两个进程
└─ README.md
```

---

## 7. 几个关键设计

### 7.1 意图分派，不用原生 function calling

前端知道用户点了什么（工具条「解释」、卡片「跳过」、输入框回车），所以意图直接由入口给出，
比让模型猜更准。全库共 10 种意图：`chat / explain / summarize / add_note / classify /
retrieve / propose / followup / memory_patch / memory_compile`。

只有分类这一处需要**结构化输出**，做法是「强制 JSON + 容错提取」（模型偶尔裹一层 ```json）。

### 7.2 SSE 事件协议驱动状态机

9 类事件对应 6 个状态（`idle / tool / streaming / hitl / followup / done`）：

| 事件 | 前端去向 |
|---|---|
| `state` | 顶部状态（「正在调用工具」/「正在生成」） |
| `tool_call` / `tool_result` | 挂到消息下的可展开工具轨迹 |
| `proposals` | 候选托盘（**默认不钉**） |
| `hitl_request` | 弹确认卡，本次运行挂起等用户 |
| `followup_suggestions` | 追问芯片 |
| `token` | 追加到助手消息 |
| `error` | 错误条（统一是「问题 + 处理动作」两段式） |

**为什么不用 `EventSource`**：要 POST 一个可能带几千字正文的 body，而 `EventSource` 只能 GET。
所以前端手写 `ReadableStream` + `TextDecoder` 解析，并用 `AbortController` 支持中途打断。

### 7.3 人机中断（HITL）：自动，但别乱动我的东西

分类走**双门槛**：

```
confidence ≥ 0.72   且   confidence - second ≥ 0.08   → 自动写
否则                                                  → 弹卡片：选已有夹 / 新建 / 跳过
```

只看置信度会让「0.75 vs 0.74」这种两个夹胶着的情况被自动写错，所以还要看与第二名的**间隙**。

对 `memory.md` 的写入更严：三条路径（用户说「记住」、设置页手改、日志编译）**全部**要确认，
`PUT /memory` 缺 `approved` 直接返回 403。

### 7.4 材料与会话分离

| 数据 | 住在哪 | 为什么 |
|---|---|---|
| 转写正文、划线 | Obsidian `.md` | **源真相**，你要能随时读原文 |
| 对话、钉选的笔记 | 浏览器 IndexedDB | 过程产物，塞进笔记库会污染 Obsidian 的检索与图谱 |
| 行为日志 | `server/.state/*.jsonl` | 只服务 memory 编译，不进笔记库 |
| 向量索引 | `state/*.sqlite` | 可随时重建的派生数据 |

由此推出一个反直觉的默认行为：**检索命中的笔记不自动进上下文，只提案。**
因为「钉上」= 每轮请求都带上它，整库灌 prompt 既贵又糊。钉不钉由你勾选。

### 7.5 划线指纹 + 重转写后的 stale 重匹配

重新转写会整篇覆盖正文，偏移量全部失效。所以划线不以「裸引用」存在，而是进 frontmatter：

```yaml
highlights:
  - id: "h-1790500970601-c11ab2"
    quote: "换了个说法接着说同一件事"
    prefix: "<前 32 字指纹>"
    suffix: "<后 32 字指纹>"
    start: 42
    end: 54
    status: ok          # ok | stale
```

覆盖前按**由强到弱**四级重定位：
`prefix + quote + suffix` → `prefix + quote` → `quote` → `quote + suffix`。
全都不中就标 `stale` 并如实告诉你，**不假装它还在原位**。

> 踩过的坑：把空白折成单空格后，中文跨行的 `怎么\n在` 会变成 `怎么 在`，而正文里是 `怎么在`，
> 于是好好的划线被判成 stale。现在两种归一化都试（英文靠保留空格、中文靠去掉空白），
> 并把归一化串上的下标映射回原文偏移。

### 7.6 行为日志 → memory 自动编译

每次划线解释 / 入笔记 / 分类 / 检索 / 钉笔记 / 说「记住」都往 append-only 的 JSONL 记一条。
编译时按**保守规则**聚合成 `memory.md` 草稿：

- 分类习惯：同一目标夹被接受 **≥ 2 次**
- 解释偏好：提示词里反复出现的词
- 常查主题：检索 **≥ 3 次**才统计
- 使用节奏：合计 **≥ 5 次**才写一句

规则刻意保守 —— 单次行为不算习惯，否则 memory 变流水账，反而污染每一次 system prompt。
而且 `compileMemory()` 的函数签名就是「进文本、出文本」，**它没有能力写文件**，落地必须走确认。

### 7.7 向量检索是可降级的叠加层

- 基线永远是 FTS5。向量只是叠加；`_embed()` 任何失败都静默退回全文检索。
- 一键安装会建**独立 venv**（`state/venv-vector`）装 `sentence-transformers`，
  下 `BAAI/bge-small-zh-v1.5`（清华 pip 源 + hf-mirror），装完挂进 `sys.path` —— **不用换解释器、不用重启**。
- 自带**自监督评测**：从每篇笔记取最长的中文片段当 query，期望命中它自己，
  量出 recall@k / MRR 以及「相比纯 FTS 的增益」，让「向量到底有没有用」有数字可答。
- **不装也照样能用**，界面里就这么写。

### 7.8 降级路径都说实话

- 转写服务没开 → 退回本地词面粗筛，结果标 `via: 'local'`，界面上**黄色警示**说明「这是粗筛，不是全文索引」。
- 检索零命中 → 明确说没命中，「我不会编造出处」，且**不发候选事件**。
- 错误文案统一是「问题 + 处理动作」，不留光秃秃的 `FetchError`。

---

## 8. 测试

```bash
npm run test          # 全部：Node 31 例 + Python 37 例
npm run test:server   # Node：格式契约 / Jev 阈值 / HTTP 层的规矩
npm run test:py       # Python：分区落库 / 指纹重匹配 / 检索评测
```

测试卡的是**规矩**，不是功能：

- 没 `approved` 就写不了 `memory.md`（403 `RejectedWrite`）
- `memory_patch` 第一轮只发 HITL，笔记库必须没被改
- 空库检索必须承认没命中，且不许发候选
- `../` 路径穿越必须被拒（`PathEscape`）
- 重转写后划线要么跟着走、要么标 `stale`，不许假装还在原位
- 重跑同一条视频**不许**产出 `标题_2.md`；归属变了要搬移而不是复制

**跨语言格式契约**：`douyin-fav-transcribe/tests/fixtures/note_with_highlight.md`
由 Python 生成、Node 读取断言。改了 `highlights.py` 或 `highlights.ts` 的落库格式，
要跑 `python tests/make_fixture.py` 重生成夹具，两端测试都得过。

---

## 9. 隐私与安全

这个仓库**可以公开**，但下面这些是「本地私产」，一律不进仓库（已在 `.gitignore` 里）:

| 路径 | 里面是什么 |
|---|---|
| `douyin-fav-transcribe/state/` | 收藏/喜欢快照、进度、**以及一整个 Chrome 用户数据目录**（`state/profile/`，含抖音登录态 Cookies 与保存的密码） |
| `douyin-fav-transcribe/config.json` | DeepSeek API Key |
| `douyin-fav-transcribe/config.env` | 你本机的 Obsidian 路径 |
| `server/.env` | Agent 用的 API Key |
| `server/.state/` | 行为日志（含你的检索词、划线内容） |
| `.workbuddy/` | 工作区内部记录 |

**源码里不含任何凭据**，也不硬编码任何个人绝对路径 —— 所有路径都来自环境变量或相对默认值
（例如 `DOUYIN_OBSIDIAN_DIR` 不设时落到项目内的 `./抖音/`）。

> ⚠️ 使用前请自行确认：**如果你 fork 了这个仓库并改过 `config.json` / `.env`，别把它们提交上去。**
> `.gitignore` 是防呆，不是保险箱。

---

## 10. 常见问题

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 顶部横幅报「转写服务没开」 | Flask `:8899` 没起来 | 看转写服务窗口的报错；多半是没先准备好 `cap-backend` |
| `ImportError: No module named 'script'` | 缺 `cap-backend` | 见 [4.1](#41-前置条件) |
| 检索结果是「本地粗筛」 | Flask 挂了，走了降级路径 | 属预期兜底；想用全文/向量就把 Flask 起起来 |
| 收藏夹树是空的 | 索引没建，或收藏快照是空的 | 点横幅上的「重建索引」；或先跑一次 `start-collect.bat` |
| 笔记写到了意料之外的目录 | `DOUYIN_OBSIDIAN_DIR` 没设，用了项目内默认值 | 指向你的 Obsidian 库根目录（**根**，不是 `收藏/`） |
| 同一条视频出现两份笔记 | 它在抖音里属于多个收藏夹，**每个夹各存一份**是预期行为 | 想只留一份就去抖音里移出多余的夹，再重新转录 |
| 划线显示「stale」 | 笔记被重新转写过，原句找不到了 | 点中间顶部的「重匹配划线」再修一次 |
| `.bat` 报「`'xxx'` 不是内部或外部命令」 | `.bat` 被存成了 LF 行尾，cmd 会从行中段执行 | 本仓库用 `.gitattributes` 锁定 CRLF；拉最新代码 |
| 转写服务启动报 WinError 10013 | 端口落进了 Windows 给 Hyper-V/WSL 的 TCP 保留段 | 程序会自动顺延；**以启动窗口打印的地址为准** |

---

## 11. 明确不做

- ❌ **Obsidian 插件**，或把整个站点拷进笔记库
- ❌ 把聊天记录写成笔记（对话是过程产物，源真相只有 markdown）
- ❌ 用 Agent 去取消收藏 / 改抖音账号（写操作只限笔记库白名单内）
- ❌ **用向量替换全文检索** —— 向量只能是叠加，挂了必须退回 FTS
- ❌ 每一句话都自动搜整库（检索命中默认不钉进上下文）
- ❌ 删掉旧的导师页面源码（只从导航隐藏，见下一节）

---

## 12. 仓库里的旧代码

这个仓库最初是个「AI 代码导师」项目，后来主体被改造成了收藏阅读 Agent。
为了不丢历史，旧代码**没有删**，只是从导航和命令面板里摘掉了：

| 路径 | 状态 |
|---|---|
| `client/src/views/` 下的 Diff / 代码解释 / 个人简介页 | 路由标了 `meta: { retired: true }`，源码保留 |
| `DESIGN.md`（63KB） | 旧导师项目的架构设计 |
| `context.md` | 旧导师项目的上下文说明 |
| `AI-Code-Tutor-代码模式速查.md` | 旧项目的代码模式笔记 |
| `skills/pinia`、`skills/vite`、`skills/vue` | 旧项目的技能文档 |

**它们不是本项目的主路径**，读代码时可以直接跳过。

---

## 深入阅读

| 想了解 | 看这里 |
|---|---|
| 产品规格（三栏、对话怎么挂笔记、prompt / memory 分工） | [`docs/specs/reading-agent-ia.md`](docs/specs/reading-agent-ia.md) |
| 早期设计动机（为什么这样拆） | [`docs/designs/douyin-fav-agent.md`](docs/designs/douyin-fav-agent.md) |
| 施工计划、状态机、SSE 事件表 | [`docs/plans/douyin-fav-agent.md`](docs/plans/douyin-fav-agent.md) |
| 转写 / 检索 / 落库分区的完整说明 | [`douyin-fav-transcribe/README.md`](douyin-fav-transcribe/README.md) |
| 划线格式与两端契约 | [`server/src/highlights.ts`](server/src/highlights.ts) ＋ [`douyin-fav-transcribe/highlights.py`](douyin-fav-transcribe/highlights.py) |

**代码约定**

- 单个组件 / 模块**不超过 500 行**，超了就拆
- `server/src/app.ts` 只装配、`index.ts` 只 `listen` —— 这样 HTTP 层能用临时端口起真实例测
- 行为日志 append-only，写坏了不能影响主流程
- 所有 `fetch` 失败都要能说出人话（问题 + 处理），不要只抛 `FetchError`
