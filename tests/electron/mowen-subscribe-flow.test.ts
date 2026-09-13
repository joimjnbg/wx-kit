// tests/electron/mowen-subscribe-flow.test.ts
// M63 T3：订阅决策逻辑（搜索候选 / 带 uid 订阅 / 重复防护 / uid 校验）。
// subscribeAuthor 注入式（无 electron 运行时）；handler 只是一行委派。
// fixture 来自计划「真机锚点」（user search 返回 uids + users{name,intro,home_url}）。
import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { subscribeAuthor } from '../../electron/services/mowen-ipc'
import { MowenSubscriptions } from '../../src/core/mowen/subscription'
import type { MocliRunner, MowenUser } from '../../src/core/mowen/types'

const users: MowenUser[] = [
  { uid: 'vtv_PV1fEMBb-8_BPlmDu', name: '池建强', intro: '墨问西东和极客时间创始人', homeUrl: 'https://note.mowen.cn/user/vtv_PV1fEMBb-8_BPlmDu?from=mocli' },
  { uid: '0C-bLHmOmxiYpzgIxJaVS', name: '阿苟', intro: 'Java程序员', homeUrl: 'https://note.mowen.cn/user/0C-bLHmOmxiYpzgIxJaVS' },
]
const searchRunner: MocliRunner = async (args) => {
  // 真实语义：服务端按 keyword 过滤——keyword 不含名字的作者不会出现在候选里
  const kw = args[args.indexOf('--keyword') + 1] ?? ''
  const hit = users.filter((u) => u.name.includes(kw) || u.intro.includes(kw))
  return { code: 0, stdout: JSON.stringify({ code: 0, reply: { uids: hit.map((u) => u.uid), users: Object.fromEntries(hit.map((u) => [u.uid, { uid: u.uid, name: u.name, intro: u.intro, home_url: u.homeUrl }])) } }), stderr: '' }
}

const harness = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mowen-flow-'))
  return new MowenSubscriptions(root)
}

describe('subscribeAuthor', () => {
  it('只带 keyword：返回候选（含简介），不写库', async () => {
    const subs = await harness()
    const r = await subscribeAuthor(searchRunner, subs, '池建强')
    expect(r).toMatchObject({ ok: true })
    expect((r as { authors: MowenUser[] }).authors[0]).toMatchObject({ name: '池建强', intro: '墨问西东和极客时间创始人' })
    expect(await subs.list()).toHaveLength(0)
  })

  it('keyword+uid：校验候选后订阅，intro 快照入库，watermark≈now（不回补历史）', async () => {
    const subs = await harness()
    const before = Math.floor(Date.now() / 1000)
    const r = await subscribeAuthor(searchRunner, subs, '池建强', 'vtv_PV1fEMBb-8_BPlmDu')
    expect(r).toMatchObject({ ok: true, subscribed: { uid: 'vtv_PV1fEMBb-8_BPlmDu', name: '池建强' } })
    const a = (await subs.list())[0]
    expect(a.intro).toBe('墨问西东和极客时间创始人')
    expect(a.watermark).toBeGreaterThanOrEqual(before)
  })

  it('重复订阅同 uid → ALREADY_SUBSCRIBED，不入库', async () => {
    const subs = await harness()
    await subscribeAuthor(searchRunner, subs, '池建强', 'vtv_PV1fEMBb-8_BPlmDu')
    const r = await subscribeAuthor(searchRunner, subs, '池建强', 'vtv_PV1fEMBb-8_BPlmDu')
    expect(r).toMatchObject({ ok: false, error: { code: 'ALREADY_SUBSCRIBED' } })
    expect(await subs.list()).toHaveLength(1)
  })

  it('uid 不在候选中 → NOT_FOUND（keyword 与 uid 不匹配，防误订阅）', async () => {
    const subs = await harness()
    const r = await subscribeAuthor(searchRunner, subs, '别人', '0C-bLHmOmxiYpzgIxJaVS')
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await subs.list()).toHaveLength(0)
  })

  it('空 keyword → VALIDATE', async () => {
    const subs = await harness()
    expect(await subscribeAuthor(searchRunner, subs, '  ')).toMatchObject({ ok: false, error: { code: 'VALIDATE' } })
  })
})
