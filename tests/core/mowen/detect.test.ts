// tests/core/mowen/detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectMocli } from '../../../src/core/mowen/detect'
import type { MocliRunner } from '../../../src/core/mowen/types'
import type { WhichRunner } from '../../../src/core/mowen/detect'

// 真实 mocli 输出去前实测：`mocli version v0.5.4 (PROD-BUILD on 2026-08-31T16:24:45)`
const versionOk: MocliRunner = async () => ({ code: 0, stdout: 'mocli version v0.5.4 (PROD-BUILD on 2026-08-31T16:24:45)\n', stderr: '' })
const versionNoV: MocliRunner = async () => ({ code: 0, stdout: 'mocli version 0.5.4 (build)\n', stderr: '' })
const versionOnStderr: MocliRunner = async () => ({ code: 0, stdout: '', stderr: 'mocli version v1.0.0-rc1 (canary)\n' })
const versionNoMocli: MocliRunner = async () => ({ code: 0, stdout: 'unknown version reporter v9.9\n', stderr: '' })
const versionFail: MocliRunner = async () => ({ code: 1, stdout: '', stderr: 'boom' })
// which 系统命令探测
const whichFound: WhichRunner = async () => ({ code: 0, stdout: '/usr/local/bin/mocli\n' })
const whichMissing: WhichRunner = async () => ({ code: 1, stdout: '' })
const whichThrows: WhichRunner = async () => { throw new Error('spawn which ENOENT') }

describe('detectMocli', () => {
  it('未安装（which 退出码非零）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichMissing)).toEqual({ installed: false, path: null, version: null })
  })

  it('which 命令本身不存在（抛错）→ installed:false，不抛', async () => {
    expect(await detectMocli(versionOk, whichThrows)).toEqual({ installed: false, path: null, version: null })
  })

  it('装了：v0.5.4 真实输出 → 路径 + 剥前缀的版本号', async () => {
    const calls: string[][] = []
    const spyRunner: MocliRunner = async (args) => { calls.push(args); return versionOk(args) }
    const r = await detectMocli(spyRunner, whichFound)
    expect(r).toEqual({ installed: true, path: '/usr/local/bin/mocli', version: '0.5.4' })
    expect(calls[0]).toContain('--version')
  })

  it('装了但 --version 不含 mocli 字样（输出异常）→ installed true、version null', async () => {
    expect(await detectMocli(versionNoMocli, whichFound)).toMatchObject({ installed: true, version: null })
  })

  it('版本在 stderr（M60 实录：失败时 JSON 走 stderr）也能解析', async () => {
    expect(await detectMocli(versionOnStderr, whichFound)).toMatchObject({ installed: true, version: '1.0.0-rc1' })
  })

  it('无 v 前缀的版本也能解析', async () => {
    expect(await detectMocli(versionNoV, whichFound)).toMatchObject({ installed: true, version: '0.5.4' })
  })

  it('装了但 --version 失败（不可执行） → installed true、version null', async () => {
    const r = await detectMocli(versionFail, whichFound)
    expect(r.installed).toBe(true)
    expect(r.version).toBeNull()
  })
})