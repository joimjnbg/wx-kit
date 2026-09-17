# wx-kit v0.11.2 产品需求文档（迭代 PRD）

> 两项墨问体验增强，源自 2026-09-17 安哥需求收集（需求 1 引用块标题 + 需求 2 关键词搜笔记）。
> 技术事实均已真机验证（2026-09-17，样本：池建强 CatBar 0.7 发布笔记 05-oJyNajKAzUBD42qYjt
> 及其引用 6ipCTiFtt0yQRXNeSDA1w / 付费样本 -Bh35Ogyfr7OQTs-GGsCu / mocli notes search）。
> 当前进度见 `ROADMAP.md`，验收以本文第 4 节为准。

## 1. 一句话定义

**引用块让用户不点链接就知道引了什么，搜索让用户不换工具就能按内容找笔记。**

## 2. 需求清单

### R1 · 引用笔记块展示标题（信息前置）

**用户目标**：下载含引用的墨问笔记后，不必逐条点开链接才知道每篇被引用笔记写的是什么——
标题（及摘要/作者）直接可见。

**现状与根因**（真机验证）：

- 墨问正文里引用块的原生形态是 `<note uuid="X"></note>` **纯占位标签**——正文本身不带
  标题，与图片 `<img uuid>` 同一模式。当前实现未处理该标签：阅读器里浏览器静默吞掉，
  正文中「关联阅读：」后面是空白。
- 引用信息只存在于 M61 的人为尾部追加块：`引用笔记 · 6ipCTiFt · note.mowen.cn/detail/6ipCTiFt…`
  （uuid 前 8 位 + 裸链接，无标题）。
- 对每条 ref uuid 追加一次匿名 `note/show` 可拿到 title / digest / authorName / publicAt
  （验证样本：6ipCTiFtt0yQRXNeSDA1w →《发布第一款 Mac App：CatBar，极简 Mac 菜单栏图标
  管理工具》+ 摘要 + 作者，完整返回）。

**硬边界**（真机验证）：被引用笔记为付费内容时（样本 -Bh35Ogyfr7OQTs-GGsCu Vibe Coding
专栏），`note/show` 返回 400 `ASSET_NOT_FOUND`（metadata.skuId）——**连标题都不返回**。
引用卡片只能如实标注「付费笔记，标题不可见」，不得伪装成功。

**方案**：

- 下载含引用的笔记时，对 `refNoteIds` 逐条拉取子笔记元信息（匿名 `note/show`，限速沿用
  0.5s/篇），正文中的 `<note uuid>` 标签**原地替换**为引用卡片：标题 + 摘要（digest）+
  作者 + 跳转链接——对齐墨问 App 的内联卡片形态，而非只在尾部挂链接列表。
- 付费 / 已删除 / 请求失败的子笔记：卡片如实标注（「付费笔记，标题不可见」/「无法获取」），
  链接保留，不静默丢、不伪装成功。单条失败不影响父笔记下载成功。
- **尾部追加块取消**：正文已内联卡片后，尾部「引用笔记（N 篇）」块成为同信息两处重复，
  整个移除。原 warning 中「递归下载请用展开引用子笔记」提示保留在 warnings 里（卡片可见
  即引导，文案保留一条即可）。
- 勾选「展开引用子笔记」（expandRefs）时**复用同一次元信息请求**，下载子笔记正文不再重复
  请求——展开与不展开，元信息只拉一轮。
- 图集式多引用（`<note uuid>` 与 `<gallery uuid>` 同类占位）：逐条卡片，不设数量上限
  （当前样本均为单引用；若实测出现几十条引用的形态，限速 0.5s/篇已是保护，超时/失败
  走如实标注分支，不阻塞主流程）。

**降级语义**：元信息整轮失败（网络断/接口改版）不阻塞父笔记下载——父笔记正常落库，
引用处回退为「引用笔记（标题获取失败）+ 链接」卡片，warnings 记一条。

### R2 · 墨问 tab 增加按关键词搜笔记

**用户目标**：不记得作者名、只记得内容主题时，也能从 wx-kit 直接搜到全站笔记并勾选下载，
不必先去墨问 App/网页搜完再复制链接回来。

