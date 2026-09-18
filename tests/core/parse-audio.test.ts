// tests/core/parse-audio.test.ts
// 票据 voice-01 RED:语音解析纯函数尚不存在。
import { describe, it, expect } from 'vitest'
import { extractMpAudios } from '../../src/core/parse-audio'

const el = (over: Record<string, string> = {}) => {
  const attrs = {
    voice_encode_fileid: 'MzI0OTYwNjE4MF8yMjQ3NTQwOTkz',
    name: 'U1&nbsp;Wrapping Up',
    play_length: '30000',
    ...over,
  }
  const s = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')
  return `<mp-common-mpaudio ${s}></mp-common-mpaudio>`
}
const voiceList = `var voiceList={"voice_in_appmsg":[{"voice_id":"MzI0OTYwNjE4MF8yMjQ3NTQwOTkz","sn":"fabecc","listen_id":"222507957108098006"},{"voice_id":"MzI0OTYwNjE4MF8yMjQ3NTQwOTky","sn":"c47e05","listen_id":"222507957108097213"}]};`
const page = (body: string) => `<html><body><div id="js_content">${body}</div><script>${voiceList}</script></body></html>`

describe('extractMpAudios', () => {
  it('单元素解析出 voiceId/标题/时长', () => {
    const [a] = extractMpAudios(page(el())).audios
    expect(a.voiceId).toBe('MzI0OTYwNjE4MF8yMjQ3NTQwOTkz')
    expect(a.title).toContain('U1')
    expect(a.durationMs).toBe(30000)
    expect(a.url).toContain('res.wx.qq.com/voice/getvoice?mediaid=MzI0OTYwNjE4MF8yMjQ3NTQwOTkz')
  })

  it('两份拷贝(content/content_noencode)按 fileid 去重', () => {
    const html = page(`${el()}<div>${el()}</div>`)
    expect(extractMpAudios(html).audios).toHaveLength(1)
  })

  it('无音频页返回空数组零告警', () => {
    expect(extractMpAudios('<html><body><div id="js_content"><p>文</p></div></body></html>')).toEqual({ audios: [], warnings: [] })
  })

  it('不可播状态只告警不解析(verify_state=5 被作者删除)', () => {
    const { audios, warnings } = extractMpAudios(page(el({ 'data-verify_state': '5', 'data-trans_state': '1' })))
    expect(audios).toHaveLength(0)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
