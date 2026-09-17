// src/renderer/sync-view.ts
// 同步页派生纯函数(与 subscription-view 同层:只放 UI 无关的派生逻辑)。
// 渲染层可直接 import —— 零 node 依赖,不得引入 core/fs/electron 运行时。

/** 同步条目在列表上的身份与展示字段。 */
export interface SyncEntry {
  refId: string
  url: string
  title: string
  /** 已在文库:展示"已存档"标记,不阻止再次勾选 */
  archived?: boolean
}

/** 行标题:有标题用标题,无标题回退原文链接。 */
export function entryTitle(e: Pick<SyncEntry, 'title' | 'url'>): string {
  return e.title.trim() || e.url
}

/** 登录态提示:有效/失效/检查中三种,失效必须指引重扫而非报"无新文章"。 */
export function sessionHint(s: { loggedIn: boolean | null }): string {
  if (s.loggedIn === true) return '已登录,同步可用'
  if (s.loggedIn === false) return '登录已过期,请到设置页扫码重新登录'
  return '登录态检查中…'
}

/** 选择集话术:已选 N / 共 M 篇。 */
export function pickSummary(picked: number, total: number): string {
  return `已选 ${picked} / ${total} 篇`
}
