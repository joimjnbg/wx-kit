// tests/renderer/sync-rows.test.ts
// 票据 02a RED:行组装纯函数尚不存在。
import { describe, it, expect } from 'vitest'
import { buildSyncRows, type SyncRowInput } from '../../src/renderer/sync-rows'

const row = (over: Partial<SyncRowInput>): SyncRowInput => ({
  url: 'u', title: 't', ...over,
})

describe('buildSyncRows', () => {
  it('标题空回退 url;类型缺失不标;未存档不标', () => {
    const [r] = buildSyncRows([row({ title: '', url: 'u1' })], new Set())
    expect(r.title).toBe('u1')
    expect(r.kindLabel).toBeNull()
    expect(r.archived).toBe(false)
  })

  it('类型映射与未知告警同 message-kind 一致', () => {
    const [v, p, u] = buildSyncRows([
      row({ itemShowType: 5 }), row({ itemShowType: 8 }), row({ itemShowType: 99 }),
    ], new Set())
    expect(v.kindLabel).toBe('视频')
    expect(p.kindLabel).toBe('图片')
    expect(u.kindLabel).toBe('未知类型')
    expect(u.kindWarn).toBe(true)
  })

  it('文库已有按归一化 URL 命中 Tron 已存档', () => {
    const [r] = buildSyncRows(
      [row({ url: 'https://mp.weixin.qq.com/s/abc' })],
      new Set(['https://mp.weixin.qq.com/s/abc']),
    )
    expect(r.archived).toBe(true)
  })

  it('短链 ~/ 形态归一后命中,不因形态漏标', () => {
    const [r] = buildSyncRows(
      [row({ url: 'https://mp.weixin.qq.com/s/a~b' })],
      new Set(['https://mp.weixin.qq.com/s/a_b']),
    )
    expect(r.archived).toBe(true)
  })
})
