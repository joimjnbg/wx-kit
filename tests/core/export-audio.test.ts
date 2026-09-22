// tests/core/export-audio.test.ts
// 音频内联原位:文件名取标题,md/html 链接文字与标题一致,位置在正文原位。
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportArticle, type ExportDeps } from '../../src/core/exporter/index'
import type { ParsedArticle, DownloadFormat } from '../../src/core/types'
import type { MpAudioSource } from '../../src/core/parse-audio'
import { audioRelPath } from '../../src/core/exporter/export-audio'

const A1: MpAudioSource = {
  voiceId: 'V1',
  url: 'https://res.wx.qq.com/voice/getvoice?mediaid=V1',
  title: 'U1 Wrapping Up 单词',
  durationMs: 30000,
  filesizeHint: 487328,
  cover: '',
  index: 0,
}
const A2: MpAudioSource = {
  voiceId: 'V2',
  url: 'https://res.wx.qq.com/voice/getvoice?mediaid=V2',
  title: 'P16 Activity1',
  durationMs: 101000,
  filesizeHint: 1637775,
  cover: '',
  index: 1,
}

const parsedWithAudio = (audios = [A1, A2]): ParsedArticle => ({
  title: '音频文章', author: '作者', account: '号',
  publishTime: '2026-09-18 08:00', digest: '', coverUrl: '',
  contentHtml: '<p>学单词</p><mp-common-mpaudio voice_encode_fileid="V1"></mp-common-mpaudio><p>做练习</p><mp-common-mpaudio voice_encode_fileid="V2"></mp-common-mpaudio><p>结束</p>',
  imageUrls: [], videos: [], audios, itemShowType: 0, warnings: []
})

const run = async (formats: DownloadFormat[], opts: { downloadAudios?: boolean; fetchBinary?: ExportDeps['fetchBinary']; audios?: MpAudioSource[] } = {}) => {
  const { downloadAudios = true, fetchBinary, audios } = opts
  const dir = join(mkdtempSync(join(tmpdir(), 'wxk-aud-')), 'art')
  const calls: string[] = []
  const deps: ExportDeps = {
    fetchBinary: fetchBinary ?? (async (url) => {
      calls.push(url)
      return { data: Buffer.from('MP3BYTESxxxx'), contentType: 'audio/mpeg' }
    }),
    BrowserWindowCtor: undefined as never,
    now: () => '2026-09-18T00:00:00.000Z',
  }
  const wrapped: ExportDeps = { ...deps, fetchBinary: async (u) => { calls.push(u); return deps.fetchBinary(u) } }
  const meta = await exportArticle({ parsed: parsedWithAudio(audios), id: 'id1', sourceUrl: 'https://x', dir, formats, downloadAudios }, wrapped)
  return { dir, meta, calls }
}

describe('exportArticle: 音频内联原位', () => {
  it('文件名取标题:链接上写什么,文件就叫什么', async () => {
    const { dir } = await run(['md', 'meta'])
    expect(existsSync(join(dir, 'audios', 'U1 Wrapping Up 单词.mp3'))).toBe(true)
    expect(existsSync(join(dir, 'audios', 'P16 Activity1.mp3'))).toBe(true)
    expect(existsSync(join(dir, 'audios', 'audio-1.mp3'))).toBe(false)
  })

  it('md 链接文字与标题一致,且在正文原位(学单词后、做练习前)', async () => {
    const { dir } = await run(['md'])
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('U1 Wrapping Up')
    expect(md).toContain('P16 Activity1')
    const iWord = md.indexOf('学单词')
    const iA1 = md.indexOf('U1 Wrapping Up')
    const iEx = md.indexOf('做练习')
    const iA2 = md.indexOf('P16 Activity1')
    expect(iWord).toBeLessThan(iA1)
    expect(iA1).toBeLessThan(iEx)
    expect(iEx).toBeLessThan(iA2)
  })

  it('html 原位 <audio>(无脚本,阅读器 iframe 可播)', async () => {
    const { dir } = await run(['html'])
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect(html).toContain('<audio controls')
    expect(html).toContain('U1 Wrapping Up')
    const iWord = html.indexOf('学单词')
    const iA1 = html.indexOf('<audio')
    expect(iWord).toBeLessThan(iA1)
  })

  it('meta.json 记 voiceId/标题/时长/路径,不存 url', async () => {
    const { dir } = await run(['meta'])
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    expect(meta.audios).toHaveLength(2)
    expect(meta.audios[0]).toMatchObject({ voiceId: 'V1', title: 'U1 Wrapping Up 单词', durationMs: 30000 })
    expect(meta.audios[0].path).toContain('U1 Wrapping Up')
    expect(JSON.stringify(meta)).not.toContain('getvoice')
  })

  it('下载失败:原位写明,告警上报,文章照常完成', async () => {
    const { dir, meta } = await run(['md', 'meta'], {
      fetchBinary: async () => { throw new Error('net down') },
    })
    expect(existsSync(join(dir, 'audios'))).toBe(true)
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('U1 Wrapping Up')
    expect(md).toContain('下载失败')
    expect(meta.warnings?.join('')).toContain('下载失败')
  })

  it('关闭下载:不发请求,原位留说明,记录无路径', async () => {
    const { dir, meta, calls } = await run(['md', 'meta'], { downloadAudios: false })
    expect(existsSync(join(dir, 'audios'))).toBe(false)
    expect(calls.filter((u) => u.includes('getvoice'))).toHaveLength(0)
    expect(meta.audios).toHaveLength(2)
    expect(meta.audios?.[0].path).toBeUndefined()
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('U1 Wrapping Up')
    expect(md).toContain('未下载')
  })
})

describe('audioRelPath 标题命名', () => {
  it('非法字符清洗,重名加后缀', () => {
    const taken = new Set<string>()
    expect(audioRelPath('U1: Wrapping?', taken)).toBe('audios/U1_ Wrapping_.mp3')
    expect(audioRelPath('U1: Wrapping?', taken)).toBe('audios/U1_ Wrapping_-2.mp3')
    expect(audioRelPath('', taken)).toBe('audios/untitled.mp3')
  })
})
