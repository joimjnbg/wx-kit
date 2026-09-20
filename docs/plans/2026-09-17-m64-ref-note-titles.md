# M64 · 引用笔记块展示标题（v0.11.2 R1） 实现计划

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. PRD 与本计划冲突时以 PRD 为准。

**Goal:** 下载含引用的墨问笔记时，正文 `<note uuid>` 占位标签原地替换为引用卡片（标题/摘要/作者/链接）；尾部追加块退场；expandRefs 不重复请求（元信息与子下载共享同一轮 note/show）；顺手补上 PRD-v0.11.0 钉死却未实现的 0.5s 限速。

**Architecture:** 全部收敛在 core 两文件——`download-mowen-note.ts`（编排：元信息拉取 + 请求缓存 + 限速）与 `mowen-to-article.ts`（纯渲染：卡片替换）。renderer/IPC/CLI 零改动（卡片在 ParsedArticle.contentHtml 里，exporter/阅读器/md 转换天然复用）。

**Tech Stack:** TypeScript / vitest。

**Spec:** `docs/PRD-v0.11.2.md` §2 R1 + §4 R1 验收清单。

## Global Constraints

- **失败保留失败类型**（宪法级）：付费子笔记是 `MowenNoteUnavailable` → 卡片标「付费，标题不可见」；其他异常 → 「无法获取标题」；**都不得伪装成功，也不得阻塞父笔记落库**。
- 元信息整轮失败时父笔记照常下载（回退为纯链接卡 + warning）。
- 卡片用 `<blockquote class="mowen-ref-card">` 语义标签——阅读器 HTML 原生缩进样式，turndown 转 `> ` 引用块，md 导出标题不丢（验收点）。
- **限速补课**：PRD-v0.11.0 §「R2 限速」钉死 0.5s/篇写死 core 层，实际从未实现（2026-09-17 核实：GUI `ipc.ts` / CLI 均裸调）。本任务补在 `fetchShowCached` 闸口，接口暴露 `minIntervalMs`（默认 500，测试传 0）。
- 请求缓存 `showCache` 挂 deps（`Map<uuid, NoteShowResult>`）：父 show、元信息 show、expandRefs 子下载三处共享，同一 uuid 全程只发一次请求（含「兄弟引用同一篇」）。
- **信息不丢失兜底**：`refNoteIds` 里没在正文出现 `<note>` 标签的 uuid → 文末追加卡片（替代旧尾部块的防丢失职责）；正文出现 `<note>` 但不在 refNoteIds（防御，理论不发生）→ 纯链接卡 + warning。
- 不做元信息持久化缓存（PRD 非目标）；重复下载靠文库判重，不会二次拉。

## 真机锚点（fixture 唯一来源，2026-09-17 实测）

父笔记 `05-oJyNajKAzUBD42qYjt`（池建强 CatBar 0.7）content 片段（引用块原生形态）：

```html
<p>关联阅读：</p><note uuid="6ipCTiFtt0yQRXNeSDA1w"></note><p></p><p>2026年9月9日</p>
```

`detail.noteRef`：`["6ipCTiFtt0yQRXNeSDA1w"]`（uuid 字符串数组，与正文 `<note>` 标签一致）。

子笔记 `6ipCTiFtt0yQRXNeSDA1w` note/show 命中返回：

```json
{"noteBase":{"title":"发布第一款 Mac App：CatBar，极简 Mac 菜单","digest":"发布第一款 Mac App：CatBar，极简 Mac 菜单栏图标管理工具\n完全免费，M 芯片 Mac 用户可以下载使用","publicAt":1788506303},"user":{"base":{"name":"池建强"}}}
```

付费子笔记 `-Bh35Ogyfr7OQTs-GGsCu` 失败返回（HTTP 400，连标题都没有）：

```json
{"code":400,"reason":"ASSET_NOT_FOUND","message":"service.v1 [NoteWxaService.NoteShow]: asset not found","metadata":{"parent_charge_note_uuid":"","skuId":"2056619449635758081"}}
```

---

### Task 1: adapter 卡片渲染 + 尾部块退场

**Files:**
- Modify: `src/core/mowen/mowen-to-article.ts`
- Test: `tests/core/mowen/mowen-to-article.test.ts`（已有文件追加用例）

**Interfaces:**
- Consumes: `NoteShowResult`（`./note-show`）；新增 `RefNoteMeta`（本文件导出，Task 2 消费）。
- Produces:
  - `export interface RefNoteMeta { uuid: string; title?: string; digest?: string; authorName?: string; publicAt?: number | null; state: 'ok' | 'paid' | 'failed' }`
  - `noteShowToParsedArticle(r: NoteShowResult, refMetas?: Map<string, RefNoteMeta>): ParsedArticle`（第二参可选=向后兼容；缺省时正文 `<note>` 标签按 failed 卡渲染，不留空白）

- [ ] **Step 1: 写失败测试**（fixture 用上方真机锚点）
  - ok 卡：`<note uuid>` 替换为 `<blockquote class="mowen-ref-card">`，含 `《标题》` 链接 + 作者名 + digest；
  - paid 卡：含「付费」文案 + 链接，不含标题；
  - failed 卡：含「无法获取标题」+ 链接；
  - 无第二参：`<note>` 标签不出现在输出（按 failed 卡渲染，不留裸标签）；
  - refNoteIds 有、正文无对应标签 → 文末追加卡片（信息不丢）；
  - 正文有标签、refNoteIds 无 → 卡片 + 一条 warning；
  - **尾部 `<section class="mowen-refs">` 块不再出现**；
  - md 导出：`exportArticle` 或 turndown 直转卡片 HTML，断言输出含标题文本与 `>` 引用块（挂 tests/core 已有 exporter 测试形态）。
