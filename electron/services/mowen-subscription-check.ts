// electron/services/mowen-subscription-check.ts
// 墨问订阅检查编排（M63）。对齐 subscription-check.ts 的依赖注入模式：无 electron 运行时，
// GUI 与 CLI 共用，可单测。失败保留失败类型（宪法）：单作者失败归集该作者名下、水位不动；
// mocli 不可用如实 mocli-missing，不得伪装「无新笔记」。检查深度固定 count=20，全量比对
// （真机实证 note_ids 非严格 publicAt 倒序，「遇旧提前停」不安全——2026-09-13）。
import { listUserNotes } from '../../src/core/mowen/metadata'
import { MowenNoteUnavailable } from '../../src/core/mowen/errors'
import type { MocliRunner } from '../../src/core/mowen/types'
import type { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { diffNewNotes, mergeNewNotes } from '../../src/core/mowen/subscription'
import type { CheckLogEntry, CheckFailure } from '../../src/core/subscriptions'
import type { DownloadItemResult } from '../../src/core/types'
import type { AppSettings } from './settings'

const CHECK_COUNT = 20

export interface MowenCheckDeps {
  subs: MowenSubscriptions
  /** null = mocli 不可用（未装/检测失败）→ mocli-missing 早退，不伪装「无新笔记」 */
  runner: MocliRunner | null
  /** 与微信共用的检查日志通道（ipc.ts 组装，写 checkLog 数组 + 行日志文件） */
  log: (entry: CheckLogEntry) => Promise<void>
  settings: Pick<AppSettings, 'subscriptionNewArticleAction' | 'defaultFormats'>
  /** 单篇下载注入点：调用方组装 downloadMowenNote（含 library 判重/图片本地化全链路） */
  downloadNote: (noteId: string) => Promise<DownloadItemResult>
  /** 注入点，缺省真实现 */
  listUserNotes?: typeof listUserNotes
  /** 行内单作者检查：只查这些 uid（缺省全量）。 */
  uids?: string[]
}

export interface MowenPerAuthorResult {
  uid: string; name: string; ok: boolean
  newFound: number; downloaded: number; existed: number; unavailable: number
  error?: string
  /** 非失败注记：如「N 篇缺少发布时间未参与水位比对」 */
  warn?: string
}
export interface MowenCheckResult {
  authors: number; newFound: number; failed: number
  note?: 'mocli-missing' | 'no-authors'
  results: MowenPerAuthorResult[]
}

export async function runMowenSubscriptionCheck(trigger: 'auto' | 'manual', deps: MowenCheckDeps): Promise<MowenCheckResult> {
  const list = deps.listUserNotes ?? listUserNotes
  const now = Date.now()
  const baseLog = { trigger, platform: 'mowen' as const, time: now }
  const authors = (await deps.subs.list()).filter((a) => a.subscribed)
    .filter((a) => (deps.uids ? deps.uids.includes(a.uid) : true))

  if (!authors.length) {
    await deps.log({ ...baseLog, accounts: 0, newFound: 0, failed: 0, note: 'no-authors' })
    return { authors: 0, newFound: 0, failed: 0, note: 'no-authors', results: [] }
  }
  if (!deps.runner) {
    // mocli 缺失 = 该平台本轮检查全部失败；水位一律不动；失败明细进日志（检查记录可见）
    const failures: CheckFailure[] = authors.map((a) => ({ nickname: a.name, error: '未检测到 mocli' }))
    await deps.log({ ...baseLog, accounts: authors.length, newFound: 0, failed: authors.length, failures })
    return {
      authors: authors.length, newFound: 0, failed: authors.length, note: 'mocli-missing',
      results: authors.map((a) => ({ uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error: '未检测到 mocli' })),
    }
  }

  let newFound = 0, failed = 0
  const failures: CheckFailure[] = []
  const results: MowenPerAuthorResult[] = []
  // 平台级防重入时刻：与微信 lastRunAt 同思路，scheduler 据此跳过重复触发
  await deps.subs.setLastRunAt(now)
  for (const a of authors) {
    try {
      const items = await list(deps.runner, a.uid, { count: CHECK_COUNT })
      const { fresh, undated } = diffNewNotes(items, a.watermark)
      // 本地合并拿「全量 pending 集」：新发现 + 上轮遗留 pending（如上次下载失败）一并按策略交付
      const merged = mergeNewNotes(a.newNotes, fresh)
      await deps.subs.appendNewNotes(a.uid, fresh.map((f) => ({ noteId: f.noteId, title: f.title, publicAt: f.publicAt, url: f.url, status: 'pending' as const })))
      // 水位推进 = 本轮见到的最大 publicAt（与已有水位取大）；检查成功才走到这里
      const maxPublicAt = items.reduce<number>((m, it) => (it.publicAt != null && it.publicAt > m ? it.publicAt : m), a.watermark)
      await deps.subs.updateWatermark(a.uid, maxPublicAt)
      await deps.subs.setLastCheckedAt(a.uid, Date.now())

      let downloaded = 0, existed = 0, unavailable = 0
      const pending = merged.filter((n) => n.status === 'pending')
      if (deps.settings.subscriptionNewArticleAction === 'download' && pending.length) {
        for (const n of pending) {
          try {
            const r = await deps.downloadNote(n.noteId)
            if (r.skipped) existed++; else downloaded++
            await deps.subs.setNoteStatus(a.uid, [n.noteId], 'downloaded')
          } catch (e) {
            if (e instanceof MowenNoteUnavailable) unavailable++   // 付费/不可见：保持 pending，用户可挑可重试
            else throw e
          }
        }
      }
      newFound += pending.length
      results.push({
        uid: a.uid, name: a.name, ok: true, newFound: pending.length, downloaded, existed, unavailable,
        ...(undated.length ? { warn: `${undated.length} 篇笔记缺少发布时间，未参与水位比对` } : undefined),
      })
    } catch (e) {
      failed++
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ nickname: a.name, error })
      results.push({ uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error })
    }
  }
  await deps.log({
    ...baseLog, accounts: authors.length, newFound, failed,
    ...(failures.length ? { failures } : {}),
  })
  return { authors: authors.length, newFound, failed, results }
}
