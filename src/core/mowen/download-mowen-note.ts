// src/core/mowen/download-mowen-note.ts
// 墨问笔记下载闭环（M61）：note/show → 适配 → exporter 复用 → library 入库。
// 主键 mowen_<uuid>（确定性、可读，与微信 mid_idx / h_hash 主键空间天然隔离——不走 articleId，
// 它对 mowen URL 只能算出不可读哈希）。
// 合集：引用块无条件渲染（mowen-to-article）；递归下载是显式开关（expandRefs，深度上限 3，
// 付费子笔记 unavailable 如实进 refResults，不阻塞父级）。
// v0.11.2 R1：引用子笔记元信息（标题/摘要/作者）随父笔记拉取进卡片——正文 <note uuid> 原地
// 替换（原生标签不带标题，与 <img uuid> 同模式，真机钉死）；元信息与 expandRefs 子下载共享
// 同一轮 note/show（showCache，同一 uuid 全程只发一次请求）；失败保留失败类型（paid/failed
// 卡如实标注，不伪装成功、不阻塞父笔记）。限速 0.5s/篇补课：PRD-v0.11.0 钉死「写死 core 层」
// 但此前从未实现（GUI/CLI 均裸调），本版收口在 fetchShowCached 单点。
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { DownloadFormat, DownloadItemResult } from '../types'
import type { DownloadArticleDeps } from '../download-article'
import { extractMowenNoteId, normalizeMowenUrl } from './url'
import { fetchNoteShow, type NoteShowResult, type NoteShowDeps } from './note-show'
import { MowenNoteUnavailable } from './errors'
import { noteShowToParsedArticle, type RefNoteMeta } from './mowen-to-article'
import { articleDirName, dedupeDirName, sanitizeName } from '../paths'
import { exportArticle } from '../exporter'

const REF_DEPTH_LIMIT = 3

export interface MowenDownloadDeps extends Omit<DownloadArticleDeps, 'fetchHtml'> {
  /** 注入点：缺省用真 fetchNoteShow（含限速由调用方决定是否包） */
  fetchNoteShow?: (uuid: string) => Promise<NoteShowResult>
  /** 递归展开引用子笔记（GUI 子勾选 / CLI --expand-refs） */
  expandRefs?: boolean
  /** note/show 结果缓存（uuid → show）：父/元信息/子下载共享，同一 uuid 只发一次请求。
   *  调用方不传则内部惰性建（同一次批量下载传同一 deps 即共享）。 */
  showCache?: Map<string, NoteShowResult>
  /** 真实请求最小间隔毫秒（默认 500，PRD-v0.11.0「0.5s/篇写死 core 层」契约补课；测试传 0 跳过）。
   *  注意闸是**模块级共享**的（见下方 lastNoteShowAt），不是 per-deps。 */
  minIntervalMs?: number
}

export interface RefDownloadRecord { uuid: string; ok: boolean; skipped?: boolean; unavailable?: boolean; title?: string }

/** note/show 请求节流闸——模块级共享，跨调用生效。
 *
 *  PRD-v0.11.0 的契约是「笔记间隔 0.5s」，按**篇**计，也就是跨调用也要成立。
 *  M64 初版把闸挂在 deps 实例上（WeakMap），但 GUI 与 CLI 的调用方都是**每篇 URL
 *  新建 deps 字面量**：GUI `ipc.ts` 的 queue mapper 写 `{...deps, onVideoProgress}`、
 *  CLI `mowen import` 的 mapper 写内联对象字面量——per-deps 闸于是在每篇开头重置，
 *  跨篇间隔形同虚设（单次调用内的请求间隔倒是有保障，所以当初单测没暴露）。
 *  上提为模块级后，同进程内所有墨问 note/show 请求共用一个闸；GUI 手动连点两篇也会
 *  隔 500ms，这正是「温和请求保通道」要的语义。
 *  并发进入的请求靠调用方串行队列（DownloadQueue）保证先后；这里只做时间戳节流，不排队。 */
let lastNoteShowAt = 0

