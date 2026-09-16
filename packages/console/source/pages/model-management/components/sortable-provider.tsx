import type { ReactNode } from 'react'
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableProviderProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

export function SortableProvider(props: SortableProviderProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: args => {
      // 避免被拖拽项在释放时出现异常回弹动画；其余项保持正常布局过渡。
      if (args.wasDragging) return false
      return defaultAnimateLayoutChanges(args)
    },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // 拖动中的那一行要压住上下邻居，否则半透明背景会让两行文字叠在一起。
      className={cn(isDragging && 'relative z-10')}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
