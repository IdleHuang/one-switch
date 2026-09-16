import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'

interface CopyButtonProps {
  /** 复制回执用的 key，同一页面的多个入口各自独立反馈。 */
  itemKey: string
  value: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
  /** 无障碍名；同一个值用哪种形态，名字都一样。 */
  label: string
  /** 页面主角（Base URL）用带文字的按钮，其余值只用图标，避免一页里排出一列同款按钮。 */
  showLabel?: boolean
  className?: string
}

/**
 * 「可复制的值」旁边的复制按钮：成功后就地换成勾，回执留在按钮上。
 *
 * 值拼不出来（服务没跑、地址不全）时禁用而不是隐藏——布局不跟着数据有无变形。
 */
export function CopyButton(props: CopyButtonProps) {
  const { itemKey, value, copiedKey, onCopy, label, showLabel, className } = props
  const t = useTranslation()
  const copied = copiedKey === itemKey
  const icon = copied ? <Check /> : <Copy />

  if (showLabel) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={!value}
        aria-label={label}
        title={label}
        onClick={() => onCopy(itemKey, value)}
      >
        {icon}
        {copied ? t('common.action.copied') : t('common.action.copy')}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      disabled={!value}
      aria-label={label}
      title={label}
      onClick={() => onCopy(itemKey, value)}
    >
      {icon}
    </Button>
  )
}
