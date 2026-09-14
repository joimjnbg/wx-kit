// tests/core/wechat-render.test.ts
// M63 后补：贴图/图片消息新模板的渲染兜底。样本形态来自 2026-09-14 真机取证
// （mp.weixin.qq.com/s/b4VbCeWb8eEtY2R0XlX0Vg，item_show_type=8 JS 壳模板）。
import { describe, it, expect } from 'vitest'
import { buildRenderedContent, EXTRACT_SCRIPT } from '../../src/core/wechat-render'

describe('buildRenderedContent', () => {
  it('文字 + 图片：descHtml 保留、imgUrls 去重、图片以 data-src 形态接在正文后', () => {
    const r = buildRenderedContent({
      descHtml: '<p id="js_image_desc">摩纳哥能活到今天<br><br>先保命</p>',
      imgUrls: ['https://mmbiz.qpic.cn/a.jpg', 'https://mmbiz.qpic.cn/a.jpg', 'https://mmbiz.qpic.cn/b.png'],
    })
    expect(r).not.toBeNull()
    expect(r!.imageUrls).toEqual(['https://mmbiz.qpic.cn/a.jpg', 'https://mmbiz.qpic.cn/b.png'])
    expect(r!.contentHtml).toContain('<p id="js_image_desc">摩纳哥能活到今天')
    expect(r!.contentHtml).toContain('<p><img data-src="https://mmbiz.qpic.cn/a.jpg"></p>')
    expect(r!.contentHtml).toContain('<p><img data-src="https://mmbiz.qpic.cn/b.png"></p>')
  })

  it('只有图片无文字（纯贴图）→ 正文只含图片段落', () => {
    const r = buildRenderedContent({ imgUrls: ['https://mmbiz.qpic.cn/x.jpg'] })
    expect(r!.contentHtml).toBe('<p><img data-src="https://mmbiz.qpic.cn/x.jpg"></p>')
    expect(r!.contentHtml).not.toContain('#js_image_desc')
  })

  it('什么都没有（非贴图模板/渲染失败）→ null，调用方据此如实告警', () => {
    expect(buildRenderedContent({})).toBeNull()
    expect(buildRenderedContent({ descHtml: '', imgUrls: [] })).toBeNull()
  })

  it('EXTRACT_SCRIPT：全页 mmbiz 图（轮播帧散落多容器）+ 黑名单排除头像/二维码/赞赏面板', () => {
    expect(EXTRACT_SCRIPT).toContain('#js_image_desc')
    expect(EXTRACT_SCRIPT).toContain("querySelectorAll('img')")
    expect(EXTRACT_SCRIPT).toContain('mmbiz.qpic.cn')
    expect(EXTRACT_SCRIPT).toContain('wx_follow_avatar')
    expect(EXTRACT_SCRIPT).toContain('reward_pop_panel')
  })
})
