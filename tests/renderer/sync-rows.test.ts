// tests/renderer/sync-rows.test.ts
// 票据 02a:行组装纯函数(稳定 refId + 已存档交叉)。
import { describe, it, expect } from 'vitest'
import { buildSyncRows, syncRefId, type SyncRowInput } from '../../src/renderer/sync-rows'

const row = (over: Partial<SyncRowInput>): SyncRowInput => ({
  url: 'u', title: 't', ...over,
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
