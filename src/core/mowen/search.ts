// src/core/mowen/search.ts
// 全站笔记搜索（mocli notes search）。与 homepage/mine 同一响应形态，复用清单映射。
// M65：搜索结果跨作者——复合返回 notes（条目带 authorName，从 reply.users 拼）+
// authors（完整 MowenUser[]，GUI「点作者名 → 展开该作者清单」联动用）。
import type { MocliRunner, MowenNoteListItem, MowenUser } from './types'
import { parseMocliJson, mapNoteList, mapReplyUsers } from './metadata'

export async function searchNotes(
  run: MocliRunner,
  keyword: string,
  count = 20,
): Promise<{ notes: MowenNoteListItem[]; authors: MowenUser[] }> {
  const r = await run(['notes', 'search', '--keyword', keyword, '--count', String(count)])
  const reply = parseMocliJson(r.stdout, r.stderr).reply as Record<string, unknown>
  return { notes: mapNoteList(reply), authors: mapReplyUsers(reply) }
}
