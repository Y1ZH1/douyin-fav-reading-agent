<!-- /autoplan restore point: "C:\\Users\\25078\\.gstack\\projects\\aicodetutor\\unknown-autoplan-restore-20260921-120446.md" -->
# Implementation plan: 抖音收藏阅读 Agent

Source design: `docs/designs/douyin-fav-agent.md`
Mode: local-first resume demo (Vue3 + TS + Node agent loop, Python ingest)
Base branch: n/a (workspace not a git root)

## Implementation plan

### Goal

Replace the unused code-tutor product surface with a **reading agent over already-transcribed Douyin favorites**. Users open a local Vue app (browser or Obsidian Web Viewer / Custom Frames pointing at `http://127.0.0.1`). They highlight transcript text, stream an explanation, follow up like Doubao, classify with Jev, retrieve notes, and persist highlights into vault markdown. Python keeps collection, Whisper, and Chinese retrieve.

### Non-goals

- Do not rewrite `douyin-fav-transcribe` collector / faster-whisper / uncollect.
- Do not put a second copy of the Vite app into the vault as static HTML.
- Do not implement code Diff / code-selection explain (retire those routes from the agent UI).
- Do not ship mobile Obsidian embed.
- Do not treat Obsidian plugin API as required for v1 (writes go through Node → disk).

### Architecture

```
[Vue Agent UI :5173]
   |  SSE + REST (same-origin via Vite proxy)
[Node :3001]  agent loop: tools, HITL, memory, SSE event types
   |  HTTP
[Python :8899]  existing Flask: favs/items/transcribe/folders
   |  POST /internal/retrieve  (new)  chunks + scores
[Vault *.md]  source of truth
```

Reuse:

- `server/src/routes/chat.ts` SSE headers + `streamChatCompletion` (`server/src/services/ai.ts`).
- `client/src/services/ai/stream-parser.ts`, `useMarkdown.ts`, `markdown.worker.ts` (gate Worker behind “long content jank”).
- Flask `app.py` list/transcribe/folders/obsidian-dir. New retrieve endpoint next to existing summarize, not a new process if avoidable.

### Data model

- Transcript note markdown frontmatter: existing `folders`, `liked`, plus `video_id`, `highlights: [{id, quote, prefix, suffix, start, end, notePath?}]`.
- Agent session on Node (memory): `{id, videoId, messages[], pendingHitl?, tools[]}`.
- `memory.md` at vault root or `抖音收藏/memory.md`: YAML-ish bullets of habits + follow-up templates.
- Jev result: `{folderId, folderName, confidence, alt[]}`. Auto-write if `confidence >= threshold` and gap to second >= `minGap`; else HITL: existing / create / skip.

### Node agent loop

State machine: `idle | streaming | tool | hitl | followup`.

Tools (JSON schemas, typed results):

1. `explain_selection` — quote + user prompt template
2. `summarize_selection`
3. `add_to_notes` — HITL if target file ambiguous
4. `classify_item` — Jev structured output
5. `retrieve_vault` — proxy Python retrieve; empty hits must be spoken as empty
6. `read_memory`
7. `propose_memory_patch` — always HITL before write

SSE event types (extend current token stream): `token | tool_call | tool_result | hitl_request | followup_suggestions | error | done`.

CORS: allow both `localhost:5173` and Obsidian webview origin if it is `http://127.0.0.1:5173` (same). If Web Viewer is a unique origin, proxy all API through Vite so the page is same-origin.

### Python worker additions

- After successful transcribe: chunk markdown by heading/paragraph, persist sidecar index (`state/retrieve-index/`): sqlite FTS first; optional embedding later.
- `POST /api/retrieve` `{query, k, videoId?, folderId?}`. v1 search **current video + same folder first**, then optional full vault. Empty hits stay honest (no invented citations).
- Bind to localhost only. No new public internet surface.

Auto-decide retrieve v1: **FTS + title boost first** (explicit, ships). Vector as follow-on when FTS misses user queries. Document upgrade trigger in code comment only after user asked for vectors.

Auto-decide Jev folders: **map 1:1 to `folders.json`** (existing Douyin collections). New folder = HITL create name, then write frontmatter.

