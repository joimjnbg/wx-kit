// src/core/exporter/export-audio.ts
// 微信文章内嵌语音落盘。对标 export-video 的失败语义(不静默丢弃),但引用方式不同:
// 音频是正文流的一部分 —— 下载后在 contentHtml 原位把 <mp-common-mpaudio> 换成
// <audio> 播放器(或失败说明),md 经 turndown 自然得到"链接文字一致"的可点链接,
// 无需文末追加。文件名取语音标题 sanitize(链接上写什么,文件就叫什么),重名加 -2/-3。
// 音频文件百 KB 量级,超时沿图片档 30s(见 FETCH_TIMEOUT_MS),不按视频体积算。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { MpAudioSource } from '../parse-audio'
import { sanitizeName } from '../paths'
import { FETCH_TIMEOUT_MS } from '../fetch-html'
import { globalRequestStopCode } from '../mp-errors'

/** meta.json 里的语音记录。**不存 url**——getvoice 302 filekey 短窗有效,存了也用不了。 */
export interface AudioRecord {
  voiceId: string
  title: string
  durationMs: number
  /** 库内相对路径;未下载(没选 audio)或下载失败时缺省 */
  path?: string
}

export interface DownloadAudiosResult {
  records: AudioRecord[]
  /** 回填后的正文 HTML(播放器/说明已在原位,无音频时原样返回) */
  contentHtml: string
  /** 音频相关的告警(失败原因),供上层上报——失败不该只躺在文件里 */
  warnings: string[]
}

/** 标题命名:sanitize 后重名加后缀(audios/ 下唯一)。返回 rel 路径。 */
export function audioRelPath(title: string, taken: Set<string>): string {
  const base = `audios/${sanitizeName(title) || 'untitled'}`
  if (!taken.has(`${base}.mp3`)) {
    taken.add(`${base}.mp3`)
    return `${base}.mp3`
  }
  let i = 2
  while (taken.has(`${base}-${i}.mp3`)) i++
  taken.add(`${base}-${i}.mp3`)
  return `${base}-${i}.mp3`
}

/**
 * 逐条下载语音并在正文原位回填。`download=false` 时不发任何请求,
 * 仅把原位播放器换成"(未下载)"说明——用户仍然知道「这里有音频」。
 */
export async function downloadAudios(
  audios: MpAudioSource[],
  contentHtml: string,
  dir: string,
  download: boolean,
  fetchBinary: (url: string, timeoutMs?: number) => Promise<{ data: Buffer; contentType: string }>,
  onProgress?: (e: { index: number; total: number; audio: MpAudioSource }) => void,
): Promise<DownloadAudiosResult> {
  const records: AudioRecord[] = audios.map((a) => ({
    voiceId: a.voiceId, title: a.title, durationMs: a.durationMs,
  }))
  if (!audios.length) return { records, contentHtml, warnings: [] }

  const $ = cheerio.load(contentHtml, null, false)
  const tags = $('mp-common-mpaudio').toArray()
  // 按 voiceId 配对(不可播元素仍在正文中占位,按序配对会错位)
  const byId = new Map(audios.map((a) => [a.voiceId, a]))
  const byRecord = new Map(records.map((r) => [r.voiceId, r]))
  const voiceIdOf = (el: { attribs?: Record<string, string | undefined> }): string | undefined => {
    const raw = (el.attribs?.['voice_encode_fileid'] ?? '').trim()
    const norm = raw.replace(/&amp;/g, '&').replace(/&#61;/g, '=').trim()
    return norm || undefined
  }
  const taken = new Set<string>()
  const warnings: string[] = []

  if (!download) {
    tags.forEach((el) => {
      const id = voiceIdOf(el)
      const a = id ? byId.get(id) : undefined
      const label = a ? `${a.title}（未下载,打开「文中音频」后重新下载即可保存）` : '语音（未下载）'
      $(el).replaceWith(`<p>🔊 ${label}</p>`)
    })
    return { records, contentHtml: $.html(), warnings }
  }

  await mkdir(join(dir, 'audios'), { recursive: true })
  let done = 0
  for (const el of tags) {
    const id = voiceIdOf(el)
    const a = id ? byId.get(id) : undefined
    if (!a) continue
    const rel = audioRelPath(a.title, taken)
    onProgress?.({ index: ++done, total: audios.length, audio: a })
    try {
      // 音频百 KB 量级,超时沿图片档 30s(视频按体积算不适用)
      const { data } = await fetchBinary(a.url, FETCH_TIMEOUT_MS)
      await writeFile(join(dir, rel), data)
      byRecord.get(a.voiceId)!.path = rel
      // <audio> 不依赖脚本,阅读器的 iframe(sandbox 无 allow-scripts)里也能播;
      // data-title 供 turndown 规则产出"链接文字一致"的 md 链接
      $(el).replaceWith(`<p><audio controls preload="metadata" src="${rel}" data-title="${a.title.replace(/"/g, '&quot;')}"></audio></p>`)
    } catch (e) {
      if (globalRequestStopCode(e)) throw e
      // 音频失败不该拖垮整篇(其余格式已写好),但必须说出来——原位写,并上报告警
      const why = (e as Error).message
      const note = `🔊 ${a.title} 下载失败：${why}`
      $(el).replaceWith(`<p>${note}</p>`)
      warnings.push(note)
    }
  }
  return { records, contentHtml: $.html(), warnings }
}
