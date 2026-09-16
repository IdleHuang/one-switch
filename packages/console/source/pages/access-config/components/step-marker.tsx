import { cn } from '@/lib/utils'

interface StepMarkerProps {
  /** 步骤序号，1 起数。 */
  index: number
  className?: string
}

/**
 * 步骤标记：接入配置页读的是顺序（先确认服务、再选客户端、最后补字段），不是模块身份，
 * 所以卡片头本来放图标的那个位置换成序号。
 *
 * 序号是内容不是装饰，直接写在卡片头里，而不是另起一条时间轴导航。
 * 第一步是一条状态带、没有卡片头，标记就落在带子里——三处都用同一个标记，
 * 序号才会对齐在同一条竖线上，读起来才是一条路。
 */
export function StepMarker(props: StepMarkerProps) {
  const { index, className } = props
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md bg-inset system-2xs-medium text-text-secondary tabular-nums',
        className,
      )}
    >
      {index}
    </span>
  )
}
