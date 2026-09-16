import { ChevronDown, Sparkles } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'

import { PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'
import { WorkflowButton } from './workflow-button'

/** 一条预设的展示文案键（名称 + 一句说明）。 */
export interface PresetTextKeys {
  name: UiCatalogKey
  description: UiCatalogKey
}

/** 菜单自身的界面文案。两个模式各给一份，这样各自的措辞能贴合自己的正文（画布 / 规则表）。 */
export interface PresetMenuLabels {
  aria: UiCatalogKey
  fallbackName: UiCatalogKey
  title: UiCatalogKey
  subtitle: UiCatalogKey
  builtInDefault: UiCatalogKey
  current: UiCatalogKey
}

type PresetMenuProps<TPreset extends { id: string; isDefault: boolean }> = {
  presets: readonly TPreset[]
  /** 预设 id → 文案键；表里没有的 id 返回 `undefined`，由这里兜底显示 id 本身。 */
  textKeysOf: (id: string) => PresetTextKeys | undefined
  labels: PresetMenuLabels
  /** 当前内容与某个预设一致时高亮它；不一致时为 `null`。 */
  activeId: string | null
  onApply: (preset: TPreset) => void
}

/**
 * 内置预设下拉：把当前内容整体换成某个内置预设。
 *
 * 图模式（`PolicyMenu`）与规则表模式（`RulesPresetMenu`）共用这一个组件 ——
 * 「内置预设」在两个模式里是同一个概念，能被认出来靠的就是这套完全一样的视觉词汇：
 * 用当前预设名当按钮文案、两行一项、默认项带「内置默认」角标、命中项带「当前」标记。
 * 两边各写一份的结果必然是改了一处忘了另一处，然后「同一个东西」慢慢长得不像。
 *
 * 浮层样式与 `VersionMenu` 同一套（去阴影、复用圆角还原标记）。
 */
export function PresetMenu<TPreset extends { id: string; isDefault: boolean }>(props: PresetMenuProps<TPreset>) {
  const { presets, textKeysOf, labels, activeId, onApply } = props
  const t = useTranslation()
  const activeTextKeys = activeId ? textKeysOf(activeId) : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* 触发器直接套按钮类名（而不是塞一层函数组件）—— Radix 需要真实 DOM 上的 ref。 */}
        <WorkflowButton size="medium" aria-label={t(labels.aria)}>
          <Sparkles className="size-3.5" aria-hidden />
          {activeTextKeys ? t(activeTextKeys.name) : t(labels.fallbackName)}
          <ChevronDown className="size-3.5" aria-hidden />
        </WorkflowButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(PANEL_POPUP_SURFACE_CLASSNAME, 'w-80 min-w-80')}
      >
        <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1.5 system-xs-medium text-text-tertiary">
          <Sparkles className="size-3.5" aria-hidden />
          {t(labels.title)}
          <span className="ml-auto system-2xs-regular text-text-quaternary">{t(labels.subtitle)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-components-panel-border" />

        {presets.map(preset => {
          const textKeys = textKeysOf(preset.id)
          return (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => onApply(preset)}
              className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
            >
              <span className="flex items-center gap-2">
                <span className="system-xs-medium text-text-primary">{textKeys ? t(textKeys.name) : preset.id}</span>
                {preset.isDefault && (
                  <span className="rounded-md bg-workflow-block-parma-bg px-1 py-0.5 system-2xs-regular text-text-tertiary">
                    {t(labels.builtInDefault)}
                  </span>
                )}
                {preset.id === activeId && (
                  <span className="ml-auto system-2xs-regular text-text-accent">{t(labels.current)}</span>
                )}
              </span>
              <span className="system-2xs-regular text-text-tertiary">{textKeys ? t(textKeys.description) : ''}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
