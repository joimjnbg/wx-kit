// src/core/mowen/detect.ts
// mocli 安装检测（PRD v0.11.0 R3）。只回答「装没装、在哪、什么版本」，
// 不管业务调用（那是 metadata.ts）。未安装是正常态，不抛错。
//
// 陷阱（M60 实录）：which/where 是系统命令，不是 mocli 子命令——最初把两者塞进同一个
// MocliRunner，结果真实执行的是 `mocli which mocli`（mocli 把 which 当子命令，INTERNAL 255），
// 真机上永远「未检测到」。故探测系统命令用独立的 WhichRunner，mocli 业务调用才走 MocliRunner。
import type { MocliRunner } from './types'

export interface MocliDetectResult { installed: boolean; path: string | null; version: string | null }

/** 系统命令探测（which/where），独立于 MocliRunner——它跑的不是 mocli。 */
export type WhichRunner = (cmd: string, arg: string) => Promise<{ code: number; stdout: string }>

export async function detectMocli(run: MocliRunner, which: WhichRunner): Promise<MocliDetectResult> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  let path: string | null = null
  try {
    const r = await which(whichCmd, 'mocli')
    path = r.code === 0 ? r.stdout.trim().split(/\r?\n/)[0] || null : null
  } catch {
    return { installed: false, path: null, version: null }
  }
  if (!path) return { installed: false, path: null, version: null }

  // 版本探测失败不影响「已安装」结论（v0.5.5 实录：用户实测输出
  // `mocli version v0.5.4 (PROD-BUILD ...)`，早期正则 /version\s+(\S+)/ 把 'v' 一起吞进版本号，
  // 后续做版本比较会出错）。两段独立判定：(1) 含 mocli 字样是「装了」官方证据；
  // (2) 抓 v?X.Y.Z 形式的版本号串——前缀 v 可选，去前导零不影响。
  let version: string | null = null
  try {
    const v = await run(['--version'])
    const out = v.stdout + (v.stderr || '')
    if (/\bmocli\b/i.test(out)) {
      const m = /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(out)
      version = m ? m[1] : null
    } else {
      // 含 mocli 字样的版本输出都缺失——视为版本未知，installed 仍为 true
      version = null
    }
  } catch { /* keep null */ }
  return { installed: true, path, version }
}
