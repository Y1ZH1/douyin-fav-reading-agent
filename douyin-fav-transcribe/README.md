# douyin-fav-transcribe

本地批量转写抖音收藏夹/喜欢列表视频为文字，写入 Obsidian 笔记，并可选接入 DeepSeek 做 AI 总结与翻译。

- **采集**：登录后脚本自动拉取**收藏列表**与**「喜欢」(点赞) 列表**（含无水印播放直链 + 封面），并**同步你自建的收藏夹分组**
  - 「喜欢」是**独立的一个数据源**（单独存 `state/liked.json`），不是收藏夹 —— 因为它可能有几万条，混在一起会拖垮加载
  - 「喜欢」采集**支持断点续采**：每翻一页都把游标落盘，中断/关窗后下次从断点继续，已采到的不重复
- **转写**：本地 `faster-whisper`（默认 **`large-v3`**，GPU 加速），从直链抽音频 → 转写 → 生成 Obsidian md
  - 用**视频标题 + 作者名做 `hotwords` 术语加权**，并用固定提示词引导简体中文与标点
  - 实测准确率：`large-v3` 显著优于 `small`（术语/动词错误大幅减少、消除幻觉）；`small` 保留为快速档
- **分类**：笔记 frontmatter 写入 `folders`（所属收藏夹）与 `liked`，每个收藏夹自动成为一个 tag；同时**物理归档**到 `收藏/{收藏夹名}/` 或 `喜欢/`
- **语言**：自动检测语种；**非中文视频自动翻译成简体中文**追加到笔记（可选「逐句对照」或「整段翻译」，见 §8.1）
- **重新转录**：转录出错或想换模型/模式时，卡片上可一键**覆盖重跑**（见 §8.2）
- **AI 总结**：接 DeepSeek，可单篇总结，也可把选中内容汇总成一篇主题综述新笔记
- **落库（自动分区）**：收藏的视频 → `抖音/收藏/`，有自建收藏夹的再进 `抖音/收藏/{收藏夹名}/`（命中多个夹则每个夹各存一份），无收藏夹的留在 `抖音/收藏/` 顶层；仅「喜欢」的视频 → `抖音/喜欢/`；AI 总结新笔记 → `抖音/AI总结/`
- **GUI**：本仓库自带本地网页界面（`app.py`），**「收藏夹 / 喜欢」两个 Tab**，封面缩略图卡片 + 状态徽章 + 收藏夹筛选 + 批量转写
  - 「喜欢」Tab 是**懒加载**：打开界面只请求收藏数据，只有主动点进「喜欢」才去读/采集喜欢数据
  - 列表**服务端分页 + 滚动加载**，几万条也不会卡（接口响应 ~5ms）
- **清理**：可在界面上**单条 / 批量取消收藏、取消喜欢**（真的在抖音上生效）
  - 带不可逆二次确认（必须勾选才能点确认）+ 逐条复核（用详情接口核对抖音实际状态）
  - 支持 `--dry-run` 预演（网络层拦截，账号零改动）；每次操作留审计日志 `state/removed.json`
- **配套：阅读 Agent**（本仓库根目录的 Node + Vue 部分）：对转写好的笔记做划线解释、追问、入笔记、Jev 分类、检索与 memory 编译。它**靠 HTTP 复用本目录的 Flask**，不重复实现转写与检索。
  - 两边一起跑：先在本目录双击 `start-gui.bat`（转写与检索），再到仓库根目录跑 `start-reading.bat`（阅读界面）
  - 分工、接口与数据边界见仓库根目录的 `README.md`

---

## 0. 部署前必读（依赖与路径配置）

本项目不是"开箱即跑"的单仓库：它**依赖另一个独立项目 `cap-backend` 提供的转写代码**，并且几处关键路径需要你自己指定。请先读完本节再运行，否则会直接 `ImportError` 或把笔记写进错误目录。

### 0.1 ⚠️ 硬依赖：另一个项目 `cap-backend`

`core.py` 在加载时直接 `from script.transcriber import transcribe_audio` / `from script.utils import sanitize_filename`，
这两个模块**来自另一个独立项目 `cap-backend`**（**不在本仓库内**）。克隆本仓库后，你必须用下面三种方式之一提供它
（缺了会 `ImportError: No module named 'script'`）：

1. **克隆 cap-backend 到同级目录**：让 `../cap-backend/script/transcriber.py` 存在，`core.py` 会自动发现；
2. **设置环境变量** `CAP_BACKEND_DIR` 指向你机器上 `cap-backend` 的根目录；
3. **自备 transcriber**：自己写/取一个 `transcriber.py` + `utils.py`，只需暴露 `transcribe_audio(...)`
   和 `sanitize_filename(...)` 两个接口，并放进 `PYTHONPATH`。

> 如果你只想要转写能力，方案 3 最轻量；`transcribe_audio` 的签名请参考 cap-backend 的实现。

### 0.2 路径配置（环境变量）

以下路径**没有硬编码写死**，全部通过环境变量覆盖（不设置时回退到代码默认值，建议直接用变量显式指定，避免落到你不想要的目录）：

