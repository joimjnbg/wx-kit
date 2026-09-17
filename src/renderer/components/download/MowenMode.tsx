import { useState } from 'react'
import { Input, Button, Select, InputNumber, Checkbox, Table, Tag, Typography, message, Segmented } from 'antd'
import { api } from '../../api'

const { Text } = Typography

interface UserItem { uid: string; name: string; intro: string; homeUrl: string }
interface NoteItem {
  noteId: string; uid: string; title: string; brief: string; url: string
  publicAt: number | null; withFee: boolean; withImage: boolean; withText: boolean
  wordCount: number | null; viewCount: number | null; favorCount: number | null
  authorName?: string
}

// 「墨问笔记」tab（M61 R2a + M65）：顶部 Segmented「按用户 ｜ 按关键词」两种找法，
// 一个搜索入口、结果区形态随模式变。下载走现有 download 通道（mowen URL 在
// downloadArticle 路由），进度/历史/结果区全部复用。
// 模式切换语义：切模式 = 开新会话，旧结果与勾选清空（半新半旧的混合态最让人困惑）；
// 唯一例外是搜索结果里点作者名的主动联动——那是有意图的跳转，直接展开该作者清单。
// mocli 未装：顶部指引条（不灰死整页，PRD R3 降级语义）。
export default function MowenMode({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'user' | 'keyword'>('user')
  const [keyword, setKeyword] = useState('')
  const [users, setUsers] = useState<UserItem[] | null>(null)
  const [authors, setAuthors] = useState<UserItem[]>([])
  const [user, setUser] = useState<UserItem | null>(null)
  const [filter, setFilter] = useState('all')
  const [recent, setRecent] = useState<string | undefined>('7d')
  const [count, setCount] = useState(20)
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [expandRefs, setExpandRefs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [mocliMissing, setMocliMissing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handle = (r: { ok: boolean; error?: { code: string; message: string } }): boolean => {
    if (r.ok) { setMocliMissing(false); setErrorMsg(''); return true }
    if (r.error?.code === 'MOCLI_NOT_FOUND') setMocliMissing(true)
    else setErrorMsg(r.error?.message ?? '请求失败')
    return false
  }

  /** 切模式 = 开新会话：结果/勾选/选中状态全清，回空态。 */
  const switchMode = (m: 'user' | 'keyword') => {
    if (m === mode) return
    setMode(m)
    setKeyword(''); setUsers(null); setAuthors([]); setUser(null)
    setNotes([]); setChecked(new Set()); setExpandRefs(new Set())
  }

  const search = async () => {
    if (!keyword.trim()) { message.warning(mode === 'user' ? '输入要搜索的用户名' : '输入要搜索的关键词'); return }
    setLoading(true)
    try {
      if (mode === 'user') {
        const r = await api.mowenSearchUsers(keyword.trim())
        if (!handle(r)) return
        setUsers(r.users ?? [])
        setUser(null); setNotes([]); setChecked(new Set())
        if (!r.users?.length) message.info('没有匹配的用户')
      } else {
        const r = await api.mowenSearchNotes(keyword.trim())
        if (!handle(r)) return
        setNotes(r.notes ?? [])
        setAuthors(r.authors ?? [])
        setChecked(new Set((r.notes ?? []).filter((n) => !n.withFee).map((n) => n.noteId)))
        setExpandRefs(new Set())
        if (!r.notes?.length) message.info('没有匹配的笔记')
      }
    } finally { setLoading(false) }
  }

  const listNotes = async (u: UserItem) => {
    setLoading(true)
    try {
      const r = await api.mowenListUserNotes(u.uid, { filter, recent, count })
      if (!handle(r)) return
      setNotes(r.notes ?? [])
      // 默认全选；「文库已有」此处未知（下载时判重跳过并如实标注），付费笔记默认不选
      setChecked(new Set((r.notes ?? []).filter((n) => !n.withFee).map((n) => n.noteId)))
      setExpandRefs(new Set())
    } finally { setLoading(false) }
  }

  const pickUser = (u: UserItem) => {
    setUser(u)
    void listNotes(u)
  }

  /** 作者联动（有意图的跳转，不算切模式丢状态）：切回「按用户」+ 直接展开该作者清单。 */
  const jumpToAuthor = (uid: string) => {
    const a = authors.find((x) => x.uid === uid)
    if (!a) return
    setMode('user')
    setKeyword(''); setUsers(null); setAuthors([])
    pickUser(a)
  }

  const toggle = (id: string) => {
    setChecked((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  }
  const toggleExpand = (id: string) => {
    setExpandRefs((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id) } else { n.add(id) } return n })
  }

  const downloadChecked = async () => {
    const ids = notes.filter((n) => checked.has(n.noteId))
    if (!ids.length) { message.warning('先勾选要下载的笔记'); return }
    setLoading(true)
    try {
      const formats = (await api.getSettings()).defaultFormats
      // 展开引用按篇生效（M61：隐式递归是意外不是功能）——勾了「展开」的一批带 expandRefs，
      // 没勾的一批不带，分两次提交，各批语义互不污染。
      const expand = ids.filter((n) => expandRefs.has(n.noteId))
      const plain = ids.filter((n) => !expandRefs.has(n.noteId))
      const parts = []
      if (plain.length) parts.push(await api.download(plain.map((n) => n.url), formats))
      if (expand.length) parts.push(await api.download(expand.map((n) => n.url), formats, { expandRefs: true }))
      const r = {
        total: parts.reduce((s, x) => s + x.total, 0),
        failed: parts.reduce((s, x) => s + x.failed, 0),
        unavailable: parts.reduce((s, x) => s + (x.unavailable ?? 0), 0),
      }
      const failed = r.failed
      const unavail = r.unavailable ?? 0
      const msg = unavail
        ? `已提交 ${r.total} 篇下载（${unavail} 篇不可匿名获取（付费/私密），详见下载历史）`
        : `已提交 ${r.total} 篇下载${failed ? `（${failed} 篇失败，详见下载历史）` : ''}`
      message.success(msg)
      onDone()
    } catch (e) { message.error('下载失败：' + (e as Error).message) }
    finally { setLoading(false) }
  }

  const fmtTime = (sec: number | null) => {
    if (sec == null || sec <= 0) return '—'   // 真机实测：搜索结果有 public_at=0 的条目（显示 1970-01-01 是误导）
    const d = new Date(sec * 1000)
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  // 勾选/「含引用子笔记」/下载按钮：两模式的表格共用同一套逻辑
  const rowSelection = {
    selectedRowKeys: [...checked],
    onSelect: (rec: NoteItem) => toggle(rec.noteId),
    onSelectAll: (selected: boolean, _rows: NoteItem[], changeRows: NoteItem[]) => setChecked((s) => {
      const n = new Set(s)
      for (const row of changeRows) {
        if (selected) { n.add(row.noteId) } else { n.delete(row.noteId) }
      }
      return n
    }),
  }
  const downloadButton = (
    <Button type="primary" size="small" data-testid="mowen-download"
      disabled={checked.size === 0 || loading} onClick={downloadChecked}
      loading={loading}>
      下载选中（{checked.size}）
    </Button>
  )
  const expandColumn = {
    title: '下载', width: 170,
    render: (_v: unknown, rec: NoteItem) => (
      <Checkbox checked={expandRefs.has(rec.noteId)} disabled={!checked.has(rec.noteId)}
        onChange={() => toggleExpand(rec.noteId)} data-testid="mowen-expand-refs">
        含引用子笔记
      </Checkbox>
    ),
  }

  return (
    <div data-testid="mowen-mode">
      {mocliMissing && (
        <div className="setting-hint" data-testid="mowen-tab-missing" style={{ marginBottom: 12 }}>
          未检测到 mocli。请先安装并认证：<code>npm install -g @mowenxd/cli</code>；<code>mocli auth init</code>（API Key 在墨问小程序「我的 → 开发者」获取）。详见设置页「墨问集成」。
        </div>
      )}
      {errorMsg && <div className="setting-hint" style={{ color: 'var(--cinnabar)', marginBottom: 12 }} data-testid="mowen-tab-error">{errorMsg}</div>}

      {/* surface 白底卡片：与「按链接下载」tab 的内容区同形态——两个 tab 落在同一视觉
          容器里，Segmented 与内容的关系才成立（2026-09-17 安哥反馈「tab 与内容区割裂」
          的根因是 UrlMode 有 surface、这里裸渲染，不是切换控件的问题）。padding 对齐
          UrlMode 的 cfg-sec（20px 22px）。指引条/错误条留在卡片外（alert 语义）。 */}
      <div className="surface" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Segmented
          value={mode}
          onChange={(v) => switchMode(v as 'user' | 'keyword')}
          options={[{ value: 'user', label: '按用户' }, { value: 'keyword', label: '按关键词' }]}
          data-testid="mowen-mode-seg" />
        <Input.Search data-testid="mowen-search-input"
          placeholder={mode === 'user' ? '按用户名/简介模糊搜索墨问用户' : '按关键词搜索全站墨问笔记'}
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onSearch={search} loading={loading} style={{ maxWidth: 420 }}
          enterButton={mode === 'user' ? '搜用户' : '搜笔记'} />
      </div>

      {mode === 'user' && (
        <>
          {users && users.length > 0 && (
            <div style={{ margin: '12px 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {users.map((u) => (
                <Button key={u.uid} size="small" type={user?.uid === u.uid ? 'primary' : 'default'}
                  data-testid="mowen-user-item" title={u.intro}
                  onClick={() => pickUser(u)}>
                  {u.name}
                </Button>
              ))}
            </div>
          )}

          {user && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
                <Text strong>「{user.name}」的笔记</Text>
                <Select value={filter} onChange={(v) => setFilter(v)} style={{ width: 100 }} data-testid="mowen-filter"
                  options={[{ value: 'all', label: '全部' }, { value: 'album', label: '合集' }, { value: 'fee', label: '付费' }, { value: 'popular', label: '热门' }]} />
                <Select value={recent} onChange={(v) => setRecent(v)} allowClear placeholder='不限时间' style={{ width: 110 }} data-testid="mowen-recent"
                  options={[{ value: '24h', label: '24 小时' }, { value: '3d', label: '3 天' }, { value: '7d', label: '7 天' }, { value: '15d', label: '15 天' }]} />
                <InputNumber min={1} max={100} value={count} onChange={(v) => setCount(v ?? 20)} data-testid="mowen-count" />
                <Button size="small" onClick={() => listNotes(user)} loading={loading}>刷新清单</Button>
                <span style={{ flex: 1 }} />
                {downloadButton}
              </div>

              <Table<NoteItem>
                size="small" rowKey="noteId" dataSource={notes} loading={loading}
                pagination={{ pageSize: 10 }} rowSelection={rowSelection}
                tableLayout="fixed"
                columns={[
                  {
                    title: '标题', dataIndex: 'title', ellipsis: true,
                    render: (_v, rec) => (
                      <span>
                        {rec.withFee && <Tag color="gold" data-testid="mowen-tag-fee">付费</Tag>}
                        <Text>{rec.title || '(无标题)'}</Text>
                      </span>
                    ),
                  },
                  { title: '发表', width: 106, render: (_v, rec) => fmtTime(rec.publicAt) },
                  { title: '字数', width: 70, render: (_v, rec) => rec.wordCount ?? '—' },
                  expandColumn,
                ]}
              />
            </>
          )}
        </>
      )}

      {mode === 'keyword' && notes.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
            <Text strong>「{keyword}」的搜索结果（{notes.length}）</Text>
            <span style={{ flex: 1 }} />
            {downloadButton}
          </div>

          <Table<NoteItem>
            size="small" rowKey="noteId" dataSource={notes} loading={loading}
            pagination={{ pageSize: 10 }} rowSelection={rowSelection}
            tableLayout="fixed"
            columns={[
              {
                title: '标题', dataIndex: 'title',
                render: (_v, rec) => (
                  <div>
                    <div>
                      {rec.withFee && <Tag color="gold" data-testid="mowen-tag-fee">付费</Tag>}
                      <Text>{rec.title || '(无标题)'}</Text>
                    </div>
                    {rec.brief && <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{rec.brief}</Text>}
                  </div>
                ),
              },
              {
                // 作者列：搜索结果跨作者，作者名是判断「哪篇值得下」的第一信号；
                // 点击 = 联动切回「按用户」并展开该作者完整清单（搜到一篇好笔记 → 看他全部作品）
                title: '作者', width: 110, ellipsis: true,
                render: (_v, rec) => (
                  rec.authorName
                    ? <Button type="link" size="small" style={{ padding: 0 }} data-testid="mowen-author-link"
                        onClick={() => jumpToAuthor(rec.uid)}>
                        {rec.authorName}
                      </Button>
                    : <Text type="secondary">—</Text>
                ),
              },
              { title: '发表', width: 106, render: (_v, rec) => fmtTime(rec.publicAt) },
              { title: '阅读', width: 70, align: 'right' as const, render: (_v, rec) => rec.viewCount != null ? rec.viewCount.toLocaleString() : '—' },
              expandColumn,
            ]}
          />
        </>
      )}
      </div>
    </div>
  )
}
