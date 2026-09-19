// src/core/resolve-urls.ts
// URL 清单文本解析(纯函数,零网络):逐行判定有效/无效,重复按归一化合并。
// 与 subscription-refs.sourceUrlKey 同规则(渲染层 sync-rows 复述过),此处收口到 core。

/** 单条 URL 的解析结果。 */
export interface ResolvedUrl {
  url: string
  valid: boolean
  /** 无效原因(非文章 URL 等);有效时缺省 */
  reason?: string
  /** 长链自带主键(短链无);供下载判重 hint */
  appmsgid?: number
  itemidx?: number
  /** 与另一行归一化同址(TRUE 仅标在保留的那行) */
  duplicate?: boolean
}

export interface ResolveUrlsResult {
  items: ResolvedUrl[]
  /** 输入行数(含空行/无效行) */
  total: number
}

/** 短链 ~/ 形态归一(与 sourceUrlKey 同规则)。 */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.hostname === 'mp.weixin.qq.com' && u.pathname.startsWith('/s/')) {
      return `${u.origin}${u.pathname.replace(/~/g, '_')}`
    }
  } catch { /* 非 URL 保持原值 */ }
  return raw
}

function parseOne(raw: string): ResolvedUrl {
  const url = raw.trim()
  let u: URL | null = null
  try { u = new URL(url) } catch { /* 下方判无效 */ }
  if (!u || u.hostname !== 'mp.weixin.qq.com' || !u.pathname.startsWith('/s')) {
    return { url, valid: false, reason: '不是微信文章链接(mp.weixin.qq.com/s/...)' }
  }
  const out: ResolvedUrl = { url, valid: true }
  const mid = u.searchParams.get('mid')
  const idx = u.searchParams.get('idx')
  if (mid && idx && /^\d+$/.test(mid) && /^\d+$/.test(idx)) {
    out.appmsgid = Number(mid)
    out.itemidx = Number(idx)
  }
  return out
}

/** 解析多行 URL 文本:空行跳过但计入 total;重复按归一化合并。 */
export function resolveUrlText(text: string): ResolveUrlsResult {
  const lines = text.split(/\r?\n/)
  const total = lines.filter((l) => l.trim()).length
  const items: ResolvedUrl[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const r = parseOne(t)
    if (!r.valid) { items.push(r); continue }
    const key = urlKey(r.url)
    if (seen.has(key)) {
      const first = items.find((i) => i.valid && urlKey(i.url) === key)
      if (first) first.duplicate = true
      continue
    }
    seen.add(key)
    items.push(r)
  }
  return { items, total }
}