Highlight anchors: store **start/end + 32-char prefix/suffix fingerprint**. On re-transcribe, rematch fingerprint; if fail, keep quote only and mark `stale`.

### Vue surfaces

Layout: left transcript (plain text or markdown-it), floating highlight toolbar (explain / summarize / add note / custom prompt), right chat with tool traces, follow-up chips, HITL card.

Settings: edit `memory.md` (textarea + save via Node), per-action prompt templates, Jev threshold.

Empty: no transcripts → tell user to run existing Flask collect/transcribe.
Error: stream fail → problem, cause, retry.
Partial: tools succeeded, model still streaming.

Obsidian: README steps for Web Viewer / Custom Frames. Product still works in Chrome if embed fails.

### Retirement of code tutor UI

Keep server files until agent routes exist; hide Diff/analyze from router and nav. Do not delete in first PR if it risks a huge unreviewable diff; hide first, delete in a follow-up PR.

### Implementation slices (build order)

1. **Probe doc** (manual): Web Viewer → localhost health page. Record pass/fail. Does not block Chrome-first development.
2. **Vault adapter (Node)**: read list of md from `DOUYIN_OBSIDIAN_DIR` or Flask `/api/obsidian-dir` + parse frontmatter. List + get one note.
3. **Reading page**: pick item from Flask `/api/items` + body from vault file.
4. **Highlight toolbar + selection payload**.
5. **Agent SSE** with `token` + tool_call plumbing; first tool `explain_selection` reusing `streamChatCompletion`.
6. **Follow-up chips** from a small second model call or heuristic from last answer.
7. **add_to_notes** write append to md.
8. **classify_item** + HITL UI + write folders.
9. **memory.md** read/write + inject into system prompt + HITL patch.
10. **Python FTS retrieve** + `retrieve_vault` tool.
11. **Tool trace UI**.
12. **Transcribe hook** to rebuild FTS index.
13. **README** dual process start: Flask + `npm run dev`.
14. Tests: tool schema unit tests; HITL threshold table; retrieve empty; frontmatter roundtrip; SSE parser for new event types.

### Tests (must exist)

- Node: classify auto vs HITL given confidence fixtures.
- Node: `propose_memory_patch` never writes without approval flag.
- Node: retrieve empty → assistant cannot invent citations (prompt + tool result shape).
- Vault: highlight fingerprint rematch.
- Client: stream-parser accepts new event types without dropping tokens.
- Manual: Chrome path for slices 3–6; Obsidian embed as checklist in README.

### Security

- Bind Flask retrieve and Node to 127.0.0.1.
- Do not log API keys. Reuse existing env `OPENAI_API_KEY` / DeepSeek config.
- Uncollect remains Python + existing confirm UI only; agent must not call it in v1.

### Success

Matches design Success Criteria: real transcript highlight → stream explain → two follow-ups → note writeback; Jev auto/HITL; memory edit; retrieve citations or honest miss; Chrome always; Obsidian embed documented.


<!-- autoplan-accepted:ceo -->
- Keep Node-owned agent loop + highlight/SSE/follow-up as v1 demo spine (user office-hours choice). Do not switch to Flask-only without Final Gate.
- Retrieve v1: query current video + same folder first; empty still honest; full-vault FTS second.
- Named stream/tool/HITL errors with user-visible problem+cause+retry.
- Bind Node and Flask to 127.0.0.1.
- Hide code-tutor Diff/analyze in nav; delete in a later slice.
- Chrome-first; Obsidian Web Viewer is documented extra, not a ship blocker.
- Tests listed in Implementation plan remain mandatory.
<!-- /autoplan-accepted:ceo -->
## Review record

CEO methodology read: `autoplan-ceo-methodology-VTb3Ub/methodology.md` ranges 1–600, 601–1200, 1201–1800, 1801–2225 (EOF).
Mode (autoplan override): **SELECTIVE EXPANSION**.
UI scope: **yes**. DX scope: **yes** (21 term matches; agent-primary).
Outside Codex: **unavailable** (no git root; `not_installed`/cannot `-C` repo). Native CEO: [Review](e0c794e2-7b94-43ef-a264-6995674f4eb6) INPUT hash `bad27edc…51a41` matched.

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"bad27edc112822afd5258ba89ddef2cf4ba89bd1b508298b88873c4fcde51a41","replacements":[{"oldText":"- `POST /api/retrieve` `{query, k}` → `{hits:[{path,title,span,score}]}`.","newText":"- `POST /api/retrieve` `{query, k, videoId?, folderId?}`. v1 search **current video + same folder first**, then optional full vault. Empty hits stay honest (no invented citations)."}]} -->

