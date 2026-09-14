// src/core/wechat-render.ts
// 微信「贴图/图片消息」（item_show_type 8）新模板的渲染兜底（M63 后补，2026-09-14 安哥实测反馈）。
// 该模板的 SSR HTML 是 JS 壳：无 #js_content、无 picture_page_info_list 脚本变量，正文与图片
// 全靠前端渲染（正文文字在 #js_image_desc，贴图在 #img_list 轮播、懒加载）。fetch 通道拿不到，
// 用 offscreen BrowserWindow 渲染后精确提取。BrowserWindow 以构造器注入（core 层不碰 electron 运行时）。
import type { ExportDeps } from './exporter'

/** 手机微信 UA：渲染实验钉死——桌面/无 UA 会拿到不同的页面模板 */
export const WECHAT_MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49'

export interface RenderedWeChatContent { contentHtml: string; imageUrls: string[] }

/** 渲染页面里执行的提取脚本（字符串常量，便于 review 与测试对齐）。
 *  贴图轮播的帧不都挂在 #img_list 下（真机取证：7 帧轮播只有当前帧是 <img>，其余帧散落在
 *  lazy 容器），故取全页 mmbiz 图、黑名单排除头像/二维码/赞赏面板等非正文图。 */
export const EXTRACT_SCRIPT = `(() => {
  const bad = (el) => !!el.closest('.wx_follow_avatar, .jump_author_avatar_con, [class*="qrcode"], .reward_pop_panel')
  const imgUrls = [...document.querySelectorAll('img')]
    .filter((i) => !bad(i))
    .map((i) => i.currentSrc || i.src || '')
    .filter((u) => u.includes('mmbiz.qpic.cn'))
  return {
    descHtml: document.querySelector('#js_image_desc')?.innerHTML || '',
    imgUrls,
  }
})()`

export interface RenderedWeChatRaw { descHtml?: string; imgUrls?: string[] }

/**
 * 提取结果 → 正文 HTML。纯函数（单测对象）。
 * 图片以 data-src 形态构造，与微信普通图文的解析产物同构，复用 exporter 既有本地化链路；
 * 「本轮真的什么都没有」（不是贴图模板/渲染失败）→ null，由调用方如实告警。
 */
export function buildRenderedContent(raw: RenderedWeChatRaw): RenderedWeChatContent | null {
  const imgUrls = [...new Set((raw.imgUrls ?? []).filter(Boolean))]
  const desc = (raw.descHtml ?? '').trim()
  if (!desc && !imgUrls.length) return null
  const parts: string[] = []
  if (desc) parts.push(desc)
  parts.push(...imgUrls.map((u) => `<p><img data-src="${u}"></p>`))
  return { contentHtml: parts.join('\n'), imageUrls: imgUrls }
}

const STABLE_ROUNDS = 3
const MAX_ROUNDS = 30
const POLL_MS = 600

/**
 * 渲染并提取贴图内容。拿不到（渲染失败/提取为空）→ null，不抛——
 * 调用方据此走「如实告警」而不是把渲染失败伪装成下载失败。
 */
export async function renderWeChatArticleContent(
  url: string,
  BrowserWindowCtor: ExportDeps['BrowserWindowCtor'],
): Promise<RenderedWeChatContent | null> {
  if (!BrowserWindowCtor) return null
  const win = new BrowserWindowCtor({ show: false, width: 900, height: 1600 })
  try {
    await win.loadURL(url, { userAgent: WECHAT_MOBILE_UA })
    // 分步滚动触发懒加载；稳定判定 = 页面长度 + 已加载正文图片数（轮播的 src 替换不改变
    // 页面长度，只看长度会在只有首图时就误判稳定——首版真机实测只下到 1/7 张）。
    let last = -1
    let stable = 0
    for (let i = 0; i < MAX_ROUNDS && stable < STABLE_ROUNDS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      await win.webContents.executeJavaScript(
        `window.scrollTo(0, document.body.scrollHeight * ${Math.min(1, (i + 2) / 5)})`,
      ).catch(() => {})
      const sig = await win.webContents.executeJavaScript(
        `document.body.innerHTML.length * 1000 + document.querySelectorAll('#img_list img[src*="mmbiz"]').length`,
      ).catch(() => -1)
      if (sig === last && sig > 0) stable++
      else stable = 0
      last = sig
    }
    const raw = await win.webContents.executeJavaScript(EXTRACT_SCRIPT) as RenderedWeChatRaw
    return buildRenderedContent(raw)
  } catch {
    return null
  } finally {
    // 离屏窗口用完即毁；destroy 不等关闭动画（GUI 模式下不留幽灵窗口）
    win.destroy()
  }
}
