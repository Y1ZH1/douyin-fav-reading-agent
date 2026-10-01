/**
 * Node 侧单测。跑法：npm run test（在 server/ 下），或仓库根 npm run test:server。
 *
 * 用 Node 自带的 test runner + tsx，不引第三方测试框架 —— 这个项目的
 * 依赖已经够多了，没必要再塞一个 vitest。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fingerprint,
  highlightsDeco,
  locate,
  makeHighlight,
  parseHighlights,
  rematch,
  serializeHighlights,
  splitFrontmatter,
  upsertHighlight,
  writeHighlights,
} from '../src/highlights.js'
import {
  JEV_DEFAULT_MIN_GAP,
  JEV_DEFAULT_THRESHOLD,
  localCandidates,
  shouldAutoClassify,
} from '../src/services/agent-tools.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, '../../douyin-fav-transcribe/tests/fixtures/note_with_highlight.md')

/* ------------------------------------------------- 与 Python 端的格式契约 */

test('能读懂 Python 侧写出来的 frontmatter highlights 块', () => {
  const text = readFileSync(FIXTURE, 'utf8')
  const items = parseHighlights(text)
  assert.equal(items.length, 2)
  assert.equal(items[0].quote, '换了个说法接着说同一件事')
  assert.equal(items[1].start, 8)
  assert.ok(items.every((h) => h.status === 'ok'))
  assert.ok(items.every((h) => h.id.startsWith('h-')))
})

