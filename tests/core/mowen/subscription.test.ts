// tests/core/mowen/subscription.test.ts
// M63 T1：墨问订阅存储 + 水位/合并纯函数。fixture 来自 2026-09-13 真机 notes homepage
// （见计划「真机锚点」：public_at 是 unix 秒数字；note_ids 非严格时间序）。
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MowenSubscriptions, diffNewNotes, mergeNewNotes, type MowenNoteRef } from '../../../src/core/mowen/subscription'
import type { MowenNoteListItem } from '../../../src/core/mowen/types'

const item = (over: Partial<MowenNoteListItem>): MowenNoteListItem => ({
  noteId: 'n1', uid: 'u1', title: '标题', brief: '', url: 'https://note.mowen.cn/detail/n1',
  publicAt: 1789191409, withFee: false, withImage: true, withText: true,
  wordCount: 676, viewCount: 360, favorCount: 6, ...over,
})

describe('diffNewNotes', () => {
  it('publicAt > watermark 判新；null 进 undated 不算新', () => {
    const items = [item({ noteId: 'a', publicAt: 1789191409 }), item({ noteId: 'b', publicAt: 1789000000 }), item({ noteId: 'c', publicAt: null })]
    const r = diffNewNotes(items, 1789100000)
    expect(r.fresh.map((x) => x.noteId)).toEqual(['a'])
    expect(r.undated.map((x) => x.noteId)).toEqual(['c'])
  })
  it('全量为旧 → 空（不炸）；输入顺序与真机一致（非严格时间序）也能正确判新', () => {
    // 真机实证：第 2 条比第 1 条新——比对与顺序无关
    const items = [item({ noteId: 'x', publicAt: 1789191409 }), item({ noteId: 'y', publicAt: 1789193661 })]
    expect(diffNewNotes(items, 1789100000).fresh.map((x) => x.noteId)).toEqual(['x', 'y'])
    expect(diffNewNotes([item({ publicAt: 100 })], 200).fresh).toEqual([])
  })
})

describe('mergeNewNotes', () => {
  it('按 noteId 合并：已有条目 status 保留，新条目 pending，输出 publicAt 降序（null 殿后）', () => {
    const existing: MowenNoteRef[] = [
      { noteId: 'old', title: '旧', publicAt: 1789000000, url: 'u', status: 'downloaded' },
      { noteId: 'keep', title: '保留', publicAt: 1789100000, url: 'u', status: 'pending' },
    ]
    const fresh = [item({ noteId: 'new', publicAt: 1789191409, title: '新笔记' }), item({ noteId: 'nodate', publicAt: null })]
    const r = mergeNewNotes(existing, fresh)
    expect(r.find((x) => x.noteId === 'old')?.status).toBe('downloaded')
    expect(r.find((x) => x.noteId === 'keep')?.status).toBe('pending')
    expect(r.find((x) => x.noteId === 'new')?.status).toBe('pending')
    expect(r.find((x) => x.noteId === 'nodate')?.status).toBe('pending')
    expect(r.map((x) => x.noteId)).toEqual(['new', 'keep', 'old', 'nodate'])
  })
  it('重复检查同一批不产生重复条目', () => {
    const fresh = [item({ noteId: 'a', publicAt: 1789191409 })]
    const once = mergeNewNotes([], fresh)
    expect(mergeNewNotes(once, fresh).filter((x) => x.noteId === 'a')).toHaveLength(1)
  })
})

describe('MowenSubscriptions', () => {
  it('add → has → list 往返；重复 add 同 uid 幂等不重复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    const subs = new MowenSubscriptions(root)
    await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '墨问西东创始人', watermark: 1789191409 })
    await subs.addAuthor({ uid: 'u1', name: '池建强', intro: '墨问西东创始人', watermark: 1789191409 })
    expect(await subs.hasAuthor('u1')).toBe(true)
    const all = await subs.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ uid: 'u1', name: '池建强', intro: '墨问西东创始人', subscribed: true, watermark: 1789191409, lastCheckedAt: null, lastRunAt: null, newNotes: [] })
  })
  it('appendNewNotes 合并去重 + setNoteStatus 改状态 + updateWatermark/setLastCheckedAt 生效', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    const subs = new MowenSubscriptions(root)
    await subs.addAuthor({ uid: 'u1', name: '池', intro: '', watermark: 100 })
    await subs.appendNewNotes('u1', [{ noteId: 'n1', title: 't', publicAt: 200, url: 'u', status: 'pending' }])
    await subs.appendNewNotes('u1', [{ noteId: 'n1', title: 't', publicAt: 200, url: 'u', status: 'pending' }])   // 重复检查
    await subs.setNoteStatus('u1', ['n1'], 'downloaded')
    await subs.updateWatermark('u1', 200)
    await subs.setLastCheckedAt('u1', 1234)
    const a = (await subs.list())[0]
    expect(a).toMatchObject({ watermark: 200, lastCheckedAt: 1234 })
    expect(a.newNotes).toHaveLength(1)
    expect(a.newNotes[0].status).toBe('downloaded')
  })
  it('setSubscribed / removeAuthor / getLastRunAt / setLastRunAt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    const subs = new MowenSubscriptions(root)
    await subs.addAuthor({ uid: 'u1', name: '池', intro: '', watermark: 100 })
    expect(await subs.getLastRunAt()).toBeNull()
    await subs.setLastRunAt(555)
    expect(await subs.getLastRunAt()).toBe(555)
    await subs.setSubscribed('u1', false)
    expect((await subs.list())[0].subscribed).toBe(false)
    await subs.removeAuthor('u1')
    expect(await subs.hasAuthor('u1')).toBe(false)
  })
  it('损坏文件如实抛错，不得静默清空（对齐微信存储纪律）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mowen-subs-'))
    await writeFile(join(root, 'mowen-subscriptions.json'), '{broken')
    const subs = new MowenSubscriptions(root)
    await expect(subs.list()).rejects.toThrow(/corrupt/)
  })
})
