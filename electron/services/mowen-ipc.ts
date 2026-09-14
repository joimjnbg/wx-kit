// electron/services/mowen-ipc.ts
// 墨问作者订阅 IPC（M63）。独立注册器（对齐 mowen-detect.ts 模式），ipc.ts 一行调用。
// 订阅决策抽成 subscribeAuthor（注入式，可单测）；handler 是一行委派。
// 检查日志与微信共用同一通道（logCheck 由 ipc.ts 适配注入，platform:'mowen' 由编排写入）。
import { ipcMain } from 'electron'
import { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { runMowenSubscriptionCheck, type MowenCheckResult } from './mowen-subscription-check'
import { searchUsers } from '../../src/core/mowen/metadata'
import { mowenRunnerOrNull } from './mowen-detect'
import { mergeCheckDetailItems } from '../../src/core/subscription-batch'
import type { MocliRunner, MowenUser } from '../../src/core/mowen/types'
import type { CheckLogEntry, DownloadItemLog } from '../../src/core/subscriptions'
import type { DownloadFormat, DownloadItemResult } from '../../src/core/types'
import type { SettingsService } from './settings'

type AddResult =
  | { ok: true; authors?: MowenUser[]; subscribed?: { uid: string; name: string; intro: string } }
  | { ok: false; error: { code: string; message: string } }

/** 订阅决策：只带 keyword → 搜索返回候选（含简介，零额外请求）；带 uid → 校验候选后订阅。
 *  watermark = 订阅时刻（不回补历史，PRD R4 交互约定）；重复订阅幂等报 ALREADY_SUBSCRIBED。 */
export async function subscribeAuthor(
  runner: MocliRunner,
  subs: MowenSubscriptions,
  keyword: string,
  uid?: string,
): Promise<AddResult> {
  const kw = keyword.trim()
  if (!kw) return { ok: false, error: { code: 'VALIDATE', message: '请输入作者名字' } }
  const users = await searchUsers(runner, kw)
  if (!uid) return { ok: true, authors: users }
  const u = users.find((x) => x.uid === uid)
  if (!u) return { ok: false, error: { code: 'NOT_FOUND', message: '候选列表中没有该作者，请重新搜索确认' } }
  if (await subs.hasAuthor(uid)) return { ok: false, error: { code: 'ALREADY_SUBSCRIBED', message: '该作者已在订阅列表' } }
  await subs.addAuthor({ uid: u.uid, name: u.name, intro: u.intro, watermark: Math.floor(Date.now() / 1000) })
  return { ok: true, subscribed: { uid: u.uid, name: u.name, intro: u.intro } }
}

export interface MowenSubsIpcDeps {
  settings: SettingsService
  /** 与微信共用的检查日志通道（ipc.ts 适配：写 subscriptions.json 的 checkLog + 行日志文件） */
  logCheck: (entry: CheckLogEntry) => Promise<void>
  /** 就地更新最近一条检查明细（共用微信 subscriptions.json 的 checkLog；M58 同规） */
  mutateLatestCheckDetail: (uid: string, fn: (items: DownloadItemLog[]) => DownloadItemLog[]) => Promise<boolean>
  /** 单篇下载（ipc.ts 组装完整 downloadMowenNote 通道：library 判重/图片本地化/offscreen PDF） */
  downloadNote: (noteId: string, formats: DownloadFormat[]) => Promise<DownloadItemResult>
  broadcast: (channel: string) => void
}

export function registerMowenSubscriptionIpc(deps: MowenSubsIpcDeps): void {
  const subsOf = async () => new MowenSubscriptions((await deps.settings.get()).libraryRoot)
  const formatsOf = async () => (await deps.settings.get()).defaultFormats
  const broadcastUpdated = () => deps.broadcast('mowen-subs:updated')
  const checkNow = async (uids?: string[]): Promise<MowenCheckResult> => {
    const [subs, runner, settings] = await Promise.all([subsOf(), mowenRunnerOrNull(), deps.settings.get()])
    const result = await runMowenSubscriptionCheck('manual', {
      subs, runner,
      log: deps.logCheck,
      settings: { subscriptionNewArticleAction: settings.subscriptionNewArticleAction, defaultFormats: settings.defaultFormats },
      downloadNote: (noteId) => deps.downloadNote(noteId, settings.defaultFormats),
      ...(uids?.length ? { uids } : {}),
    })
    broadcastUpdated()
    return result
  }

  ipcMain.handle('mowen-subs:list', async () => {
    const subs = await subsOf()
    return { authors: await subs.list(), lastRunAt: await subs.getLastRunAt() }
  })

  ipcMain.handle('mowen-subs:add', async (_e, keyword: string, uid?: string) => {
    const runner = await mowenRunnerOrNull()
    if (!runner) return { ok: false as const, error: { code: 'MOCLI_NOT_FOUND', message: '未检测到 mocli，请到设置页查看安装指引' } }
    const r = await subscribeAuthor(runner, await subsOf(), keyword, uid)
    if (r.ok && r.subscribed) broadcastUpdated()
    return r
  })

  ipcMain.handle('mowen-subs:remove', async (_e, uid: string) => {
    await (await subsOf()).removeAuthor(uid)
    broadcastUpdated()
  })

  // 订阅开关（对齐微信「取消订阅不是删除」）：off 暂停检查、数据与检查状态保留
  ipcMain.handle('mowen-subs:setSubscribed', async (_e, uid: string, subscribed: boolean) => {
    await (await subsOf()).setSubscribed(uid, subscribed)
    broadcastUpdated()
  })

  ipcMain.handle('mowen-subs:checkNow', (_e, uids?: string[]) => checkNow(uids))

  ipcMain.handle('mowen-subs:downloadNotes', async (_e, uid: string, noteIds: string[]) => {
    const subs = await subsOf()
    const formats = await formatsOf()
    // 回填「本轮检查明细」要带标题：从 newNotes 取（明细条目按 url 合并、title 随结果态更新）
    const author = (await subs.list()).find((a) => a.uid === uid)
    const titleOf = (id: string) => author?.newNotes.find((n) => n.noteId === id)?.title ?? '(无标题)'
    let downloaded = 0, existed = 0, failed = 0
    const resultItems: DownloadItemLog[] = []
    for (const noteId of noteIds) {
      const url = author?.newNotes.find((n) => n.noteId === noteId)?.url
      try {
        const r = await deps.downloadNote(noteId, formats)
        if (r.skipped) existed++; else downloaded++
        await subs.setNoteStatus(uid, [noteId], 'downloaded')
        resultItems.push({ title: titleOf(noteId), status: r.skipped ? 'exists' : 'downloaded', ...(r.id ? { articleId: r.id } : {}), ...(url ? { url } : {}), refId: noteId })
      } catch (e) {
        // 失败保留 pending 状态，行内可重试；明细如实落 failed
        failed++
        resultItems.push({ title: titleOf(noteId), status: 'failed', error: e instanceof Error ? e.message : String(e), ...(url ? { url } : {}), refId: noteId })
      }
    }
    // M58 同规：把本次结果回填进「本轮检查明细」——行内 pending 就地变为结果态（已下载/文库已有）
    await deps.mutateLatestCheckDetail(uid, (cur) => mergeCheckDetailItems(cur, resultItems))
    broadcastUpdated()
    return { downloaded, existed, failed }
  })

  ipcMain.handle('mowen-subs:dismissNotes', async (_e, uid: string, noteIds: string[]) => {
    await (await subsOf()).setNoteStatus(uid, noteIds, 'ignored')
    broadcastUpdated()
  })
}
