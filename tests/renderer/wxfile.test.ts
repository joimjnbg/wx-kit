// tests/renderer/wxfile.test.ts
// wxfile 基地址映射:库根下取相对子路径(Windows 分隔符混用也要命中)。
import { describe, it, expect } from 'vitest'
import { toWxfileBase, wxfileJoin } from '../../src/renderer/wxfile'

describe('toWxfileBase', () => {
  it('posix 同分隔符取相对路径', () => {
    expect(toWxfileBase('/lib/root', '/lib/root/A/b')).toBe('wxfile://local/A/b')
  })
  it('windows 混用分隔符仍取相对路径(回归:e2e 图片 500)', () => {
    const root = 'C:\\Users\\x\\lib'
    const dir = 'C:/Users/x/lib/甲号/2026-03-01_文'
    const out = toWxfileBase(root, dir)
    expect(out.startsWith('wxfile://local/')).toBe(true)
    expect(out).not.toContain('C:')
    expect(decodeURIComponent(out)).toContain('甲号/2026-03-01_文')
  })
  it('库根之外回退原 dir(协议侧 403 降级)', () => {
    expect(toWxfileBase('/lib/root', '/other/dir')).toBe('wxfile://local/other/dir')
  })
})

describe('wxfileJoin', () => {
  it('文件名逐段编码拼接', () => {
    expect(wxfileJoin('wxfile://local/A', 'images/img 1.png')).toBe('wxfile://local/A/images/img%201.png')
  })
})
