// src/renderer/sync-view.ts
// 同步页派生纯函数(与 subscription-view 同层:只放 UI 无关的派生逻辑)。
// 渲染层可直接 import —— 零 node 依赖,不得引入 core/fs/electron 运行时。

/** 登录态提示:有效/失效/检查中三种,失效必须指引重扫而非报"无新文章"。 */
export function sessionHint(s: { loggedIn: boolean | null }): string {
  if (s.loggedIn === true) return '已登录,同步可用'
  if (s.loggedIn === false) return '登录已过期,请到设置页扫码重新登录'
  return '登录态检查中…'
}
