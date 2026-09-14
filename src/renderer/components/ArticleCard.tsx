import { useEffect, useState } from 'react'
import { Dropdown, Modal, Popconfirm, Button, Spin, Tag, message } from 'antd'
import type { ArticleMeta } from '../../core/types'
import { api } from '../api'
import { toWxfileBase, wxfileJoin } from '../wxfile'
import { relativeTime } from '../time'
import { kindTag } from '../../core/message-kind'
import { cardMenuItems } from '../copy-path'

interface Props {
  meta: ArticleMeta
  libraryRoot: string
  index: number
  selected: boolean
  onToggleSelect: () => void   // 单击卡片：切换选中
  onRead: () => void           // 双击卡片 / hover「阅读」：进入阅读
  onReveal: () => void
  onCopyPath: () => void       // M59 R1：复制该篇目录绝对路径
  onDelete: () => void
  /** 卡片上的行动（补下载引用/重下）完成后通知父级刷新文库（v0.11.0） */
  onChanged?: () => void
}

// 书架上的一篇文章：封面缩略图（无则朱砂首字占位）+ 衬线标题 + 公众号/时间。
// 单击=选中（切换），双击=阅读；hover 浮出操作。内容人脑子里是「封面+标题」，不是表格行。
// 类型文案在 core/message-kind（M40 上提）：订阅页的待处理列表也要用同一份，两处各写一份必然漂。

