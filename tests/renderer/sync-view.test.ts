// tests/renderer/sync-view.test.ts
// 票据 gui-01 RED:同步页派生纯函数尚不存在。
import { describe, it, expect } from 'vitest'
import { entryTitle, sessionHint, pickSummary, type SyncEntry } from '../../src/renderer/sync-view'

const e = (over: Partial<SyncEntry>): SyncEntry => ({
  refId: 'r', url: 'u', title: 't', ...over,
})

describe('entryTitle', () => {
  it('有标题用标题,无标题回退 url', () => {
    expect(entryTitle(e({ title: '文' }))).toBe('文')
    expect(entryTitle(e({ title: '' }))).toBe('u')
  })
})

describe('sessionHint', () => {
  it('三种登录态给三种话术', () => {
    expect(sessionHint({ loggedIn: true })).toContain('已登录')
    expect(sessionHint({ loggedIn: false })).toContain('扫码')
    expect(sessionHint({ loggedIn: null })).toContain('检查中')
  })
})

describe('pickSummary', () => {
  it('空集与全集的话术', () => {
    expect(pickSummary(0, 3)).toBe('已选 0 / 3 篇')
    expect(pickSummary(3, 3)).toBe('已选 3 / 3 篇')
  })
})
