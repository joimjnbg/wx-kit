// src/core/parse-audio.ts
// 微信文章内嵌语音(mp-common-mpaudio)解析。对标 parse-video.ts。
// canonical 键是元素的 voice_encode_fileid;voiceList 只补 listen_id/sn;
// readtemplate audio_tmpl 的 src 是展示占位,不可下载,直接忽略。
// 端点证据见 docs/superpowers/spikes/2026-09-18-wechat-voice-download.md。

/** 单条语音的解析结果(url 为 session 内有效的 getvoice 直链,不持久化)。
 * index 为其在正文中的出现序号(从 0 起),供导出时原位回填。 */
export interface MpAudioSource {
  voiceId: string
  url: string
  title: string
  durationMs: number
  filesizeHint: number
  cover: string
  index: number
  listenId?: string
}

export interface ExtractAudiosResult {
  audios: MpAudioSource[]
  warnings: string[]
}

const GETVOICE = 'https://res.wx.qq.com/voice/getvoice?mediaid='

function voiceAttr(tag: string, name: string): string {
  // data-pluginname="insertaudio" 与 name="..." 并存:必须锚定词首,防止 data-* 前缀误命中
  const m = tag.match(new RegExp(`(?:\\s|^)${name}\\s*=\\s*"([^"]*)"`))
    ?? tag.match(new RegExp(`(?:\\s|^)${name}\\s*=\\s*'([^']*)'`))
  return (m?.[1] ?? '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#61;/g, '=').trim()
}

function voiceNum(tag: string, name: string): number {
  const n = Number(voiceAttr(tag, name))
  return Number.isFinite(n) ? n : 0
}

/** 状态语义抄播放器 be3.js 的 verifyErr 表:0/2/4/5 不可播,只告警不取。 */
function playable(tag: string): { ok: boolean; reason?: string } {
  const verify = voiceAttr(tag, 'data-verify_state')
  const trans = voiceAttr(tag, 'data-trans_state')
  if (verify === '5') return { ok: false, reason: '该语音已被作者删除,跳过下载' }
  if (verify === '2' || verify === '4') return { ok: false, reason: '该语音暂无法播放,跳过下载' }
  if (trans === '0') return { ok: false, reason: '该语音转码中,跳过下载' }
  return { ok: true }
}

/** voiceList 仅作 listen_id/sn 补充(元素无该属性时兜底)。键归一(base64 变体/&#61;),与播放器 isSameVoiceFileid 同语义。 */
export function normVoiceId(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/&#61;/g, '=').trim()
}

function listenMap(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const m = html.match(/voiceList\s*=\s*(\{[\s\S]*?\});/)
  if (!m) return out
  try {
    const v = JSON.parse(m[1]) as { voice_in_appmsg?: { voice_id?: string; listen_id?: string }[] }
    for (const item of v.voice_in_appmsg ?? []) {
      if (item.voice_id && item.listen_id) out.set(normVoiceId(item.voice_id), item.listen_id)
    }
  } catch { /* 脏数据不炸整篇解析 */ }
  return out
}

/** 从整页 html 提取语音列表。顺序 = 正文出现顺序(导出原位回填依赖);
 * 去重按 voiceId(content 与 content_noencode 是同一拷贝)。 */
export function extractMpAudios(html: string): ExtractAudiosResult {
  const audios: MpAudioSource[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const listen = listenMap(html)
  let index = 0
  for (const tag of html.matchAll(/<mp-common-mpaudio\b[^>]*>/g)) {
    const t = tag[0]
    const voiceId = normVoiceId(voiceAttr(t, 'voice_encode_fileid'))
    if (!voiceId || seen.has(voiceId)) continue
    // 去重先行:两份拷贝的同一 id 只告警一次;播放与不可播混排时可播优先
    seen.add(voiceId)
    const state = playable(t)
    if (!state.ok) {
      warnings.push(state.reason ?? '该语音不可播,跳过下载')
      continue
    }
    audios.push({
      voiceId,
      url: `${GETVOICE}${encodeURIComponent(voiceId)}`,
      title: voiceAttr(t, 'name') || voiceId,
      durationMs: voiceNum(t, 'play_length'),
      filesizeHint: voiceNum(t, 'high_size') || voiceNum(t, 'source_size'),
      cover: voiceAttr(t, 'cover'),
      index: index++,
      ...(listen.get(voiceId) ? { listenId: listen.get(voiceId)! } : {}),
    })
  }
  return { audios, warnings }
}