<!-- autoplan-accepted:ceo -->
- Keep Node-owned agent loop + highlight/SSE/follow-up as v1 demo spine (user office-hours choice). Do not switch to Flask-only without Final Gate.
- Retrieve v1: query current video + same folder first; empty still honest; full-vault FTS second.
- Named stream/tool/HITL errors with user-visible problem+cause+retry.
- Bind Node and Flask to 127.0.0.1.
- Hide code-tutor Diff/analyze in nav; delete in a later slice.
- Chrome-first; Obsidian Web Viewer is documented extra, not a ship blocker.
- Tests listed in Implementation plan remain mandatory.
<!-- /autoplan-accepted:ceo -->

### CEO 0A Premises
1. Right problem: yes vs code-tutor. Native voice says highlight-chat is a proxy vs vault writeback — **User Challenge queued** (do not auto-flip). Evidence that would flip: user says they will not demo streaming explain in interviews.
2. Outcome: resume + local use. Plan is a direct path if tools are visible on screen.
3. Do nothing: resume stays weak; vault stays unread. Real pain for this user.

### CEO 0B Existing code
| Subproblem | Existing |
|---|---|
| SSE token stream | `server/src/routes/chat.ts`, `streamChatCompletion` |
| Stream parse + md worker | `client/src/services/ai/stream-parser.ts`, `useMarkdown.ts` |
| Fav list / transcribe / folders | `douyin-fav-transcribe/app.py` |
| Summarize | `app.py` `/api/summarize`, `ai.py` |
| Vault path | `/api/obsidian-dir` |

Not rebuilding Whisper. Rebuilding conversation UI is justified (tutor is code-shaped).

### CEO 0C Dream
```
CURRENT: Flask cards + md dump; Vue tutor unused
THIS PLAN: Node tools + reading UI on same vault
12-MONTH: more platforms, vector retrieve, batch Jev
```

### CEO 0C-bis alternatives (auto-picked B per user)
- A minimal: Flask + one POST explain. Completeness 5/10. Rejected: resume Node agent story dies.
- B planned runtime. Completeness 9/10. **Selected.**
- C Obsidian plugin. Completeness 6/10. Rejected: frontend portfolio weaker.

### CEO 0D SELECTIVE — cherry-picks auto
| Item | Decision | Why |
|---|---|---|
| Flask-only reader | USER CHALLENGE / keep B | Both-voice missing; user chose Node loop |
| Scoped retrieve | **ACCEPT** | P1 completeness, <1d |
| Six-week kill metric | **DEFER** TODOS | Taste; resume demo ≠ weekly N writes |
| Tool trace | keep (already in plan) | Interview artifact |
| Vector index v1 | **DEFER** | Plan already FTS-first |

Delight (defer): timestamp jump-to-video, batch Jev queue, mobile. NOT in scope.

### CEO 0E Temporal
HOUR 1: vault path env, 127.0.0.1 bind, Vite proxy `/api` and `/py`.
HOUR 2–3: tool JSON schema + HITL pause of SSE.
HOUR 4–5: Flask down while Node up; concurrent highlight writes.
HOUR 6+: fingerprint after re-transcribe; empty retrieve copy.

### Section 1 Architecture
```
Vue --proxy--> Node(agent) --http--> Flask --fs--> vault md
                         \--llm--> DeepSeek
```
Nil: missing videoId → 400 named. Empty transcript → empty state, no tools. Error: Flask down → banner "转写服务未启动 :8899". 10x: FTS sqlite file size; 100x liked list already paginated in Flask. SPOF: DeepSeek key. Rollback: git revert UI; md writes are append (keep backups of note before write).

Examined coupling Node↔Flask: justified (ASR vs loop). No silent "scrap architecture".