| 环境变量 | 作用 | 不设置时的默认值 |
|---|---|---|
| `DOUYIN_OBSIDIAN_DIR` | 笔记落库**根**目录：其下自动分出 `收藏/` 与 `喜欢/` 两个桶（收藏的再按收藏夹名分子目录），一般指向你 Obsidian 库里的 `大道/抖音` 这种位置 | 项目内的 `./抖音/` |
| `DOUYIN_MODELS_DIR` | Whisper 模型所在目录 | `<CAP_BACKEND_DIR>/models`（即 cap-backend 项目下的 `models`） |
| `CAP_BACKEND_DIR` | cap-backend 项目根目录（见 0.1） | 自动探测同级 `../cap-backend` |
| `DOUYIN_TRANSLATE_MODE` | 外文视频的翻译模式：`aligned` 逐句对照 / `whole` 整段翻译 | `aligned` |
| `DOUYIN_PORT` | GUI 监听端口 | `8899`；若该端口不可用（被占用或被系统保留），会自动顺延到附近空闲端口 |

- **推荐用本地配置文件设置这些变量**：仓库根目录提供了 `config.example.env` 模板，复制为 `config.env`（已被 `.gitignore` 忽略，不会上传）后，取消对应行注释并填值即可。三个 `start-*.bat` 启动时会自动读取 `config.env`。macOS/Linux 用户也可直接在 shell 里 `export`，或写入系统环境变量。
- 启动脚本（`start-*.bat`）已改为**自动探测 Python**：优先复用同级 `cap-backend/.venv`，
  其次本地 `.venv`，最后系统 `python`；不再写死任何绝对路径。
- 命令行转写可用 `--obsidian <目录>` 覆盖落库目录（见第 5 节）。

### 0.3 项目目录结构与路径说明

克隆本仓库后，建议按下面理解各目录/文件的"位置与用途"。**方括号 `[ ]` 表示运行时生成、不进仓库**。

```
douyin-fav-transcribe/            ← 本仓库根目录
├─ collector.py                   # 采集：收藏 / 喜欢 / 收藏夹分组
├─ core.py                       # 转写核心：抽音频、调 Whisper、生成 md
├─ transcribe_favs.py            # 命令行转写入口
├─ uncollect.py                  # 取消收藏 / 取消喜欢（真实生效）
├─ ai.py                         # DeepSeek 翻译 / 总结
├─ app.py                        # 本地网页 GUI（Flask）
├─ templates/index.html          # GUI 前端页面
├─ requirements.txt              # Python 依赖
├─ start-gui.bat / start-collect.bat / start-transcribe.bat   # Windows 启动脚本
├─ [state/]                      # 运行时数据（gitignore）
│   ├─ collected.json            #   收藏数据（含收藏夹归属）
│   ├─ liked.json                #   喜欢数据（量级可达数万）
│   ├─ liked_cursor.json         #   喜欢翻页断点
│   ├─ folders.json              #   收藏夹分组
│   ├─ progress.json             #   转写进度（已成功的不重复）
│   ├─ removed.json              #   取消操作审计日志（最多 5000 条）
│   └─ profile/                  #   登录态（首次扫码，之后可 headless）
├─ [work/]                       # 临时音频 / 转写中间产物（gitignore，用完即清）
├─ [downloads/]                  # 下载缓存（gitignore）
└─ [config.json]                 # AI Key 配置（gitignore，也可改用环境变量）

../cap-backend/                  ← 另一个独立项目（需自行提供，见 0.1）
└─ script/
    ├─ transcriber.py            #   transcribe_audio(...) 转写实现
    └─ utils.py                  #   sanitize_filename(...) 等工具

<你的 Obsidian 仓库>/
└─ 抖音/                          ← DOUYIN_OBSIDIAN_DIR 指向这里（落库根）
    ├─ 收藏/                      #   收藏的视频
    │   ├─ {视频标题}.md          #     没有自建收藏夹归属的，留在这一层
    │   ├─ 摄影/                  #     有收藏夹归属的，按【收藏夹名】建子目录
    │   │   └─ {视频标题}.md
    │   └─ 足球/
    │       └─ {视频标题}.md
    ├─ 喜欢/                      #   仅「喜欢」(点赞)、未收藏的视频（平铺，无子目录）
    │   └─ {视频标题}.md
    └─ AI总结/                    #   AI 总结/综述新笔记
```

> **归属规则**：一条视频命中多个收藏夹时，会在**每个夹的子目录各存一份**（内容相同）。
> 在抖音里改了收藏夹归属后**重新转录**，旧副本会自动搬到新目录、不会留下孤儿文件。

> **从旧版（平铺）升级要跑一次迁移**：老版本把所有笔记平铺在 `抖音收藏/` 下，升级后**历史笔记不会自己搬家**。
> 用仓库自带的 `_migrate_notes.py`：`python _migrate_notes.py` 先空跑看「哪篇去哪」（不动任何文件），
> 确认无误再加 `--apply`。它会把旧目录整份备份到 `work/_backup_抖音收藏_<时间戳>/`，
> 并在 `work/_migrate_manifest_<时间戳>.json` 留下每一笔搬移记录，可反向回滚。
> 落库根取自 `core.DEFAULT_OBSIDIAN`（即 `DOUYIN_OBSIDIAN_DIR`），**脚本里不写死任何绝对路径**。
> 判定依据是 `state/collected.json` 与 `state/liked.json`，所以迁移前**先跑一次采集**让收藏夹归属是最新的。