**现状**：下载页「墨问笔记」tab 只有按用户名模糊搜索（M61）。底层 `searchNotes`（mocli
`notes search`）M60 已封装、CLI `mowen search` 已通——**GUI 缺口，纯接线工作**。

**接口事实**（真机验证，2026-09-17，关键词「AI 编程」）：

- `reply.notes[note_id]` 条目含 title / brief / public_at / uid / url / stat{view, favor,
  collect} / flag{with_text, with_image}——与 homepage 清单同构，`mapNoteList` 直接复用。
- `reply.users[uid]` 带完整 name / intro / home_url，按条目 uid 关联可拼出**作者名**——
  搜索结果跨作者，作者列是第一判断信号。
- 付费标识：`mapNoteItem` 现有 withFee 映射沿用（搜索结果付费笔记默认不勾选，与清单一致）。

**UI 方案**（2026-09-17 与安哥对齐）：

- tab 顶部 antd **Segmented「按用户 ｜ 按关键词」**模式切换，不加子 tab、不做单框智能判断
  （「池建强」搜用户还是搜笔记无法可靠消歧，让用户猜系统怎么想是最差 UX）。
- **按用户模式 = 现有形态零变更**：placeholder「按用户名/简介模糊搜索墨问用户」、用户候选
  chips → 点选 → 条件行（filter/recent/count/刷新）+ 现有四列清单表（标题/发表/字数/
  含引用子笔记）。
- **按关键词模式**：placeholder「按关键词搜索全站墨问笔记」，结果表为跨作者形态——
  - 标题列下加摘要行（brief，次级文本）；
  - 新增**作者列**（可点击）：点击 = 切回「按用户」模式并直接展开该作者完整清单
    （搜到一篇好笔记 → 看他全部作品的最自然续接，接上现有条件行）；
  - 新增**阅读数列**（stat.view，有就展示）；
  - 勾选 / 「含引用子笔记」/ 下载选中按钮 / 付费默认不选：逻辑与清单表完全共用。
- **模式切换语义：切模式 = 开新会话，旧结果与勾选状态清空**，回到空态。唯一例外是结果表
  内点作者名的主动联动——这是有意图的跳转，不算丢状态。
- 下载走现有 download 通道（mowen URL 在 downloadArticle 路由），进度/历史/结果区复用，
  expandRefs 分批提交语义与 M61 一致。

**改动面**（预估，实施以 plan 为准）：

- core：`MowenNoteListItem` 增 `authorName?: string`（search 场景从 `reply.users` 拼，
  homepage 场景留空）；`searchNotes` 返回值带作者。
- IPC：`mowen:search-notes` 透传（或并入现有 search 通道加 type 参数，实施时定）。
- renderer：`MowenMode` 拆模式 state，用户模式 JSX 原封进分支，关键词模式新分支。
- CLI：无变更（`mowen search` 已存在）。

## 3.5 非目标

- 不为引用卡片做站内跳转/在线预览（卡片链接是 note.mowen.cn 原文，与现有尾部链接同语义）。
- 不做引用元信息缓存/持久化（每次下载现拉；同一笔记重复下载走既有文库判重，不会重复拉）。
- 不做关键词搜索的高级语法（与/或/排除等，mocli `--keyword` 是单串，多词空格分词由服务端
  决定，wx-kit 不做本地加工）。
- 不改订阅链路（订阅仍以作者为单位；搜到的笔记经作者联动可跳转订阅入口，但不在本版做
  「从搜索结果直接订阅」）。
- R2 不动 mocli 契约层（`metadata.ts` 映射仅加可选字段，向后兼容）。

## 4. 验收清单（逐条）

### R1

- [x] `<note uuid>` 占位标签替换：含引用笔记下载后，正文原位置出现引用卡片（标题/摘要/
      作者/链接）；**阅读器 HTML 与 md 导出均可见**（turndown 转换卡片不丢标题）。
- [x] 引用元信息请求限速 0.5s/篇：闸为**模块级共享**、跨篇也生效（GUI/CLI 都是逐篇新建
      deps 字面量，per-deps 闸跨篇会重置——M64 收尾修正）；父笔记落库不因子笔记失败而失败。
