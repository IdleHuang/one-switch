import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

interface CodeBlockProps {
  /** 复制回执用的 key，同一页面里每个代码块各自独立反馈。 */
  itemKey: string
  /** 要粘贴的整段文本；为空时摆占位符并禁用复制。 */
  code: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
  copyLabel: string
  className?: string
}

/**
 * 片段块：等宽、可横向滚动、整段一次复制。
 *
 * 为什么是「块」而不是几行带复制按钮的文本：配置文件要的是**一整份**能粘贴的东西，
 * 逐行给复制按钮会把「这些行是一体的」这件事拆掉；太长的那几行靠横向滚动解决，不折行——
 * 折行会让 JSON / TOML 的层级看起来变了意思。
 *
 * 复制按钮浮在右上角而不是占一行：它和片段的关系是「整个块都属于它」，
 * 放到下面反而会读成「复制上面那行的值」。
 */
export function CodeBlock(props: CodeBlockProps) {
  const { itemKey, code, copiedKey, onCopy, copyLabel, className } = props

  return (
    <div className={cn('relative rounded-lg bg-inset', className)}>
      <CopyButton
        itemKey={itemKey}
        value={code}
        copiedKey={copiedKey}
        onCopy={onCopy}
        label={copyLabel}
        className="absolute top-1.5 right-1.5"
      />
      <pre className="overflow-x-auto p-3 pr-12 font-mono system-2xs-regular leading-5 text-text-secondary select-all">
        {code || '—'}
      </pre>
    </div>
  )
}