> 模型放在 `<CAP_BACKEND_DIR>/models/` 下，子目录形如 `faster-whisper-large-v3/`
> （内含 `model.bin`、`config.json`、`tokenizer.json`、`vocabulary.json`、`preprocessor_config.json`）。
> 下载见第 10 节。

### 0.4 不随仓库走、需自行准备的「运行时状态」

| 项目 | 说明 |
|---|---|
| 登录态 | `state/` 已被 `.gitignore` 忽略，**不会进仓库**。首次运行会弹 Chrome 扫码登录，登录态存 `state/profile/`，之后可 `--headless`。 |
| DeepSeek Key | `config.json` 已被忽略。用环境变量 `DEEPSEEK_API_KEY` 或 GUI 顶部「AI 设置」填写；不填也能转写，只是没有 AI 总结/翻译。 |
| Whisper 模型 | 需自行下载到 `DOUYIN_MODELS_DIR`（见第 10 节）。默认目录指向 cap-backend 的 `models`，你要么改环境变量，要么把模型放到该目录。 |
| ffmpeg | 需自行安装并加入 `PATH`（代码用 `shutil.which("ffmpeg")` 查找，**不写死路径**）。 |

### 0.5 Python 环境提醒

- 用**普通 Python venv** 即可（见第 1、2 节），不依赖其它项目的虚拟环境。
- 注意：**不要用会 hook `os.remove` / `shutil.rmtree` 的「托管 / 被注入删除守卫的 Python」**（某些工具会拦截删除、
  在批量删除时直接抛 `SystemExit`）。本项目清理临时目录已用 `except BaseException` 兜底，
  正常 venv 不受影响，但请避开这类被注入删除守卫的解释器。

---

## 1. 准备

- **Python 3.10+**，自行建 venv（见第 2 节）
- 系统已装 **Chrome 或 Edge**（Playwright 用 `channel='chrome'` 复用，不另下 Chromium）；若没有执行 `playwright install chrome`
- **ffmpeg** 在 `PATH` 中（用于从直链抽音频）
- 至少一个 Whisper 模型放在 `DOUYIN_MODELS_DIR` 指向的目录，子目录形如 `faster-whisper-large-v3/`（下载见第 10 节）
- 提供 `cap-backend` 的 `script` 包（三种方式见第 0.1 节）

## 2. 安装依赖（一次性）

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows；macOS/Linux 用 source .venv/bin/activate
pip install -r requirements.txt
playwright install chrome       # 仅当本机没有 Chrome/Edge 时才需要
```

## 3. 采集收藏 + 喜欢 + 收藏夹分组

```bash
# 首次使用（有头）：会弹 Chrome 窗口，扫码登录、保持窗口开着
start-collect.bat          # Windows 双击
# 或：
python collector.py

# 已登录后（headless，复用登录态）：
python collector.py --headless

# 只同步收藏夹分组，不抓收藏与喜欢：
python collector.py --headless --folders-only

# 只抓收藏列表，不碰喜欢与收藏夹：
python collector.py --headless --no-folders --no-liked

# 只抓「喜欢」列表，不动收藏与分组（默认从断点续采，可反复执行）
python collector.py --headless --liked-only

# 「喜欢」从头重采（已采到的不丢，会去重合并）
python collector.py --headless --liked-only --liked-reset

# 强制清空重采收藏：
python collector.py --headless --reset
```

- 收藏数据 → `state/collected.json`（含自建收藏夹归属）
- 喜欢数据 → `state/liked.json`（独立存放，量级可达数万）
- 喜欢翻页断点 → `state/liked_cursor.json`（`max_cursor` / `done` / `count`）
- 收藏夹分组 → `state/folders.json`（含 `id` / `name` / `count` / `video_ids`）
- 取消操作审计 → `state/removed.json`（追加式，最多保留 5000 条，见第 6 节）

> 注意 1：收藏夹接口（`collects/list`、`collects/video/list`）**必须用 GET**；`collects_id` 是 19 位大整数，超过 JS `Number.MAX_SAFE_INTEGER`，所以采集时一律让浏览器返回**原始文本**，在 Python 侧 `json.loads`，避免精度丢失导致收藏夹查不到内容。
>
> 注意 2：「喜欢」列表走另一个接口 `GET /aweme/v1/web/aweme/favorite/`，需要先 `GET /aweme/v1/web/user/profile/self/` 拿到 `sec_user_id`，再用返回的 `max_cursor` 翻页（`has_more` 为 0 结束）。
>
> 注意 3：「喜欢」**不设人为条数上限**（`MAX_LIKED_PAGES=5000` 只是防死循环的硬顶），按 `has_more` 自然结束。每页间隔 0.8s，几万条约需十几到几十分钟，**中途可随时停止，断点会自动保存**。
>
> 注意 4：数据层做了 **mtime 缓存**（`core._read_json_cached`）：文件没变就复用已解析对象，避免每个请求都去解析几十 MB 的 JSON。
>
> 注意 5：老版本把「喜欢」当作虚拟分组塞在 `collected.json` 里；`core.migrate_liked_split()` 会做一次性迁移（纯点赞的移出收藏视图、清掉虚拟分组名），幂等可重复执行。

## 4. 启动 GUI

```bash
start-gui.bat              # Windows 双击
# 或：
python app.py
```

浏览器打开 `http://127.0.0.1:<端口>/`（默认 `8899`，可用 `DOUYIN_PORT` 改）。
**注意：实际端口以启动窗口打印的地址为准** —— 若 `8899` 被占用或被 Windows 保留，程序会自动顺延（如 `8800`）。