- [x] 付费子笔记卡片如实标注「付费笔记，标题不可见」，链接保留（真机样本
      -Bh35Ogyfr7OQTs-GGsCu）。
- [x] 尾部「引用笔记（N 篇）」追加块不再出现；warnings 保留引用提示一条。
- [x] expandRefs 展开时子笔记元信息不重复请求（同一 uuid 只拉一次）。
- [x] 元信息整轮失败：父笔记正常下载，卡片回退「标题获取失败」形态 + warning（单测注入
      fetchJson 失败模拟）。
- [x] 单测：note/show fixture 含 `<note uuid>` 的正文替换、付费 400、元信息失败回退、
      expandRefs 复用请求（spy 计数）、跨 deps 实例的限速间隔。
- [x] **e2e（M64 收尾补）**：`gui.e2e.mjs` 新增「墨问链接下载 → 阅读器」用例，6 条断言覆盖
      卡片 `blockquote.mowen-ref-card` / 标题 / 作者 / 旧尾部块退场 / md 落盘不丢标题。
      mock 经 `WXKIT_MOWEN_BASE` 注入（note/show 走 Node fetch，webRequest 拦不到），
      入口走「按链接下载」tab（不经 mocli）。
- [x] **图集缺图补拉（安哥实测发现的真缺陷，2026-09-17 修复）**：`note/show` 图片池对图集
      不保证完整，池缺映射时补调 `gallery/infos`（`{noteUuid, gids}`，匿名，墨问网页端同款
      两段式）合并；失败退回缺图告警不炸笔记。真机验收 3/3 落盘；e2e 断言「图集 3 张图全
      落盘（池 2 + gallery/infos 补 1）」。

### R2

- [x] Segmented 切换：按用户模式行为与 v0.11.1 完全一致（e2e 既有断言不改动全过）。
- [x] 按关键词搜索：结果表含标题/摘要/作者/发表/阅读列；作者名点击切回按用户模式并展开
      该作者清单（条件行出现）。
- [x] 模式切换清空结果与勾选状态（e2e 断言旧结果不残留）。
- [x] 搜索结果下载：勾选 → 下载选中 → 进度/历史/结果区与清单下载同表现；付费默认不选、
      可手动勾选（下载时如实报 unavailable，与 M61 语义一致）。
- [x] 「含引用子笔记」勾选在搜索结果表同样可用（分批提交语义不变）。
- [x] mocli 未装时两种模式的降级指引条均正常（MOCLI_NOT_FOUND handle 共用）。
- [x] 单测：searchNotes 返回含 authorName（users 映射拼接）；无 users 键时 authorName 空
      不崩。
- [x] **e2e 补充（M65）**：Segmented 存在 + 切「按关键词」placeholder 变化 + 切回「按用户」
      placeholder 复原（轻量静态断言；搜索行为本身走真机验收——mocli 外部二进制不进 mock e2e）。
- [x] **真机验收（M65）**：CLI `mowen search --keyword "AI 编程"` 条目带 authorName/阅读数、
      输出向后兼容（GUI 全链路验收由安哥本地下一步实机确认）。

### 全局

- [ ] `npm test`、`npm run lint`、`npx tsc --noEmit -p tsconfig.json`、`npm run test:e2e`
      全绿。
- [ ] 真机验收：用 05-oJyNajKAzUBD42qYjt（含引用）下载后阅读器看卡片；关键词「AI 编程」
      搜索 → 点作者名联动 → 批量下载全链路。
- [ ] `agent/wx-kit-skill/` 同步（R1 引用卡片对 CLI `mowen import` 输出的影响、R2 若
      CLI 行为有变则刷速查表；本版 CLI 面无变更则只核对）。

## 5. 版本与里程碑

- 里程碑拆分：M64（R1 引用卡片 + 尾部块退场）、M65（R2 搜索模式 + 作者联动）。实现计划
  `docs/plans/2026-09-17-m64-*.md` / `docs/plans/2026-09-17-m65-*.md`。
- 版本号 v0.11.2，发布走统一发版规约（feat 分支 → main → tag → GitHub Release + brew tap）。
