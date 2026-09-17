// tests/renderer/sync-view.test.ts
// 票据 gui-01:同步页登录态话术纯函数。
import { describe, it, expect } from 'vitest'
import { sessionHint } from '../../src/renderer/sync-view'

describe('sessionHint', () => {
  it('三种登录态给三种话术', () => {
    expect(sessionHint({ loggedIn: true })).toContain('已登录')
    expect(sessionHint({ loggedIn: false })).toContain('扫码')
    expect(sessionHint({ loggedIn: null })).toContain('检查中')
  })
})
