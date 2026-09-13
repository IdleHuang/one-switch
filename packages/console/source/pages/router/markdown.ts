import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * 便签正文的 Markdown 渲染（备注节点专用）。
 *
 * 白名单思路和「版本更新说明」一致：Markdown 允许内联 HTML，所以渲染结果必须过一遍
 * DOMPurify，免得把一段随手粘贴的内容变成可执行脚本。
 *
 * 白名单里刻意没有 `a` 和 `img`：
 * - 画布节点本身要响应点击（打开面板）、拖动时整块都是拖拽区，里面再挂一个可点的链接，
 *   点击会同时触发「跳转」和「打开面板」，还会在拖动起手时被浏览器当成链接拖拽；
 * - 备注是离线旁注，不该在渲染时去请求远端图片。
 * 两者被过滤后文字照旧保留，只是不再是可点元素。
 */
const NOTE_ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 'del', 'code', 'pre',
  'ul', 'ol', 'li',
  'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

/**
 * 把备注正文转成可直接 `dangerouslySetInnerHTML` 的 HTML。
 *
 * 空文本返回空串，由调用方决定空状态怎么画。
 */
export function renderNoteMarkdown(text: string): string {
  if (!text.trim()) return ''
  const html = marked.parse(text, { async: false, gfm: true, breaks: true })
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: NOTE_ALLOWED_TAGS, ALLOWED_ATTR: [] })
}
