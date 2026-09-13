# M63 · 墨问作者订阅 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以作者为单位订阅墨问账号——搜索（带简介）→ 订阅 → 定时/手动检查新笔记（水位比对）→ 按策略下载入库，与微信公众号订阅同构。

**Architecture:** 三层对齐微信订阅的既有切分——core 纯函数与存储（`src/core/mowen/subscription.ts`）、编排服务依赖注入可单测（`electron/services/mowen-subscription-check.ts`，对齐 `subscription-check.ts` 模式）、IPC/GUI/CLI 薄接线。检查调度与自动下载设置与微信共用（PRD R4 拍板），同一 scheduler tick 分平台串行执行、互不阻塞。

**Tech Stack:** TypeScript / vitest / Electron IPC / antd（renderer）/ commander（CLI）/ spawn mocli（发现层）。

**Spec:** `docs/PRD-v0.11.0.md` §3 R4 + §6 R4 验收清单。PRD 与本计划冲突时以 PRD 为准。

## Global Constraints

- 检查失败必须保留失败类型，**不得降级为「没有新笔记」**（v0.10.5 教训，宪法级）。
- `watermark` 只在检查成功后推进；单作者失败不影响其他作者。
- 数据落独立 `mowen-subscriptions.json`（库根下），**不与微信 `subscriptions.json` 混文件**。
- 检查日志与微信共用同一通道（`subscriptions.json` 的 `checkLog` 数组 + `subscriptions-check.log`），`CheckLogEntry.platform: 'mowen'` 区分。
- 发现层走 mocli：`user search`（带 intro）/ `notes homepage --uid`；**真机实证 `note_ids` 顺序不是 publicAt 严格倒序**（2026-09-13 池建强主页：第 2 条比第 1 条新）→ 水位比对**必须全量过滤** `publicAt > watermark`，不得做「遇旧提前停」遍历优化（PRD 里该句以此修正为准）。
- `MowenNoteListItem.publicAt` 是 **unix 秒 number|null**（homepage 真机实证）——与 note/show 的字符串形态不同，勿混用。`publicAt === null` 的条目**不算新**（无法比对水位），但进检查 warning。
- 检查深度固定 `--count 20`；不使用 `--recent`（水位比对已覆盖）。
- 订阅时 `watermark = Date.now()/1000`（unix 秒），**不回补历史**；补历史走 R2a 批量下载 tab。
- 自动下载策略读微信侧设置键 `subscriptionNewArticleAction`；下载格式读 `defaultFormats`；**零新增 settings 键**。
- 下载统一走 `downloadMowenNote`（判重 skip、付费 unavailable 如实、图片本地化全部内建）。
- mock 之前先看真机形态（M60/M61 两次教训）：本计划单测 fixture 全部来自下方「真机锚点」。
- 渲染层不得 import core 的 node:fs 模块（M56 vite 白屏红线）；墨问面板数据全走 `window.api` 新增 IPC。
- commit message 一律写临时文件 `git commit -F`（反引号事故防线）。
- 每任务收尾跑 `npm test` 全量；全部任务完成跑 `npm run lint` + `npx tsc --noEmit -p tsconfig.json` + `npm run test:e2e`。

## 真机锚点（fixture 唯一来源，2026-09-13 实测）

`mocli user search --keyword 池建强`（stdout 单行 JSON）：

```json
{"code":0,"status":"OK","reply":{"uids":["vtv_PV1fEMBb-8_BPlmDu","0C-bLHmOmxiYpzgIxJaVS"],"users":{"vtv_PV1fEMBb-8_BPlmDu":{"uid":"vtv_PV1fEMBb-8_BPlmDu","name":"池建强","intro":"墨问西东和极客时间创始人…","home_url":"https://note.mowen.cn/user/vtv_PV1fEMBb-8_BPlmDu?from=mocli"}}}}
```

`mocli notes homepage --uid <uid> --count 3`（条目形态，`public_at` 为 unix 秒数字）：

```json
{"note_id":"7hRdXRGQdEatFghL4Ms1a","uid":"vtv_PV1fEMBb-8_BPlmDu","title":"嗨，Astra 用户们…","brief":"…","url":"https://note.mowen.cn/detail/7hRdXRGQdEatFghL4Ms1a?from=mocli","created_at":1789191168,"updated_at":1789191302,"public_at":1789191409,"flag":{"with_text":true,"with_image":true},"content":{"word_count":676},"status":{"public_status":1,"audit_status":64},"stat":{"view":360,"favor":6}}
```

失败形态（M60 钉死）：错误 JSON 写 **stderr**，stdout 为空；`{"code":非0,"reason":"VALIDATE","msg":"…"}`。

---

### Task 1: core 存储与水位纯函数

**Files:**
- Create: `src/core/mowen/subscription.ts`
- Test: `tests/core/mowen/subscription.test.ts`

**Interfaces:**
- Consumes: `MowenNoteListItem`（`./types`，`publicAt: number | null`）；`atomicWriteFile`（`../atomic-write`）；`withPathLock`（`../path-lock`）——均已在 `../subscriptions.ts` 使用，模式照抄。
- Produces（后续任务依赖的确切签名）:
  - `interface MowenNoteRef { noteId: string; title: string; publicAt: number | null; url: string; status: 'pending' | 'downloaded' | 'ignored' }`
  - `interface MowenSubscribedAuthor { uid: string; name: string; intro: string; subscribed: boolean; watermark: number; lastCheckedAt: number | null; lastRunAt: number | null; newNotes: MowenNoteRef[] }`
  - `class MowenSubscriptions { constructor(root: string); list(): Promise<MowenSubscribedAuthor[]>; addAuthor(a: { uid: string; name: string; intro: string; watermark: number }): Promise<void>; hasAuthor(uid: string): Promise<boolean>; removeAuthor(uid: string): Promise<void>; setSubscribed(uid: string, subscribed: boolean): Promise<void>; updateWatermark(uid: string, watermark: number): Promise<void>; appendNewNotes(uid: string, notes: MowenNoteRef[]): Promise<void>; setNoteStatus(uid: string, noteIds: string[], status: 'downloaded' | 'ignored'): Promise<void>; setLastCheckedAt(uid: string, t: number): Promise<void>; setLastRunAt(t: number): Promise<void>; getLastRunAt(): Promise<number | null> }`
  - `function diffNewNotes(items: MowenNoteListItem[], watermark: number): { fresh: MowenNoteListItem[]; undated: MowenNoteListItem[] }`（纯函数；`publicAt === null` 进 `undated` 不算新）
  - `function mergeNewNotes(existing: MowenNoteRef[], fresh: MowenNoteListItem[]): MowenNoteRef[]`（纯函数；按 noteId 合并，**已有条目原样保留**——status 不被重置；新增条目 status='pending'；输出按 publicAt 降序，null 殿后）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/core/mowen/subscription.test.ts
// fixture 来自 2026-09-13 真机 notes homepage（见计划「真机锚点」）。
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MowenSubscriptions, diffNewNotes, mergeNewNotes, type MowenNoteRef } from '../../../src/core/mowen/subscription'
import type { MowenNoteListItem } from '../../../src/core/mowen/types'

