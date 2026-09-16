// tests/cli/library-batch.test.ts
// 票据 07:文库浏览/搜索/过滤/删除 + 批量进度/取消/重试(CLI 缝)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Library } from '../../src/core/library'

const network = vi.hoisted(() => ({ factory: vi.fn(), gateway: vi.fn(), html: vi.fn(), binary: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    network.gateway.mockResolvedValue({})
    return { resume: network.gateway, fetchText: network.html, fetchBinary: network.binary }
  },
}))
import { runCli } from '../../src/cli'

const page = (title: string, account: string, mid: string) =>
  `<html><body><h1 id="activity-name">${title}</h1><span id="js_name">${account}</span>`
  + `<em id="publish_time">2026-09-01 08:00</em><div id="js_content"><p>正文</p></div>`
  + `<script>var biz = "MzYzNDg1MDcyNQ=="; var mid = "${mid}"; var idx = "1";</script></body></html>`

let root: string, userDataDir: string, stdout: string, progress: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-batch-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-batch-user-'))
  stdout = ''
  progress = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => { progress += value; return true })
  for (const mock of Object.values(network)) mock.mockReset()
  network.gateway.mockResolvedValue({})
  // 无标题错误页:标题为空 → describeUnavailable 认出"审核未通过" → unavailable 真失败
  // 注意网关 fetchText(kind, url, timeout) 三参:mock 取第二个参数才是 URL
  network.html.mockImplementation(async (_kind: string, url: string) => {
    if (url.includes('dead')) return '<html><body>此内容发送失败无法查看,(#2003)</body></html>'
    // 不同 URL 给不同 mid:否则两篇都归一到同一主键,第二篇被判重跳过
    if (url.includes('good')) return page('批文', '批量号', '2247486019')
    return page('批文', '批量号', '2247486020')
  })
  network.binary.mockResolvedValue({ data: Buffer.from('img'), contentType: 'image/jpeg' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true })
})
async function run(...args: string[]) {
  stdout = ''
  progress = ''
  // download 命令自带 --out/--formats;library 子命令把 --out 插到子命令后
  const argv = args[0] === 'download'
    ? ['download', '--out', root, '--formats', 'md,meta', ...args.slice(1)]
    : [args[0], args[1], '--out', root, ...args.slice(2)]
  const code = await runCli(argv, { userDataDir })
  return { code, result: JSON.parse(stdout) }
}
async function seed(id: string, title: string, account: string) {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'content.md'), `# ${title}`)
  await new Library(root).add({
    id, title, account, author: '', publishTime: '2026-09-01 08:00',
    downloadTime: '2026-09-16T00:00:00Z', sourceUrl: `https://mp.weixin.qq.com/s/${id}`,
    formats: ['md'], dir, digest: '', coverUrl: '',
  })
}

describe('文库浏览与批量(票据 07)', () => {
  it('list/search/account 过滤三件套可用', async () => {
    await seed('a1', '甲文章', '甲号')
    await seed('a2', '乙文章', '乙号')
    const list = await run('library', 'list')
    expect(list.code).toBe(0)
    expect(list.result.items).toHaveLength(2)
    const search = await run('library', 'search', '甲文章')
    expect(search.result.items).toHaveLength(1)
    expect(search.result.items[0]).toMatchObject({ account: '甲号' })
    const filtered = await run('library', 'list', '--account', '乙号')
    expect(filtered.result.items).toHaveLength(1)
    expect(filtered.result.items[0]).toMatchObject({ title: '乙文章' })
  })

  it('remove 按 id 删除索引与目录', async () => {
    await seed('a1', '待删文', '甲号')
    const { code, result } = await run('library', 'remove', '--ids', 'a1')
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, removed: 1 })
    expect(await new Library(root).list()).toHaveLength(0)
  })

  it('批量下载逐篇上报进度,失败单篇可按 URL 重试且成功篇不重下', async () => {
    const { writeFile: wf } = await import('node:fs/promises')
    const urlsFile = join(root, 'urls.txt')
    await wf(urlsFile, 'https://mp.weixin.qq.com/s/good\nhttps://mp.weixin.qq.com/s/dead\n')
    const first = await run('download', '--urls-file', urlsFile)
    expect(first.result.total).toBe(2)
    expect(first.result.succeeded).toBe(1)
    expect(first.result.failed).toBe(1)
    expect(first.result.ok).toBe(false)
    expect(first.code).toBe(1)
    // 错误页被认出"审核未通过" → unavailable(重试无用),与真故障区分
    expect(first.result.items[1]).toMatchObject({ ok: false, unavailable: true })
    // 进度上报到 stderr:逐篇 fetch/save 或 failed 阶段
    expect(progress).toContain('2/2')
    const retry = await run('download', '--url', 'https://mp.weixin.qq.com/s/dead')
    expect(retry.code).toBe(1)
    expect(retry.result).toMatchObject({ failed: 1 })
    // 成功篇已在库:按原 URL 重下即跳过,不复制
    const again = await run('download', '--url', 'https://mp.weixin.qq.com/s/good')
    expect(again.result).toMatchObject({ succeeded: 0, skipped: 1 })
  })
})
