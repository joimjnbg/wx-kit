// tests/core/parse-audio.test.ts
// 票据 voice-01 RED:语音解析纯函数尚不存在。
import { describe, it, expect } from 'vitest'
import { extractMpAudios } from '../../src/core/parse-audio'

const el = (over: Record<string, string> = {}) => {
  const attrs: Record<string, string> = {
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

  it('不可播状态只告警一次不解析(verify_state=5 被作者删除,两份拷贝)', () => {
    const bad = el({ 'data-verify_state': '5', 'data-trans_state': '1' })
    const { audios, warnings } = extractMpAudios(page(`${bad}<div>${bad}</div>`))
    expect(audios).toHaveLength(0)
    expect(warnings).toHaveLength(1)
  })

  it('verify_state=2/4 与 trans_state=0 同样告警不取', () => {
    const cases: Record<string, string>[] = [
      { 'data-verify_state': '2' }, { 'data-verify_state': '4' }, { 'data-trans_state': '0' },
    ]
    for (const attrs of cases) {
      const { audios, warnings } = extractMpAudios(page(el(attrs)))
      expect(audios).toHaveLength(0)
      expect(warnings.length).toBeGreaterThan(0)
    }
  })

  it('voiceList 补 listen_id;单引号元素不静默丢失', () => {
    const single = `<mp-common-mpaudio voice_encode_fileid='MzI0OTYwNjE4MF8yMjQ3NTQwOTkz' name='单引号' play_length='30000'></mp-common-mpaudio>`
    const { audios } = extractMpAudios(page(single))
    expect(audios).toHaveLength(1)
    expect(audios[0].listenId).toBe('222507957108098006')
    expect(audios[0].title).toBe('单引号')
  })
})
