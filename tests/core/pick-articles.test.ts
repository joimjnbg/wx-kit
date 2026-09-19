// tests/core/pick-articles.test.ts
// 票据 05 RED:两层选择器的纯函数契约尚不存在。
import { describe, expect, it } from 'vitest'
import { applyPick, shouldDownloadAudio, type PickInput } from '../../src/core/pick-articles'

const ref = (over: Partial<PickInput['refs'][number]> & { url: string }) => ({
  title: 't', createTime: 1, ...over,
})

describe('applyPick 两层选择器', () => {
  it('默认全选:无 toggles 无 checklist 时全部入选', () => {
    const out = applyPick({ refs: [ref({ url: 'u1' }), ref({ url: 'u2' })] }, {})
    expect(out.items.map((i) => i.url)).toEqual(['u1', 'u2'])
  })

  it('类型开关关闭整类:types.text=false 剔除图文,保留视频', () => {
    const out = applyPick(
      { refs: [ref({ url: 'u1', itemShowType: 0 }), ref({ url: 'u2', itemShowType: 5 })] },
      { types: { text: false } },
    )
    expect(out.items.map((i) => i.url)).toEqual(['u2'])
  })

  it('单篇勾选覆盖批量:关闭图文类后仍可单篇加回', () => {
    const out = applyPick(
      { refs: [ref({ url: 'u1', itemShowType: 0 }), ref({ url: 'u2', itemShowType: 0 })] },
      { types: { text: false }, include: ['u1'] },
    )
    expect(out.items.map((i) => i.url)).toEqual(['u1'])
  })

  it('单篇排除覆盖批量:默认全选时可单篇剔除', () => {
    const out = applyPick(
      { refs: [ref({ url: 'u1' }), ref({ url: 'u2' })] },
      { exclude: ['u2'] },
    )
    expect(out.items.map((i) => i.url)).toEqual(['u1'])
  })

  it('未知条目引用被忽略,不炸', () => {
    const out = applyPick({ refs: [ref({ url: 'u1' })] }, { include: ['nope'], exclude: ['nope2'] })
    expect(out.items.map((i) => i.url)).toEqual(['u1'])
  })
})

describe('shouldDownloadAudio 下载维度开关', () => {
  it('audio:false 或总开关关都停语音;默认开', () => {
    expect(shouldDownloadAudio({ audio: false }, true)).toBe(false)
    expect(shouldDownloadAudio({ audio: true }, false)).toBe(false)
    expect(shouldDownloadAudio(undefined, true)).toBe(true)
    expect(shouldDownloadAudio({}, true)).toBe(true)
  })
})
