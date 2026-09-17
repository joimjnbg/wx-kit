import { useEffect, useState } from 'react'
import { Alert, Button, Input, Select, Spin } from 'antd'
import { api, type MpSessionInfo, type SubscribedAccount } from '../api'
import { sessionHint } from '../sync-view'

// 同步页外壳(票据 gui-01):Seed URL 输入 + 已订阅账号选择 + 登录态,暂无行列表。
// 行列表/选择器/下载接线见后续票据;本页只负责入口与登录态。
export default function Sync() {
  const [seedUrl, setSeedUrl] = useState('')
  const [accounts, setAccounts] = useState<SubscribedAccount[]>([])
  const [accountId, setAccountId] = useState<string | undefined>(undefined)
  const [session, setSession] = useState<MpSessionInfo | null>(null)
  const [authExpired, setAuthExpired] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

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
          <Button data-testid="sync-run" type="primary">同步</Button>
        </div>
      </div>
    </div>
  )
}
