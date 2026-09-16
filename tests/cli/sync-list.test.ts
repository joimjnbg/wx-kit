// tests/cli/sync-list.test.ts
// 票据 04:同步列表身份稳定、可重入、无重复行(CLI 缝)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Subscriptions } from '../../src/core/subscriptions'

const network = vi.hoisted(() => ({ factory: vi.fn(), cover: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    return { requestWereadJson: network.cover, fetchText: vi.fn(), fetchBinary: vi.fn() }
  },
}))
import { runCli } from '../../src/cli'

const BOOK = 'MP_WXS_3634850725'
const REVIEW = `${BOOK}_TOKENAAA`
const coverPayload = { reviewId: REVIEW, title: '最新文章', pic: 'http://pic', name: '种子号' }

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-sync-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-sync-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  for (const mock of Object.values(network)) mock.mockReset()
  network.cover.mockImplementation(async (_kind: string, raw: string) => {
    const url = new URL(raw)
    if (url.pathname !== '/api/mp/cover') throw new Error('只允许 cover 取件')
    return { ...coverPayload }
  })
  await writeFileCreds()
  const subs = new Subscriptions(root)
  await subs.addAccount({ fakeid: BOOK, nickname: '种子号', subscribed: true, watermark: 100 })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true })
})
async function writeFileCreds() {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(userDataDir, 'weread-creds.json'),
    JSON.stringify({ vid: '7', accessToken: 'AT', refreshToken: 'RT', updatedAt: 0 }))
}
async function run(...args: string[]) {
  stdout = ''
  const code = await runCli(['subscription', 'check-now', '--out', root, ...args], { userDataDir })
  return { code, result: JSON.parse(stdout) }
}

describe('sync 列表身份稳定可重入(票据 04)', () => {
  it('首轮 cover 新文章进入待处理,订阅行可查且合并后携带 refId/url', async () => {
    const { code, result } = await run()
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, newFound: 1 })
    expect(result.results[0]).toMatchObject({ fakeid: BOOK, ok: true, newFound: 1 })
    // 行内 articles 只在 download 策略下落明细;提示策略下待处理行由订阅存储持有
    const subs = new Subscriptions(root)
    const rows = await subs.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].newRefs).toHaveLength(1)
    expect(rows[0].newRefs[0]).toMatchObject({ title: '最新文章' })
    const { refId } = await import('../../src/core/subscription-refs')
    expect(refId(rows[0].newRefs[0])).toMatch(/.+/)
    expect(rows[0].newRefs[0].url).toContain('mp.weixin.qq.com/s/')
  })

  it('重跑不重复报新:同一 cover 身份第二轮 newFound 归零且无重复行', async () => {
    const first = await run()
    expect(first.result.newFound).toBe(1)
    const second = await run()
    expect(second.code).toBe(0)
    expect(second.result.newFound).toBe(0)
    const subs = new Subscriptions(root)
    const rows = await subs.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].newRefs).toHaveLength(1)
    // 待处理行身份稳定:refId 与首轮一致,不是追加第二行
    expect(second.result.results[0]).toMatchObject({ newFound: 0 })
  })

  it('cover 换新文章时旧待处理保留(合并非覆盖):列表行数仍为一篇待处理两篇', async () => {
    await run()
    network.cover.mockResolvedValue({ ...coverPayload, reviewId: `${BOOK}_TOKENBBB`, title: '更新文章' })
    const { code, result } = await run()
    expect(code).toBe(0)
    expect(result.newFound).toBe(1)
    const subs = new Subscriptions(root)
    const rows = await subs.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].newRefs).toHaveLength(2)
  })
})
