// tests/core/mowen/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectMocli } from '../../../src/core/mowen/detect'
import type { MocliRunner } from '../../../src/core/mowen/types'
import type { WhichRunner } from '../../../src/core/mowen/detect'
import type { LocateDeps } from '../../../src/core/mowen/locate'

// mocli 业务 runner(--version)
const versionOk: MocliRunner = async () => ({ code: 0, stdout: 'mocli version v0.5.4 (PROD-BUILD on 2026-08-31T16:24:45)\n', stderr: '' })
const versionFail: MocliRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' })
// which 系统命令探测
const whichFound: WhichRunner = async () => ({ code: 0, stdout: '/usr/local/bin/mocli\n' })
const whichMissing: WhichRunner = async () => ({ code: 1, stdout: '' })
const whichThrows: WhichRunner = async () => { throw new Error('spawn which ENOENT') }

// detectMocli 会注入 process.env.PATH（locate 检出后、version 探测前）——保存/恢复防跨用例污染
let savedPath: string | undefined
beforeEach(() => { savedPath = process.env.PATH })
afterEach(() => { process.env.PATH = savedPath })

describe('detectMocli', () => {
  it('未安装（which 退出码非零）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichMissing)).toEqual({ installed: false, path: null, version: null })
  })

  it('which 命令本身不存在（抛错）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichThrows)).toEqual({ installed: false, path: null, version: null })
  })

  it('装了：which 给路径，--version 解析出版本号', async () => {
    const calls: string[][] = []
    const spyRunner: MocliRunner = async (args) => { calls.push(args); return versionOk(args) }
    const r = await detectMocli(spyRunner, whichFound)
    expect(r).toEqual({ installed: true, path: '/usr/local/bin/mocli', version: 'v0.5.4' })
    expect(calls[0]).toContain('--version')
  })

  it('装了但 --version 失败 → installed 仍 true，version null', async () => {
    const r = await detectMocli(versionFail, whichFound)
    expect(r.installed).toBe(true)
    expect(r.version).toBeNull()
  })

  it('PATH 注入必须先于 version 探测：安装位检出后，version runner 执行时 PATH 已含其目录（GUI 场景时序，打包产物实测踩过）', async () => {
    const nvmBin = '/Users/tom/.nvm/versions/node/v24.12.0/bin'
    const deps: LocateDeps = {
      platform: 'darwin',
      env: { HOME: '/Users/tom', SHELL: '/bin/zsh' },
      exists: async (p) => p === `${nvmBin}/mocli`,
      listDir: async (d) => (d === '/Users/tom/.nvm/versions/node' ? ['v24.12.0'] : null),
    }
    let pathAtVersionProbe: string | undefined
    const probeRunner: MocliRunner = async () => {
      pathAtVersionProbe = process.env.PATH
      return versionOk([])
    }
    const r = await detectMocli(probeRunner, whichMissing, deps)
    expect(r).toEqual({ installed: true, path: `${nvmBin}/mocli`, version: 'v0.5.4' })
    // version 探测当刻 PATH 已含 mocli 目录（且不在调用前的初始 PATH 里）
    expect((pathAtVersionProbe ?? '').split(':')).toContain(nvmBin)
  })
})