界面顶部是**两个 Tab**：

| Tab | 内容 | 说明 |
|---|---|---|
| ⭐ 收藏夹 | `state/collected.json` | 你收藏的 + 自建收藏夹归属；收藏夹筛选只在这个 Tab 生效 |
| ❤️ 喜欢 | `state/liked.json` | 点赞列表，可能几万条 |

**「喜欢」Tab 是懒加载的**：打开界面只请求收藏数据（可在浏览器网络面板确认没有任何 `src=like` 请求）；
只有你主动点进「喜欢」Tab 时，才会去读本地喜欢数据 —— 如果本地还没有，就显示引导 + 「▶ 开始采集喜欢」按钮。
采集过程中进度条实时显示「已采 N 条」，可随时点「⏹ 停止」，断点会保存，下次点同一个按钮就从断点继续。

- 卡片：封面 + 标题 + 作者 + 时长 + **收藏夹标签**（可点击即筛选）+ `❤️ 喜欢` 标记
- 状态徽章：`已提取 ✓`（绿）/ `未提取`（蓝）/ `失败`（红，可重试）；已总结的会多一个**紫色"已总结"徽章**
- 收藏夹筛选下拉：按你自建的收藏夹过滤内容（含"未分类"）
- 列表**分页加载**（每页 60 条，滚到底自动加载 / 也可点「加载更多」）；筛选与搜索都在**服务端**完成
- 操作：
  - 勾选后 `▶ 转写选中`：批量转写（勾选跨 Tab 保留，收藏和喜欢可以一起转）
  - `🧠 总结选中`：把勾选的条目做 AI 总结（`mode=each` 逐条总结 / `mode=topic` 汇总成一篇主题综述）
  - `⚙️ AI 设置`：填 DeepSeek API Key / base / 模型，可一键测试连通性
  - `🔄 重新采集收藏` / `❤️ 采集喜欢`：按钮随当前 Tab 变化，只采集对应来源
  - 卡片底部 `✕ 取消收藏` / `✕ 取消喜欢`：**单条**取消；勾选后工具栏 `✕ 取消…选中`：**批量**取消
    （在抖音上真实生效，**不可逆**，见 [第 6 节](#6-取消收藏--取消喜欢不可逆)）

### 相关接口（开发者参考）

| 接口 | 说明 |
|---|---|
| `GET /api/items?src=fav\|like&offset&limit&folder&state&q` | 分页取数据（服务端筛选），返回 `{total, has_more, items}` |
| `GET /api/stats?src=fav\|like` | 按来源统计 |
| `GET /api/liked/meta` | 喜欢本地状态：条数 / 断点 / 是否采完 / 是否正在采 |
| `POST /api/collect-liked` | 单独采集喜欢，body `{reset: bool}`；支持 `POST /api/jobs/<id>/stop` 终止 |
| `POST /api/uncollect` | 取消收藏/喜欢，body `{ids, src: "fav"\|"like", verify: bool}`；job 化，可停止 |
| `GET /api/removed` | 取消操作的审计日志（最近 N 条） |
| `GET /api/folders` | 收藏夹列表（只统计收藏来源） |

- 搜索框按标题/作者实时过滤

## 5. 命令行（无 GUI）

```bash
python transcribe_favs.py                              # 默认 large-v3 全量转
python transcribe_favs.py --model small                # small 更快，质量较低
python transcribe_favs.py --only <aweme_id1,id2,...>   # 指定条目
python transcribe_favs.py --retry-fail                 # 仅重跑 progress.json 里失败的
```

笔记落库目录可用 `--obsidian <目录>` 指定（会覆盖 `DOUYIN_OBSIDIAN_DIR`）。

## 5.1 转写准确率调优（实测结论）

默认已开启以下调优，都在 `core.py` 顶部集中可调：

| 项 | 值 | 作用 |
|---|---|---|
| `DEFAULT_MODEL` | `large-v3` | 1.55B 参数，术语/动词错误与幻觉显著少于 `small`(0.24B)；耗时约 2.3 倍 |
| `BEAM_SIZE` | `8` | 束搜索加宽，用速度换准确率 |
| `PROMPT_TEMPLATE` | 简体中文 + 领域词 | Whisper 会**模仿提示词的风格** → 写了标点，输出就自动断句 |
| `build_hotwords()` | 标题 + 作者 | 术语加权，**专有名词靠它纠正** |

实测对照（同一段音频、同一套参数）：

| 原输出（`small`） | 修正后（`large-v3` + hotwords） |
|---|---|
| 总肩脱背 | **耸肩驼背** |
| 都要就位 / 给移动一下 | 都要**纠正** / 给它**纠正一下** |
| 去吸来 放手交叉 | **屈膝**来 双手交叉**抱住膝盖** |
| 靠住太美了啊（幻觉） | 靠住**看见没有** |
| 头靠着想 | 头靠着**墙** |
| 《合围》系列 / 赫维系列 | **何为系列** |

- `device="auto"` 在有 NVIDIA GPU 时自动解析为 **CUDA + float16**（实测 GPU float16 约 8.4s，CPU int8 约 43.0s）
- 标题含中文 → 显式 `language="zh"`（更稳、且省一次语言检测）；标题非中文 → 交给自动检测，后续走 AI 翻译
- **仍有零星错字时**，用 AI 后处理兜底（见第 6 节）；`zhconv` 繁转简会保留，因为 `large-v3` 偶有繁体残留

## 6. 取消收藏 / 取消喜欢（不可逆）

在抖音上**真的**取消收藏 / 取消喜欢，并同步移除本地列表里的对应条目。两个入口：

| 入口 | 位置 | 用途 |
|---|---|---|
| 单条 | 每张卡片底部的 `✕ 取消收藏` / `✕ 取消喜欢` | 零星清理 |
| 批量 | 勾选若干条 → 工具栏 `✕ 取消…选中` | 成批清理（勾选跨 Tab 保留） |

点下去会弹**强确认框**：显示条数与标题预览，必须勾选「我确认要在抖音上取消」才能点确认；
另有一个「逐条复核」开关（**默认开**）——每条取消后多打一次只读请求，以抖音实际状态为准，
而不是只信接口返回的 `status_code`。

> ⚠️ **不可逆**：取消后必须重新手动收藏 / 点赞才能恢复。
> 已转写 / 已总结的 Obsidian 笔记**不受影响**，会完整保留。
> 一条视频既收藏又点赞时，「取消收藏」只把它从「收藏夹」Tab 移走，它仍在「喜欢」Tab 里。

**接口来源**（从抖音前端 JS 里反查出的真实调用，三处互相印证，不是猜的）：

| 动作 | 接口 | body |
|---|---|---|
| 取消收藏 / 收藏 | `POST /aweme/v1/web/aweme/collect/` | `aweme_id=<id>&action=0\|1&aweme_type=0` |
| 取消点赞 / 点赞 | `POST /aweme/v1/web/commit/item/digg/` | `aweme_id=<id>&item_type=0&type=0\|1` |
| 复核（只读） | `GET /aweme/v1/web/aweme/detail/?aweme_id=` | `collect_stat`(1=已收藏) / `user_digged`(1=已点赞) |

**签名不用自己算**：抖音的安全 SDK（secsdk）会自动拦截页面里的 `fetch`，补上 `a_bogus` /
`x-secsdk-web-signature` / `msToken`。所以在已登录的 Playwright 页面上下文里直接 `fetch` 即可，
和采集收藏是同一套机制。

### 命令行

```bash
python uncollect.py --src fav  --ids 7216227503763967288,7328207585717407013
python uncollect.py --src like --ids-file ids.txt       # 每行一个，或逗号分隔
python uncollect.py --src fav  --ids <id> --no-verify   # 不逐条复核（稍快）
python uncollect.py --src fav  --ids <id> --headed      # 弹验证码时用有头模式
python uncollect.py --src fav  --ids <id> --dry-run     # 只打印会发的请求，绝不真发
```

`--dry-run` 在网络层把写请求拦下来（`page.route` → `fulfill` 假成功），服务器收不到 → **账号零改动**，
用来确认参数 / 签名是否正确，也可以当「预演」用。

**审计日志**：每次取消都会追加到 `state/removed.json`，含 `aweme_id` / 来源 / 是否复核成功 / 时间，
用 `GET /api/removed` 可查，便于事后追溯「这条是什么时候被我取消的」。

## 7. AI 配置（DeepSeek）

两种方式二选一：

1. **环境变量**（优先）：`DEEPSEEK_API_KEY=sk-xxx`
2. **本地配置**：GUI 顶部 `⚙️ AI 设置` 填入，写入 `config.json`（已在 `.gitignore`，不会上传）

可选覆盖 `DEEPSEEK_BASE`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）。

未配置 key 时，转写功能完全正常，只是不会做 AI 总结/翻译（翻译分支自动跳过，不报错）。

## 8. 笔记格式

每条转写生成一个 md，frontmatter 会带上收藏夹与语言：

```
---
type: 抖音收藏转写
source: 抖音收藏
aweme_id: "7469450685822651687"
url: https://www.douyin.com/video/7469450685822651687
author: "万物深蓝"
published: 2025-02-10
lang: zh                 # 检测/指定的语种
transcribed_at: 2026-09-12 11:02:29
source_kind: play_addr
folders:
  - 向外成长              # 所属收藏夹
tags:
  - 抖音
  - 收藏
  - 转写
  - 向外成长              # 收藏夹自动成为 tag，便于 Obsidian 筛选
---

# 标题

> 作者：xxx ｜ 发布日期 ｜ 链接　｜　收藏夹：向外成长

---
转写正文…

# 仅当原视频是【外文】时，会按所选翻译模式追加下面其中一种：

## 📖 中英对照                 # 模式=aligned（默认，逐句）
英文原句 1
中文译文 1
英文原句 2
中文译文 2

## 🌐 中文翻译（AI）           # 模式=whole（整段）
（整段中文译文）
```

> 翻译模式（`aligned` 逐句对照 / `whole` 整段翻译）见 §8.1；中文视频不会翻译。

转写笔记按来源/收藏夹自动分区：`抖音/收藏/`（含 `收藏/{收藏夹名}/`）与 `抖音/喜欢/`，见 §0.3 的目录树。

AI 总结新笔记落在 `抖音/AI总结/`，文件名形如 `{标题}·总结.md` 或 `{主题}·综述.md`。

总结笔记会**从源笔记继承 `folders` / `lang`**，并把收藏夹写入 tags —— 所以转写笔记和总结笔记都能用同一个收藏夹 tag 筛出来。

> 配置 DeepSeek key：GUI 顶部「AI 配置」，或建 `config.json`（`{"api_key": "sk-..."}`），或设环境变量 `DEEPSEEK_API_KEY`。`config.json` 已在 `.gitignore` 中。

### 8.1 翻译模式（逐句 / 整段）

**只对「检测为外文」的视频生效**，中文视频不翻译。三处可控制，优先级从高到低：

1. **GUI 工具栏「翻译」下拉框** —— `逐句对照` / `整段翻译`（本机浏览器记住上次选择）
2. **环境变量** `DOUYIN_TRANSLATE_MODE=aligned|whole`
3. 代码默认 `aligned`

| 模式 | 笔记里的块 | 说明 |
|---|---|---|
| `aligned` 逐句对照（默认） | `## 📖 中英对照` | 先把 Whisper 按停顿切碎的片段**合并成完整句子**，再逐句翻译、按句对齐（原文一句紧跟中文一句）。**句子数对不上时自动降级**为整段翻译——宁可整段，也不错位。 |
| `whole` 整段翻译 | `## 🌐 中文翻译（AI）` | 整篇一次翻成中文。译文更连贯，但无法逐句对照。 |

> 为什么"逐句"要先合并句子：Whisper 的行是按停顿切的，常在句子中间断开；直接按行翻译会因行数对不上而错位。先合并成完整句子，对齐单位从"碎片"变成"句子"，既更可靠、译文也更准。

### 8.2 重新转录（转录出错时）

卡片上**已提取**的条目会显示 **↻ 重新转录** 按钮：用当前选中的模型 + 翻译模式**重跑并覆盖**旧笔记（按 `aweme_id` 定位同一文件，**不会产生 `_2` 副本**）。适用场景：转录出错、想换翻译模式、换了更大模型重跑。

命令行等价写法：

```bash
python transcribe_favs.py --only <aweme_id> --force                    # 重跑单条
python transcribe_favs.py --only <aweme_id> --force --translate-mode whole   # 并改成整段翻译
```

## 9. 工作原理（开发者参考）

- **采集器** (`collector.py`)
  - 收藏列表：`POST /aweme/v1/web/aweme/listcollection/`，按 `cursor` 自动翻页
  - 收藏夹：`GET /aweme/v1/web/collects/list/` → `GET /aweme/v1/web/collects/video/list/`
  - 在已登录 Chrome 上下文里 `fetch(credentials:'include')`，登录态下无需签名参数
  - 关键：`page.evaluate` 只取 `resp.text()` 原始文本，`json.loads` 放在 Python 侧（保 19 位大整数精度）
- **取消器** (`uncollect.py`)
  - 写接口：`POST /aweme/v1/web/aweme/collect/`（`action=0` 取消收藏）、`POST /aweme/v1/web/commit/item/digg/`（`type=0` 取消点赞）
  - 复核接口：`GET /aweme/v1/web/aweme/detail/` → `collect_stat` / `user_digged`
  - `set_collect()` / `set_digg()` 的 `on` 参数同时支持正反向；`cancel_collect()` / `cancel_like()` 是 `on=False` 的包装
  - 批量在**子线程**里跑 Playwright（复用 `app.py` 的 job 机制），逐条回调进度，支持 `⏹ 停止`（在条目边界安全退出）
  - 只有接口确认成功的条目才 `core.drop_items()` 从本地列表移除；失败的原样保留
- **转写器** (`core.py` / `transcribe_favs.py`)：`ffmpeg` 从 `play_addr` 拉流抽 16k 单声道 wav → `faster-whisper` **自动检测语种**（标题像中文时先把提示词设为中文风格；若检测出的语种与提示词冲突，再按检测语种重跑一趟）→ 外文视频再走 AI 翻译（`translate_aligned` 逐句对照 / `translate_to_zh` 整段，见 §8.1）。提示词与 `hotwords` 由 `build_prompt()` / `build_hotwords()` 按条目生成（见 5.1 节）
- **AI 总结怎么读取笔记、怎么总结** (`core.py` 的 `summarize_one` / `summarize_notes` + `ai.py`)：
  1. **找笔记**：`find_note()` **递归**遍历落库根下的 `*.md`（跳过 `AI总结/`，否则总结笔记会被误当成转写笔记），匹配 frontmatter 里的 `aweme_id: "<id>"` —— 命中即该条的转写笔记（所以笔记即使被改名、被分到子目录也能找到）
  2. **取正文**：`read_text()` 读全文 → `strip_frontmatter()` 去掉开头的 YAML 头 → 剩下的正文交给 DeepSeek 的 `summarize()`
  3. **落库**：总结写到 `抖音/AI总结/{标题} - 总结.md`，并在 `state/summaries.json` 按 `aweme_id` 登记（GUI 的「已总结」标记、`/api/stats` 的统计都来自这里）
  4. **主题综述**：多选「📚 汇总成主题综述」走 `summarize_notes()` → `summarize_many()`，把多篇正文拼接后做主题综述，写到同一 `AI总结/` 目录
  5. **继承元数据**：总结笔记按 `_inherit_meta()` 从源笔记继承 `folders` / `lang`，收藏夹同时写进 tags，便于在 Obsidian 里和转写笔记用同一个 tag 筛出
- **AI 模块** (`ai.py`)：DeepSeek OpenAI 兼容 `/chat/completions`；`httpx.Client(trust_env=False)` 绕开系统代理
- **GUI** (`app.py` + `templates/index.html`)：Flask 单端口；`/api/items`（分页）、`/api/stats`、`/api/folders`、`/api/liked/meta`、`/api/collect-liked`、`/api/uncollect`、`/api/removed`、`/api/transcribe`、`/api/summarize`、`/api/jobs/<id>`、`/api/ai/*`
- **两个数据源**：收藏 `state/collected.json`、喜欢 `state/liked.json`；`core.load_all()` 按 `aweme_id` 合并出联合视图（同一视频两边都有时合并 folders、`liked=True`），转写/总结统一从联合视图取条目
- **性能**：`core._read_json_cached` 按 mtime 缓存已解析的 JSON；`app._snapshots` 按相关文件 mtime 缓存"已附加状态"的快照；筛选在服务端做，前端只拿当前页
- **去重 / 重跑**：`state/progress.json` 持久化 `ok` 列表，`transcribe_many` 与 GUI 转写入口默认跳过已提取的条目；带 `force=True`（GUI「↻ 重新转录」/ CLI `--force`）时跳过该判断，重跑并把新内容按**最新收藏夹归属**写回 —— 归属变了会搬移旧笔记、清掉多余副本，不会留下 `标题_2` 这类重复文件
- **落库分区**：`core.note_dirs_for()` 决定落点（收藏/喜欢 × 收藏夹），`core.write_note()` 负责写入与搬移；`load_all()` 给每条标 `in_collection` 以区分「收藏」与「仅喜欢」

## 10. 已知边界

- `play_addr` 签名有**时效**（分钟级），采集后建议尽快转写。
- 「喜欢」量级可能到几万条：采集耗时较长（十几到几十分钟），**中途停止是安全的**（断点每页落盘）；GUI 只渲染当前页，不会一次性画几万个卡片。
- **取消收藏 / 喜欢有风控**：这两个写接口在抖音的风险名单里，可能弹滑块验证。无头模式（GUI 后台跑）遇到验证会失败，该条**保留在列表里**，结束时的弹窗会列出失败明细。
  失败后可以用 `python uncollect.py --src fav --ids <id> --headed` 走有头模式重试（人可以在弹出的 Chrome 里过验证码）。
- 取消是**逐条串行**的，默认间隔 1.0s（`uncollect.DEFAULT_DELAY`）；几百条约需几分钟。随时可 `⏹ 停止`，**已取消的不回滚**（这是账号侧的真实状态）。
- 取消完成后会在 `state/removed.json` 留审计记录（最多保留 5000 条）。
- 若抖音风控导致某页返回非 0 `status_code`，采集会停在该页并保留断点，稍后重跑即可继续。
- 抖音若只返回 `uri` 片段而无完整直链，记为 fail（`progress.json`）。
- 登录态在 `state/profile/`（持久化），首次需扫码；同一 profile 后续可 `--headless`。
- 5060 是 Chrome 不安全端口，所以 GUI 默认选用 **8899**（可用 `DOUYIN_PORT` 改）。
- 模型必须**本地已存在**才会转写，GUI 会拒绝选本地没有的模型（避免误触发 HuggingFace 下载卡住）。
  就绪判定不只看 `model.bin`，还要求有词表文件（`vocabulary.json` 或 `vocabulary.txt`）。
- **手动下载模型的两个坑**（都踩过）：
  1. `Systran/faster-whisper-large-v3` 的词表叫 **`vocabulary.json`**（不是 `vocabulary.txt`）。漏下它会报
     `RuntimeError: Cannot load the vocabulary from the model directory`。
  2. HuggingFace 的 **Xet 传输协议在 hf-mirror 上会 401**（`cas-server.xethub.hf.co ... Unauthorized`），
     表现为下载卡住或半途失败。**解决：设 `HF_HUB_DISABLE_XET=1`**，回退普通 HTTP 分片下载。
     参考命令：
     ```bash
     HF_HUB_DISABLE_XET=1 HF_ENDPOINT=https://hf-mirror.com python -c "
     from huggingface_hub import snapshot_download
     snapshot_download('Systran/faster-whisper-large-v3',
       local_dir='<你的 DOUYIN_MODELS_DIR>/faster-whisper-large-v3',
       allow_patterns=['model.bin','config.json','tokenizer.json','vocabulary.json','preprocessor_config.json'])"
     ```
- `state/`、`config.json`、`work/`、`downloads/` 均在 `.gitignore`，不会进仓库。

## 11. 与 Obsidian 集成

- 笔记按来源/收藏夹分别落在 `抖音/收藏/{收藏夹名}/` 与 `抖音/喜欢/`（均在 `DOUYIN_OBSIDIAN_DIR` 指向的仓库下），在 Obsidian 里直接按文件夹浏览，或用 tag `收藏夹名` 跨目录筛选。
- 落库根目录可用 `--obsidian` 指定（CLI），或用环境变量 `DOUYIN_OBSIDIAN_DIR` 指定（GUI 也生效）；默认值在 `core.py` 的 `DEFAULT_OBSIDIAN`（也可在 `core.py` 里改）。
- 笔记**搬家不影响 Obsidian 双链**：`AI总结/` 里的总结用 `[[笔记名]]` 引用，Obsidian 按文件名解析，移动后会重新指向新位置。
- 收藏夹改名 / 一条视频换了收藏夹后，**重新转录一次**即可让笔记落到新目录（旧的自动搬走，不留副本）。

## 12. 给使用者的注意事项（上手清单）

第一次把本项目跑起来前，按这个清单逐项确认，能避开 90% 的"跑不起来"：

1. **先读 [第 0 节 部署前必读](#0-部署前必读依赖与路径配置)** —— 本项目依赖另一个项目 `cap-backend` 的 `script` 包，缺了会 `ImportError`。三种提供方式见 0.1。
2. **建自己的 venv 并装依赖**：`python -m venv .venv` → `pip install -r requirements.txt`（见第 1、2 节）。**不要直接复用其它项目的 venv 路径**。
3. **设好三个环境变量**（否则会写到代码默认路径、或找不到模型）：
   - `CAP_BACKEND_DIR` → 指向你的 cap-backend 目录（或把它克隆到同级 `../cap-backend`）
   - `DOUYIN_MODELS_DIR` → 你的 Whisper 模型目录
   - `DOUYIN_OBSIDIAN_DIR` → 你想要的 Obsidian 落库**根**目录（其下会自动建 `收藏/`、`喜欢/`、`AI总结/`）
4. **下载 Whisper 模型**到 `DOUYIN_MODELS_DIR`（默认 `large-v3`，见第 10 节；注意 `vocabulary.json` 与 `HF_HUB_DISABLE_XET=1` 两个坑）。
5. **装好 ffmpeg 并加入 PATH**（代码用 `shutil.which` 查找，不写死路径）。
6. **首次采集需扫码登录**：会弹 Chrome 窗口，登录态存 `state/profile/`（不进仓库）。之后可 `--headless`。
7. **AI 总结/翻译（可选）**：设 `DEEPSEEK_API_KEY` 或在 GUI「AI 设置」里填；不设也能转写，只是没有 AI 能力。

### 高风险操作提醒

- **取消收藏 / 取消喜欢是真实且不可逆的**（[第 6 节](#6-取消收藏--取消喜欢不可逆)）。抖音把这两个写接口列入风控，可能弹滑块验证；无头模式遇到验证会失败并保留该条，可用 `--headed` 走有头模式人工过验证。
- **`play_addr` 直链时效短（分钟级）**，采集后尽快转写；失败的可重跑。
- **「喜欢」可能几万条**，采集耗时较长，但**断点续采、随时停安全**，GUI 只渲染当前页不会卡。
- **务必通过本项目的 GUI / 脚本操作抖音**，不要拿别人的 token/cookie 批量自动化，遵守平台规则，避免封号。

### 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `ImportError: No module named 'script'` | 缺 cap-backend 的 `script` 包 | 见第 0.1 节三种方式 |
| 笔记写到了意料之外的目录 | 落库根目录用了代码默认值 | 设 `DOUYIN_OBSIDIAN_DIR`（指向**根**，不是 `收藏/` 或 `喜欢/`） |
| 笔记没进 `收藏/{收藏夹名}/`，全挤在顶层 | 该条在抖音里没有加入任何自建收藏夹，或 `state/folders.json` 未同步 | 先跑一次采集/刷新收藏夹（`collector.py` 会调用 `sync_folders`），再重新转录 |
| 同一条视频出现两份笔记 | 命中多个收藏夹时**每个夹各存一份**，属预期行为 | 若只想留一份，去抖音里把它移出多余的收藏夹，再重新转录 |
| GUI 报"模型不存在" | 模型目录不对或模型未下载 | 设 `DOUYIN_MODELS_DIR` 并放好模型 |
| `.bat` 双击报"系统找不到指定路径" | 旧版写死绝对路径 | 已改为自动探测 Python；仍不行就 `python app.py` |
| `.bat` 双击报「`'xxx'` 不是内部或外部命令」（xxx 是乱码或半截词，如 `.env`） | `.bat` 被存成了 **LF 行尾**；cmd.exe 按 CRLF 计算行偏移，纯 LF 文件会从**行中段**开始执行 | 本版 `.bat` 一律用 CRLF 存储，并用 `.gitattributes` 锁定；拉取最新代码即可 |
| 启动报「以一种访问权限不允许的方式做了一个访问套接字的尝试」 | 端口落进了 Windows 给 Hyper-V/WSL 的 TCP **保留段**（WinError 10013），不是被占用 | 本版会自动顺延到空闲端口，**以启动窗口打印的地址为准**；也可用 `DOUYIN_PORT` 指定别的端口 |
| 转写卡在 `done=0` / 假死 | 某些被注入删除守卫的"托管 Python"会让 `shutil.rmtree` 抛 `SystemExit` 杀掉后台线程 | 用普通 venv 运行（本项目已用 `except BaseException` 兜底） |
