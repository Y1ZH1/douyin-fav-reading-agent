import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './assets/main.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.mount('#app');

// ── 调试辅助：导出 localStorage 聊天状态 ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__chatDebug__ = () => {
  console.group('%c🔍 Chat Debug — localStorage State', 'color: #60a5fa; font-size: 14px')
  try {
    const sessionsRaw = localStorage.getItem('ai-tutor:sessions')
    if (!sessionsRaw || sessionsRaw === '[]') {
      console.log('%c📭 No sessions in localStorage', 'color: #fbbf24')
    } else {
      const metas = JSON.parse(sessionsRaw)
      console.log(`%c📋 ${metas.length} session(s) in localStorage:`, 'color: #4ade80')
      for (const m of metas) {
        const msgsRaw = localStorage.getItem('ai-tutor:msgs:' + m.id)
        const msgs = msgsRaw ? JSON.parse(msgsRaw) : []
        console.group(`  "${m.title}" (${m.id})`)
        console.log(`  updatedAt: ${new Date(m.updatedAt).toLocaleString()}`)
        console.log(`  messageCount: ${m.messageCount}, stored messages: ${msgs.length}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        msgs.forEach((msg: any) => {
          const content = msg.content?.slice(0, 80) || '(empty)'
          console.log(`  [${msg.role}] status=${msg.status} content="${content}"`)
        })
        console.groupEnd()
      }
    }
  } catch (e) {
    console.log('%c❌ Error reading localStorage:', 'color: red', e)
  }
  console.groupEnd()
}

console.log(
  '%c🛠  Type __chatDebug__() in console to inspect localStorage chat data.',
  'color: #60a5fa',
)

