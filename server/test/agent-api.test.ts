/**
 * 起一个真的 Express 实例（临时端口）跑 HTTP 层。
 *
 * 这些用例卡的是「规矩」，不是「功能」：
 *  - 没 approved 就不能写 memory.md
 *  - 检索命中不自动钉
 *  - 空库不能编出处
 *  - 路径不能穿越出笔记库
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'

// 先摆好环境再 import 应用，避免模块级读到真实配置
const VAULT = mkdtempSync(join(tmpdir(), 'agent-vault-'))
const STATE = mkdtempSync(join(tmpdir(), 'agent-state-'))
process.env.DOUYIN_OBSIDIAN_DIR = VAULT
process.env.AGENT_STATE_DIR = STATE
process.env.DOUYIN_FLASK_URL = 'http://127.0.0.1:59999' // 故意指向没人监听的端口
delete process.env.OPENAI_API_KEY

writeFileSync(
  join(VAULT, 'a.md'),
  '---\naweme_id: "a1"\nfolders:\n  - 认知\n---\n\n# 注意力\n\n长期保持稳定的注意力要靠把目标切小。\n',
  'utf8',
)
// 先放一份 memory.md，好让「没写成功」这个断言有可比对的基准
writeFileSync(join(VAULT, 'memory.md'), '# memory.md\n\n- 初始内容\n', 'utf8')

const { createApp } = await import('../src/app.js')
const { appendBehavior, logPath } = await import('../src/services/behavior-log.js')
const { parseHighlights, splitFrontmatter } = await import('../src/highlights.js')

let server: Server
let base = ''

before(async () => {
  await new Promise<void>((done) => {
    server = createApp().listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      base = `http://127.0.0.1:${port}`
      done()
    })
  })
})

after(() => {
  server?.close()
})

async function sse(path: string, body: unknown): Promise<string> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.text()
}

function events(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6).trim())
    .filter((d) => d !== '[DONE]')
    .map((d) => {
      try {
        return JSON.parse(d)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ event: string; data: any }>
}

/* ----------------------------------------------------------- 健康与自检 */

test('健康检查：Flask 没开也返回 200，并如实说明转写服务不可用', async () => {
  const res = await fetch(`${base}/api/agent/health`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.flask.ok, false)
  assert.ok(data.flask.error)
  assert.equal(data.vector.installed, false)
  assert.equal(data.vault.dir, VAULT)
})

test('/api/health 标明当前产品面是 reading-agent', async () => {
  const data = await (await fetch(`${base}/api/health`)).json()
  assert.equal(data.surface, 'reading-agent')
})

/* ------------------------------------------------------ memory 写入规矩 */

test('PUT /memory 没带 approved → 403，且提示是「未授权写入已阻止」', async () => {
  const res = await fetch(`${base}/api/agent/memory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '# 我要偷偷写进去' }),
  })
  assert.equal(res.status, 403)
  const data = await res.json()
  assert.equal(data.code, 'RejectedWrite')
  assert.match(data.error, /未授权写入已阻止/)
  assert.ok(!readFileSync(join(VAULT, 'memory.md'), 'utf8').includes('偷偷'))
})

test('PUT /memory 带 approved → 真的写进去', async () => {
  const res = await fetch(`${base}/api/agent/memory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: true, text: '# memory.md\n\n- 解释偏好: 短句\n' }),
  })
  assert.equal(res.status, 200)
  assert.match(readFileSync(join(VAULT, 'memory.md'), 'utf8'), /短句/)
})

test('memory_patch 第一轮只发 HITL 请求，绝不落盘', async () => {
  const before = readFileSync(join(VAULT, 'memory.md'), 'utf8')
  const raw = await sse('/api/agent/stream', {
    intent: 'memory_patch',
    messages: [{ role: 'user', content: '记住我喜欢先给要点' }],
  })
  const evs = events(raw)
  const hitl = evs.find((e) => e.event === 'hitl_request')
  assert.ok(hitl, '必须发 hitl_request')
  assert.equal(hitl!.data.kind, 'memory')
  assert.equal(hitl!.data.source, 'user')
  assert.match(hitl!.data.current, /先给要点/)
  assert.equal(readFileSync(join(VAULT, 'memory.md'), 'utf8'), before, 'memory.md 不能被改动')
})

test('memory_patch 第二轮带 approve 才写', async () => {
  const raw = await sse('/api/agent/stream', {
    intent: 'memory_patch',
    hitl: { action: 'approve', memoryText: '# memory.md\n\n- 用户要求先给要点\n' },
  })
  const evs = events(raw)
  assert.ok(evs.some((e) => e.event === 'tool_call' && e.data.name === 'propose_memory_patch'))
  assert.match(readFileSync(join(VAULT, 'memory.md'), 'utf8'), /先给要点/)
})

/* --------------------------------------------------- 行为日志 → 记忆编译 */

