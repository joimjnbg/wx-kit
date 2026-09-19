// tests/cli/urllist-command.test.ts
// 票据 urllist-02 RED:URL 清单 CLI(解析 + 下载)尚无接线测试。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const network = vi.hoisted(() => ({ factory: vi.fn(), gateway: vi.fn(), html: vi.fn(), binary: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    const gateway = { resume: network.gateway, fetchText: network.html, fetchBinary: network.binary }
    network.gateway.mockResolvedValue({})
    return gateway
  },
}))
import { runCli } from '../../src/cli'
import { Library } from '../../src/core/library'

const page = (title: string, mid: string, audio = false) =>
  `<html><body><h1 id="activity-name">${title}</h1><span id="js_name">清单号</span>`
  + `<em id="publish_time">2026-09-19 08:00</em><div id="js_content"><p>正文</p>`
  + (audio ? `<mp-common-mpaudio voice_encode_fileid="VOICEX" name="U1" play_length="30000"></mp-common-mpaudio>` : '')
  + `</div>`
  + `<script>var biz = "MzYzNDg1MDcyNQ=="; var mid = "${mid}"; var idx = "2";</script></body></html>`

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-urlcli-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-urlcli-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  for (const mock of Object.values(network)) mock.mockReset()
  network.gateway.mockResolvedValue({})
  network.html.mockImplementation(async (_kind: string, url: string) =>
    url.includes('aaa1') ? page('文:aaa1', '2247540994') : page(`文:${url.slice(-4)}`, '2247540995'))
  network.binary.mockImplementation(async (url: string) => {
    if (String(url).includes('getvoice')) return { data: Buffer.from('MP3'), contentType: 'audio/mpeg' }
    return { data: Buffer.from('img'), contentType: 'image/jpeg' }
  })
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

describe('download URL 清单(票据 urllist-02)', () => {
  it('--urls-file 批量落盘:两篇 fixture 各成档案', async () => {
    const f = join(root, 'urls.txt')
    await writeFile(f, 'https://mp.weixin.qq.com/s/aaa1\nhttps://mp.weixin.qq.com/s/bbb2\n')
    const { code, result } = await run('--urls-file', f)
    expect(code).toBe(0)
    expect(result.total).toBe(2)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(await new Library(root).list()).toHaveLength(2)
  })

  it('清单内无效行不炸整批:有效照下,无效记失败', async () => {
    const f = join(root, 'urls.txt')
    await writeFile(f, 'https://mp.weixin.qq.com/s/aaa1\nnot-a-url\n')
    const { code, result } = await run('--urls-file', f)
    expect(result.total).toBe(2)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.items[1]).toMatchObject({ ok: false })
    expect(code).toBe(1)
  })

  it('含语音文章默认落音频;--no-audio 跳过且正文留说明', async () => {
    network.html.mockImplementation(async (_kind: string, url: string) =>
      url.includes('audx2') ? page('语音文2', '2247540997') : page('语音文', '2247540996', true))
    const { result } = await run('--url', 'https://mp.weixin.qq.com/s/audx')
    expect(result.succeeded).toBe(1)
    const [meta] = await new Library(root).list()
    expect(meta.audios).toHaveLength(1)
    expect(meta.audios?.[0].path).toBe('audios/audio-1.mp3')
    const { result: r2 } = await run('--url', 'https://mp.weixin.qq.com/s/audx2', '--no-audio')
    expect(r2.succeeded).toBe(1)
    const lib = await new Library(root).list()
    expect(lib).toHaveLength(2)
    expect(lib[1].audios ?? []).toHaveLength(0)
  })
})
