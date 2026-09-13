// src/renderer/components/subscription/MowenPanel.tsx
// 墨问作者订阅面板（M63 R4a）。交互对齐微信面板：搜索添加 → 列表（行内检查 / 展开新笔记 /
// 勾选下载 / 忽略）+ 检查记录。数据全走 window.api（渲染层不 import node 依赖，M56 红线）。
// mocli 未装：整页显示安装指引（与墨问下载 tab 同文案），不打扰公众号 tab。
import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Input, List, Popconfirm, Spin, Tag, message } from 'antd'
import { DeleteOutlined, LoadingOutlined } from '@ant-design/icons'
import { api } from '../../api'
import type { MowenSubscribedAuthor, MowenUser, CheckLogEntry } from '../../api'

/** 收起时选择即全部——与微信面板同一「行内动作只有一个含义」的语义（防并列两套按钮）。 */
const pendingOf = (a: MowenSubscribedAuthor) => a.newNotes.filter((n) => n.status === 'pending')

export default function MowenPanel() {
  const [authors, setAuthors] = useState<MowenSubscribedAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [mocliMissing, setMocliMissing] = useState(false)
  const [kw, setKw] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<MowenUser[]>([])
  const [checkingIds, setCheckingIds] = useState<string[]>([])
  const [checkingAll, setCheckingAll] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [checkLog, setCheckLog] = useState<CheckLogEntry[]>([])

  const load = async () => {
    try {
      const [s, log] = await Promise.all([api.mowenSubsList(), api.subscriptionsList()])
      setAuthors(s.authors)
      setCheckLog((log.checkLog ?? []).filter((e) => e.platform === 'mowen'))
    } catch (e) {
      message.error('加载订阅失败：' + (e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { load(); return api.onMowenSubsUpdated(load) }, [])

  // 初始只看缓存结论（M60 启动检测写 settings），不主动触发重检——装没装是低频事实
  useEffect(() => {
    void api.mowenDetect().then((d) => setMocliMissing(!d.installed))
  }, [])

  const search = async () => {
    const k = kw.trim()
    if (!k) return
    setSearching(true)
    try {
      const r = await api.mowenSubsAdd(k)
      if (!r.ok) {
        if (r.error?.code === 'MOCLI_NOT_FOUND') setMocliMissing(true)
        message.error(r.error?.message ?? '搜索失败')
        return
      }
      setCandidates(r.authors ?? [])
    } finally { setSearching(false) }
  }

  const add = async (u: MowenUser) => {
    const r = await api.mowenSubsAdd(kw.trim(), u.uid)
    if (!r.ok) { message.warning(r.error?.message ?? '订阅失败'); return }
    message.success(`已订阅「${u.name}」，之后的更新会出现在这里`)
    setCandidates([]); setKw('')
    await load()
  }

  const checkOne = async (uid: string) => {
    setCheckingIds((prev) => [...prev, uid])
    try {
      const r = await api.mowenSubsCheckNow([uid])
      const mine = r.results.find((x) => x.uid === uid)
      if (mine && !mine.ok) message.error(`检查失败：${mine.error ?? '未知错误'}`)
    } catch (e) {
      message.error('检查失败：' + (e as Error).message)
    } finally {
      setCheckingIds((prev) => prev.filter((x) => x !== uid))
    }
  }

  const checkAll = async () => {
    setCheckingAll(true)
    try {
      const r = await api.mowenSubsCheckNow()
      if (r.note === 'mocli-missing') { setMocliMissing(true); message.error('未检测到 mocli，无法检查') }
      else if (r.newFound > 0) message.success(`发现 ${r.newFound} 篇新笔记`)
      else if (r.failed === 0) message.success('暂无新笔记')
    } catch (e) {
      message.error('检查失败：' + (e as Error).message)
    } finally { setCheckingAll(false) }
  }

  const pickedIds = (a: MowenSubscribedAuthor): string[] => {
    const all = pendingOf(a).map((n) => n.noteId)
    if (!expanded[a.uid]) return all
    const sel = selected[a.uid]
    return sel ? all.filter((id) => sel.includes(id)) : all
  }

  const downloadSelected = async (a: MowenSubscribedAuthor) => {
    const ids = pickedIds(a)
    if (!ids.length) return
    try {
      const r = await api.mowenSubsDownloadNotes(a.uid, ids)
      const head = `「${a.name}」已下载 ${r.downloaded} 篇`
      const skip = r.existed ? `，${r.existed} 篇已在库中` : ''
      if (r.failed > 0) message.warning(`${head}${skip}，${r.failed} 篇未成功（仍在待处理里，可再试一次）`)
      else message.success(head + skip)
      await load()
    } catch (e) {
      message.error('下载失败：' + (e as Error).message)
    }
  }

  const dismissSelected = async (a: MowenSubscribedAuthor) => {
    const ids = pickedIds(a)
    if (!ids.length) return
    await api.mowenSubsDismissNotes(a.uid, ids)
    await load()
  }

  const remove = async (a: MowenSubscribedAuthor) => {
    await api.mowenSubsRemove(a.uid)
    message.success(`已删除「${a.name}」`)
    await load()
  }

  const toggleExpand = (a: MowenSubscribedAuthor) => {
    setExpanded((prev) => ({ ...prev, [a.uid]: !prev[a.uid] }))
    // 默认全选（与微信面板同语义）
    setSelected((prev) => prev[a.uid] ? prev : { ...prev, [a.uid]: pendingOf(a).map((n) => n.noteId) })
  }
  const toggleOne = (uid: string, id: string, all: string[]) => {
    setSelected((prev) => {
      const cur = prev[uid] ?? all
      return { ...prev, [uid]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }
    })
  }

  if (mocliMissing) {
    return (
      <Alert type="warning" showIcon data-testid="mowen-subs-guide"
        message="墨问订阅需要 mocli"
        description={<>未检测到 mocli。请先安装并认证：<code>npm install -g @mowenxd/cli</code>；<code>mocli auth init</code>（API Key 在墨问小程序「我的 → 开发者」获取）。详见设置页「墨问集成」。</>}
      />
    )
  }

  const mowenLogs = checkLog.slice(0, 10)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input placeholder="输入墨问作者名字搜索并订阅" value={kw} onChange={(e) => setKw(e.target.value)}
          onPressEnter={search} style={{ width: 280 }} data-testid="mowen-subs-kw" allowClear disabled={searching} />
        <Button type="primary" onClick={search} loading={searching} data-testid="mowen-subs-search">搜索</Button>
        <div style={{ flex: 1 }} />
        <Button type="primary" loading={checkingAll} disabled={checkingIds.length > 0} onClick={checkAll} data-testid="mowen-subs-check-now">检查全部</Button>
      </div>

      {candidates.length > 0 && (
        <List size="small" bordered style={{ marginBottom: 16 }} dataSource={candidates}
          data-testid="mowen-subs-candidates"
          renderItem={(c) => (
            <List.Item actions={[<a key="add" data-testid="mowen-subs-subscribe" onClick={() => add(c)}>订阅</a>]}>
              <List.Item.Meta title={c.name} description={<span className="faint" style={{ fontSize: 12.5 }} title={c.intro}>{c.intro || '（无简介）'}</span>} />
            </List.Item>
          )} />
      )}

      {loading ? <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>
        : authors.length === 0 ? (
          <div className="empty-state">
            <div className="es-mark">订</div>
            <div className="es-title">还没有订阅墨问作者</div>
            <div>上方搜索作者名字，确认简介后订阅；之后的更新会出现在这里。</div>
          </div>
        ) : (
          <List dataSource={authors} data-testid="mowen-subs-list" renderItem={(a) => {
            const pending = pendingOf(a)
            const thisChecking = checkingIds.includes(a.uid)
            const all = pending.map((n) => n.noteId)
            const sel = selected[a.uid] ?? all
            return (
              <List.Item style={{ display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a data-testid="mowen-subs-author-row" onClick={() => toggleExpand(a)}
                      style={{ fontWeight: 600 }}>{a.name}</a>
                    <span className="faint" style={{ marginLeft: 8, fontSize: 12.5 }} title={a.intro}>
                      {a.intro.length > 40 ? a.intro.slice(0, 40) + '…' : (a.intro || '（无简介）')}
                    </span>
                    {pending.length > 0 && <Tag color="red" style={{ marginLeft: 8 }} data-testid="mowen-subs-new-badge">新 {pending.length}</Tag>}
                    {thisChecking && <span className="faint" style={{ marginLeft: 8 }}><LoadingOutlined /> 检查中</span>}
                  </div>
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    {a.lastCheckedAt ? `上次检查 ${new Date(a.lastCheckedAt).toLocaleString()}` : '尚未检查'}
                  </span>
                  <a data-testid="mowen-subs-check-btn" onClick={() => checkOne(a.uid)} style={{ opacity: checkingAll ? 0.5 : 1 }}>检查</a>
                  <Popconfirm title={`删除「${a.name}」？`} description="删除后该作者的订阅与检查状态一并移除；再次订阅会重新添加。"
                    okText="删除" cancelText="取消" onConfirm={() => remove(a)}>
                    <a data-testid="mowen-subs-remove" aria-label={`删除 ${a.name}`}><DeleteOutlined /></a>
                  </Popconfirm>
                </div>

                {expanded[a.uid] && (
                  <div className="subs-pending" style={{ marginTop: 8 }} data-testid="mowen-subs-notes">
                    {a.newNotes.length === 0 && <div className="faint" style={{ fontSize: 12.5 }}>还没有发现过新笔记。订阅后的更新会在这里出现。</div>}
                    {a.newNotes.map((n) => {
                      const downloadable = n.status === 'pending'
                      return (
                        <div key={n.noteId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}
                          data-testid="mowen-subs-note">
                          {downloadable && <Checkbox checked={sel.includes(n.noteId)}
                            onChange={() => toggleOne(a.uid, n.noteId, all)} data-testid="mowen-subs-note-check" />}
                          <a style={{ flex: 1, fontSize: 13 }} onClick={() => n.url && api.openExternal(n.url)}
                            title={n.url ? '在浏览器打开原文' : undefined}>{n.title || '(无标题)'}</a>
                          {n.publicAt != null && <span className="faint" style={{ fontSize: 12.5 }}>{new Date(n.publicAt * 1000).toLocaleString()}</span>}
                          <Tag color={n.status === 'downloaded' ? 'green' : n.status === 'ignored' ? 'default' : 'orange'}>
                            {n.status === 'downloaded' ? '已下载' : n.status === 'ignored' ? '已忽略' : '待处理'}
                          </Tag>
                          {downloadable && (
                            <a onClick={async () => {
                              const r = await api.mowenSubsDownloadNotes(a.uid, [n.noteId])
                              if (r.failed > 0) message.warning('下载失败，可重试')
                              else if (r.existed > 0) message.info('已在文库中')
                              else message.success('已下载')
                              await load()
                            }}>下载</a>
                          )}
                        </div>
                      )
                    })}
                    {pending.length > 0 && (
                      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                        <a onClick={() => downloadSelected(a)} data-testid="mowen-subs-download-sel">下载{expanded[a.uid] && sel.length !== all.length ? `所选（${sel.length}）` : `全部（${pending.length}）`}</a>
                        <a onClick={() => dismissSelected(a)} data-testid="mowen-subs-dismiss-sel">忽略{expanded[a.uid] && sel.length !== all.length ? `所选（${sel.length}）` : `全部（${pending.length}）`}</a>
                      </div>
                    )}
                  </div>
                )}
              </List.Item>
            )
          }} />
        )}

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>检查记录</h3>
        {mowenLogs.length === 0 ? <div className="faint" style={{ fontSize: 13 }}>还没有检查记录。开启自动检查或点「检查全部」后，这里会留痕。</div>
          : <List size="small" dataSource={mowenLogs} renderItem={(e) => (
              <List.Item data-testid="mowen-subs-log-entry" style={{ padding: '6px 0' }}>
                <span style={{ fontSize: 12.5 }}>
                  {new Date(e.time).toLocaleString()} · {e.trigger === 'auto' ? 'AUTO' : 'MANUAL'} · 查 {e.accounts} 位作者 · 新 {e.newFound} · 失败 {e.failed}{e.note ? ` · ${e.note}` : ''}
                </span>
              </List.Item>
            )} />}
      </div>
    </div>
  )
}
