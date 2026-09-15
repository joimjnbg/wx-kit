// src/core/mowen/locate.ts
// mocli 二进制定位（探测链）：which → 常见安装位 → login shell 兜底。
//
// 背景（v0.11.0 另一台机器实录）：macOS 从 Dock/Finder 启动的 GUI 应用只拿到
// 系统最小 PATH（/usr/bin:/bin:/usr/sbin:/sbin），不加载 ~/.zshrc——nvm/volta/
// homebrew/npm-global 装的 mocli 在终端 which 得到、在 GUI 进程里永远找不到，
// 造成「装了却提示未检测到」。开发模式（npm run dev）从终端启动继承了完整 PATH，
// 所以测试期不暴露。
//
// 探测到路径后调用方还需把其目录注入 process.env.PATH：mocli 的 shebang 是
// `#!/usr/bin/env node`，env 得先解析到 node——nvm/volta/homebrew 的 bin 目录里
// mocli 与 node 同住，注入目录一次解决两个可达性。
//
// 本模块零真实 IO：exists/listDir/shellResolve 全部注入。真实默认实现在 runner.ts。
import type { WhichRunner } from './detect'

export interface LocateDeps {
  platform?: NodeJS.Platform
  env?: { HOME?: string | undefined; SHELL?: string | undefined }
  /** 路径存在性检查（注入）。 */
  exists?: (p: string) => Promise<boolean>
  /** 列目录；目录不存在返回 null（注入）。 */
  listDir?: (dir: string) => Promise<string[] | null>
  /** login shell 执行通道（注入），可 reject（超时/ENOENT 由实现侧兜）。 */
  shellResolve?: (shellBin: string, cmd: string) => Promise<{ code: number; stdout: string }>
}

/** HOME 相对的固定候选（HOME 缺失时跳过）。 */
const HOME_RELATIVE_LOCATIONS = [
  '.volta/bin/mocli',
  '.asdf/shims/mocli',
  '.npm-global/bin/mocli',
]

/** 绝对固定候选（按 Apple Silicon brew → 传统路径排序，命中即止）。 */
const ABSOLUTE_LOCATIONS = ['/opt/homebrew/bin/mocli', '/usr/local/bin/mocli']

const NVM_NODE_DIR = '.nvm/versions/node'

/** nvm 版本目录名 → 可比较的数字元组；非法名（io.js 等）返回 null。 */
function parseNvmVersion(name: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(name)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** login shell 输出里取最后一个「绝对路径形态」的行——.zshrc 可能打垃圾，只认 / 开头。 */
function lastAbsolutePathLine(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/'))
  return lines.length ? lines[lines.length - 1] : null
}

/**
 * 探测链：① which（终端启动场景一击命中，零后续开销）；
 * ② 固定安装位 + nvm 最新版本目录（纯文件系统检查，确定性）；
 * ③ login shell（$SHELL -ilc 'command -v mocli'，覆盖任意奇葩安装位，
 *    输出必须经 exists 认可才采信）。win32 不做 ②③——GUI 进程继承注册表
 *    PATH，where 本来就可靠。
 * 任何一步失败静默降级到下一步，全落空返回 null（未安装是正常态，不抛）。
 */
export async function locateMocli(which: WhichRunner, deps: LocateDeps = {}): Promise<string | null> {
  // ① which
  try {
    const r = await which(deps.platform === 'win32' ? 'where' : 'which', 'mocli')
    if (r.code === 0) {
      const p = r.stdout.trim().split(/\r?\n/)[0]
      if (p) return p
    }
  } catch { /* which 本身不可用 → 继续 */ }

  if (deps.platform === 'win32') return null

  const exists = deps.exists ?? (async () => false)
  const listDir = deps.listDir ?? (async () => null)
  const home = deps.env?.HOME

  // ② 固定安装位（绝对路径先于 HOME 相对）
  for (const p of ABSOLUTE_LOCATIONS) {
    if (await exists(p)) return p
  }
  if (home) {
    for (const rel of HOME_RELATIVE_LOCATIONS) {
      const p = `${home}/${rel}`
      if (await exists(p)) return p
    }
    // nvm：取最新 node 版本目录下的 bin/mocli
    const nvmDir = `${home}/${NVM_NODE_DIR}`
    const entries = await listDir(nvmDir)
    if (entries) {
      const versions = entries
        .map((name) => ({ name, key: parseNvmVersion(name) }))
        .filter((e): e is { name: string; key: [number, number, number] } => e.key !== null)
        .sort((a, b) => {
          for (let i = 0; i < 3; i++) {
            if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]
          }
          return 0
        })
      const latest = versions[versions.length - 1]
      if (latest) {
        const p = `${nvmDir}/${latest.name}/bin/mocli`
        if (await exists(p)) return p
      }
    }
  }

  // ③ login shell 兜底
  const shellResolve = deps.shellResolve
  if (shellResolve) {
    const shellBin = deps.env?.SHELL || '/bin/zsh'
    try {
      const r = await shellResolve(shellBin, 'command -v mocli')
      if (r.code === 0) {
        const p = lastAbsolutePathLine(r.stdout)
        if (p && await exists(p)) return p
      }
    } catch { /* 超时/dotfiles 报错 → 未安装不抛 */ }
  }
  return null
}
