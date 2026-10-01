import 'dotenv/config'
import { createApp } from './app.js'

const PORT = Number(process.env.PORT || 3001)
// 只绑本机：这是个本地工具，没有理由把端口暴露到局域网。
const HOST = process.env.HOST || '127.0.0.1'

createApp().listen(PORT, HOST, () => {
  console.log(`[Fav Agent] http://${HOST}:${PORT}`)
})
