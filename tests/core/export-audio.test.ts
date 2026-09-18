// tests/core/export-audio.test.ts
// 票据 voice-02 RED:音频落盘纯函数尚不存在(镜像 export-video.test.ts)。
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportArticle, type ExportDeps } from '../../src/core/exporter/index'
import type { ParsedArticle, DownloadFormat } from '../../src/core/types'
import type { MpAudioSource } from '../../src/core/parse-audio'

const AUDIO: MpAudioSource = {
  voiceId: 'MzI0OTYwNjE4MF8yMjQ3NTQwOTkz',
  url: 'https://res.wx.qq.com/voice/getvoice?mediaid=MzI0OTYwNjE4MF8yMjQ3NTQwOTkz',
  title: 'U1 Wrapping Up',
  durationMs: 30000,
  filesizeHint: 487328,
  cover: '',
}

const parsedWithAudio = (): ParsedArticle => ({
  title: '音频文章', author: '作者', account: '号',
  publishTime: '2026-09-18 08:00', digest: '', coverUrl: '',
  contentHtml: '<p>正文</p>',
  imageUrls: [], videos: [], audios: [AUDIO], itemShowType: 0, warnings: []
})

const run = async (formats: DownloadFormat[], opts: { downloadAudios?: boolean; fetchBinary?: ExportDeps['fetchBinary'] } = {}) => {
  const { downloadAudios = true, fetchBinary } = opts
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
  const meta = await exportArticle({ parsed: parsedWithAudio(), id: 'id1', sourceUrl: 'https://x', dir, formats, downloadAudios }, wrapped)
  return { dir, meta, calls }
}

describe('exportArticle: 音频', () => {
  it('落盘(默认下载):audios/audio-1.mp3,内容为字节', async () => {
    const { dir } = await run(['md', 'meta'])
    const p = join(dir, 'audios', 'audio-1.mp3')
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p).toString()).toBe('MP3BYTESxxxx')
  })

  it('md 给可点链接,附时长', async () => {
    const { dir } = await run(['md'])
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('(audios/audio-1.mp3)')
    expect(md).toContain('0:30')
  })

  it('html 给内联 <audio>(无脚本,阅读器 iframe 可播)', async () => {
    const { dir } = await run(['html'])
    const html = readFileSync(join(dir, 'index.html'), 'utf-8')
    expect(html).toContain('<audio controls')
    expect(html).toContain('src="audios/audio-1.mp3"')
  })

  it('meta.json 记 voiceId/标题/时长/路径,不存 url', async () => {
    const { dir } = await run(['meta'])
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    expect(meta.audios).toHaveLength(1)
    expect(meta.audios[0]).toMatchObject({ voiceId: AUDIO.voiceId, title: 'U1 Wrapping Up', durationMs: 30000, path: 'audios/audio-1.mp3' })
    expect(JSON.stringify(meta)).not.toContain('getvoice')
  })

  it('下载失败:正文两处写明,告警上报,文章照常完成', async () => {
    const { dir, meta } = await run(['md', 'meta'], {
      fetchBinary: async () => { throw new Error('net down') },
    })
    expect(existsSync(join(dir, 'audios'))).toBe(true)
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('下载失败')
    expect(meta.warnings?.join('')).toContain('下载失败')
  })

  it('关闭下载:不发请求,只留说明,记录无路径', async () => {
    const { dir, meta, calls } = await run(['md', 'meta'], { downloadAudios: false })
    expect(existsSync(join(dir, 'audios'))).toBe(false)
    expect(calls.filter((u) => u.includes('getvoice'))).toHaveLength(0)
    // 记录保留身份(标题/时长)供展示,但无 path(未落盘)——与视频关闭分支同规
    expect(meta.audios).toHaveLength(1)
    expect(meta.audios?.[0].path).toBeUndefined()
    const md = readFileSync(join(dir, 'content.md'), 'utf-8')
    expect(md).toContain('未下载')
  })
})
