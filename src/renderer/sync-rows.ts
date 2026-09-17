// src/renderer/sync-rows.ts
// 同步行组装纯函数(与 subscription-view 同层:只放 UI 无关的派生逻辑)。
// 渲染层可直接 import —— 零 node 依赖,不得引入 core/fs/electron 运行时。
// 类型映射与 core/message-kind.kindTag 同构(渲染层禁引 core,故此处复述最小映射);
// 若 message-kind 新增类型,此处需同步跟进(测试钉住视频/图片/未知三档)。

/** 行组装输入:订阅待处理条目的最小展示子集(含主键与时间,身份与排序稳定)。 */
export interface SyncRowInput {
  url: string
  title: string
  createTime: number
  itemShowType?: number | null
  appmsgid?: number
  itemidx?: number
}

/** 组装后的行:稳定 refId、标题/类型标签/已存档标记,保留时间供排序。 */
export interface SyncRow {
  refId: string
  url: string
  title: string
  createTime: number
  kindLabel: string | null
  kindWarn: boolean
  archived: boolean
}

function kindOf(type: number | null | undefined): { label: string | null; warn: boolean } {
  if (type == null) return { label: null, warn: false }
  if (type === 5) return { label: '视频', warn: false }
  if (type === 8) return { label: '图片', warn: false }
  if (type === 10) return { label: '文字', warn: false }
  if (type === 0 || type === 11) return { label: null, warn: false }
  return { label: '未知类型', warn: true }
}

/** 短链 ~/ 形态归一(与 core/subscription-refs.sourceUrlKey 同规则,渲染层复述)。 */
function urlKey(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.hostname === 'mp.weixin.qq.com' && u.pathname.startsWith('/s/')) {
      return `${u.origin}${u.pathname.replace(/~/g, '_')}`
    }
  } catch { /* 非 URL 保持原值 */ }
  return raw
}

/** 稳定身份:微信主键 mid_idx 优先,回退归一化 URL(与 core refId 同规则,渲染层复述)。 */
export function syncRefId(r: Pick<SyncRowInput, 'url' | 'appmsgid' | 'itemidx'>): string {
  if (r.appmsgid != null && r.itemidx != null) return `${r.appmsgid}_${r.itemidx}`
  return urlKey(r.url)
}

/** 选择集计算(渲染层复述 core/applyPick 规则,禁引 core):
 * 类型开关定默认(text 覆盖非视频,video 覆盖视频5),单篇勾选覆盖。
 * checked 为显式勾选集;withTypes 为批量开关(默认全开)。 */
export function computePicked(
  rows: SyncRow[],
  checked: Set<string>,
  withTypes: { text: boolean; video: boolean },
): SyncRow[] {
  return rows.filter((r) => {
    if (checked.has(r.refId)) return true
    const isVideo = r.kindLabel === '视频'
    return isVideo ? withTypes.video : withTypes.text
  })
}

/** 选择集话术:已选 N / 共 M 篇。 */
export function pickSummary(picked: number, total: number): string {
  return `已选 ${picked} / ${total} 篇`
}

/** 组装行:标题回退 url,类型标签映射,主键或归一化 URL 命中即已存档。 */
export function buildSyncRows(
  refs: SyncRowInput[],
  archived: { archivedIds: Set<string>; archivedUrls: Set<string> },
): SyncRow[] {
  const urlSet = new Set([...archived.archivedUrls].map(urlKey))
  return refs.map((r) => {
    const k = kindOf(r.itemShowType)
    const id = syncRefId(r)
    return {
      refId: id,
      url: r.url,
      title: r.title.trim() || r.url,
      createTime: r.createTime,
      kindLabel: k.label,
      kindWarn: k.warn,
      archived: archived.archivedIds.has(id) || urlSet.has(urlKey(r.url)),
    }
  }).sort((a, b) => b.createTime - a.createTime)
}

/** 重同步合并(并集合并):新行整体替换同 refId 旧行(archived 等标记刷新),
 * 不在新集中的旧行保留(不静默丢),顺序按时间重排,与文库一致。 */
export function mergeSyncRows(prev: SyncRow[], next: SyncRow[]): SyncRow[] {
  const byId = new Map(next.map((n) => [n.refId, n] as const))
  const kept = prev.map((r) => byId.get(r.refId) ?? r)
  const prevIds = new Set(prev.map((r) => r.refId))
  const fresh = next.filter((n) => !prevIds.has(n.refId))
  return [...kept, ...fresh].sort((a, b) => b.createTime - a.createTime)
}
