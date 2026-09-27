// 身份规则单一缝:URL 归一 + 文章主键 + 语音 id 归一。
// 零 node 依赖(仅 URL 类)——core 与 renderer 皆可直引,终结四处复述。
// (subscription-refs / resolve-urls / sync-rows / Sync.tsx 各一份的收口。)

/** 短链 ~/ 形态归一:同 token 两种写法认作同一篇。非文章 URL 原样返回。 */
export function articleUrlKey(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.hostname === 'mp.weixin.qq.com' && u.pathname.startsWith('/s/')) {
      return `${u.origin}${u.pathname.replace(/~/g, '_')}`
    }
  } catch { /* 非 URL 保持原值 */ }
  return raw
}

/** 稳定身份:微信主键 mid_idx 优先,回退归一化 URL。 */
export function refIdOf(r: { url: string; appmsgid?: number | null; itemidx?: number | null }): string {
  if (r.appmsgid != null && r.itemidx != null) return `${r.appmsgid}_${r.itemidx}`
  return articleUrlKey(r.url)
}

/** 语音 id 归一(base64 变体/&#61;),与播放器 isSameVoiceFileid 同语义。 */
export function normVoiceId(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/&#61;/g, '=').trim()
}
