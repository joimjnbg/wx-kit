// tests/core/resolve-urls.test.ts
// 票据 urllist-01 RED:URL 文本解析纯函数尚不存在。
import { describe, it, expect } from 'vitest'
import { resolveUrlText } from '../../src/core/resolve-urls'

describe('resolveUrlText', () => {
  it('混合文本产出逐条结果:有效、无效、空行跳过', () => {
    const out = resolveUrlText('https://mp.weixin.qq.com/s/abc\n\nnot-a-url\nhttps://example.com/x')
    expect(out.total).toBe(3)
    expect(out.items[0]).toMatchObject({ url: 'https://mp.weixin.qq.com/s/abc', valid: true })
    expect(out.items[1]).toMatchObject({ valid: false })
    expect(out.items[2]).toMatchObject({ valid: false })
  })

  it('重复 URL 按归一化形态合并并注记', () => {
    const out = resolveUrlText('https://mp.weixin.qq.com/s/a~b\nhttps://mp.weixin.qq.com/s/a_b')
    expect(out.total).toBe(2)
    expect(out.items).toHaveLength(1)
    expect(out.items[0].duplicate).toBe(true)
  })

  it('深链接(长链 mid/idx)给出主键提示', () => {
    const out = resolveUrlText('https://mp.weixin.qq.com/s?__biz=MzI0&mid=2247540994&idx=2&sn=abc')
    expect(out.items[0]).toMatchObject({ valid: true, appmsgid: 2247540994, itemidx: 2 })
  })
})