const item = (over: Partial<MowenNoteListItem>): MowenNoteListItem => ({
  noteId: 'n1', uid: 'u1', title: '标题', brief: '', url: 'https://note.mowen.cn/detail/n1',
  publicAt: 1789191409, withFee: false, withImage: true, withText: true,
  wordCount: 676, viewCount: 360, favorCount: 6, ...over,
})

describe('diffNewNotes', () => {
  it('publicAt > watermark 判新；null 进 undated 不算新', () => {
    const items = [item({ noteId: 'a', publicAt: 1789191409 }), item({ noteId: 'b', publicAt: 1789000000 }), item({ noteId: 'c', publicAt: null })]
    const r = diffNewNotes(items, 1789100000)
    expect(r.fresh.map((x) => x.noteId)).toEqual(['a'])
    expect(r.undated.map((x) => x.noteId)).toEqual(['c'])
  })
  it('全量为旧 → 空数组（不炸）', () => {
    expect(diffNewNotes([item({ publicAt: 100 })], 200).fresh).toEqual([])
  })
})

describe('mergeNewNotes', () => {
  it('按 noteId 合并：已有条目 status 保留，新条目 pending，输出 publicAt 降序', () => {
    const existing: MowenNoteRef[] = [
      { noteId: 'old', title: '旧', publicAt: 1789000000, url: 'u', status: 'downloaded' },
      { noteId: 'keep', title: '保留', publicAt: 1789100000, url: 'u', status: 'pending' },
    ]
    const fresh = [item({ noteId: 'new', publicAt: 1789191409, title: '新笔记' })]
    const r = mergeNewNotes(existing, fresh)
    expect(r.find((x) => x.noteId === 'old')?.status).toBe('downloaded')
    expect(r.find((x) => x.noteId === 'keep')?.status).toBe('pending')
    expect(r.find((x) => x.noteId === 'new')?.status).toBe('pending')
    // 降序：new(1789191409) > keep(1789100000) > old(1789000000)
    expect(r.map((x) => x.noteId)).toEqual(['new', 'keep', 'old'])
  })
  it('重复检查同一批不产生重复条目', () => {
    const fresh = [item({ noteId: 'a', publicAt: 1789191409 })]
    const once = mergeNewNotes([], fresh)
    expect(mergeNewNotes(once, fresh).filter((x) => x.noteId === 'a')).toHaveLength(1)
  })
})

describe('MowenSubscriptions', () => {
  it('add → has → list 往返；重复 add 同 uid 幂等不重复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    const subs = new MowenSubscriptions(root)
    await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '简介', watermark: 1789191409 })
    await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '简介', watermark: 1789191409 })
    expect(await subs.hasAuthor('u1')).toBe(true)
    const all = await subs.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ uid: 'u1', name: '池建强', intro: '简介', subscribed: true, watermark: 1789191409, lastCheckedAt: null, newNotes: [] })
  })
  it('appendNewNotes 合并去重 + setNoteStatus 改状态；removeAuthor 生效', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    const subs = new MowenSubscriptions(root)
    await subs.addAuthor({ uid: 'u1', name: '池', intro: '', watermark: 100 })
    await subs.appendNewNotes('u1', [{ noteId: 'n1', title: 't', publicAt: 200, url: 'u', status: 'pending' }])
    await subs.setNoteStatus('u1', ['n1'], 'downloaded')
    await subs.updateWatermark('u1', 200)
    await subs.setLastCheckedAt('u1', 1234)
    expect((await subs.list())[0]).toMatchObject({ watermark: 200, lastCheckedAt: 1234 })
    expect((await subs.list())[0].newNotes[0].status).toBe('downloaded')
    await subs.removeAuthor('u1')
    expect(await subs.hasAuthor('u1')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/mowen/subscription.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// src/core/mowen/subscription.ts
// 墨问作者订阅存储（库根下 mowen-subscriptions.json，与微信 subscriptions.json 分文件——
// schema 语义不同：fakeid/createTime 水位 vs uid/publicAt 水位）+ 水位/合并纯函数。
// 读写模式照抄 ../subscriptions.ts（path-lock + atomic-write）。
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { withPathLock } from '../path-lock'
import type { MowenNoteListItem } from './types'

export interface MowenNoteRef {
  noteId: string
  title: string
  publicAt: number | null   // unix 秒
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
  /** 平台级防重入（scheduler 用）：上次检查发起时刻，unix ms。旧文件缺省 null。 */
  lastRunAt: number | null
  newNotes: MowenNoteRef[]
}

interface Store { authors: MowenSubscribedAuthor[] }

/** 水位比对：publicAt > watermark 判新。真机实证 note_ids 非严格时间序（2026-09-13），
 *  必须全量过滤、不得「遇旧提前停」。publicAt null 无法比对 → undated，不算新。 */
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

/** 合并新笔记：按 noteId 去重；已有条目（含其 status）原样保留——已下载/已忽略不被下次检查重置；
 *  新条目 status='pending'。输出按 publicAt 降序（null 殿后）。 */
export function mergeNewNotes(existing: MowenNoteRef[], fresh: MowenNoteListItem[]): MowenNoteRef[] {
  const byId = new Map(existing.map((n) => [n.noteId, n] as const))
  for (const it of fresh) {
    if (byId.has(it.noteId)) continue
    byId.set(it.noteId, { noteId: it.noteId, title: it.title, publicAt: it.publicAt, url: it.url, status: 'pending' })
  }
  return [...byId.values()].sort(byPublicAtDesc)
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

export class MowenSubscriptions {
  private path: string
  constructor(private root: string) { this.path = join(root, 'mowen-subscriptions.json') }

  private async read(): Promise<Store> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      return { authors: isObj(parsed) && Array.isArray(parsed.authors) ? (parsed.authors as MowenSubscribedAuthor[]) : [] }
    } catch { return { authors: [] } }
  }

  /** 写路径加锁 + 原子替换（与微信订阅同一并发纪律）。 */
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
    await this.mutate((d) => { const a = d.authors.find((x) => x.uid === uid); if (a) a.newNotes = mergeNewNotes(a.newNotes, notes.map(toListItem)) })
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
}

// appendNewNotes 的入参统一走 MowenNoteRef；内部合并需要 ListItem 形态——最小转换。
function toListItem(n: MowenNoteRef): MowenNoteListItem {
  return { noteId: n.noteId, uid: '', title: n.title, brief: '', url: n.url, publicAt: n.publicAt, withFee: false, withImage: false, withText: false, wordCount: null, viewCount: null, favorCount: null }
}
```

实现注：`appendNewNotes` 若嫌绕，可以直接内联合并逻辑（Map 合并）而不经过 `toListItem`——以测试为准，两种写法选一种，别两个都留。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/mowen/subscription.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/mowen/subscription.ts tests/core/mowen/subscription.test.ts
git commit -F /tmp/m63-t1-msg.txt   # message: feat(mowen): subscription store and watermark diff/merge (M63 T1)
```

---

### Task 2: 检查编排服务

**Files:**
- Create: `electron/services/mowen-subscription-check.ts`
- Modify: `src/core/subscriptions.ts`（`CheckLogEntry` 加 `platform?: 'wechat' | 'mowen'` 字段 + `formatCheckLogLine` 输出）
- Test: `tests/electron/mowen-subscription-check.test.ts`、`tests/core/subscriptions.test.ts`（追加 platform 断言）

**Interfaces:**
- Consumes: Task 1 全部产出；`listUserNotes` / `searchUsers`（`src/core/mowen/metadata.ts`）；`MocliRunner`（`./types`）；`downloadMowenNote`（`./download-mowen-note`，经注入的 `downloadNote` 间接用）。
- Produces:

```typescript
// electron/services/mowen-subscription-check.ts
export interface MowenCheckDeps {
  subs: MowenSubscriptions
  runner: MocliRunner | null          // null = mocli 不可用（未装/检测失败）
  log: (entry: CheckLogEntry) => Promise<void>   // 与微信共用（ipc.ts 组装，写 platform:'mowen'）
  settings: { subscriptionNewArticleAction: NewArticleAction; defaultFormats: DownloadFormat[] }
  downloadNote: (noteId: string) => Promise<DownloadItemResult>   // 调用方组装 downloadMowenNote
  listUserNotes?: typeof listUserNotes   // 注入点，缺省真实现
}
export interface MowenPerAuthorResult {
  uid: string; name: string; ok: boolean
  newFound: number; downloaded: number; existed: number; unavailable: number
  error?: string
}
export interface MowenCheckResult {
  authors: number; newFound: number; failed: number
  note?: 'mocli-missing' | 'no-authors'
  results: MowenPerAuthorResult[]
}
export async function runMowenSubscriptionCheck(trigger: 'auto' | 'manual', deps: MowenCheckDeps): Promise<MowenCheckResult>
```

- [ ] **Step 1: 写失败测试**

```typescript
// tests/electron/mowen-subscription-check.test.ts
// fixture 来自计划「真机锚点」；runner/log/subs 全部内存 mock（编排无 electron 运行时）。
import { describe, it, expect } from 'vitest'
import { runMowenSubscriptionCheck, type MowenCheckDeps } from '../../electron/services/mowen-subscription-check'
import { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MowenNoteListItem } from '../../src/core/mowen/types'
import type { CheckLogEntry } from '../../src/core/subscriptions'

const item = (id: string, publicAt: number | null, title = `t-${id}`): MowenNoteListItem => ({
  noteId: id, uid: 'u1', title, brief: '', url: `https://note.mowen.cn/detail/${id}`,
  publicAt, withFee: false, withImage: false, withText: true, wordCount: null, viewCount: null, favorCount: null,
})

