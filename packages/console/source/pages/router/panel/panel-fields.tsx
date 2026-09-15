import type { ReactNode } from 'react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** 浮层面板外观，复制自上游 UI 包的 `overlay-shared.ts` 的 `menuPopupSurfaceClassName`。
   *  `workflow-ui-surface` 用于在浮层（被 portal 到 body）内还原上游的圆角刻度。 */
  export const PANEL_POPUP_SURFACE_CLASSNAME =
    'workflow-ui-surface rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 ring-0 shadow-none backdrop-blur-[5px] focus:ring-0 focus:shadow-none'

/** 浮层菜单项，复制自上游 `overlay-shared.ts` 的 `menuItemClassName`。 */
export const PANEL_POPUP_ITEM_CLASSNAME =
  'mx-1 h-8 gap-1 rounded-lg px-2 text-[13px] leading-4 text-text-secondary focus:bg-state-base-hover focus:text-text-primary not-data-[variant=destructive]:focus:**:text-text-primary'

type NodePanelHintProps = {
  children: ReactNode
  tone?: 'muted' | 'warning'
}

/** 面板里的说明条。`role="note"` 是「旁注」语义，同时也是「同一节点里说了几遍」的检查入口。 */
export function NodePanelHint(props: NodePanelHintProps) {
  const { children, tone = 'muted' } = props

  return (
    <div
      role="note"
      className={cn(
        'rounded-lg border border-module-border px-2.5 py-2 system-xs-regular',
        tone === 'warning'
          ? 'border-transparent bg-state-warning-hover text-text-warning'
          : 'bg-workflow-block-parma-bg text-text-tertiary',
      )}
    >
      {children}
    </div>
  )
}

type NodePanelCardProps = {
  children: ReactNode
  className?: string
}

/** 面板里的分组卡片。 */
export function NodePanelCard(props: NodePanelCardProps) {
  const { children, className } = props
  return <div className={cn('grid gap-2.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2.5', className)}>{children}</div>
}

type NodePanelFieldProps = {
  label: string
  children: ReactNode
  className?: string
}

/** 面板里的表单项。 */
export function NodePanelField(props: NodePanelFieldProps) {
  const { label, children, className } = props

  return (
    <div className={cn('grid gap-1.5', className)}>
      {/* 不用 shadcn Label：它的 `text-sm leading-none` 会盖过面板的 system-sm-medium。 */}
      <label className="w-fit py-1 system-sm-medium text-text-secondary">{label}</label>
      {children}
    </div>
  )
}

type NodePanelSwitchRowProps = {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** 面板里的「开关 + 说明」行。 */
export function NodePanelSwitchRow(props: NodePanelSwitchRowProps) {
  const { label, checked, onCheckedChange } = props

  return (
    <div className="flex items-center justify-between rounded-lg border border-module-border bg-workflow-block-parma-bg px-2.5 py-2">
      <span className="system-xs-regular text-text-secondary">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

type NodePanelGroupHeaderProps = {
  title: string
  action?: ReactNode
}

/** 分组标题行（标题 + 右侧操作）。 */
export function NodePanelGroupHeader(props: NodePanelGroupHeaderProps) {
  const { title, action } = props

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="py-1 system-sm-medium text-text-secondary">{title}</span>
      {action}
    </div>
  )
}

/** 只读参考表里的一行：路径 + 静态类型，有说明的再附一句。 */
interface NodePanelShapeField {
  path: string
  valueType: string
  note?: string
}

/**
 * 一组字段。分组名与空态说明都可选：输入、逻辑模型选择这类节点只有一组字段，
 * 协议发现节点则按协议分支分组，一组都没有字段时说明「认不出协议」。
 */
export interface NodePanelShapeGroup {
  label?: string
  fields: readonly NodePanelShapeField[]
  /** 这一组没有字段时显示的说明；不给就只留分组名。 */
  emptyHint?: string
}

type NodePanelShapeCardProps = {
  title: string
  groups: readonly NodePanelShapeGroup[]
}

/**
 * 只读字段表：把「这个节点交给下游哪些字段」摆出来。
 *
 * 内容不是各面板自己写的，而是各节点的**声明表**（`../input-shape.ts`、
 * `../model-select-shape.ts`、`@common/router/request-shape.ts`）——
 * 与下游节点面板里的字段候选表同源，所以表里读到的就是下游真正能选的。
 *
 * 不套灰底：只读参考表和可交互的配置项长得一样，读的人会去点它。
 * 三个零配置 / 少配置节点共用这一块，行高与分隔线只有一处定义。
 */
export function NodePanelShapeCard(props: NodePanelShapeCardProps) {
  const { title, groups } = props

  return (
    <div className="grid gap-2 rounded-lg border border-module-border p-2.5">
      <NodePanelGroupHeader title={title} />
      <div className="divide-y divide-border/50">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="grid gap-1 py-2 first:pt-0 last:pb-0">
            {group.label && <span className="font-mono system-2xs-regular text-text-tertiary">{group.label}</span>}
            {group.fields.length === 0
              ? group.emptyHint
                ? <span className="system-2xs-regular text-text-quaternary">{group.emptyHint}</span>
                : null
              : group.fields.map(field => (
                  <div key={field.path} className="grid gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{field.path}</span>
                      <span className="shrink-0 system-2xs-regular text-text-quaternary">{field.valueType}</span>
                    </div>
                    {field.note
                      ? <span className="system-xs-regular text-text-tertiary">{field.note}</span>
                      : null}
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  )
}
