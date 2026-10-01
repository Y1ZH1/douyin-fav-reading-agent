import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { chatRouter } from './routes/chat.js'
import { explanationRouter } from './routes/explanation.js'
import { diffRouter } from './routes/diff.js'
import { analyzeRouter } from './routes/analyze.js'
import { agentRouter } from './routes/agent.js'

/**
 * 单独导出 createApp，index.ts 只负责 listen。
 * 拆开之后单测可以直接 `createApp().listen(0)` 起一个临时端口跑真实 HTTP，
 * 不用装 supertest 之类的东西。
 */
export function createApp() {
  const app = express()
  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '10mb' }))

  // 阅读 Agent 是主路径
  app.use('/api/agent', agentRouter)

  // 旧「代码导师」路由：源码保留（产品规格明确不删），但导航里已经不出现。
  // 留着是为了不改动 server 编译产物，也不影响既有 lint / 构建。
  app.use('/api/chat', chatRouter)
  app.use('/api/explanation', explanationRouter)
  app.use('/api/diff', diffRouter)
  app.use('/api/analyze', analyzeRouter)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), surface: 'reading-agent' })
  })

  return app
}
