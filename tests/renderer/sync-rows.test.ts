// tests/renderer/sync-rows.test.ts
// 票据 02a:行组装纯函数(稳定 refId + 已存档交叉)。
import { describe, it, expect } from 'vitest'
import { buildSyncRows, computePicked, mergeSyncRows, pickSummary, syncRefId, type SyncRowInput } from '../../src/renderer/sync-rows'

const row = (over: Partial<SyncRowInput>): SyncRowInput => ({
  url: 'u', title: 't', createTime: 1, ...over,
})
const none = () => ({ archivedIds: new Set<string>(), archivedUrls: new Set<string>() })

describe('buildSyncRows', () => {
  it('标题空回退 url;类型缺失不标;未存档不标', () => {
    const [r] = buildSyncRows([row({ title: '', url: 'u1' })], none())
    expect(r.title).toBe('u1')
    expect(r.kindLabel).toBeNull()
    expect(r.archived).toBe(false)
  })

  it('类型映射与未知告警同 message-kind 一致', () => {
    const [v, p, u] = buildSyncRows([
      row({ itemShowType: 5 }), row({ itemShowType: 8 }), row({ itemShowType: 99 }),
    ], none())
    expect(v.kindLabel).toBe('视频')
    expect(p.kindLabel).toBe('图片')
    expect(u.kindLabel).toBe('未知类型')
    expect(u.kindWarn).toBe(true)
  })

  it('主键命中即已存档(URL 形态不同也不漏)', () => {
    const [r] = buildSyncRows(
      [row({ url: 'https://mp.weixin.qq.com/s/abc', appmsgid: 11, itemidx: 1 })],
      { archivedIds: new Set(['11_1']), archivedUrls: new Set() },
    )
    expect(r.refId).toBe('11_1')
    expect(r.archived).toBe(true)
  })

  it('无主键时短链 ~/ 形态归一后命中,不因形态漏标', () => {
    const [r] = buildSyncRows(
      [row({ url: 'https://mp.weixin.qq.com/s/a~b' })],
      { archivedIds: new Set(), archivedUrls: new Set(['https://mp.weixin.qq.com/s/a_b']) },
    )
    expect(r.archived).toBe(true)
  })

  it('syncRefId 与 core refId 同规则:主键优先,否则归一化 URL', () => {
    expect(syncRefId(row({ url: 'u', appmsgid: 7, itemidx: 2 }))).toBe('7_2')
    expect(syncRefId(row({ url: 'https://mp.weixin.qq.com/s/a~b' }))).toBe('https://mp.weixin.qq.com/s/a_b')
  })
})

describe('mergeSyncRows 并集合并', () => {
  it('同 refId 用新行替换(archived 刷新),旧集独有行保留,按时间重排', () => {
    const prev = buildSyncRows([
      row({ url: 'u1', title: '旧', createTime: 10, appmsgid: 1, itemidx: 1 }),
      row({ url: 'u2', title: '留', createTime: 5 }),
    ], none())
    const next = buildSyncRows([
      row({ url: 'u1', title: '旧', createTime: 10, appmsgid: 1, itemidx: 1 }),
      row({ url: 'u3', title: '新', createTime: 20 }),
    ], { archivedIds: new Set(['1_1']), archivedUrls: new Set() })
    const out = mergeSyncRows(prev, next)
    expect(out.map((r) => r.refId)).toEqual(['u3', '1_1', 'u2'])
    expect(out.find((r) => r.refId === '1_1')?.archived).toBe(true)
  })
})

describe('computePicked 选择集', () => {
  const rows = () => buildSyncRows([
    row({ url: 't1', title: '文', createTime: 1, itemShowType: 0, appmsgid: 1, itemidx: 1 }),
    row({ url: 'v1', title: '视', createTime: 2, itemShowType: 5, appmsgid: 2, itemidx: 1 }),
  ], none())
  it('默认全开全选;关 text 只剩视频', () => {
    expect(computePicked(rows(), new Set(), { text: true, video: true })).toHaveLength(2)
    const out = computePicked(rows(), new Set(), { text: false, video: true })
    expect(out.map((r) => r.refId)).toEqual(['2_1'])
  })
  it('单篇勾选覆盖开关:关 text 后勾选加回图文', () => {
    const out = computePicked(rows(), new Set(['1_1']), { text: false, video: true })
    expect(out.map((r) => r.refId).sort()).toEqual(['1_1', '2_1'])
  })
  it('pickSummary 话术', () => {
    expect(pickSummary(0, 3)).toBe('已选 0 / 3 篇')
    expect(pickSummary(3, 3)).toBe('已选 3 / 3 篇')
  })
})