- [ ] **Step 2: 实现**——删 `buildRefsBlock`，新增 `refCard(meta)` 生成器（ok/paid/failed 三态）与 `replaceNoteTags(html, metas, refNoteIds, warnings)`；`noteShowToParsedArticle` 签名加可选第二参，warnings 保留一条「含 N 篇引用子笔记…展开请用…」引导。
- [ ] **Step 3: 跑 `npx vitest run tests/core/mowen` 全绿**（既有用例改断言：旧尾部块断言删除）。

### Task 2: 编排层元信息拉取 + 请求缓存 + 限速

**Files:**
- Modify: `src/core/mowen/download-mowen-note.ts`
- Test: `tests/core/mowen/download-mowen-note.test.ts`（已有文件追加用例）

**Interfaces:**
- `MowenDownloadDeps` 增：`showCache?: Map<string, NoteShowResult>`（调用方不传则内部惰性建）；`minIntervalMs?: number`（默认 500，测试传 0）。
- 内部 `fetchShowCached(uuid, deps)`：查缓存 → 限速闸（模块级 `WeakMap<deps, lastAtMs>`，间隔 `minIntervalMs ?? 500`）→ 真实请求（注入 `fetchNoteShow` 优先）→ 写缓存。**父 show、ref 元信息、expandRefNotes 子下载全部改走它**。

- [ ] **Step 1: 写失败测试**（spy `fetchNoteShow` 注入 + `minIntervalMs: 0`）
  - 含引用父笔记：spy 被调 2 次（父 1 + 元信息 1）；输出卡片渲染进 meta（断言 library 收到的 ParsedArticle 含标题——用内存 library spy 或 meta.json 落盘断言）；
  - **expandRefs 复用**：同 fixture 开 expandRefs，子笔记下载不再请求（spy 总次数 2，不是 3）；
  - 付费子笔记：元信息阶段 `MowenNoteUnavailable` 被归类 paid 卡，父笔记 ok 落库，refResults.unavailable 照旧（expandRefs 时）；
  - 元信息整轮抛非 unavailable 异常：父笔记仍 ok 落库，卡片 failed + warning；
  - 限速：不传 `minIntervalMs` 时两次请求间隔 ≥500ms（fake timers）；传 0 时不等待。
- [ ] **Step 2: 实现**——`downloadMowenNote` 拿到父 show 后：`refNoteIds` 逐条 `fetchShowCached` → 拼 `Map<uuid, RefNoteMeta>`（try/catch 分类 paid/failed，单条失败续走）→ 传入 `noteShowToParsedArticle(show, refMetas)`；`expandRefNotes` 内子下载路径 `downloadMowenNote(childUuid, formats, deps, depth+1)` 天然命中缓存（deps 同对象）。判重分支（本体已在库）不拉元信息（skipped 语义不变，expandRefs 时按现状拉一次拿清单）。
- [ ] **Step 3: 跑 `npx vitest run tests/core/mowen` 全绿。**

### Task 3: 收尾验证 + 文档同步

- [ ] `npm test` 全量 + `npm run lint` + `npx tsc --noEmit -p tsconfig.json` 全绿。
- [ ] 真机验收（对照 PRD §4 R1）：CLI `download --url https://note.mowen.cn/detail/05-oJyNajKAzUBD42qYjt --formats md,html` 隔离文库跑：html 阅读器见卡片（标题/摘要/作者）；md 文件含 `> ` 引用块与标题；`agent/wx-kit-skill/` 速查表核对（`mowen import` 输出契约无变，仅核对不改则跳过）。
- [ ] devlog 增补 M64 小节（含「PRD 限速写了没实现、验收没抓出来」这条流程教训）；ROADMAP 当前状态一行。
- [ ] commit（英文 message）合 main 删分支（自动收尾授权内）。

## Self-Review 记录（写计划时已核）

- `mowen-refs` 无配套 CSS（grep 证实），尾部块删除无样式残留。
- 限速缺口是本计划新发现：PRD-v0.11.0 写「写死在 core 层」，实际 `fetchNoteShow` 注释「限速由调用方决定」且调用方（ipc.ts/cli）均未包——两层都没落地。补在 `fetchShowCached` 单点收口。
- `expandRefNotes` 的判重在缓存**之前**（`library.has` 先行），库内已有的子笔记不发请求也不进缓存，语义不变。
- 判重分支（skipped）不拉元信息：旧笔记重新下载会拉新元信息重导出？不——skipped 直接返回不重导出，元信息拉取只发生在「真下载」路径，老库存量不触发。
- 卡片在 `rewriteUuidImages`（img 重写）之后追加不影响：`<note>` 与 `<img>` 正则不交叠。
- CLI `mowen-ipc.ts` L154/L160 直调 `fetchNoteShow`（订阅检查通知文案场景）不在本任务范围——那是检查链路非下载链路，不动。
