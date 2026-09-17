// src/renderer/sync-rows.ts
// 同步行组装纯函数(与 subscription-view 同层:只放 UI 无关的派生逻辑)。
// 渲染层可直接 import —— 零 node 依赖,不得引入 core/fs/electron 运行时。
// 类型映射与 core/message-kind.kindTag 同构(渲染层禁引 core,故此处复述最小映射);
// 若 message-kind 新增类型,此处需同步跟进(测试钉住视频/图片/未知三档)。

/** 行组装输入:订阅待处理条目的最小展示子集(含主键,身份稳定)。 */
export interface SyncRowInput {
  url: string
  title: string
  itemShowType?: number | null
  appmsgid?: number
  itemidx?: number
}

/** 组装后的行:稳定 refId、标题/类型标签/已存档标记。 */
export interface SyncRow {
  refId: string
  url: string
  title: string
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
      kindLabel: k.label,
      kindWarn: k.warn,
      archived: archived.archivedIds.has(id) || urlSet.has(urlKey(r.url)),
    }
  })
}
