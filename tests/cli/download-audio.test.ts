// tests/cli/download-audio.test.ts
// 票据 voice-03 RED:CLI 音频接线尚不存在(镜像 download-archive.test.ts)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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

const page = `<html><body><h1 id="activity-name">语音文章</h1><span id="js_name">音频号</span>`
  + `<em id="publish_time">2026-09-18 08:00</em><div id="js_content"><p>正文</p>`
  + `<mp-common-mpaudio voice_encode_fileid="VOICE1" name="U1 单词" play_length="30000"></mp-common-mpaudio></div>`
  + `<script>var biz = "MzYzNDg1MDcyNQ=="; var mid = "2247540994"; var idx = "2";</script></body></html>`

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-audcli-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-audcli-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  for (const mock of Object.values(network)) mock.mockReset()
  network.gateway.mockResolvedValue({})
  network.html.mockResolvedValue(page)
  network.binary.mockResolvedValue({ data: Buffer.from('MP3'), contentType: 'audio/mpeg' })
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

describe('download 音频接线(票据 voice-03,内联原位+标题命名)', () => {
  it('默认下载音频:文件名取标题,meta 记 voiceId', async () => {
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/aud1')
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, succeeded: 1 })
    const [meta] = await new Library(root).list()
    expect(meta.audios).toHaveLength(1)
    expect(meta.audios?.[0]).toMatchObject({ voiceId: 'VOICE1', title: 'U1 单词', path: 'audios/U1 单词.mp3' })
    expect(network.binary.mock.calls.some((c) => String(c[0]).includes('getvoice'))).toBe(true)
    // 文件真实落盘(不只记 meta)
    const { existsSync, readFileSync } = await import('node:fs')
    const { join: joinPath } = await import('node:path')
    const p = joinPath(meta.dir, 'audios', 'U1 单词.mp3')
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p).toString()).toBe('MP3')
    // md 链接文字与标题一致(链接上写什么,文件就叫什么)
    const md = readFileSync(joinPath(meta.dir, 'content.md'), 'utf-8')
    expect(md).toContain('U1 单词')
  })

  it('--no-audio 跳过:不请求 getvoice,记录无路径,正文留说明', async () => {
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/aud1', '--no-audio')
    expect(code).toBe(0)
    expect(result.ok).toBe(true)
    expect(network.binary.mock.calls.some((c) => String(c[0]).includes('getvoice'))).toBe(false)
    const [meta] = await new Library(root).list()
    expect(meta.audios?.[0]?.path).toBeUndefined()
    // 说明落进正文(md 后缀),不是静默跳过
    const { readFileSync } = await import('node:fs')
    const { join: joinPath } = await import('node:path')
    const md = readFileSync(joinPath(meta.dir, 'content.md'), 'utf-8')
    expect(md).toContain('未下载')
    // JSON 汇总区分音频告警(不混入文章失败)
    expect(result).toMatchObject({ ok: true, succeeded: 1 })
  })
})
