import { createRouter, createWebHistory } from 'vue-router'

/**
 * 主路径只有两个：阅读页（/）和设置（/settings）。
 *
 * 下面三个 retired 路由是旧「代码导师」的页面。产品规格明确说
 * **只从导航隐藏，不删源码**（避免一次巨大的、没法 review 的删除 diff），
 * 所以它们仍然可达，但 meta.retired 标了出来，
 * CommandPalette 与 Sidebar 也都不再列它们。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/explain',
      name: 'explain',
      component: () => import('@/views/ExplainView.vue'),
      meta: { retired: true, title: '代码解释（退役）' },
    },
    {
      path: '/diff',
      name: 'diff',
      component: () => import('@/views/DiffView.vue'),
      meta: { retired: true, title: '代码差异（退役）' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { retired: true, title: '个人简介（退役）' },
    },
  ],
})

export { router }
