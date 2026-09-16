// src/core/pick-articles.ts
// 两层选择器:批量类型开关定默认,单篇勾选覆盖。纯函数,GUI 与 CLI 共用。
// v1 类型映射:item_show_type 0/8/10/11 → text;5 → video;未知 → text(与解析兜底一致)。
// images/audio 是下载维度(随正文/附件落地),不是列表类型维度——开关默认全开,
// 关闭 images 意味着"只下文字骨架",关闭 audio 意味着"跳过音频附件"。
import type { ArticleRef } from './mp-types'

export interface PickTypes { text?: boolean; images?: boolean; audio?: boolean; video?: boolean }

export interface PickSelection {
  types?: PickTypes
  /** 单篇加回(覆盖类型开关的剔除)。按 refId 认,未知条目忽略。 */
  include?: string[]
  /** 单篇剔除(覆盖默认入选)。按 refId 认,未知条目忽略。 */
  exclude?: string[]
}

export interface PickInput { refs: ArticleRef[] }

/** 与 subscription-refs.refId 同源的待选身份:有主键用 mid_idx,否则归一化 URL。 */
export function pickId(ref: ArticleRef): string {
  if (ref.appmsgid != null && ref.itemidx != null) return `${ref.appmsgid}_${ref.itemidx}`
  const raw = ref.url
  try {
    const url = new URL(raw)
    if (url.hostname === 'mp.weixin.qq.com' && url.pathname.startsWith('/s/')) {
      return `${url.origin}${url.pathname.replace(/~/g, '_')}`
    }
  } catch { /* 非 URL 保持原值 */ }
  return raw
}

/** 类型开关是否命中该条目:text 覆盖图文/图片/文字/通告与未知,video 覆盖视频消息。 */
function typeEnabled(ref: ArticleRef, types: PickTypes): boolean {
  if (ref.itemShowType === 5) return types.video !== false
  return types.text !== false
}

export interface PickResult { items: ArticleRef[]; total: number }

export function applyPick(input: PickInput, sel: PickSelection): PickResult {
  const types = sel.types ?? {}
  const include = new Set(sel.include ?? [])
  const exclude = new Set(sel.exclude ?? [])
  const items = input.refs.filter((r) => {
    const id = pickId(r)
    if (exclude.has(id)) return false
    if (include.has(id)) return true
    return typeEnabled(r, types)
  })
  return { items, total: input.refs.length }
}
