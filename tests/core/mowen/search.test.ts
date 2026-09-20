// tests/core/mowen/search.test.ts
// searchNotes 复合返回（M65）：notes（条目含 authorName）+ authors（完整 MowenUser[]，
// GUI 作者联动用）。fixture 形态与 metadata.test.ts 的 NOTE_SEARCH_RAW 同源（2026-09-17 真机）。
import { describe, it, expect } from 'vitest'
import { searchNotes } from '../../../src/core/mowen/search'
import type { MocliRunner } from '../../../src/core/mowen/types'

const RAW = JSON.stringify({
  code: 0, status: 'OK',
  reply: {
    note_ids: ['n1', 'n2'],
    notes: {
      n1: { note_id: 'n1', uid: 'u-1', title: '甲', brief: 'b1', url: 'https://note.mowen.cn/detail/n1', public_at: 1, flag: { with_text: true }, stat: { view: 5 } },
      n2: { note_id: 'n2', uid: 'u-2', title: '乙', brief: 'b2', url: 'https://note.mowen.cn/detail/n2', public_at: 2, flag: {} },
    },
    users: {
      'u-1': { uid: 'u-1', name: '作者一', intro: 'i1', home_url: 'https://note.mowen.cn/user/u-1' },
      'u-2': { uid: 'u-2', name: '作者二', intro: 'i2', home_url: 'https://note.mowen.cn/user/u-2' },
    },
  },
})

describe('searchNotes', () => {
  it('返回 notes + authors 复合对象；notes 条目带 authorName；authors 含完整用户信息', async () => {
    const seen: string[][] = []
    const run: MocliRunner = async (args) => { seen.push(args); return { code: 0, stdout: RAW, stderr: '' } }
    const r = await searchNotes(run, 'AI 编程', 10)
    expect(seen[0]).toEqual(['notes', 'search', '--keyword', 'AI 编程', '--count', '10'])
    expect(r.notes.map((n) => n.title)).toEqual(['甲', '乙'])
    expect(r.notes[0]).toMatchObject({ authorName: '作者一' })
    expect(r.authors).toHaveLength(2)
    expect(r.authors[1]).toMatchObject({ uid: 'u-2', name: '作者二', homeUrl: 'https://note.mowen.cn/user/u-2' })
  })

  it('无 users 键：authors 为空数组、条目 authorName undefined，不崩', async () => {
    const raw = JSON.stringify({ code: 0, reply: { note_ids: ['n1'], notes: { n1: { note_id: 'n1', uid: 'u-x', title: '甲', url: '' } } } })
    const r = await searchNotes(async () => ({ code: 0, stdout: raw, stderr: '' }), 'x')
    expect(r.authors).toEqual([])
    expect(r.notes[0]?.authorName).toBeUndefined()
  })
})
