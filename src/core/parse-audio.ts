// src/core/parse-audio.ts
// 微信文章内嵌语音(mp-common-mpaudio)解析。对标 parse-video.ts。
// canonical 键是元素的 voice_encode_fileid;voiceList 只补 listen_id/sn;
// readtemplate audio_tmpl 的 src 是展示占位,不可下载,直接忽略。
// 端点证据见 docs/superpowers/spikes/2026-09-18-wechat-voice-download.md。

/** 单条语音的解析结果(url 为 session 内有效的 getvoice 直链,不持久化)。 */
export interface MpAudioSource {
  voiceId: string
  url: string
  title: string
  durationMs: number
  filesizeHint: number
  cover: string
  listenId?: string
}

export interface ExtractAudiosResult {
  audios: MpAudioSource[]
  warnings: string[]
}

const GETVOICE = 'https://res.wx.qq.com/voice/getvoice?mediaid='

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))
  return (m?.[1] ?? '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#61;/g, '=').trim()
}

function num(tag: string, name: string): number {
  const v = attr(tag, name)
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 状态语义抄播放器 be3.js 的 verifyErr 表:0/2/4/5 不可播,只告警不取。 */
function playable(tag: string): { ok: boolean; reason?: string } {
  const verify = attr(tag, 'data-verify_state')
  const trans = attr(tag, 'data-trans_state')
  if (verify === '5') return { ok: false, reason: '该语音已被作者删除,跳过下载' }
  if (verify === '2' || verify === '4') return { ok: false, reason: '该语音暂无法播放,跳过下载' }
  if (trans === '0') return { ok: false, reason: '该语音转码中,跳过下载' }
  return { ok: true }
}

/** voiceList 仅作 listen_id/sn 补充(元素无该属性时兜底)。 */
function listenMap(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const m = html.match(/voiceList\s*=\s*(\{.*?\});/s)
  if (!m) return out
  try {
    const v = JSON.parse(m[1]) as { voice_in_appmsg?: { voice_id?: string; listen_id?: string }[] }
    for (const item of v.voice_in_appmsg ?? []) {
      if (item.voice_id && item.listen_id) out.set(item.voice_id, item.listen_id)
    }
  } catch { /* 脏数据不炸整篇解析 */ }
  return out
}

/** 从整页 html 提取语音列表,按 voiceId 去重(content 与 content_noencode 是同一拷贝)。 */
export function extractMpAudios(html: string): ExtractAudiosResult {
  const audios: MpAudioSource[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const listen = listenMap(html)
  for (const tag of html.matchAll(/<mp-common-mpaudio\b[^>]*>/g)) {
    const t = tag[0]
    const voiceId = attr(t, 'voice_encode_fileid')
    if (!voiceId || seen.has(voiceId)) continue
    const state = playable(t)
    if (!state.ok) {
      warnings.push(state.reason ?? '该语音不可播,跳过下载')
      continue
    }
    seen.add(voiceId)
    audios.push({
      voiceId,
      url: `${GETVOICE}${encodeURIComponent(voiceId)}`,
      title: attr(t, 'name') || voiceId,
      durationMs: num(t, 'play_length'),
      filesizeHint: num(t, 'high_size') || num(t, 'source_size'),
      cover: attr(t, 'cover'),
      ...(listen.get(voiceId) ? { listenId: listen.get(voiceId)! } : {}),
    })
  }
  return { audios, warnings }
}