const harness = async (over: Partial<MowenCheckDeps> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'mowen-check-'))
  const subs = new MowenSubscriptions(root)
  await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '简介', watermark: 1789000000 })
  const logs: CheckLogEntry[] = []
  const downloads: string[] = []
  const deps: MowenCheckDeps = {
    subs,
    runner: async () => { throw new Error('runner 不应被直接调用——listUserNotes 已注入') },
    log: async (e) => { logs.push(e) },
    settings: { subscriptionNewArticleAction: 'notify', defaultFormats: ['md'] },
    downloadNote: async (noteId) => { downloads.push(noteId); return { url: 'u', ok: true, id: `mowen_${noteId}`, dir: '/x' } },
    listUserNotes: async (_run, uid, opts) => {
      expect(uid).toBe('u1'); expect(opts?.count).toBe(20)
      return [item('n1', 1789191409), item('n2', 1789000000), item('n3', null)]
    },
    ...over,
  }
  return { subs, logs, downloads, deps }
}

describe('runMowenSubscriptionCheck', () => {
  it('水位比对：只有 publicAt > watermark 的新笔记入 newNotes（null 不算新）；检查成功才推水位', async () => {
    const h = await harness()
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.authors).toBe(1); expect(r.newFound).toBe(1); expect(r.failed).toBe(0)
    const a = (await h.subs.list())[0]
    expect(a.newNotes.map((n) => n.noteId)).toEqual(['n1'])
    expect(a.watermark).toBe(1789191409)          // 推进到本轮见到的最大 publicAt
    expect(a.lastCheckedAt).not.toBeNull()
    expect(logs[0]).toMatchObject({ trigger: 'manual', accounts: 1, newFound: 1, failed: 0, platform: 'mowen' })
  })

  it('自动下载策略 download：新笔记逐篇下载、状态置 downloaded；watermark 照常推进', async () => {
    const h = await harness({ settings: { subscriptionNewArticleAction: 'download', defaultFormats: ['md'] } })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.results[0]).toMatchObject({ ok: true, newFound: 1, downloaded: 1 })
    expect(h.downloads).toEqual(['n1'])
    expect((await h.subs.list())[0].newNotes[0].status).toBe('downloaded')
  })

  it('重复检查：已见笔记不重复入列；已下载状态不被重置', async () => {
    const h = await harness()
    await runMowenSubscriptionCheck('manual', h.deps)
    await h.subs.setNoteStatus('u1', ['n1'], 'downloaded')
    await h.deps.listUserNotes!(h.deps.runner!, 'u1', { count: 20 })   // 确认注入通道可用
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.newFound).toBe(0)
    const a = (await h.subs.list())[0]
    expect(a.newNotes).toHaveLength(1)
    expect(a.newNotes[0].status).toBe('downloaded')
  })

  it('单作者失败：归集到该作者名下（ok:false + error），不影响其他作者，失败作者水位不推进', async () => {
    const h = await harness()
    await h.subs.addAuthor({ uid: 'u2', name: '另一个', intro: '', watermark: 1789000000 })
    const deps = { ...h.deps, listUserNotes: async (_r: unknown, uid: string) => {
      if (uid === 'u1') throw new Error('MOCLI_FAILED: VALIDATE')
      return [item('n9', 1789199999)]
    } }
    const r = await runMowenSubscriptionCheck('manual', deps)
    expect(r.failed).toBe(1); expect(r.newFound).toBe(1)
    expect(r.results.find((x) => x.uid === 'u1')).toMatchObject({ ok: false })
    expect(r.results.find((x) => x.uid === 'u1')?.error).toContain('VALIDATE')
    expect((await h.subs.list()).find((x) => x.uid === 'u1')?.watermark).toBe(1789000000)   // 未推进
    expect(logs[0].failed).toBe(1)
    expect(logs[0].failures?.[0]).toMatchObject({ nickname: '池建强' })
  })

  it('mocli 不可用（runner=null）：如实报 mocli-missing，不得伪装「无新笔记」，水位不动', async () => {
    const h = await harness({ runner: null })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.note).toBe('mocli-missing'); expect(r.failed).toBe(1)
    expect((await h.subs.list())[0].watermark).toBe(1789000000)
    expect(logs[0]).toMatchObject({ accounts: 1, failed: 1, platform: 'mowen' })
  })

  it('无订阅：早退 no-authors，日志照写', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-check-'))
    const subs = new MowenSubscriptions(root)
    const logs: CheckLogEntry[] = []
    const r = await runMowenSubscriptionCheck('auto', {
      subs, runner: async () => { throw new Error('x') }, log: async (e) => { logs.push(e) },
      settings: { subscriptionNewArticleAction: 'notify', defaultFormats: ['md'] },
      downloadNote: async () => { throw new Error('x') },
    })
    expect(r.note).toBe('no-authors'); expect(r.authors).toBe(0)
    expect(logs[0]).toMatchObject({ note: 'no-authors', platform: 'mowen' })
  })

  it('付费新笔记下载 unavailable 如实计数，状态保持 pending（重试由用户决定）', async () => {
    const h = await harness({
      settings: { subscriptionNewArticleAction: 'download', defaultFormats: ['md'] },
      downloadNote: async () => { const e: any = new Error('该笔记不可匿名获取（付费/私密），无法下载'); e.name = 'MowenNoteUnavailable'; throw e },
    })
    const r = await runMowenSubscriptionCheck('manual', h.deps)
    expect(r.results[0]).toMatchObject({ ok: true, newFound: 1, downloaded: 0, unavailable: 1 })
    expect((await h.subs.list())[0].newNotes[0].status).toBe('pending')
  })
})
```

注意：`e.name = 'MowenNoteUnavailable'` 依赖 `downloadMowenNote` 抛出的错误类名（`MowenNoteUnavailable`，`src/core/mowen/errors.ts`）。编排判定 unavailable 用 `e instanceof MowenNoteUnavailable`（直接 import，与 download-mowen-note 同源，避免 M61 踩过的「同名字类两处定义」坑）。上面 fixture 里用 `Object.assign(new Error(...), { name: 'MowenNoteUnavailable' })` 形态不够——**编排实现里 import 真类做 instanceof**，fixture 构造：`import { MowenNoteUnavailable } from '../../src/core/mowen/errors'` 然后 `throw new MowenNoteUnavailable()`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/electron/mowen-subscription-check.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 CheckLogEntry.platform（先小步）**

`src/core/subscriptions.ts` 的 `CheckLogEntry` interface 加一行（`note?: string` 字段之后）：

```typescript
  /** M63：检查来源平台。缺省 'wechat'（旧条目兼容）——墨问检查与微信共用日志通道。 */
  platform?: 'wechat' | 'mowen'
