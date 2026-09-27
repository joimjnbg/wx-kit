// tests/shared/url-identity.test.ts
// Wave1-01:单一身份缝(零 node 依赖,core 与 renderer 共用)。
import { describe, it, expect } from 'vitest'
import { articleUrlKey, refIdOf, normVoiceId } from '../../src/shared/url-identity'

describe('articleUrlKey', () => {
  it('短链 ~/ 归一,非文章 URL 原样', () => {
    expect(articleUrlKey('https://mp.weixin.qq.com/s/a~b')).toBe('https://mp.weixin.qq.com/s/a_b')
    expect(articleUrlKey('not-a-url')).toBe('not-a-url')
    expect(articleUrlKey('https://example.com/s/a~b')).toBe('https://example.com/s/a~b')
  })
})

describe('refIdOf', () => {
  it('主键优先,否则归一化 URL', () => {
    expect(refIdOf({ url: 'u', appmsgid: 7, itemidx: 2 })).toBe('7_2')
    expect(refIdOf({ url: 'https://mp.weixin.qq.com/s/a~b' })).toBe('https://mp.weixin.qq.com/s/a_b')
  })
})

describe('normVoiceId', () => {
  it('转义归一', () => {
    expect(normVoiceId('ab&#61;cd')).toBe('ab=cd')
    expect(normVoiceId('  x  ')).toBe('x')
  })
})
