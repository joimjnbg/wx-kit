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
  // 下载接线(票据 04):计算集按账号走 subscriptionsDownloadNew,进度复用订阅广播;
  // 行级结果落 resultById(成功/失败/不可见常驻行上),失败行可单篇重试
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [resultById, setResultById] = useState<Record<string, { status: 'ok' | 'failed' | 'unavailable'; message?: string }>>({})

  useEffect(() => api.onSubscriptionDownloadProgress((e) => {
    setDlProgress({ done: e.done, total: e.total, phase: e.phase })
  }), [])

  const downloadPicked = async (ids?: string[]) => {
    const targets = ids ?? picked.map((p) => p.refId)
    if (!targets.length || downloading) return
    const target = accountId ?? confirmed?.fakeid
    if (!target) { message.warning('请先同步确认账号'); return }
    setDownloading(true)
    // 进度标记:广播不到时(如单测外)至少显示"下载中",下载结束清除
    const progressTimer = setTimeout(() => {
      setDlProgress((cur) => cur ?? { done: 0, total: targets.length, phase: 'downloading' })
    }, 1500)
    try {
      const r = await api.subscriptionsDownloadNew(target, targets)
      const kept = r?.kept ?? 0
      if (kept > 0) message.warning(`已下载 ${r?.downloaded ?? 0} 篇,还有 ${kept} 篇未成功,可重试`)
      else message.success(`已下载 ${r?.downloaded ?? targets.length} 篇${r?.skipped ? `,${r.skipped} 篇文库已有` : ''}`)
      // 行级结果:成功行标 ok,失败行留 failed/unavailable 供单篇重试(常驻,不清)
      setResultById((prev) => {
        const next = { ...prev }
        for (const id of targets) next[id] = { status: 'ok' }
        return next
      })
      // 下载后刷新行(已下载行清出待处理,archived 标记更新)
      const [subs, lib] = await Promise.all([api.subscriptionsList(), api.libraryList()])
      const acc = subs.accounts.find((a) => a.fakeid === target)
      setAccounts(subs.accounts)
      const archivedIds = new Set(lib.map((m) => m.id))
      const archivedUrls = new Set(lib.map((m) => m.sourceUrl))
      const next = buildSyncRows(acc?.newRefs ?? [], { archivedIds, archivedUrls })
      // 留在待处理中的 = 未成功(失败/不可见):标 failed 供重试;已清出 = 成功
      const nextIds = new Set(next.map((n) => n.refId))
      setResultById((prev) => {
        const marked = { ...prev }
        for (const id of targets) {
          if (nextIds.has(id)) marked[id] = { status: 'failed', message: '未成功,可重试' }
        }
        return marked
      })
      setRows((prev) => mergeSyncRows(prev, next))
      setChecked((prev) => new Set([...prev].filter((id) => nextIds.has(id))))
      setTouched((prev) => new Set([...prev].filter((id) => nextIds.has(id))))
    } catch (e) {
      message.error('下载失败:' + (e as Error).message)
    } finally {
      clearTimeout(progressTimer)
      setDownloading(false)
      setDlProgress(null)
    }
  }

  const retryOne = (refId: string) => downloadPicked([refId])

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
      // 先读快照(种子行):checkNow 在下载策略下会清待处理,快照保证种子行不丢
      const [subsBefore, lib] = await Promise.all([api.subscriptionsList(), api.libraryList()])
      const seedRows = buildSyncRows(
        subsBefore.accounts.find((a) => a.fakeid === fakeid)?.newRefs ?? [],
        { archivedIds: new Set(), archivedUrls: new Set() },
      )
      const check = await api.subscriptionsCheckNow([fakeid])
      if (check.note === 'auth-expired' || check.authExpired) { setAuthExpired(true); return }
      const [subs, lib] = await Promise.all([api.subscriptionsList(), api.libraryList()])
      const acc = subs.accounts.find((a) => a.fakeid === fakeid)
      setAccounts(subs.accounts)
      setAuthExpired(subs.authExpired)
      // 已存档交叉:主键 mid_idx 优先(URL 形态会变),回退归一化 URL
      const archivedIds = new Set(lib.map((m) => m.id))
      const archivedUrls = new Set(lib.map((m) => m.sourceUrl))
      const fresh = buildSyncRows(acc?.newRefs ?? [], { archivedIds, archivedUrls })
      // 快照种子行 + 新行并集(种子可能已被检查清掉,但下载仍可用):去重按 refId
      const seen = new Set(fresh.map((n) => n.refId))
      const next = [...fresh, ...seedRows.filter((s) => !seen.has(s.refId))]
      // 重同步合并(并集):同 refId 用新行替换(archived 刷新),旧独有行保留,按时间重排
      const isFirst = rows.length === 0
      setRows((prev) => mergeSyncRows(prev, next))
      // 首轮默认:行与勾选一并进 touched(显式选择);后续新行才追加勾选
      if (isFirst) {
        setChecked(new Set(next.map((n) => n.refId)))
        setTouched(new Set(next.map((n) => n.refId)))
      } else {
        const known = new Set(rows.map((r) => r.refId))
        const fresh = next.filter((n) => !known.has(n.refId))
        if (fresh.length) {
          setChecked((prev) => new Set([...prev, ...fresh.map((n) => n.refId)]))
          setTouched((prev) => new Set([...prev, ...fresh.map((n) => n.refId)]))
        }
      }
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
          <span data-testid="sync-account-select"><Select placeholder="或选已订阅账号" style={{ minWidth: 200 }}
            value={accountId} onChange={(v) => setAccountId(v)}
            options={accounts.map((a) => ({ label: a.nickname, value: a.fakeid }))} /></span>
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
                  onChange={(e) => {
                    const on = e.target.checked
                    setTypes((t) => ({ ...t, text: on }))
                    // 关 text:该类行取消勾选(显式勾选保留);开 text:该类行默认勾选
                    setTouched((prev) => {
                      const next = new Set(prev)
                      for (const r of rows) if (r.itemShowType !== 5) next.add(r.refId)
                      return next
                    })
                    setChecked((prev) => {
                      const next = new Set(prev)
                      for (const r of rows) {
                        if (r.itemShowType === 5) continue
                        if (on) next.add(r.refId)
                        else next.delete(r.refId)
                      }
                      return next
                    })
                  }}>图文/文字</Checkbox>
                <Checkbox data-testid="sync-type-video" checked={types.video}
                  onChange={(e) => {
                    const on = e.target.checked
                    setTypes((t) => ({ ...t, video: on }))
                    setTouched((prev) => {
                      const next = new Set(prev)
                      for (const r of rows) if (r.itemShowType === 5) next.add(r.refId)
                      return next
                    })
                    setChecked((prev) => {
                      const next = new Set(prev)
                      for (const r of rows) {
                        if (r.itemShowType !== 5) continue
                        if (on) next.add(r.refId)
                        else next.delete(r.refId)
                      }
                      return next
                    })
                  }}>视频</Checkbox>
                <span data-testid="sync-pick-count">{pickSummary(picked.length, rows.length)}</span>
                <Button data-testid="sync-download" type="primary" loading={downloading}
                  disabled={!picked.length} onClick={() => downloadPicked()}>
                  下载已选({picked.length})
                </Button>
                {dlProgress && <span data-testid="sync-dl-progress">{dlProgress.done}/{dlProgress.total} {dlProgress.phase}</span>}
              </div>
            }
            renderItem={(r) => {
              const res = resultById[r.refId]
              return (
                <List.Item key={r.refId}
                  actions={res?.status === 'failed'
                    ? [<Button key="retry" size="small" data-testid={`sync-retry-${r.refId}`} onClick={() => retryOne(r.refId)}>重试</Button>]
                    : []}>
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
                  {res?.status === 'ok' && <Tag color="green">已下载</Tag>}
                  {res?.status === 'failed' && <Tag color="red">未成功</Tag>}
                  {res?.status === 'unavailable' && <Tag color="orange">读者不可见</Tag>}
                </List.Item>
              )
            }} />
      </div>
    </div>
  )
}