### Section 2 Error & Rescue
METHOD | WRONG | CLASS | RESCUED | USER
streamChat | timeout | UpstreamTimeout | retry 1 + error event | 模型超时，可重试
streamChat | 401 | AuthError | no retry | 检查 API Key
tool JSON | malformed | ToolParseError | HITL skip tool | 工具返回无法解析
retrieve | flask down | WorkerUnreachable | no fake hits | 检索服务未启动
add_to_notes | file missing | VaultIoError | no write | 笔记文件不存在
classify | low conf | HitlRequired | HITL card | 选择分类
memory patch | no approval | RejectedWrite | no write | (silent skip is BAD) → show 未授权写入已阻止

### Section 3 Security
Local-only bind. Prompt injection via transcript: tools cannot uncollect; classify/write only vault paths under obsidian-dir (path prefix allowlist). **ACCEPT** path allowlist. Likelihood Med if bind 0.0.0.0 — plan already localhost.

### Section 4 Edges
Highlight double-click: debounce toolbar. Navigate mid-stream: abort EventSource. Zero favs: empty CTA to Flask. 10k liked: use Flask pagination not load all md. Re-transcribe concurrent with highlight: fingerprint stale flag.

### Section 5 Quality
Reuse stream-parser; new event types must be additive (unknown events ignored, tokens kept). Do not fork a second SSE client.

### Section 6 Tests
New UX: highlight, HITL, follow-up, settings memory.
New data: frontmatter highlights, FTS index, session state.
Gaps filled in accepted tests + path allowlist unit test.
2am test: write note with Flask down still fails visibly.
Hostile: `../` path in add_to_notes rejected.

### Section 7 Perf
Do not load liked.json into Vue. Index rebuild on transcribe complete only. Markdown worker only if jank.

### Section 8 Observ
Log sessionId, toolName, latency ms, first-token ms (reuse tutor idea only if cheap). No Datadog. User-visible stream error is the alert.

### Section 9 Deploy
Local two-process README. No migration. Rollback: stop Node. Dual-run old tutor routes hidden.

### Section 10 Trajectory
Reversibility 4/5 (md append). Debt: dual backend. 1-year: Python retrieve can stay.

### Section 11 Design
1st: transcript. 2nd: toolbar on select. 3rd: chat+HITL.
States: loading/empty/error/success/partial named in plan. Recommend later `/plan-design-review`. Desktop only intentional.

### NOT in scope
Mobile embed; vault static HTML app; uncollect in agent; vector DB v1; code Diff; other video sites; Obsidian plugin API; weekly usage kill-switch (deferred).

### What already exists
See 0B.

### Dream state delta
This plan reaches local Douyin control-plane + visible agent loop. Not multi-platform, not mobile.

### Failure modes
CODEPATH | MODE | RESCUED | TEST | USER | LOG
stream | timeout | Y | Y | retry | Y
retrieve empty | empty | Y | Y | 未找到 | Y
memory write sans HITL | Y block | Y | Y | 已阻止 | Y
path escape | Y reject | Y | Y | 非法路径 | Y

No CRITICAL silent rows after accepted path allowlist.

### CEO DUAL VOICES
Consensus N/A (outside unavailable). Native: 2 critical (proxy chat vs vault; idle product). Primary does not replace outside. User Challenge at Final Gate.

### Implementation Tasks (CEO)
- [ ] **T1 (P1)** — retrieve scoped to current video/folder first — Section 1/native — `app.py` retrieve — Verify: query hits only same folder fixtures
- [ ] **T2 (P1)** — vault path prefix allowlist — Section 3 — Node vault adapter — Verify: `../` rejected
- [ ] **T3 (P2)** — named WorkerUnreachable banner — Section 2 — Vue — Verify: Flask stop shows copy

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | ceo | Keep Node agent loop | User Challenge hold | user sovereignty | Office-hours B | Flask-only rewrite |
| 2 | ceo | SELECTIVE EXPANSION | Mechanical | autoplan override | Feature on existing system | EXPANSION/HOLD |
| 3 | ceo | Scoped retrieve | Mechanical | P1 completeness | Chinese FTS empty | Full-vault-only success |
| 4 | ceo | Path allowlist | Mechanical | P3 security | Local writes | Trust model paths |
| 5 | ceo | Defer kill-metric | Taste | resume goal | Demo not SaaS | Six-week freeze |