```

`formatCheckLogLine` 的 `if (e.note) line += ...` 之后加：

```typescript
  if (e.platform === 'mowen') line += ' platform=mowen'
```

`tests/core/subscriptions.test.ts` 追加一条：

```typescript
it('platform=mowen 输出标记（M63）', () => {
  const line = formatCheckLogLine({ time: 0, trigger: 'manual', accounts: 1, newFound: 0, failed: 0, platform: 'mowen' })
  expect(line).toContain('platform=mowen')
})
it('缺省 platform 不输出（旧条目逐字节不变）', () => {
  const line = formatCheckLogLine({ time: 0, trigger: 'auto', accounts: 1, newFound: 0, failed: 0 })
  expect(line).not.toContain('platform')
})
```

Run: `npx vitest run tests/core/subscriptions.test.ts` → PASS

- [ ] **Step 4: 实现编排**

```typescript
// electron/services/mowen-subscription-check.ts
// 墨问订阅检查编排（M63）。对齐 subscription-check.ts 的依赖注入模式：无 electron 运行时，
// GUI 与 CLI 共用，可单测。失败保留失败类型（宪法）：单作者失败归集该作者名下、水位不动；
// mocli 不可用如实 mocli-missing，不得伪装「无新笔记」。
import { listUserNotes } from '../../src/core/mowen/metadata'
import { MowenNoteUnavailable } from '../../src/core/mowen/errors'
import type { MocliRunner } from '../../src/core/mowen/types'
import type { MowenSubscriptions, MowenNoteRef } from '../../src/core/mowen/subscription'
import { diffNewNotes, mergeNewNotes } from '../../src/core/mowen/subscription'
import type { CheckLogEntry, CheckFailure } from '../../src/core/subscriptions'
import type { DownloadFormat, DownloadItemResult } from '../../src/core/types'
import type { AppSettings } from './settings'

const CHECK_COUNT = 20

export interface MowenCheckDeps {
  subs: MowenSubscriptions
  runner: MocliRunner | null
  log: (entry: CheckLogEntry) => Promise<void>
  settings: Pick<AppSettings, 'subscriptionNewArticleAction' | 'defaultFormats'>
  downloadNote: (noteId: string) => Promise<DownloadItemResult>
  listUserNotes?: typeof listUserNotes
}

export interface MowenPerAuthorResult {
  uid: string; name: string; ok: boolean
  newFound: number; downloaded: number; existed: number; unavailable: number
  error?: string
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

  if (!authors.length) {
    await deps.log({ ...baseLog, accounts: 0, newFound: 0, failed: 0, note: 'no-authors' })
    return { authors: 0, newFound: 0, failed: 0, note: 'no-authors', results: [] }
  }
  if (!deps.runner) {
    // mocli 缺失 = 该平台本轮检查全部失败；水位不动；日志照写（检查记录可见）
    await deps.log({ ...baseLog, accounts: authors.length, newFound: 0, failed: authors.length,
      failures: authors.map((a) => ({ nickname: a.name, error: '未检测到 mocli' })) })
    return { authors: authors.length, newFound: 0, failed: authors.length, note: 'mocli-missing',
      results: authors.map((a) => ({ uid: a.uid, name: a.name, ok: false, newFound: 0, downloaded: 0, existed: 0, unavailable: 0, error: '未检测到 mocli' })) }
  }

