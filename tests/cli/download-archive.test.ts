// tests/cli/download-archive.test.ts
// 票据 06:整篇下载到 Whole-article archive,判重跳过,失败分类诚实(CLI 缝)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const network = vi.hoisted(() => ({ factory: vi.fn(), gateway: vi.fn(), html: vi.fn(), binary: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    // download 命令先调 gateway.resume() 再取 fetchers:mock 网关需同时提供两条
    const gateway = { resume: network.gateway, fetchText: network.html, fetchBinary: network.binary }
    network.gateway.mockResolvedValue({})
    return gateway
  },
}))
import { runCli } from '../../src/cli'
import { Library } from '../../src/core/library'

const page = (title: string, body = '<p>正文</p>') =>
  `<html><body><h1 id="activity-name">${title}</h1><span id="js_name">档案号</span>`
  + `<em id="publish_time">2026-09-01 08:00</em><div id="js_content">${body}</div>`
  + `<script>var biz = "MzYzNDg1MDcyNQ=="; var mid = "2247486019"; var idx = "1";</script></body></html>`

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-arch-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-arch-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  for (const mock of Object.values(network)) mock.mockReset()
  network.html.mockResolvedValue(page('档案文章'))
  network.binary.mockResolvedValue({ data: Buffer.from('img'), contentType: 'image/jpeg' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true })
})
async function run(...args: string[]) {
  stdout = ''
  const code = await runCli(['download', '--out', root, '--formats', 'md,meta', ...args], { userDataDir })
  return { code, result: JSON.parse(stdout) }
}

describe('download 落整篇档案(票据 06)', () => {
  it('文本+元信息落盘:content.md 与 meta.json 含标题与告警位', async () => {
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/t1')
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, succeeded: 1 })
    const lib = new Library(root)
    const all = await lib.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: '档案文章' })
    const dir = all[0].dir
    expect(await readdir(dir)).toEqual(expect.arrayContaining(['content.md', 'meta.json']))
    expect(await readFile(join(dir, 'content.md'), 'utf8')).toContain('档案文章')
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    expect(meta.title).toBe('档案文章')
  })

  it('重下同一篇跳过不复制:第二轮 skipped 且库仍一篇', async () => {
    await run('--url', 'https://mp.weixin.qq.com/s/t1')
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/t1')
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, succeeded: 0, skipped: 1 })
    expect(await new Library(root).list()).toHaveLength(1)
  })

  it('读者打不开的错误页报 unavailable 而非笼统失败', async () => {
    network.html.mockResolvedValue('<html><body>此内容发送失败无法查看</body></html>')
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/dead')
    expect(code).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(1)
    // 单篇 download 汇总只给 unavailable;realFailures 是批量 crawl 层的派生字段
    expect(result.items[0]).toMatchObject({ ok: false, unavailable: true })
    expect(await new Library(root).list()).toHaveLength(0)
  })
})