export default function ArticleCard({ meta, libraryRoot, index, selected, onToggleSelect, onRead, onReveal, onCopyPath, onDelete, onChanged }: Props) {
  const [cover, setCover] = useState<string | null>(null)
  const readable = meta.formats.includes('md') || meta.formats.includes('html')
  const tag = kindTag(meta.itemShowType)
  // 提示/告警行动弹窗（v0.11.0）：标识可点，点开即见全文与下一步动作——
  // 「只报告不引导」等于让用户自己猜下一步（安哥实测反馈）。
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const allWarnings = meta.warnings ?? []
  const infoWarnings = allWarnings.filter((w) => w.includes('引用子笔记'))
  const realWarnings = allWarnings.filter((w) => !w.includes('引用子笔记'))
  // 引用子笔记清单：弹窗打开时按需拉真实标题与库内状态（点开才花请求）
  const [refNotes, setRefNotes] = useState<{ noteId: string; title: string; available: boolean; inLibrary: boolean }[] | null>(null)
  const [refLoading, setRefLoading] = useState(false)
  const reloadRefNotes = () => {
    setRefLoading(true)
    api.mowenRefNotes(meta.sourceUrl)
      .then((r) => setRefNotes(r.ok ? (r.notes ?? []) : []))
      .catch(() => setRefNotes([]))
      .finally(() => setRefLoading(false))
  }
  const openNotice = () => {
    setNoticeOpen(true)
    if (infoWarnings.length && refNotes == null) reloadRefNotes()
  }

  useEffect(() => {
    let alive = true
    if (meta.formats.includes('cover')) {
      api.coverName(meta.dir).then((name) => {
        if (alive && name) setCover(wxfileJoin(toWxfileBase(libraryRoot, meta.dir), name))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [meta.dir, meta.formats, libraryRoot])

  // 行动：就地把提示/告警变成可执行的下一步（v0.11.0 安哥反馈「列出来用户又能怎样」）。
  // api.download 等队列跑完才返回——返回即下载已结束，提示说结果，不说「已提交」。
  const runAction = async (kind: 'expand' | 'redownload') => {
    setActing(kind)
    try {
      const formats = (await api.getSettings()).defaultFormats
      if (kind === 'expand') {
        // 本体已在文库（判重 skip），只补引用的子笔记
        const s = await api.download([meta.sourceUrl], formats, { expandRefs: true })
        if (s.succeeded > 0) message.success(`引用笔记已下载 ${s.succeeded} 篇`)
        else if (s.failed > 0) message.warning('引用笔记下载失败，可稍后重试')
        else message.info('引用笔记均已在文库中')
        reloadRefNotes()   // 就地刷新库内状态：刚下的子笔记立即变「已在文库」
      } else {
        await api.libraryRemove(meta.id)
        const s = await api.download([meta.sourceUrl], formats)
        if (s.succeeded > 0) message.success('已删除旧内容并重新下载完成')
        else if (s.failed > 0) message.warning('重新下载失败，可稍后重试')
        else message.info('内容无变化')
      }
      setNoticeOpen(false)
      onChanged?.()
    } catch (e) {
      message.error('操作失败：' + (e as Error).message)
    } finally { setActing(null) }
  }

  // M59 R1：右键菜单与 hover 按钮共用同一组 handler（发现性补充，不替换 hover 入口）。
  // 菜单动作统一 stopPropagation，不触发卡片单击选中。
  const menu = {
    items: cardMenuItems(readable).map((i) => ({
      key: i.key, label: i.label, danger: i.danger, disabled: i.disabled,
    })),
    onClick: ({ key, domEvent }: { key: string; domEvent: React.SyntheticEvent }) => {
      domEvent.stopPropagation()
      if (key === 'read') { if (readable) onRead() }
      else if (key === 'reveal') onReveal()
      else if (key === 'copy-path') onCopyPath()
      else if (key === 'delete') {
        Modal.confirm({
          title: '删除该文章？', content: '磁盘文件将一并删除',
          okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
          onOk: onDelete,
        })
      }
    },
  }

  return (
    <>
    <Dropdown menu={menu} trigger={['contextMenu']}>
    <div className={`article-card${selected ? ' sel' : ''}`} data-testid="article-card"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      onClick={onToggleSelect} onDoubleClick={() => readable && onRead()}>
      <div className="card-chk">✓</div>
      {cover ? (
        <img className="article-cover" src={cover} alt="" loading="lazy" />
      ) : (
        <div className="cover-fallback">{(meta.title || '文').slice(0, 1)}</div>
      )}
      <div className="article-body">
        <div className="article-title" title={meta.title}>{meta.title || '(无标题)'}</div>
        <div className="article-meta">
          {/* 含视频的文章值得一眼看出来（视频是最占空间也最容易被忽略的部分） */}
          {meta.videos?.length ? <span data-testid="card-has-video" title={`含 ${meta.videos.length} 个视频`}>📹 </span> : null}
          {/* 非普通图文标出类型：同一个文库里混着文字消息/视频消息，形态差别很大 */}
          {tag && (
            <span data-testid="card-kind" className={`kind-tag${tag.warn ? ' warn' : ''}`}
              title={tag.warn ? `未识别的消息类型 ${meta.itemShowType}，正文是兜底提取的，建议核对` : undefined}>{tag.text} </span>
          )}
          {/* 「下到了但可能不对」的唯一信号：不显眼，但必须找得到（M40 起写进 meta.json） */}
          {/* warnings 分级（v0.11.0）：引用子笔记提示是「还有关联内容可选下」，不是故障——
              用 ℹ 信息态；真正的解析/下载告警保留 ⚠ 警示态。标识可点：点开见全文与下一步动作。 */}
          {allWarnings.length ? (
            <span data-testid={realWarnings.length ? 'card-warnings' : 'card-infos'}
              className={`kind-tag ${realWarnings.length ? 'warn' : 'info'}`}
              style={{ cursor: 'pointer' }}
              title="点击查看详情与可执行操作"
              onClick={(e) => { e.stopPropagation(); openNotice() }}>
              {realWarnings.length ? '⚠ ' : 'ℹ '}
            </span>
          ) : null}
          {meta.account || '未知公众号'}
          {meta.publishTime ? ` · ${relativeTime(meta.publishTime)}` : ''}
        </div>
      </div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="card-btn" data-testid="card-read" disabled={!readable}
          style={!readable ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          onClick={() => readable && onRead()}>阅读</button>
        <button className="card-btn" onClick={onReveal}>文件夹</button>
        <Popconfirm title="删除该文章？" description="磁盘文件将一并删除" okText="删除" cancelText="取消"
          okButtonProps={{ danger: true }} onConfirm={onDelete}>
          <button className="card-btn danger" data-testid="card-delete">删除</button>
        </Popconfirm>
      </div>
    </div>
    </Dropdown>
    {/* 提示/告警行动弹窗：引用笔记列真实标题与库内状态；告警给原文核对/重下动作
        （v0.11.0 安哥反馈：给用户看的应该是「引用了哪几篇、下了没有」，不是内部文案） */}
    <Modal open={noticeOpen} onCancel={() => setNoticeOpen(false)} title={meta.title.slice(0, 30)} footer={null} width={520}>
      {infoWarnings.length > 0 && (
        <div style={{ marginBottom: 16 }} data-testid="card-notice-infos">
          <h4 style={{ fontSize: 13, margin: '0 0 8px' }}>这篇笔记引用了 {refNotes?.length ?? '…'} 篇笔记</h4>
          {refLoading ? <Spin size="small" />
            : (refNotes?.length ?? 0) === 0 ? <span className="faint" style={{ fontSize: 13 }}>暂无引用信息，可重新下载本篇后查看。</span>
              : (
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                  {refNotes!.map((n) => (
                    <li key={n.noteId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <a style={{ flex: 1, fontSize: 13 }} onClick={() => api.openExternal(`https://note.mowen.cn/detail/${n.noteId}`)}
                        title="在浏览器打开">{n.title}</a>
                      <Tag color={n.inLibrary ? 'green' : 'orange'}>{n.inLibrary ? '已在文库' : '未下载'}</Tag>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
      {realWarnings.length > 0 && (
        <div style={{ marginBottom: 16 }} data-testid="card-notice-warnings">
          <h4 style={{ fontSize: 13, margin: '0 0 6px', color: 'var(--cinnabar)' }}>下载告警</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {realWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {infoWarnings.length > 0 && (refNotes?.some((n) => n.available && !n.inLibrary) ?? false) && (
          <Button type="primary" loading={acting === 'expand'} disabled={!!acting && acting !== 'expand'}
            onClick={() => runAction('expand')} data-testid="card-notice-expand">
            下载未入库的引用笔记
          </Button>
        )}
        {realWarnings.length > 0 && (
          <>
            <Button disabled={!meta.sourceUrl || !!acting} onClick={() => api.openExternal(meta.sourceUrl)}>
              打开原文核对
            </Button>
            <Button danger loading={acting === 'redownload'} disabled={!meta.sourceUrl || (!!acting && acting !== 'redownload')}
              onClick={() => runAction('redownload')} data-testid="card-notice-redownload">
              删除后重新下载
            </Button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <Button type="text" onClick={() => setNoticeOpen(false)}>关闭</Button>
      </div>
    </Modal>
    </>
  )
}