  let newFound = 0, failed = 0
  const failures: CheckFailure[] = []
  const results: MowenPerAuthorResult[] = []
  await deps.subs.setLastRunAt(now)
  for (const a of authors) {
    try {
      const items = await list(deps.runner, a.uid, { count: CHECK_COUNT })
      const { fresh, undated } = diffNewNotes(items, a.watermark)
      const merged: MowenNoteRef[] = mergeNewNotes(a.newNotes, fresh)
      await deps.subs.appendNewNotes(a.uid, fresh.map((f) => ({ noteId: f.noteId, title: f.title, publicAt: f.publicAt, url: f.url, status: 'pending' as const })))
      // 水位推进 = 本轮见到的最大 publicAt（含旧笔记——证明作者没删库）；全 null 则不动
      const maxPublicAt = items.reduce<number>((m, it) => (it.publicAt != null && it.publicAt > m ? it.publicAt : m), a.watermark)
      await deps.subs.updateWatermark(a.uid, maxPublicAt)
      await deps.subs.setLastCheckedAt(a.uid, Date.now())
      if (undated.length) { /* publicAt null 无法比对：数量进 result.error 注记，不算失败 */ }

      let downloaded = 0, existed = 0, unavailable = 0
      const newlyPending = merged.filter((n) => n.status === 'pending')
      if (deps.settings.subscriptionNewArticleAction === 'download' && newlyPending.length) {
        for (const n of newlyPending) {
          try {
            const r = await deps.downloadNote(n.noteId)
            if (r.skipped) existed++; else downloaded++
            await deps.subs.setNoteStatus(a.uid, [n.noteId], 'downloaded')
          } catch (e) {
            if (e instanceof MowenNoteUnavailable) unavailable++
            else throw e
          }
        }
      }
      newFound += newlyPending.length
      results.push({ uid: a.uid, name: a.name, ok: true, newFound: newlyPending.length, downloaded, existed, unavailable,
        ...(undated.length ? { error: `${undated.length} 篇笔记缺少发布时间，未参与水位比对` } : undefined) })
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/electron/mowen-subscription-check.test.ts tests/core/subscriptions.test.ts`
Expected: PASS

- [ ] **Step 6: 全量回归 + Commit**

```bash
npm test   # 全量 630+ 全绿（platform 字段不得破坏微信既有日志断言；若有断言写死整对象需同步）
git add electron/services/mowen-subscription-check.ts src/core/subscriptions.ts tests/
git commit -F /tmp/m63-t2-msg.txt   # message: feat(mowen): subscription check orchestration with watermark (M63 T2)
```

---

### Task 3: IPC 接线 + 调度共用

**Files:**
- Create: `electron/services/mowen-ipc.ts`（墨问订阅 IPC 处理器注册，对齐 `mowen-detect.ts` 的独立注册模式，避免 ipc.ts 再膨胀）
- Modify: `electron/ipc.ts`（调用 `registerMowenSubscriptionIpc`；scheduler 组装处串接墨问检查）
- Test: `tests/electron/mowen-ipc.test.ts`（处理器函数级单测——ipc.ts 层薄，重点测组装的检查回调编排）

**Interfaces:**
- Consumes: Task 1/2 全部产出；`ipc.ts` 既有 `settings.get()`、`logCheck`（`subscriptions-check.log` 行日志）、广播模式（`BrowserWindow.getAllWindows()` webContents.send）；`runSubscriptionCheck` 的 scheduler 组装（`ipc.ts:362`）。
- Produces（renderer `api.ts` 将在 Task 4 消费）:

```typescript
// electron/services/mowen-ipc.ts
export function registerMowenSubscriptionIpc(deps: {
  getLibraryRoot: () => Promise<string>
  broadcast: (channel: string) => void
}): void
// 注册的 IPC 通道：
//   'mowen-subs:list'       → { authors, lastRunAt }（含每作者 newNotes 里 status==='pending' 的数量摘要？不——全量返回 newNotes，渲染层自行过滤）
//   'mowen-subs:add'        (keyword: string, uid?: string) → { ok, authors?: MowenUser[] }（uid 缺省 = 只搜索返回候选；带 uid = 直接订阅，watermark=now）
//   'mowen-subs:remove'     (uid: string)
//   'mowen-subs:checkNow'   (uids?: string[]) → MowenCheckResult
//   'mowen-subs:downloadNotes' (uid: string, noteIds: string[]) → { downloaded, existed, failed }
//   'mowen-subs:dismissNotes'  (uid: string, noteIds: string[])
// 广播：'mowen-subs:updated'
```

- [ ] **Step 1: 写失败测试**

```typescript
// tests/electron/mowen-ipc.test.ts
// ipc 层单测打在「组装出的检查回调」与 handler 逻辑函数上：注册器抽成可拆的纯组装 +
// handler 工厂（handleMowenSubsCheckNow(handleCheck) 等太薄没意义——直接测组合后的行为：
// 墨问检查不依赖微信登录态（list=null 也照跑）、日志写进微信通道且带 platform）。
import { describe, it, expect } from 'vitest'
// —— 具体断言形态依赖 Step 3 实现拆出的可测函数，随实现写；本任务最少钉住两条：——
// 1) 组装的 runMowen 调用注入的 log 会写 platform:'mowen' 的 CheckLogEntry（传 mock log 收集）
// 2) 微信 list=null（未登录）时 runMowen 仍执行墨问检查并返回 results
describe('mowen subscription ipc assembly', () => {
  it('占位：实现后替换为真实断言（见上两条要求）', () => { expect(true).toBe(true) })
})
```

（注：这是本计划唯一允许的「占位测试」，因为 ipc 组装的精确切分要在实现时定；但上述两条行为断言**必须在实现落地后补齐为真断言**，占位不得留存到 Task 3 commit——self-review 会查。）

- [ ] **Step 2: 实现**

`electron/services/mowen-ipc.ts`（骨架，关键行为都在）：

```typescript
// electron/services/mowen-ipc.ts
// 墨问作者订阅 IPC（M63）。独立注册器（对齐 mowen-detect.ts 模式），ipc.ts 一行调用。
// 检查日志与微信共用：log 同时写 subscriptions.json 的 checkLog（platform:'mowen'）+ 行日志文件。
import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { app } from 'electron'
import { MowenSubscriptions } from '../../src/core/mowen/subscription'
import { runMowenSubscriptionCheck, type MowenCheckResult } from './mowen-subscription-check'
import { searchUsers, listUserNotes } from '../../src/core/mowen/metadata'
import { downloadMowenNote } from '../../src/core/mowen/download-mowen-note'
import { defaultFetchJson } from '../../src/core/mowen/download-mowen-note'
import { detectMocli, createMocliRunner, createWhichRunner } from './mowen-detect'
// ↑ 实现时按 mowen-detect.ts 的真实导出名调整；detectMocli/createMocliRunner/createWhichRunner 来自 M60。
import type { AppSettings } from './settings'
import type { DownloadItemResult } from '../../src/core/types'

export interface MowenSubsIpcDeps {
  getSettings: () => Promise<AppSettings>
  getLibraryRoot: (s: AppSettings) => string
  logCheck: (entry: import('../../src/core/subscriptions').CheckLogEntry) => Promise<void>   // ipc.ts 既有（写行日志+checkLog）
  broadcast: (channel: string) => void
  /** 下载注入（供单测替换；缺省走完整 downloadMowenNote 通道） */
  downloadNote?: (noteId: string, formats: import('../../src/core/types').DownloadFormat[]) => Promise<DownloadItemResult>
}

export function registerMowenSubscriptionIpc(deps: MowenSubsIpcDeps): void {
  const subsOf = async () => new MowenSubscriptions(deps.getLibraryRoot(await deps.getSettings()))
  const runnerOf = async () => {
    const det = await detectMocli(createMocliRunner(), createWhichRunner())
    return det.installed ? createMocliRunner() : null
  }
  const broadcastUpdated = () => deps.broadcast('mowen-subs:updated')

  const runMowenCheck = async (trigger: 'auto' | 'manual', uids?: string[]): Promise<MowenCheckResult> => {
    const [settings, subs, runner] = await Promise.all([deps.getSettings(), subsOf(), runnerOf()])
    const result = await runMowenSubscriptionCheck(trigger, {
      subs,
      runner,
      log: deps.logCheck,
      settings: { subscriptionNewArticleAction: settings.subscriptionNewArticleAction, defaultFormats: settings.defaultFormats },
      downloadNote: async (noteId) => deps.downloadNote
        ? deps.downloadNote(noteId, settings.defaultFormats)
        : downloadMowenNote(noteId, settings.defaultFormats, await buildDownloadDeps(settings)),
    })
    broadcastUpdated()
    return result
  }
  // buildDownloadDeps：组装 downloadMowenNote 需要的 library/fetchBinary/BrowserWindow 等
  // ——照抄 ipc.ts 里 mowen import 命令/墨问 tab 下载通道的既有组装（M61 已写好，别重写第二份；
  //   若 ipc.ts 里的组装是内联的，抽成导出函数 buildMowenDownloadDeps(settings, libraryRoot) 供两处复用）。

  ipcMain.handle('mowen-subs:list', async () => {
    const subs = await subsOf()
    return { authors: await subs.list(), lastRunAt: await subs.getLastRunAt() }
  })

  ipcMain.handle('mowen-subs:add', async (_e, keyword: string, uid?: string) => {
    const kw = keyword.trim()
    if (!kw) return { ok: false, error: { code: 'VALIDATE', message: '请输入作者名字' } }
    const subs = await subsOf()
    const runner = await runnerOf()
    if (!runner) return { ok: false, error: { code: 'MOCLI_NOT_FOUND', message: '未检测到 mocli，请到设置页查看安装指引' } }
    if (uid) {
      if (await subs.hasAuthor(uid)) return { ok: false, error: { code: 'ALREADY_SUBSCRIBED', message: '该作者已在订阅列表' } }
      // 直接订阅：用 search 校验 uid 真实存在并拿最新 name/intro 快照
      const users = await searchUsers(runner, kw)
      const u = users.find((x) => x.uid === uid)
      if (!u) return { ok: false, error: { code: 'NOT_FOUND', message: '候选列表中没有该作者，请重新搜索' } }
      await subs.addAuthor({ uid: u.uid, name: u.name, intro: u.intro, watermark: Math.floor(Date.now() / 1000) })
      broadcastUpdated()
      return { ok: true }
    }
    return { ok: true, authors: await searchUsers(runner, kw) }
  })

  ipcMain.handle('mowen-subs:remove', async (_e, uid: string) => {
    await (await subsOf()).removeAuthor(uid)
    broadcastUpdated()
  })

  ipcMain.handle('mowen-subs:checkNow', (_e, uids?: string[]) => runMowenCheck('manual', uids))

  ipcMain.handle('mowen-subs:downloadNotes', async (_e, uid: string, noteIds: string[]) => {
    const [settings, subs] = await Promise.all([deps.getSettings(), subsOf()])
    const author = (await subs.list()).find((a) => a.uid === uid)
    if (!author) return { downloaded: 0, existed: 0, failed: 0 }
    let downloaded = 0, existed = 0, failed = 0
    for (const noteId of noteIds) {
      try {
        const r = deps.downloadNote
          ? await deps.downloadNote(noteId, settings.defaultFormats)
          : await downloadMowenNote(noteId, settings.defaultFormats, await buildDownloadDeps(settings))
        if (r.skipped) existed++; else downloaded++
        await subs.setNoteStatus(uid, [noteId], 'downloaded')
      } catch { failed++ }   // 失败保留 pending 状态，行内可重试
    }
    broadcastUpdated()
    return { downloaded, existed, failed }
  })

  ipcMain.handle('mowen-subs:dismissNotes', async (_e, uid: string, noteIds: string[]) => {
    await (await subsOf()).setNoteStatus(uid, noteIds, 'ignored')
    broadcastUpdated()
  })
}
```

`electron/ipc.ts` 接线（在 `registerMowenIpc(deps)` 调用附近）：

```typescript
registerMowenSubscriptionIpc({
  getSettings: () => settings.get(),
  getLibraryRoot: (s) => s.libraryRoot,
  logCheck,                      // ipc.ts:355 既有
  broadcast: (channel) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel) },
})
```

调度共用——`ipc.ts` 中 `SubscriptionScheduler` 的组装回调（当前只调微信 `runSubscriptionCheck`）改为两平台串行、各自隔离：

```typescript
const scheduledTick = async () => {
  // 微信侧（未登录 → runSubscriptionCheck 早退 no-session，不抛错）
  await runSubscriptionCheck('auto').catch(() => {})
  // 墨问侧（mocli 缺失 → runMowenSubscriptionCheck mocli-missing 早退，不抛错）；
  // 两平台互不阻塞：微信失败/未登录不影响墨问检查，反之亦然。
  await runMowenScheduledCheck().catch(() => {})
}
```

`runMowenScheduledCheck` = `runMowenCheck('auto')` 的调度包装，加平台级防重入（读 `mowen-subscriptions.json` 的 `lastRunAt`，与微信同一 `shouldRunCheck` 判定）：

```typescript
const runMowenScheduledCheck = async (): Promise<void> => {
  const s = await settings.get()
  if (!s.subscriptionAutoCheck) return
  const subs = await subsOf()
  const lastRunAt = await subs.getLastRunAt()
  const authors = (await subs.list()).filter((a) => a.subscribed)
  if (!authors.length) return
  if (!shouldRunCheck({ now: Date.now(), lastRunAt, hasAccounts: true,
    mode: s.subscriptionScheduleMode, checkTime: s.subscriptionCheckTime, intervalHours: s.subscriptionIntervalHours })) return
  await runMowenCheck('auto')
}
```

（`shouldRunCheck` 的确切参数名以 `src/core/subscription-schedule.ts:10` 的 `ScheduleInput` 为准——实现时读该 interface，别凭记忆。）

- [ ] **Step 3: 补真断言（替换 Step 1 占位）**

按实现拆分，把两条行为断言写实在：
1. `runMowenCheck` 组装注入的 `log` 收到 `platform: 'mowen'` 条目；
2. 微信 `list: null` 时墨问检查照常执行（直接调 `runMowenSubscriptionCheck` 的既有单测已覆盖编排层；ipc 层断言组装回调调用了它——用注入 `downloadNote`/`logCheck` 的 mock 收集调用证据）。

- [ ] **Step 4: 全量回归 + Commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json
git add electron/ tests/
git commit -F /tmp/m63-t3-msg.txt   # message: feat(mowen): subscription ipc and shared scheduler tick (M63 T3)
```

---

### Task 4: 订阅页墨问 tab（renderer）

**Files:**
- Create: `src/renderer/components/subscription/MowenPanel.tsx`
- Modify: `src/renderer/pages/Subscriptions.tsx`（顶部平台 Segmented：公众号 / 墨问作者；默认公众号，Tab 状态不持久化——会话内记忆即可）
- Modify: `src/renderer/api.ts`（新增 6 个方法声明 + preload 透传）
- Modify: `electron/preload.ts`（透传）
- Test: `tests/e2e/gui.e2e.mjs`（追加墨问 tab 断言）

**Interfaces:**
- Consumes: Task 3 的 6 个 IPC 通道；`api.mowenSearchUsers`（M61 既有）；微信面板的行内检查/展开/勾选交互模式（M40/M58）。
- Produces: `api.mowenSubsList() / mowenSubsAdd(keyword, uid?) / mowenSubsRemove(uid) / mowenSubsCheckNow(uids?) / mowenSubsDownloadNotes(uid, noteIds) / mowenSubsDismissNotes(uid, noteIds)`；`onMowenSubsUpdated(cb)`。

- [ ] **Step 1: api.ts + preload.ts 通道声明**

`src/renderer/api.ts` 的 interface（`SubscriptionsState` 附近）加：

```typescript
export interface MowenSubsState { authors: MowenSubscribedAuthor[]; lastRunAt: number | null }
// MowenSubscribedAuthor 类型从 core 类型 re-export（type-only，红线安全——同 SubscribedAccount 模式）
export interface MowenSubsAddResult { ok: boolean; authors?: { uid: string; name: string; intro: string; homeUrl: string }[]; error?: { code: string; message: string } }
```

方法（形状对齐 Task 3 通道）：

```typescript
  mowenSubsList(): Promise<MowenSubsState>
  mowenSubsAdd(keyword: string, uid?: string): Promise<MowenSubsAddResult>
  mowenSubsRemove(uid: string): Promise<void>
  mowenSubsCheckNow(uids?: string[]): Promise<{ authors: number; newFound: number; failed: number; note?: string; results: { uid: string; name: string; ok: boolean; newFound: number; error?: string }[] }>
  mowenSubsDownloadNotes(uid: string, noteIds: string[]): Promise<{ downloaded: number; existed: number; failed: number }>
  mowenSubsDismissNotes(uid: string, noteIds: string[]): Promise<void>
  onMowenSubsUpdated(cb: () => void): () => void
```

`electron/preload.ts` 对应 `ipcRenderer.invoke` 透传 + `onMowenSubsUpdated` 订阅（照抄 `onSubscriptionsUpdated` 模式）。

- [ ] **Step 2: MowenPanel 组件**

结构（对齐微信面板既有交互，不造新交互范式）：

```tsx
// src/renderer/components/subscription/MowenPanel.tsx
// 墨问作者订阅面板（M63 R4a）。结构对齐微信面板：搜索添加 → 列表（行内检查/展开新笔记/勾选下载/忽略）。
// 交互从微信面板照抄的：行内检查 loading 按 uid 记、新笔记展开按 uid 记、勾选按 uid 记。
// mocli 未装：api.mowenSubsAdd 返回 MOCLI_NOT_FOUND → 整页显示安装指引（与墨问下载 tab 同文案）。
```

状态与行为（完整实现时遵循）：
- `authors` / `loading` / `checkingIds: string[]` / `expanded: Record<string, boolean>` / `selected: Record<string, string[]>` / `kw` / `candidates: MowenUser[]`
- 搜索：`api.mowenSubsAdd(kw)` → `result.authors` 渲染候选卡（**昵称 + 简介 + 主页链接**——简介一行截断 + title 全文 hover）；候选卡「订阅」按钮 → `api.mowenSubsAdd(kw, uid)` → 成功清空候选、刷新列表
- 列表行：作者名 / 简介快照（`Text type="secondary"` 截断）/ `新笔记 N` 徽标（`newNotes` 里 `status==='pending'` 数）/ 最近检查时间 / 行内「检查」/「删除」（Popconfirm）
- 行内「检查」：`api.mowenSubsCheckNow([uid])` → 行内结果态（`N 篇新笔记` 或错误信息，失败不淡出）
- 展开新笔记：逐条 标题（`<a>` 开浏览器）/ 发布时间 / 勾选；「下载选中」→ `api.mowenSubsDownloadNotes`；「忽略」→ `api.mowenSubsDismissNotes`
- data-testid：`mowen-subs-tab`、`mowen-subs-kw`、`mowen-subs-candidate`、`mowen-subs-author-row`、`mowen-subs-check-btn`、`mowen-subs-new-note`

- [ ] **Step 3: Subscriptions.tsx 挂 Tab**

页面顶部（现有「策略常驻可见」条之下）加 antd `Segmented`：

```tsx
const [platform, setPlatform] = useState<'wechat' | 'mowen'>('wechat')
// 渲染：
<Segmented value={platform} onChange={(v) => setPlatform(v as 'wechat' | 'mowen')}
  options={[{ label: '公众号', value: 'wechat' }, { label: '墨问作者', value: 'mowen' }]}
  data-testid="subs-platform-tab" />
{platform === 'wechat' ? <WechatPanel（现有 JSX 原地保留）/> : <MowenPanel />}
```

现有微信面板 JSX **整体原样保留**（不重排、不改 className——e2e 既有断言依赖 DOM 结构），仅包进条件渲染。若现有 JSX 是页面主体不易包裹，抽 `WechatPanel` 组件到同文件（不新建文件，避免 import 环）。

- [ ] **Step 4: e2e 断言（gui.e2e.mjs 追加）**

```javascript
// —— M63 R4a：订阅页平台 tab ——
await t.test('subscriptions: mowen tab renders with install-guide or list (isolated env has no mocli)', async () => {
  await page.click('[data-testid="nav-subscriptions"]')   // 选择器以既有 e2e 为准
  await page.waitForSelector('[data-testid="subs-platform-tab"]')
  await page.click('.ant-segmented-item:nth-child(2)')     // 墨问作者
  // 隔离 e2e 环境无 mocli → 面板显示安装指引；真机态由 live 验收覆盖
  await page.waitForSelector('text=未检测到 mocli')
})
```

（选择器按既有 e2e 文件的实际导航 testid 修正；antd Segmented 的 DOM 结构以真机 DOM 为准——写之前跑一次 `npm run dev` 手点确认。Antd 两汉字按钮自动插空格坑适用：「墨问作者」在 DOM 里可能是「墨问 作者」，用 testid 不用文本。）

- [ ] **Step 5: 全量验证 + Commit**

```bash
npm test && npx tsc --noEmit -p tsconfig.json && env -u ELECTRON_RUN_AS_NODE npm run test:e2e
git add src/renderer/ electron/preload.ts tests/e2e/gui.e2e.mjs
git commit -F /tmp/m63-t4-msg.txt   # message: feat(mowen): subscription panel tab in subscriptions page (M63 T4)
```

---

### Task 5: CLI 四命令

**Files:**
- Modify: `src/cli/index.ts`（`mowen` 命令组追加 subscribe / unsubscribe / list / check-now）
- Test: `tests/cli/mowen-commands.test.ts`（追加；对齐 M60 既有 mowen 命令测试的 mock 模式）

**Interfaces:**
- Consumes: Task 1/2 产出；M60 的 `mowenRunnerOf` 前置检测模式（`src/cli/index.ts:611`）。
- Produces: 四个命令的 stdout JSON 契约（agent 消费）：

```typescript
// wx-kit mowen subscribe --keyword "池建强"          → { ok:true, candidates:[{uid,name,intro,homeUrl}] }
// wx-kit mowen subscribe --keyword "池建强" --uid X   → { ok:true, subscribed:{uid,name,intro} }
// wx-kit mowen unsubscribe --uid X                   → { ok:true, removed:1 }
// wx-kit mowen list                                  → { ok:true, authors:[{uid,name,intro,watermark,lastCheckedAt,newCount,newNotes:[...]}] }
// wx-kit mowen check-now [--uid X]                   → MowenCheckResult（透传）+ { ok:true }
```

- [ ] **Step 1: 写失败测试**

对齐 M60 mowen 命令测试的 mock 方式（读 `tests/cli/mowen-commands.test.ts` 现有 helper，复用其 runner 注入路径）。新增用例：

```typescript
it('mowen subscribe --keyword 输出候选（含 intro）', ...)      // mock searchUsers 返回真机锚点形态
it('mowen subscribe --uid 订阅入库，watermark≈now，重复订阅报 ALREADY_SUBSCRIBED', ...)
it('mowen unsubscribe --uid 退订', ...)
it('mowen list 输出订阅列表含 newNotes 摘要', ...)
it('mowen check-now 透传编排结果；mocli 未装出指引 exit 1', ...)  // 对齐 M60 MOCLI_NOT_FOUND 断言
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

`src/cli/index.ts` 的 mowen 组内追加（`mowenRunnerOf` 复用；存储 `new MowenSubscriptions(libraryRoot)`，libraryRoot 取法照抄同文件 `library`/`subscription` 命令的既有取法）：

```typescript
  mowen
    .command('subscribe')
    .description('订阅墨问作者(先搜索确认,再带 --uid 订阅)')
    .requiredOption('--keyword <kw>', '作者名字关键词')
    .option('--uid <uid>', '确认订阅的作者 uid(来自候选列表)')
    .action(async (opts) => { /* runner 前置 → uid ? 订阅(hasAuthor 幂等报错) : 输出候选 */ })
  mowen
    .command('unsubscribe').description('退订墨问作者')
    .requiredOption('--uid <uid>', '作者 uid').action(/* removeAuthor */)
  mowen
    .command('list').description('墨问作者订阅列表(含新笔记摘要)')
    .action(/* list + 每作者 newNotes 里 pending 数与明细 */)
  mowen
    .command('check-now').description('立即检查墨问订阅更新')
    .option('--uid <uid>', '只检查该作者')
    .action(/* runner 前置 → runMowenSubscriptionCheck('manual', …) 透传结果 */)
```

实现要点：
- `check-now` 在 CLI 侧组装 deps：runner 用 `mowenRunnerOf()` 的产物（未装则前面已 exit 1——但 PRD 要求 check-now 对「未装」也如实报，`mowenRunnerOf` 的早退已覆盖，返回 code `MOCLI_NOT_FOUND`）；
- `subscribe --uid` 的订阅水 basement：`watermark: Math.floor(Date.now() / 1000)`；
- CLI 不写检查行日志（无 userData 上下文与 GUI 不一致——检查日志只在 GUI 进程落盘；CLI `check-now` 输出即记录。与微信 `subscription check-now` 现行为对齐，实现时核实微信侧是否落盘——若微信 CLI 也落盘则对齐它）。

- [ ] **Step 4: 跑绿 + Commit**

```bash
npx vitest run tests/cli/mowen-commands.test.ts && npm test
git add src/cli/index.ts tests/cli/mowen-commands.test.ts
git commit -F /tmp/m63-t5-msg.txt   # message: feat(mowen): subscribe/unsubscribe/list/check-now commands (M63 T5)
```

---

### Task 6: 真机验收 + 文档同步

**Files:**
- Modify: `docs/PRD-v0.11.0.md`（§6 R4 验收逐条勾选）
- Modify: `ROADMAP.md`（里程碑表加 M63 行；「当前状态」的 R4 描述补「已完成」）
- Modify: `docs/devlog/wx-kit-vibe-coding.md`（M63 实录）
- Modify: `agent/wx-kit-skill/SKILL.md` + `agent/wx-kit-skill/references/`（CLI 变更同步——工作流第 7 条；新增 `mowen subscribe/unsubscribe/list/check-now` 速查与范例）

- [ ] **Step 1: 全量门禁**

```bash
npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && env -u ELECTRON_RUN_AS_NODE npm run test:e2e
```

- [ ] **Step 2: 真机验收（清代理 unset http_proxy https_proxy；开发态 CLI 用 `npx electron .`）**

1. `npx electron . mowen subscribe --keyword "池建强"` → 候选含本尊（uid `vtv_PV1fEMBb-8_BPlmDu`）与简介
2. `npx electron . mowen subscribe --keyword "池建强" --uid vtv_PV1fEMBb-8_BPlmDu` → 订阅成功，`list` 可见
3. `npx electron . mowen check-now` → 首轮 newFound=0（水位=订阅时刻，历史不回补——这是预期，不是 bug）
4. 真机验证新笔记路径：`mowen subscribe --keyword <另一位> --uid <uid>`（选一位近期有更新的作者）后手动把其 `watermark` 在 `mowen-subscriptions.json` 里调小 → `check-now` → 新笔记入列、自动下载策略生效、水位推进；复跑 → newFound=0、零下载（判重）
5. GUI：订阅页切「墨问作者」→ 列表/行内检查/展开/单篇下载/忽略 全流程手点
6. 删除订阅 → `list` 确认

- [ ] **Step 3: 文档同步（四处）**

- PRD §6 R4 逐条勾选（如实：没验到的条目不许勾）
- ROADMAP 里程碑表加 M63 行（✅，计划文档列本文件路径）；「当前状态」R4 描述补完成态
- devlog M63 实录：真机坑（若有）+ 方法论
- skill：`SKILL.md` 速查表加四命令；references 命令参考与范例同步

- [ ] **Step 4: Commit（合 main 删分支按工作流）**

```bash
git add docs/ agent/ ROADMAP.md
git commit -F /tmp/m63-t6-msg.txt   # message: docs(m63): mowen subscriptions verified, sync PRD/ROADMAP/devlog/skill
```

---

## Self-Review 记录（写计划时已核）

1. **Spec 覆盖**：PRD §6 R4 验收逐条 → R4a 五条 = Task 4（tab/搜索/重复防护/列表行/未装指引）+ Task 3（重复防护在 IPC）；R4b 七条 = Task 2（水位/去重/失败类型/自动下载/日志/platform）+ Task 3（调度共用）；R4c 五条 = Task 1（存储/订阅基线）+ Task 5（四命令）。无缺口。
2. **占位扫描**：Task 3 Step 1 有一条显式标注的占位测试，实现后必须替换为真断言（已在任务内写明，self-review 会查）；其余任务无 TBD/无「类似 Task N」。
3. **类型一致性**：`MowenNoteRef.status`/`MowenCheckResult`/IPC 通道名在 Task 1→2→3→4→5 间逐一核对一致；`MowenNoteUnavailable` 判定统一 instanceof 真类（M61 坑）。
4. **对 PRD 的一处修正**（实现依据真机，PRD 措辞已按此理解执行）：「翻到水位为止就停」不安全——`note_ids` 非严格 publicAt 倒序（2026-09-13 真机实证），count=20 全量过滤即等价且零额外请求。
