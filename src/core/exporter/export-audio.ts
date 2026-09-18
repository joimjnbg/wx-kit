// src/core/exporter/export-audio.ts
// 微信文章内嵌语音落盘。对标 export-video.ts:串行,不并发;没选/失败都不静默丢弃。
// 音频文件百 KB 量级,超时沿图片档 30s(见 FETCH_TIMEOUT_MS),不按视频体积算。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MpAudioSource } from '../parse-audio'
import { formatDuration } from './export-video'
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
  /** 追加到 html 正文的片段(可播 <audio> 或说明);无音频时空串 */
  htmlSuffix: string
  /** 追加到 markdown 的片段(可点链接或说明);turndown 不认识 <audio>,必须分开给 */
  mdSuffix: string
  /** 音频下载失败只记 warning(其余格式照常产出),致命错误直接抛 */
  warnings: string[]
}

/**
 * 逐条下载语音。`download=false` 时不发任何请求,只产出说明——用户仍然知道「这里有音频」。
 */
export async function downloadAudios(
  audios: MpAudioSource[],
  dir: string,
  download: boolean,
  fetchBinary: (url: string, timeoutMs?: number) => Promise<{ data: Buffer; contentType: string }>,
  onProgress?: (e: { index: number; total: number; audio: MpAudioSource }) => void,
): Promise<DownloadAudiosResult> {
  if (!audios.length) return { records: [], htmlSuffix: '', mdSuffix: '', warnings: [] }

  const records: AudioRecord[] = audios.map((a) => ({
    voiceId: a.voiceId, title: a.title, durationMs: a.durationMs,
  }))
  const spec = (a: MpAudioSource) => `${a.title}, ${formatDuration(a.durationMs)}`

  if (!download) {
    // 不静默丢弃:说清有几条、多长、怎么才能拿到
    const note = `🔊 本文含 ${audios.length} 条语音（未下载；${audios.map(spec).join('；')}）。打开「文中音频」后重新下载即可保存。`
    return { records, htmlSuffix: `<p>${note}</p>`, mdSuffix: note, warnings: [] }
  }

  await mkdir(join(dir, 'audios'), { recursive: true })
  const htmlParts: string[] = []
  const mdParts: string[] = []
  const warnings: string[] = []
  for (let i = 0; i < audios.length; i++) {
    const a = audios[i]
    const rel = `audios/audio-${i + 1}.mp3`
    onProgress?.({ index: i + 1, total: audios.length, audio: a })
    try {
      const { data } = await fetchBinary(a.url)
      await writeFile(join(dir, rel), data)
      records[i].path = rel
      // <audio> 不依赖脚本,阅读器的 iframe(sandbox 无 allow-scripts)里也能播
      htmlParts.push(`<p><audio controls preload="metadata" src="${rel}"></audio></p>`)
      mdParts.push(`[🔊 语音 ${i + 1}（${a.title}, ${formatDuration(a.durationMs)}）](${rel})`)
    } catch (e) {
      if (globalRequestStopCode(e)) throw e
      // 音频失败不该拖垮整篇(其余格式已写好),但必须说出来——两处正文都写,并上报告警
      const why = (e as Error).message
      const note = `🔊 语音 ${i + 1} 下载失败（${spec(a)}）：${why}`
      htmlParts.push(`<p>${note}</p>`)
      mdParts.push(note)
      warnings.push(note)
    }
  }
  return { records, htmlSuffix: htmlParts.join('\n'), mdSuffix: mdParts.join('\n\n'), warnings }
}
