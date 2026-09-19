// src/core/pick-articles.ts
// 两层选择器:批量类型开关定默认,单篇勾选覆盖。纯函数,GUI 与 CLI 共用。
// v1 类型映射:item_show_type 0/8/10/11 → text;5 → video;未知 → text(与解析兜底一致)。
// images/audio 键保留给下载维度(随正文/附件落地),不参与条目筛选。
import type { ArticleRef } from './mp-types'
import { refId } from './subscription-refs'

export interface PickTypes { text?: boolean; images?: boolean; audio?: boolean; video?: boolean }

export interface PickSelection {
  types?: PickTypes
  /** 单篇加回(覆盖类型开关的剔除)。按 refId 认,未知条目忽略。 */
  include?: string[]
  /** 单篇剔除(覆盖默认入选)。按 refId 认,未知条目忽略。 */
  exclude?: string[]
}

export interface PickInput { refs: ArticleRef[] }

/** 待选身份与订阅待处理同源(refId):有主键用 mid_idx,否则归一化 URL。 */
export function pickId(ref: ArticleRef): string {
  return refId(ref)
}

/** 类型开关是否命中该条目:text 覆盖图文/图片/文字/通告与未知,video 覆盖视频消息。
 * images/audio 是下载维度(随正文/附件落地,见Exporter的wantImages/downloadAudios),
 * 不参与条目筛选——v1 按条目类型只分 text/video 两档。 */
function typeEnabled(ref: ArticleRef, types: PickTypes): boolean {
  void types.images
  void types.audio
  if (ref.itemShowType === 5) return types.video !== false
  return types.text !== false
}

/** 该条目是否应下载语音附件:条目入选且 audio 开关开(下载维度,不影响行过滤)。 */
export function shouldDownloadAudio(types: PickTypes | undefined, downloadAudios: boolean): boolean {
  if (!downloadAudios) return false
  return types?.audio !== false
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
