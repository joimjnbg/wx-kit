// src/core/mowen/subscription.ts
// 墨问作者订阅存储（库根下 mowen-subscriptions.json）+ 水位/合并纯函数（M63）。
// 与微信 subscriptions.json 分文件——schema 语义不同：fakeid/createTime 水位 vs uid/publicAt 水位。
// 读写模式照抄 ../subscriptions.ts（path-lock + atomic-write；损坏文件如实抛错不静默清空）。
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { withPathLock } from '../path-lock'
import type { MowenNoteListItem } from './types'
import type { CheckLogEntry } from '../subscriptions'

export interface MowenNoteRef {
  noteId: string
  title: string
  publicAt: number | null   // unix 秒；homepage 真机为数字，个别条目可能缺失
  url: string
  status: 'pending' | 'downloaded' | 'ignored'   // 状态语义对齐微信 ArticleRef（M40）
}

export interface MowenSubscribedAuthor {
  uid: string
  name: string
  intro: string             // 订阅时快照（作者改名/改简介不追溯）
  subscribed: boolean
  watermark: number         // unix 秒；publicAt > watermark 即「新」
  lastCheckedAt: number | null  // unix ms
  /** 平台级防重入（scheduler tick 用）：上次检查发起时刻，unix ms。 */
  lastRunAt: number | null
  newNotes: MowenNoteRef[]
}

interface Store {
  authors: MowenSubscribedAuthor[]
  /** 墨问自己的检查日志（v0.11.0 修正：此前与微信共用 subscriptions.json 的 checkLog——
   *  两平台调度结构性同时触发（共用设置+同 slot+同抖动种子），共享写路径的并发窗口是天生的
   *  设计缺陷，且数据归属混乱。独立文件后写路径分离，窗口消失。keep 50 与微信一致。 */
  checkLog?: CheckLogEntry[]
}

/** 水位比对：publicAt > watermark 判新。真机实证 note_ids 非严格时间序（2026-09-13 池建强
 *  主页第 2 条比第 1 条新），必须全量过滤、不得「遇旧提前停」。publicAt null 无法比对 →
 *  undated，不算新也不算失败（数量由编排注记）。 */
export function diffNewNotes(items: MowenNoteListItem[], watermark: number): { fresh: MowenNoteListItem[]; undated: MowenNoteListItem[] } {
  const fresh: MowenNoteListItem[] = []
  const undated: MowenNoteListItem[] = []
  for (const it of items) {
    if (it.publicAt == null) undated.push(it)
    else if (it.publicAt > watermark) fresh.push(it)
  }
  return { fresh, undated }
}

const byPublicAtDesc = (a: MowenNoteRef, b: MowenNoteRef): number => (b.publicAt ?? 0) - (a.publicAt ?? 0)

/** 合并新笔记：按 noteId 去重；已有条目（含其 status）原样保留——已下载/已忽略不被下次
 *  检查重置；新条目 status='pending'。输出按 publicAt 降序（null 殿后）。 */