test('行为日志能写能读，且不落在笔记库里', async () => {
  const res = await fetch(`${base}/api/agent/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'highlight_explain', videoId: 'a1', prompt: '用短句解释' }),
  })
  assert.equal(res.status, 200)
  const list = await (await fetch(`${base}/api/agent/log?limit=10`)).json()
  assert.ok(list.total >= 1)
  assert.equal(list.stats.highlight_explain >= 1, true)
  assert.ok(logPath().startsWith(STATE), '日志必须在服务端 .state 下，不能进笔记库')
  assert.ok(!existsSync(join(VAULT, 'behavior-log.jsonl')))
})

test('memory_compile：日志够多时编译出草稿并走 HITL，不自动写', async () => {
  const before = readFileSync(join(VAULT, 'memory.md'), 'utf8')
  // 造出「同一个收藏夹被接受 3 次」这种重复行为
  for (let i = 0; i < 3; i++) {
    appendBehavior({ kind: 'classify', videoId: `v${i}`, folder: '认知', action: 'pick' })
  }
  const raw = await sse('/api/agent/stream', { intent: 'memory_compile', windowDays: 14 })
  const evs = events(raw)
  const hitl = evs.find((e) => e.event === 'hitl_request')
  assert.ok(hitl, '编译结果必须走确认')
  assert.equal(hitl!.data.source, 'compiled')
  assert.match(hitl!.data.current, /分类习惯/)
  assert.match(hitl!.data.current, /认知/)
  assert.equal(readFileSync(join(VAULT, 'memory.md'), 'utf8'), before, '编译不能直接落盘')
})

test('memory_compile 再跑一次不会叠加编译块', async () => {
  const raw = await sse('/api/agent/stream', { intent: 'memory_compile' })
  const hitl = events(raw).find((e) => e.event === 'hitl_request')
  const count = (hitl!.data.current.match(/从行为里学到的/g) || []).length
  assert.equal(count, 1)
})

/* --------------------------------------------------------- 检索的诚实性 */

test('空库检索：如实说没命中，且不发 proposals', async () => {
  const emptyVault = mkdtempSync(join(tmpdir(), 'empty-'))
  const prev = process.env.DOUYIN_OBSIDIAN_DIR
  process.env.DOUYIN_OBSIDIAN_DIR = emptyVault
  try {
    const raw = await sse('/api/agent/stream', {
      intent: 'retrieve',
      messages: [{ role: 'user', content: '库里有没有讲注意力训练的' }],
    })
    const evs = events(raw)
    assert.ok(!evs.some((e) => e.event === 'proposals'), '没命中就绝不能发候选')
    const text = evs.filter((e) => e.event === 'token').map((e) => e.data.content || '').join('')
    assert.match(text, /检索没有命中/)
    assert.match(text, /不会编造出处/)
    // 转写服务没开，必须显式报错而不是静默降级
    const err = evs.find((e) => e.event === 'error')
    assert.ok(err)
    assert.equal(err!.data.code, 'WorkerUnreachable')
    assert.match(err!.data.message, /问题：/)
    assert.match(err!.data.message, /处理：/)
  } finally {
    process.env.DOUYIN_OBSIDIAN_DIR = prev
  }
})

test('propose 意图只提案，不自动钉（响应里没有 pin 动作）', async () => {
  const raw = await sse('/api/agent/stream', {
    intent: 'propose',
    messages: [{ role: 'user', content: '注意力' }],
  })
  const evs = events(raw)
  const proposals = evs.find((e) => e.event === 'proposals')
  assert.ok(proposals, '本地兜底也该给出候选')
  assert.equal(proposals!.data.pinned, false)
  assert.equal(proposals!.data.via, 'local')
  assert.ok(proposals!.data.items.length >= 1)
  // 命中标题/片段要带上，但没有出处就不许编
  assert.ok(proposals!.data.items[0].title)
})

test('attach 之前不会有人替用户钉笔记 —— 请求体里不出现 pinned 写库调用', async () => {
  const raw = await sse('/api/agent/stream', {
    intent: 'retrieve',
    messages: [{ role: 'user', content: '注意力' }],
  })
  const evs = events(raw)
  const text = evs.filter((e) => e.event === 'token').map((e) => e.data.content || '').join('')
  assert.match(text, /默认没有钉进对话/)
})

/* --------------------------------------------------------- 路径与白名单 */

test('重匹配接口拒绝 ../ 路径穿越', async () => {
  const res = await fetch(`${base}/api/agent/highlights/rematch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: join(VAULT, '..', '..', 'windows', 'system32', 'x.md') }),
  })
  assert.equal(res.status, 403)
  const data = await res.json()
  assert.equal(data.code, 'PathEscape')
})

test('重匹配接口能把划线迁到新正文上', async () => {
  const p = join(VAULT, 'b.md')
  writeFileSync(
    p,
    '---\naweme_id: "b1"\nhighlights:\n  - id: "h1"\n    quote: "目标句子"\n    prefix: ""\n    suffix: ""\n    start: 5\n    end: 9\n    status: ok\n---\n\n# T\n\n前面加了新段落。\n\n目标句子还是在这。\n',
    'utf8',
  )
  const res = await fetch(`${base}/api/agent/highlights/rematch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.stats.moved, 1)
  const after = readFileSync(p, 'utf8')
  const hl = parseHighlights(after)[0]
  assert.equal(hl.status, 'ok')
  const { body } = splitFrontmatter(after)
  assert.equal(body.slice(hl.start, hl.end), '目标句子')
  assert.ok(hl.start > 10, '偏移应该是重定位后的新位置，不是原来的 5')
})

/* --------------------------------------------------------------- 笔记库 */

test('GET /notes 直接读磁盘列库（Flask 没开也能用）', async () => {
  const data = await (await fetch(`${base}/api/agent/notes`)).json()
  const titles = data.notes.map((n: any) => n.title)
  assert.ok(titles.includes('注意力'))
  const a = data.notes.find((n: any) => n.title === '注意力')
  assert.equal(a.awemeId, 'a1')
})

test('DELETE /log 只清日志，不动笔记也不动 memory.md', async () => {
  const before = readFileSync(join(VAULT, 'memory.md'), 'utf8')
  const res = await fetch(`${base}/api/agent/log`, { method: 'DELETE' })
  assert.equal(res.status, 200)
  const list = await (await fetch(`${base}/api/agent/log`)).json()
  assert.equal(list.total, 0)
  assert.equal(readFileSync(join(VAULT, 'memory.md'), 'utf8'), before)
})
