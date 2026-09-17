import { useState } from 'react'
import { Segmented } from 'antd'
import UrlMode from '../components/download/UrlMode'
import MowenMode from '../components/download/MowenMode'
import DownloadHistory from '../components/download/DownloadHistory'
import type { HistoryEvent } from '../api'
import type { DownloadFormat } from '../../core/types'

export type UrlPrefill = { nonce: number; text: string; formats: DownloadFormat[] }

// 「下载」页容器：链接下载 + 墨问笔记（M61 R2a）+ 常驻下载历史。
// 顶层模式切换保持 Segmented（与订阅页平台切换同构，2026-09-17 安哥确认）；
// 「tab 与内容区割裂」的观感问题不在切换控件，而在内容区容器不统一——
// UrlMode 有 surface 白底卡片、MowenMode 裸渲染。正解是两个 tab 的内容都落在
// 同一形态的 surface 卡片里（MowenMode 内部已包），tab 与内容的关系自然成立。
// 两个模式共用同一条下载通道与历史——mowen URL 在 downloadArticle 顶部路由。
// v0.10.0 边界（2026-08-28）：微信读书列表接口被服务端按账号封禁，批量下载历史无解，
// 「按公众号下载」入口已按决策移除（见 AGENTS.md 与 docs/plans/2026-08-28-v0.10.0-scope-tighten.md）。
export default function Download() {
  const [mode, setMode] = useState<'url' | 'mowen'>('url')
  const [reloadKey, setReloadKey] = useState(0)
  const [urlPrefill, setUrlPrefill] = useState<UrlPrefill | undefined>()

  const onDone = () => setReloadKey((k) => k + 1)

  const onAgain = (ev: HistoryEvent) => {
    setUrlPrefill({
      nonce: Date.now(),
      text: ev.items.map((i) => i.url).join('\n'),
      formats: ev.formats,
    })
  }

  return (
    <div className="page">
      <div className="fade-in">
        <div style={{ marginBottom: 16 }}>
          <Segmented value={mode} onChange={(v) => setMode(v as 'url' | 'mowen')}
            data-testid="download-mode-segmented"
            options={[{ label: '按链接下载', value: 'url' }, { label: '墨问笔记', value: 'mowen' }]} />
        </div>
        {mode === 'url'
          ? <UrlMode onDone={onDone} prefill={urlPrefill} />
          : <MowenMode onDone={onDone} />}
        <DownloadHistory reloadKey={reloadKey} onAgain={onAgain} />
      </div>
    </div>
  )
}