test('其它 frontmatter 键原样保留（folders 不能被吃掉）', () => {
  const text = readFileSync(FIXTURE, 'utf8')
  const again = writeHighlights(text, parseHighlights(text))
  assert.match(again, /aweme_id: "7300000000000000001"/)
  assert.match(again, /folders:/)
  assert.match(again, /  - 认知/)
  assert.match(again, /^# 测试视频$/m)
  assert.equal(parseHighlights(again).length, 2)
})

test('我们写出来的格式，自己必须读得回来', () => {
  const note = '---\naweme_id: "1"\n---\n\n# T\n\n正文里有一句目标话。\n'
  const { text, highlight } = upsertHighlight(note, '正文里有一句目标话')
  assert.ok(highlight)
  const back = parseHighlights(text)
  assert.equal(back.length, 1)
  assert.equal(back[0].quote, '正文里有一句目标话')
  assert.equal(back[0].start, highlight!.start)
  assert.equal(serializeHighlights(back), serializeHighlights([highlight!]))
})

/* ---------------------------------------------------------- 指纹与重匹配 */

test('重转写后偏移会跟着走，而不是留在老位置', () => {
  const note = '---\naweme_id: "1"\n---\n\n# T\n\n第三段内容。\n'
  const { text } = upsertHighlight(note, '第三段内容')
  const items = parseHighlights(text)
  const newBody = '前面插进来一大段新内容。\n\n# T\n\n第三段内容。\n'
  const { items: out, stats } = rematch(items, newBody)
  assert.equal(stats.moved, 1)
  assert.equal(out[0].status, 'ok')
  assert.equal(newBody.slice(out[0].start, out[0].end), '第三段内容')
})

test('原文没了就标 stale，不假装还在原位', () => {
  const body = '# T\n\n第三段内容。\n'
  const items = [{ ...makeHighlight('第三段内容', body) }]
  items[0].start = 3
  items[0].end = 9
  const { items: out, stats } = rematch(items, '# T\n\n正文完全换掉了。\n')
  assert.equal(stats.stale, 1)
  assert.equal(out[0].status, 'stale')
  assert.equal(out[0].start, -1)
  assert.equal(out[0].quote, '第三段内容')
})

test('跨行的中文摘录能匹配上（不该被折行拆散）', () => {
  const body = '# T\n\n讲的是一个人怎么在长期里保持注意力。\n'
  const found = locate({ quote: '讲的是一个人怎么 在长期里保持注意力', prefix: '', suffix: '' }, body)
  assert.ok(found)
  assert.equal(body.slice(found![0], found![1]), '讲的是一个人怎么在长期里保持注意力')
})

test('同一条摘录写两次不会重复落库', () => {
  const note = '---\naweme_id: "1"\n---\n\n# T\n\n目标句子在这里。\n'
  const once = upsertHighlight(note, '目标句子在这里')
  const twice = upsertHighlight(once.text, '目标句子在这里')
  assert.equal(twice.stats.added, 0)
  assert.equal(twice.stats.reused, 1)
  assert.equal(twice.text, once.text)
})

test('指纹固定 32 字，且首尾都不为空', () => {
  const q = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五'
  const [pre, suf] = fingerprint(q)
  assert.equal(pre.length, 32)
  assert.equal(suf.length, 32)
})

test('空高亮写成空数组而不是空块', () => {
  assert.equal(serializeHighlights([]), 'highlights: []')
  const note = '---\naweme_id: "1"\n---\n\n# T\n'
  const cleared = writeHighlights(note, [])
  assert.match(cleared, /highlights: \[\]/)
  assert.equal(parseHighlights(cleared).length, 0)
  assert.match(cleared, /aweme_id: "1"/)
})

test('splitFrontmatter 分得清内外，且正文不含 frontmatter', () => {
  const { inner, body } = splitFrontmatter(readFileSync(FIXTURE, 'utf8'))
  assert.match(inner, /aweme_id/)
  assert.ok(!body.includes('aweme_id'))
  assert.ok(body.startsWith('# 测试视频'))
})

test('deco 统计 stale 数量', () => {
  const text =
    '---\naweme_id: "1"\n' +
    'highlights:\n  - id: "a"\n    quote: "在"\n    start: -1\n    end: -1\n    status: stale\n' +
    '---\n\n# T\n'
  const d = highlightsDeco(text)
  assert.equal(d.total, 1)
  assert.equal(d.byStatus.stale, 1)
})

/* ------------------------------------------------------------ Jev 分类 */

test('分类阈值表：高置信自动、两夹胶着交给人、低置信交给人', () => {
  const cases: Array<[number, number, boolean, string]> = [
    [0.95, 0.1, true, '高置信 + 间隙大 → 自动'],
    [0.72, 0.1, true, '刚好踩线 → 自动'],
    [0.71, 0.1, false, '差一点不够 → HITL'],
    [0.95, 0.92, false, '两个夹子太近 → HITL'],
    [0.8, 0.75, false, '间隙 0.05 < 0.08 → HITL'],
    [0.8, 0.7, true, '间隙 0.1 → 自动'],
    [0, 0, false, '啥都没给 → HITL'],
  ]
  for (const [conf, second, auto, label] of cases) {
    const out = shouldAutoClassify(conf, second)
    assert.equal(out.auto, auto, label)
    assert.ok(out.reason.length > 0, '必须给出理由，UI 要显示')
  }
})

test('阈值可覆盖', () => {
  assert.equal(shouldAutoClassify(0.6, 0.1).auto, false)
  assert.equal(shouldAutoClassify(0.6, 0.1, 0.5, 0.01).auto, true)
  assert.equal(JEV_DEFAULT_THRESHOLD, 0.72)
  assert.equal(JEV_DEFAULT_MIN_GAP, 0.08)
})

/* ------------------------------------------------------ 检索的诚实性 */

test('空库时本地兜底候选为空 —— 宁可不给，也不编', () => {
  const dir = mkdtempSync(join(tmpdir(), 'empty-vault-'))
  assert.deepEqual(localCandidates(dir, '任意一个查询词'), [])
})

test('本地兜底候选带 via=local 标记，前端能如实说明来源', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'))
  writeFileSync(
    join(dir, 'a.md'),
    '---\naweme_id: "a1"\n---\n\n# 注意力\n\n长期保持稳定的注意力要靠把目标切小。\n',
    'utf8',
  )
  const items = localCandidates(dir, '注意力')
  assert.equal(items.length, 1)
  assert.equal(items[0].awemeId, 'a1')
  assert.equal(items[0].via, 'local')
  assert.match(items[0].reason, /Flask 检索未启用/)
})
