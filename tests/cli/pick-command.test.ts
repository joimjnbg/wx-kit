// tests/cli/pick-command.test.ts
// 票据 05:library export --pick/--from-subscription 计算下载集只展示不下载。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Subscriptions } from '../../src/core/subscriptions'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: vi.fn() } }))
import { runCli } from '../../src/cli'

const BOOK = 'MP_WXS_9'
const refs = [
  { url: 'https://mp.weixin.qq.com/s/a', title: '图文一', createTime: 1, itemShowType: 0, appmsgid: 11, itemidx: 1 },
  { url: 'https://mp.weixin.qq.com/s/b', title: '视频一', createTime: 2, itemShowType: 5, appmsgid: 12, itemidx: 1 },
  { url: 'https://mp.weixin.qq.com/s/c', title: '图文二', createTime: 3, itemShowType: 0, appmsgid: 13, itemidx: 1 },
]

let root: string, userDataDir: string, stdout: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wxkit-pick-lib-'))
  userDataDir = await mkdtemp(join(tmpdir(), 'wxkit-pick-user-'))
  stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += value; return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const subs = new Subscriptions(root)
  await subs.addAccount({ fakeid: BOOK, nickname: '待选号', subscribed: true, watermark: 0 })
  await subs.addNewRefs(BOOK, refs)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true })
})
async function run(...args: string[]) {
  stdout = ''
  const code = await runCli(['library', 'export', '--out', root, ...args], { userDataDir })
  return { code, result: JSON.parse(stdout) }
}

describe('library export --pick 两层选择器展示(票据 05)', () => {
  it('默认全选:三篇待处理全部进入下载集', async () => {
    const { code, result } = await run('--from-subscription', '--pick', '{}')
    expect(code).toBe(0)
    expect(result).toMatchObject({ ok: true, total: 3, count: 3 })
    // 待处理按发布时间降序存(mergeNewRefs):断言集合相等,不依赖顺序
    expect(result.items.map((i: { title: string }) => i.title).sort()).toEqual(['图文一', '图文二', '视频一'])
  })

  it('类型开关:关闭 text 后只剩视频', async () => {
    const { code, result } = await run('--from-subscription', '--pick', '{"types":{"text":false}}')
    expect(code).toBe(0)
    expect(result.count).toBe(1)
    expect(result.items[0]).toMatchObject({ title: '视频一', refId: '12_1' })
  })

  it('单篇覆盖:关闭 text 后 include 加回一篇图文', async () => {
    const { code, result } = await run('--from-subscription', '--pick', '{"types":{"text":false},"include":["11_1"]}')
    expect(code).toBe(0)
    expect(result.count).toBe(2)
    expect(result.items.map((i: { refId: string }) => i.refId).sort()).toEqual(['11_1', '12_1'])
  })

  it('单篇剔除:默认全选时 exclude 掉一篇', async () => {
    const { code, result } = await run('--from-subscription', '--pick', '{"exclude":["13_1"]}')
    expect(code).toBe(0)
    expect(result.count).toBe(2)
  })

  it('非法 JSON 报用法错误 exit 2', async () => {
    const { code, result } = await run('--from-subscription', '--pick', '{oops')
    expect(code).toBe(2)
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_ERROR' } })
  })
})