export function mergeNewNotes(existing: MowenNoteRef[], fresh: MowenNoteListItem[]): MowenNoteRef[] {
  const byId = new Map(existing.map((n) => [n.noteId, n] as const))
  for (const it of fresh) {
    if (byId.has(it.noteId)) continue
    byId.set(it.noteId, { noteId: it.noteId, title: it.title, publicAt: it.publicAt, url: it.url, status: 'pending' })
  }
  return [...byId.values()].sort(byPublicAtDesc)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/**
 * 一次性迁移：把微信 subscriptions.json 的 checkLog 里 platform=mowen 的历史条目搬到
 * 本文件（并从微信文件剔除）。幂等：已存在的同 time 条目跳过；跨进程双跑最坏是各自搬完
 * 互不重复。旧版 GUI 写下的墨问检查记录由此归位。
 */
export async function migrateMowenCheckLog(wechatPath: string, mowen: MowenSubscriptions): Promise<number> {
  const { readFile: rf } = await import('node:fs/promises')
  let wechat: { checkLog?: CheckLogEntry[] } & Record<string, unknown>
  try {
    wechat = JSON.parse(await rf(wechatPath, 'utf8'))
  } catch {
    return 0   // 微信文件不存在/损坏：无可迁移，不动它
  }
  const all = Array.isArray(wechat.checkLog) ? wechat.checkLog : []
  const mowenEntries = all.filter((e) => (e as CheckLogEntry).platform === 'mowen')
  if (!mowenEntries.length) return 0
  const existing = new Set((await mowen.getCheckLog()).map((e) => e.time))
  const toMove = mowenEntries.filter((e) => !existing.has(e.time))
  if (toMove.length) await mowen.appendCheckRaw(toMove)
  // 从微信文件剔除已归属墨问的条目（含此前已迁过的——剔除幂等）
  const { mkdir: mkd } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const next = { ...wechat, checkLog: all.filter((e) => (e as CheckLogEntry).platform !== 'mowen') }
  await mkd(dirname(wechatPath), { recursive: true })
  await atomicWriteFile(wechatPath, JSON.stringify(next, null, 2))
  return toMove.length
}

export class MowenSubscriptions {
  private path: string
  constructor(private root: string) { this.path = join(root, 'mowen-subscriptions.json') }

  private async read(): Promise<Store> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { authors: [] }
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`mowen subscriptions file is corrupt at ${this.path} — delete it to reset`)
    }
    return {
      authors: isObj(parsed) && Array.isArray(parsed.authors) ? (parsed.authors as MowenSubscribedAuthor[]) : [],
      checkLog: isObj(parsed) && Array.isArray(parsed.checkLog) ? (parsed.checkLog as CheckLogEntry[]) : [],
    }
  }

  private async mutate(fn: (d: Store) => void): Promise<void> {
    await withPathLock(this.path, async () => {
      const d = await this.read()
      fn(d)
      await mkdir(this.root, { recursive: true })
      await atomicWriteFile(this.path, JSON.stringify(d, null, 2))
    })
  }

  async list(): Promise<MowenSubscribedAuthor[]> { return (await this.read()).authors }
  async hasAuthor(uid: string): Promise<boolean> { return (await this.read()).authors.some((a) => a.uid === uid) }
  async getLastRunAt(): Promise<number | null> { return (await this.read()).authors[0]?.lastRunAt ?? null }

  async addAuthor(a: { uid: string; name: string; intro: string; watermark: number }): Promise<void> {
    await this.mutate((d) => {
      if (d.authors.some((x) => x.uid === a.uid)) return   // 幂等：重复订阅不入库
      d.authors.push({ ...a, subscribed: true, lastCheckedAt: null, lastRunAt: null, newNotes: [] })
    })
  }
  async removeAuthor(uid: string): Promise<void> { await this.mutate((d) => { d.authors = d.authors.filter((x) => x.uid !== uid) }) }
  async setSubscribed(uid: string, subscribed: boolean): Promise<void> {
    await this.mutate((d) => { const a = d.authors.find((x) => x.uid === uid); if (a) a.subscribed = subscribed })
  }
  async updateWatermark(uid: string, watermark: number): Promise<void> {
    await this.mutate((d) => { const a = d.authors.find((x) => x.uid === uid); if (a) a.watermark = watermark })
  }
  async appendNewNotes(uid: string, notes: MowenNoteRef[]): Promise<void> {
    await this.mutate((d) => {
      const a = d.authors.find((x) => x.uid === uid); if (!a) return
      const byId = new Map(a.newNotes.map((n) => [n.noteId, n] as const))
      for (const n of notes) {
        if (byId.has(n.noteId)) continue
        byId.set(n.noteId, n)
      }
      a.newNotes = [...byId.values()].sort(byPublicAtDesc)
    })
  }
  async setNoteStatus(uid: string, noteIds: string[], status: 'downloaded' | 'ignored'): Promise<void> {
    await this.mutate((d) => {
      const a = d.authors.find((x) => x.uid === uid); if (!a) return
      const ids = new Set(noteIds)
      for (const n of a.newNotes) if (ids.has(n.noteId)) n.status = status
    })
  }
  async setLastCheckedAt(uid: string, t: number): Promise<void> {
    await this.mutate((d) => { const a = d.authors.find((x) => x.uid === uid); if (a) a.lastCheckedAt = t })
  }
  async setLastRunAt(t: number): Promise<void> { await this.mutate((d) => { for (const a of d.authors) a.lastRunAt = t }) }

  /** 检查日志读写（自己的文件）。条目按 time 去重——迁移幂等 + 跨进程双跑不重复。 */
  async getCheckLog(): Promise<CheckLogEntry[]> { return (await this.read()).checkLog ?? [] }
  async appendCheckLog(entry: CheckLogEntry, keep = 50): Promise<void> {
    await this.mutate((d) => {
      const log = d.checkLog ?? []
      if (!log.some((e) => e.time === entry.time && e.platform === entry.platform)) {
        d.checkLog = [entry, ...log].slice(0, keep)
      }
    })
  }
  /** 迁移用：批量并入历史条目（新在前，keep 50）。 */
  async appendCheckRaw(entries: CheckLogEntry[], keep = 50): Promise<void> {
    await this.mutate((d) => {
      const existing = new Set((d.checkLog ?? []).map((e) => e.time))
      const add = entries.filter((e) => !existing.has(e.time))
      d.checkLog = [...add.reverse(), ...(d.checkLog ?? [])].slice(0, keep)
    })
  }

  /** 就地更新最近一条含该作者的检查明细（微信 M58 同规；行内明细的补下载回填）。 */
  async mutateLatestCheckDetail(
    uid: string,
    fn: (items: CheckLogEntry['downloadDetail'] extends (infer T)[] | undefined ? T extends { items: infer I } ? I : never : never) => unknown,
  ): Promise<boolean> {
    let hit = false
    await this.mutate((d) => {
      for (const entry of d.checkLog ?? []) {
        const target = entry.downloadDetail?.find((x) => x.fakeid === uid)
        if (!target) continue
        target.items = fn(target.items) as typeof target.items
        hit = true
        break
      }
    })
    return hit
  }
}