/** 带缓存与限速的 note/show 唯一网络入口：父笔记、引用元信息、expandRefs 子下载全走这里。 */
async function fetchShowCached(uuid: string, deps: MowenDownloadDeps): Promise<NoteShowResult> {
  const cache = deps.showCache ?? (deps.showCache = new Map())
  const hit = cache.get(uuid)
  if (hit) return hit
  const min = deps.minIntervalMs ?? 500
  if (min > 0) {
    const wait = lastNoteShowAt + min - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastNoteShowAt = Date.now()
  }
  const show = deps.fetchNoteShow
    ? await deps.fetchNoteShow(uuid)
    : await fetchNoteShow(uuid, { fetchJson: defaultFetchJson })
  cache.set(uuid, show)   // 失败不缓存：付费/异常的下次尝试语义不变
  return show
}

/** 引用子笔记元信息：逐条拉取（限速在 fetchShowCached 内），失败分类不伪装、不阻塞。
 *  MowenNoteUnavailable → paid（服务端连标题都不返回，真机钉死）；其他异常 → failed + warning。 */
async function fetchRefMetas(refNoteIds: string[], deps: MowenDownloadDeps): Promise<Map<string, RefNoteMeta>> {
  const metas = new Map<string, RefNoteMeta>()
  for (const uuid of refNoteIds) {
    try {
      const s = await fetchShowCached(uuid, deps)
      metas.set(uuid, {
        uuid, title: s.title, digest: s.digest, authorName: s.authorName,
        publicAt: s.publicAt, state: 'ok',
      })
    } catch (e) {
      if (e instanceof MowenNoteUnavailable) {
        metas.set(uuid, { uuid, state: 'paid' })
      } else {
        metas.set(uuid, { uuid, state: 'failed' })
        deps.onWarning?.(`引用笔记 ${uuid.slice(0, 8)} 元信息获取失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  return metas
}

/** 合集递归（显式开关）：子笔记走同一条下载路径，判重/限速/unavailable 天然复用。
 *  返回 undefined = 没有可展开的引用（或已达深度上限）。
 *  v0.11.0：此前展开逻辑内联在完整下载流程末尾——父本体已入库时判重提前 return，
 *  展开永远走不到（卡片「补下引用子笔记」点了没反应的根因），故抽出供判重分支复用。 */
async function expandRefNotes(
  refNoteIds: string[],
  formats: DownloadFormat[],
  deps: MowenDownloadDeps,
  depth: number,
): Promise<{ total: number; unavailable: string[] } | undefined> {
  if (!refNoteIds.length) return undefined
  // REF_DEPTH_LIMIT = 最多展开的引用层数（本笔记为第 1 层）。
  // 本层 depth 已 >= 上限 → 不再展开下一层（l4 是第 4 层，l3 的 depth=2 时还能下它，
  // 但 l4 自己 depth=3 的展开会被拦住——链式第 4 层不入库）。
  if (depth + 1 >= REF_DEPTH_LIMIT) {
    deps.onWarning?.(`引用展开已达上限 ${REF_DEPTH_LIMIT} 层，更深层级未下载`)
    return undefined
  }
  const unavailable: string[] = []
  let total = 0
  for (const childUuid of refNoteIds) {
    // 子笔记已在库（含「兄弟引用同一篇」）→ 判重跳过，不计入本轮下载量
    if (await deps.library.has(`mowen_${childUuid}`)) continue
    total++
    // 深度内递归；子笔记沿链继续展开（深度递增），unavailable 如实归集不阻塞兄弟
    try {
      await downloadMowenNote(childUuid, formats, deps, depth + 1)
    } catch (e) {
      if (e instanceof MowenNoteUnavailable) unavailable.push(childUuid)
      else throw e
    }
  }
  if (unavailable.length) {
    deps.onWarning?.(`${unavailable.length} 篇引用子笔记不可匿名获取（付费/私密），已如实跳过`)
  }
  return { total, unavailable }
}

export async function downloadMowenNote(
  input: string,
  formats: DownloadFormat[],
  deps: MowenDownloadDeps,
  depth = 0,
): Promise<DownloadItemResult & { refResults?: { total: number; unavailable: string[] } }> {
  const uuid = extractMowenNoteId(input)
  if (!uuid) throw new Error(`不是墨问笔记地址（note.mowen.cn/detail/<id> 或裸 noteId）: ${input}`)
  const url = normalizeMowenUrl(input)!
  const id = `mowen_${uuid}`

  if (await deps.library.has(id)) {
    const existing = await deps.library.get(id)
    // 本体判重跳过 ≠ 引用展开也跳过：卡片「补下引用子笔记」/ CLI --expand-refs 在
    // 本体已入库时同样要展开子笔记——需要一次 note/show 拿引用清单（必要成本）。
    // note/show 失败不阻塞 skipped 返回（本体本来就已在库）。
    // v0.11.2：判重分支不拉引用元信息（skipped 不重导出，老库存量不触发新请求）。
    let expanded: { total: number; unavailable: string[] } | undefined
    if (deps.expandRefs) {
      try {
        const show = await fetchShowCached(uuid, deps)
        expanded = await expandRefNotes(show.refNoteIds, formats, deps, depth)
      } catch (e) {
        if (e instanceof MowenNoteUnavailable) {
          deps.onWarning?.('本篇不可匿名获取（付费/私密），引用未展开')
        } else {
          deps.onWarning?.(`引用展开失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    return {
      url, ok: true, id, skipped: true, title: existing?.title, dir: existing?.dir,
      ...(expanded ? { refResults: expanded } : {}),
    }
  }

  deps.onProgress?.({ phase: 'fetch', message: '获取墨问笔记' })
  const show = await fetchShowCached(uuid, deps)
  // 引用子笔记元信息：真下载路径才拉（付费/失败分类进卡片，不阻塞本体）
  const refMetas = show.refNoteIds.length ? await fetchRefMetas(show.refNoteIds, deps) : undefined
  const parsed = noteShowToParsedArticle(show, refMetas)

  if (!parsed.title.trim()) {
    throw new MowenNoteUnavailable(`未取到笔记标题（可能被风控或接口变更）: ${url}`)
  }

  const accountDir = join(deps.libraryRoot, sanitizeName(parsed.account || 'unknown'))
  const datePrefix = parsed.publishTime.slice(0, 10)
  const base = articleDirName(datePrefix, parsed.title)
  const dirName = dedupeDirName(base, (name) => existsSync(join(accountDir, name)))
  const dir = join(accountDir, dirName)

  deps.onProgress?.({ phase: 'export', message: '生成文件' })
  // exportArticle 只需要 ExportDeps（fetchBinary/BrowserWindow/now），微信的 fetchHtml 不要求
  // 进来——由 MowenDownloadDeps 的 Omit 在类型层保证（静态导入无环：exporter 不回导 mowen）。
  const meta = await exportArticle({ parsed, id, sourceUrl: url, dir, formats }, deps)
  await deps.library.add(meta)

  // —— 合集递归（显式开关）：子笔记走同一条下载路径，判重/限速/unavailable 天然复用 ——
  // 元信息阶段已把子 show 写进缓存，这里子下载（库内没有时）命中缓存零重复请求。
  const refResults = deps.expandRefs ? await expandRefNotes(show.refNoteIds, formats, deps, depth) : undefined

  return {
    url, ok: true, id, dir, formats: meta.formats, title: meta.title,
    ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
    ...(refResults ? { refResults } : {}),
  }
}

// —— 内部：exportArticle 只需要 ExportDeps（fetchBinary/BrowserWindow/now），别把微信的
// fetchHtml 一并要求进来——mowen 分支根本不用它（Omit 掉后调用方也省一组依赖）——

/** note/show 的真实网络通道。Node 内建 fetch；不挂 mp gateway（独立平台，保护闸语义不适用）。 */
export const defaultFetchJson: NoteShowDeps['fetchJson'] = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  return { status: res.status, text: await res.text() }
}
