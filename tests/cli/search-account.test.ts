// tests/cli/search-account.test.ts
// 票据 03:Seed URL 解析 Account(CLI 缝)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const network = vi.hoisted(() => ({ factory: vi.fn(), html: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
vi.mock('../../electron/services/mp-runtime', async (original) => ({
  ...await original<typeof import('../../electron/services/mp-runtime')>(),
  createMpRuntime: (...args: unknown[]) => {
    network.factory(...args)
    return { fetchText: network.html, requestWereadJson: vi.fn(), fetchBinary: vi.fn() }
  },
}))
import { runCli } from '../../src/cli'

// biz MzYzNDg1MDcyNQ== 解码得 3634850725 -> MP_WXS_3634850725
const PAGE = `<html><body><h1 id="activity-name">seed title</h1>`
  + `<span id="js_name"></span>`
  + `<script>var nickname = "script account"; var biz = "MzYzNDg1MDcyNQ=="; var mid = "2247486019"; var idx = "1";</script>`
  + `</body></html>`

let userDataDir: string, stdout: string
beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-search-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  network.factory.mockReset()
  network.html.mockReset()
  network.html.mockResolvedValue(PAGE)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(userDataDir, { recursive: true, force: true })
})
async function run(...args: string[]) {
  stdout = ''
  const code = await runCli(['search', ...args], { userDataDir })
  return { code, result: JSON.parse(stdout) }
}

describe('search --url resolves Account identity (ticket 03)', () => {
  it('seed URL with biz script var resolves fakeid + nickname for confirmation', async () => {
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/sometoken')
    expect(code).toBe(0)
    expect(result).toMatchObject({
      ok: true,
      account: { fakeid: 'MP_WXS_3634850725', nickname: 'script account' },
    })
    expect(result.note).toContain('尚未登录')
  })

  it('error page without biz reports NOT_FOUND as business failure (exit 1)', async () => {
    network.html.mockResolvedValue('<html><body>error page, no script vars</body></html>')
    const { code, result } = await run('--url', 'https://mp.weixin.qq.com/s/badtoken')
    expect(code).toBe(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('non-mp URL is a usage error (exit 2, zero network)', async () => {
    const { code, result } = await run('--url', 'https://example.com/s/x')
    expect(code).toBe(2)
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
    expect(network.factory).not.toHaveBeenCalled()
  })
})
