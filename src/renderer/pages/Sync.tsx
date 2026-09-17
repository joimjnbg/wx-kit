import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, List, Select, Spin, Tag, message } from 'antd'
import { api, type MpSessionInfo, type SubscribedAccount } from '../api'
import { sessionHint } from '../sync-view'
import { buildSyncRows, computePicked, mergeSyncRows, pickSummary, type SyncRow } from '../sync-rows'

// 同步页(票据 02a):Seed URL 确认账号或已选订阅账号 → 待处理行 + 已存档标记。
// 选择器与下载接线见后续票据;本页负责入口、行列表与登录态。
export default function Sync() {
  const [seedUrl, setSeedUrl] = useState('')
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [accountId, setAccountId] = useState<string | undefined>(undefined)
  const [session, setSession] = useState<MpSessionInfo | null>(null)
  const [authExpired, setAuthExpired] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  // 同步行:Seed URL 确认的账号或已选订阅账号的待处理条目
  const [rows, setRows] = useState<SyncRow[]>([])
  const [syncing, setSyncing] = useState(false)
  const [confirmed, setConfirmed] = useState<{ fakeid: string; nickname: string } | null>(null)
  // 选择器(票据 03):批量类型开关 + 单篇勾选 refId 集;计算集实时预览
  // touched 记录用户动过的复选框(开或关):动过则显式值覆盖开关,默认全选只在首轮生效
  const [types, setTypes] = useState({ text: true, video: true })
  const [_checked, setChecked] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const picked = useMemo(() => computePicked(rows, _checked, types, touched), [rows, _checked, types, touched])

  useEffect(() => {
    let alive = true
    Promise.all([api.subscriptionsList().catch(() => null), api.mpSessionInfo().catch(() => null)])
      .then(([subs, sess]) => {
        if (!alive) return
        if (!subs || !sess) { setFailed(true); return }
        setAccounts(subs.accounts ?? [])
        setAuthExpired(subs.authExpired)
        setSession(sess)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // 同步入口:Seed URL 走 mp:search 确认账号并订阅,账号选择走已有订阅;
  // 随后 checkNow 拉取待处理,与文库交叉得已存档标记。鉴权失效只报重登,不落空行。
  const runSync = async () => {
    const url = seedUrl.trim()
    const target = accountId ?? confirmed?.fakeid
    if (!url && !target) { message.warning('请粘贴文章链接或选择已订阅账号'); return }
    setSyncing(true)
    try {
      let fakeid = target
      if (url) {
        const r = await api.mpSearch(url)
        if (!r.ok) {
          if (r.error?.code === 'AUTH_REQUIRED') { setAuthExpired(true); return }
          message.error(r.error?.message ?? '识别失败')
          return
        }
        const hit = r.list?.[0]
        if (!hit) { message.error('未识别到公众号'); return }
        setConfirmed({ fakeid: hit.fakeid, nickname: hit.nickname })
        await api.subscriptionsAddAccount(hit.fakeid, hit.nickname)
        fakeid = hit.fakeid
      }
      if (!fakeid) return
      const check = await api.subscriptionsCheckNow([fakeid])
      if (check.note === 'auth-expired' || check.authExpired) { setAuthExpired(true); return }
      const [subs, lib] = await Promise.all([api.subscriptionsList(), api.libraryList()])
      const acc = subs.accounts.find((a) => a.fakeid === fakeid)
      setAccounts(subs.accounts)
      setAuthExpired(subs.authExpired)
      // 已存档交叉:主键 mid_idx 优先(URL 形态会变),回退归一化 URL
      const archivedIds = new Set(lib.map((m) => m.id))
      const archivedUrls = new Set(lib.map((m) => m.sourceUrl))
      const next = buildSyncRows(acc?.newRefs ?? [], { archivedIds, archivedUrls })
      // 重同步合并(并集):同 refId 用新行替换(archived 刷新),旧独有行保留,按时间重排
      const isFirst = rows.length === 0
      setRows((prev) => mergeSyncRows(prev, next))
      setChecked((prev) => {
        const kept = new Set(prev)
        if (isFirst && prev.size === 0) for (const n of next) kept.add(n.refId)
        return kept
      })
      // 首轮行进入 touched(默认全选即显式选择);后续新行追加进 touched+checked
      setTouched((prev) => {
        const kept = new Set(prev)
        if (isFirst) for (const n of next) kept.add(n.refId)
        else for (const n of next) {
          if (!rows.some((r) => r.refId === n.refId)) { kept.add(n.refId); setChecked((c) => new Set(c).add(n.refId)) }
        }
        return kept
      })
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <div className="page"><Spin data-testid="sync-loading" /></div>
  if (failed) return <div className="page" data-testid="sync-page"><Alert data-testid="sync-load-error" type="error" message="同步页加载失败,请重试" /></div>
  // 登录态双源:订阅检查结论(authExpired)优先,会话探测(mpSessionInfo)次之
  const expired = authExpired || session?.loggedIn === false
  const loggedIn = expired ? false : (session == null ? null : session.loggedIn)
  return (
    <div className="page" data-testid="sync-page">
      <div className="fade-in">
        <Alert data-testid="sync-session-hint" type={loggedIn === false ? 'warning' : 'info'}
          message={sessionHint({ loggedIn })}
          {...(loggedIn === false ? { description: '到「设置」页扫码后回到本页同步' } : {})} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Input data-testid="sync-seed-input" placeholder="粘贴该号任意一篇文章链接"
            value={seedUrl} onChange={(e) => setSeedUrl(e.target.value)} />
          <Select data-testid="sync-account-select" placeholder="或选已订阅账号" style={{ minWidth: 200 }}
            value={accountId} onChange={(v) => setAccountId(v)}
            options={accounts.map((a) => ({ label: a.nickname, value: a.fakeid }))} />
          <Button data-testid="sync-run" type="primary" loading={syncing} onClick={runSync}>同步</Button>
        </div>
        {confirmed && (
          <Alert data-testid="sync-confirmed" type="success" style={{ marginTop: 8 }}
            message={`已确认账号:${confirmed.nickname}(${confirmed.fakeid})`} />
        )}
          <List data-testid="sync-rows" style={{ marginTop: 12 }} bordered
            dataSource={rows}
            locale={{ emptyText: syncing ? '同步中…' : '暂无待处理文章' }}
            header={
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Checkbox data-testid="sync-type-text" checked={types.text}
                  onChange={(e) => setTypes((t) => ({ ...t, text: e.target.checked }))}>图文/文字</Checkbox>
                <Checkbox data-testid="sync-type-video" checked={types.video}
                  onChange={(e) => setTypes((t) => ({ ...t, video: e.target.checked }))}>视频</Checkbox>
                <span data-testid="sync-pick-count">{pickSummary(picked.length, rows.length)}</span>
              </div>
            }
            renderItem={(r) => (
              <List.Item key={r.refId}>
                <Checkbox data-testid={`sync-check-${r.refId}`} checked={picked.some((p) => p.refId === r.refId)}
                  onChange={(e) => {
                    const id = r.refId
                    const on = e.target.checked
                    setTouched((prev) => new Set(prev).add(id))
                    setChecked((prev) => {
                      const next = new Set(prev)
                      if (on) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }}>
                  <span>{r.title}</span>
                </Checkbox>
                {r.kindLabel && <Tag color={r.kindWarn ? 'warning' : 'default'}>{r.kindLabel}</Tag>}
                {r.archived && <Tag color="green">已存档</Tag>}
              </List.Item>
            )} />
      </div>
    </div>
  )
}
