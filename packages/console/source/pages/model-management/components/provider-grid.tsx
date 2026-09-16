import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { GripVertical, Server } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback } from 'react'
import { ProviderIcon } from './provider-icon'
import { SortableProvider } from './sortable-provider'
import { findPresetByName, getBuiltInProviderSuggestions } from '../lib/provider-presets'
import type { ProviderPreset } from '../lib/provider-presets'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderGridProps {
  providers: Provider[]
  models: ProviderModelRoute[]
  selectedProviderId: string
  onSelectProvider: (id: string) => void
  onSelectBuiltInProvider: (preset: ProviderPreset) => void
  /** 拖动结束后按新顺序重写侧栏顺序；失败由调用方提示（列表会回滚到服务端那一份）。 */
  onReorderProviders: (ids: string[]) => Promise<void>
}

interface ProviderGridItem {
  id: string
  name: string
  enabled: boolean
  modelCount: number
  onSelect: () => void
}

/** 拖动手柄只在真实供应商行上存在；内置建议行没有这个参数。 */
interface ProviderGridGrip {
  handleProps: Record<string, unknown>
  dragging: boolean
}

export function ProviderGrid(props: ProviderGridProps) {
  const { providers, models, selectedProviderId, onSelectProvider, onSelectBuiltInProvider, onReorderProviders } = props
  const t = useTranslation()
  const builtinSuggestions = getBuiltInProviderSuggestions(providers.map(provider => provider.name))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = providers.findIndex(provider => provider.id === active.id)
    const newIndex = providers.findIndex(provider => provider.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    void onReorderProviders(arrayMove(providers, oldIndex, newIndex).map(provider => provider.id))
  }, [providers, onReorderProviders])

  const renderItem = (item: ProviderGridItem, grip?: ProviderGridGrip) => {
    const active = selectedProviderId === item.id
    const preset = findPresetByName(item.name)
    const iconColor = preset?.color

    return (
      <div
        key={item.id}
        className={cn(
          'flex w-full items-center rounded-lg pr-2 transition-colors',
          active
            ? 'bg-accent text-text-primary'
            : 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
          grip?.dragging && 'bg-card ring-1 ring-primary/45',
        )}
      >
        {/* 手柄列恒占一个 24px 的车道：「平时收成 0、浮入才撑开」会让鼠标划过时每行文字左右跳。
            下面那组内置建议没有手柄，但也留着同宽的空位，两组的图标才对得上。 */}
        {grip ? (
          <button
            type="button"
            className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center self-stretch text-text-quaternary transition-colors hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none active:cursor-grabbing"
            aria-label={t('providers.grid.dragAria', { name: item.name })}
            title={t('providers.grid.dragTitle')}
            {...grip.handleProps}
          >
            <GripVertical size={14} />
          </button>
        ) : providers.length > 0 ? (
          <span className="w-6 shrink-0" aria-hidden />
        ) : null}
        <button
          type="button"
          onClick={item.onSelect}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 text-left"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-lg"
              style={{
                color: iconColor ?? 'var(--primary)',
                backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
              }}
            >
              <ProviderIcon name={item.name} size={21} />
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-1">
              <span className="min-w-0 truncate system-xs-medium text-text-primary">{item.name}</span>
              <span className="shrink-0 system-2xs-regular text-text-tertiary">{t('providers.modelCount', { count: item.modelCount })}</span>
            </div>
          </div>
          {!item.enabled && (
            <Badge variant="muted" className="shrink-0 system-2xs-medium">
              {t('common.state.disabled')}
            </Badge>
          )}
        </button>
      </div>
    )
  }

  const renderProvider = (provider: Provider) => {
    const modelCount = new Set(
      models.filter(model => model.providerId === provider.id).map(model => model.modelName),
    ).size
    return (
      <SortableProvider key={provider.id} id={provider.id}>
        {(handleProps, dragging) => renderItem(
          {
            id: provider.id,
            name: provider.name,
            enabled: provider.enabled,
            modelCount,
            onSelect: () => onSelectProvider(provider.id),
          },
          { handleProps, dragging },
        )}
      </SortableProvider>
    )
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle>{t('providers.grid.title')}</CardTitle>
        <CardDescription>
          {t('providers.grid.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {providers.length || builtinSuggestions.length ? (
          <div className="px-2 pb-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              {/* 只有已添加的供应商参与排序：下面那组内置建议是「去新建」的入口，不是列表成员。 */}
              <SortableContext items={providers.map(provider => provider.id)} strategy={verticalListSortingStrategy}>
                {providers.map(renderProvider)}
              </SortableContext>
            </DndContext>

            {builtinSuggestions.map(preset => renderItem({
              id: `builtin-${preset.key}`,
              name: preset.name,
              enabled: true,
              modelCount: 0,
              onSelect: () => onSelectBuiltInProvider(preset),
            }))}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title={t('providers.empty.noneTitle')}
            description={t('providers.grid.emptyDescription')}
            className="min-h-36 py-6"
            embedded
          />
        )}
      </CardContent>
    </Card>
  )
}
