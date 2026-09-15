// src/core/mowen/detect.ts
// mocli 安装检测（PRD v0.11.0 R3）。只回答「装没装、在哪、什么版本」，
// 不管业务调用（那是 metadata.ts）。未安装是正常态，不抛错。
//
// 陷阱（M60 实录）：which/where 是系统命令，不是 mocli 子命令——最初把两者塞进同一个
// MocliRunner，结果真实执行的是 `mocli which mocli`（mocli 把 which 当子命令，INTERNAL 255），
// 真机上永远「未检测到」。故探测系统命令用独立的 WhichRunner，mocli 业务调用才走 MocliRunner。
// 陷阱二（v0.11.0 实录）：GUI 启动的进程只有系统最小 PATH，which 找不到 nvm/homebrew 里的
// mocli——路径定位已下沉到 locate.ts 的三级探测链（which → 安装位 → login shell）。
import type { MocliRunner } from './types'
import { locateMocli } from './locate'
import { injectPathDir } from './runner'
import type { LocateDeps } from './locate'

export interface MocliDetectResult { installed: boolean; path: string | null; version: string | null }

/** 系统命令探测（which/where），独立于 MocliRunner——它跑的不是 mocli。 */
export type WhichRunner = (cmd: string, arg: string) => Promise<{ code: number; stdout: string }>

export async function detectMocli(run: MocliRunner, which: WhichRunner, locateDeps?: LocateDeps): Promise<MocliDetectResult> {
  // 定位走探测链；不传 deps 时等价旧版「仅 which」（GUI/CLI 调用方应传 runner.ts 的真实 deps）
  const path = await locateMocli(which, { ...locateDeps, platform: locateDeps?.platform ?? process.platform })
  if (!path) return { installed: false, path: null, version: null }
  // 版本探测前必须注入：execFile('mocli') 与其 shebang `env node` 都靠 PATH 可达——
  // 注入晚于 version 探测会让 GUI 场景 version 恒 null（实测踩过）。收口在此，调用方无需再注入。
  injectPathDir(path)

  // 版本探测失败不影响「已安装」结论
  let version: string | null = null
  try {
    const v = await run(['--version'])
    const m = /version\s+(\S+)/.exec(v.stdout)
    version = m ? m[1] : null
  } catch { /* keep null */ }
  return { installed: true, path, version }
}
