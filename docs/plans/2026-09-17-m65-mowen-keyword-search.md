# M65 · 墨问 tab 按关键词搜笔记（v0.11.2 R2）

> PRD：`docs/PRD-v0.11.2.md` §R2。前置事实（2026-09-17 真机钉死）：`reply.users[uid]`
> 带完整 name/intro/home_url，条目 uid 关联可拼作者名；`notes search` 与 homepage 清单
> 同构，`mapNoteList` 直接复用。UI 方案已与安哥对齐（Segmented 模式切换，非子 tab、
> 非单框智能判断）。

## Task 1 · core：authorName 拼接（TDD）

**`src/core/mowen/types.ts`**：`MowenNoteListItem` 加可选 `authorName?: string`
（搜索场景跨作者，作者列是第一判断信号；homepage/mine 场景恒空，向后兼容——CLI
`mowen search` 输出条目自然多一个可选字段，输出结构向后兼容，无需刷 CLI 契约描述的主体）。

**`src/core/mowen/metadata.ts`**：

- `mapNoteList(reply)` 内部解析 `reply.users`（若为 obj）：条目 uid → `users[uid].name`
  拼出 `authorName`。homepage 响应无 users 键 → 不设，零行为变更。
- 导出 `mapReplyUsers(reply): MowenUser[]`——把 `reply.users` 映射为完整
  `{uid, name, intro, homeUrl}[]`（GUI 作者联动需要完整对象，不只名字）。

**`src/core/mowen/search.ts`**：`searchNotes` 返回复合对象
`{ notes: MowenNoteListItem[], authors: MowenUser[] }`（authors 来自 `mapReplyUsers`）。
唯一调用方 CLI `mowen search` 改为 `.notes`——输出 JSON 仍为
`{ok, notes:[...]}`，形态不变（条目多个可选字段）。

**测试**（`tests/core/mowen/metadata.test.ts` 增补）：
- search 响应（含 users 映射、跨两个作者）→ notes 条目 authorName 正确拼接。
- 无 users 键（homepage 形态）→ authorName undefined，不崩。
- users 里缺某条目 uid 的映射 → 该条 authorName undefined，其余正常。
- `mapReplyUsers` 返回完整 MowenUser 数组（含 intro/homeUrl）。

## Task 2 · IPC + preload + api 契约

**`electron/services/mowen-detect.ts`**：加 `mowen:searchNotes` handler，
形态与 `mowen:searchUsers` 同构（`mowenRunnerOrNull` → `notFoundPayload` /
`mowenErrorPayload`，MOCLI_NOT_FOUND 降级指引条渲染层共用现有 handle）。

**`electron/preload.ts`**：`mowenSearchNotes: (keyword, count?) =>
ipcRenderer.invoke('mowen:searchNotes', keyword, count)`。

**`src/renderer/api.ts`**：接口类型加 `mowenSearchNotes`，返回
`{ ok, notes?: NoteItem[](含 authorName), authors?: {uid,name,intro,homeUrl}[], error? }`。

## Task 3 · GUI：MowenMode 模式化（主体）

**`src/renderer/components/download/MowenMode.tsx`**：

- 顶部 antd `Segmented`：「按用户 ｜ 按关键词」（`data-testid="mowen-mode-seg"`）。
- `mode: 'user' | 'keyword'` state。**切模式 = 开新会话**：清 keyword/notes/checked/
  expandRefs/users/user，回空态（唯一例外：结果表点作者名是主动联动，见下）。
- **user 分支 = 现有 JSX 原样搬入**（搜索框 placeholder/按钮「搜用户」、用户 chips、
  条件行、现有四列表格，零行为变更）。
- **keyword 分支**：
  - 搜索框 placeholder「按关键词搜索全站墨问笔记」，enterButton「搜笔记」，
    count 用固定 20（搜索场景不需要条件行；mocli 侧 count 参数沿用）。
  - 结果表五列：标题（下挂 brief 摘要行，次级文本）/ 作者（可点击 Button type="link"）/
    发表 / 阅读（viewCount）/ 含引用子笔记。
  - 勾选、付费默认不选、下载选中、「含引用子笔记」分批提交——与 user 表完全共用现有逻辑。
  - **作者联动**：点作者名 → `setMode('user')` + `pickUser(该作者完整对象)`（authors
    映射里有 intro/homeUrl，条件行 + 清单直接展开）。这是有意图的跳转，不清状态空转。
- `NoteItem` 接口加 `authorName?: string`；authors 存 state 供联动查。

## Task 4 · e2e + 验收 + 收尾

- **e2e（轻量静态断言，不依赖 mocli）**：墨问 tab 断言 Segmented 存在；切到「按关键词」
  后 placeholder 变化；切回「按用户」placeholder 复原。搜索行为本身走真机验收
  （mocli 是外部二进制 + 真网络，不进 mock e2e）。
- **真机验收**（PRD 验收清单）：关键词「AI 编程」搜索 → 结果表五列 → 点作者名联动展开
  清单 → 勾选批量下载全链路；既有「按用户」流程回归。
- 全量：`npm test` / `npm run lint` / `npx tsc --noEmit` / `npm run test:e2e`。
- 文档：PRD R2 勾验收、ROADMAP 状态、devlog §61、skill 核对
  （CLI 输出仅加可选字段，`references/commands.md` 的 `search` 条目补一句 authorName）。
- 分支 `feat/m65-keyword-search` → 合 main（自动收尾授权，commit 英文，push 等安哥）。
