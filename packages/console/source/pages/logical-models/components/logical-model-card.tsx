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
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { GripVertical, ListTree, Pencil, RefreshCw, Target, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { SortableProviderModel } from './sortable-provider-model'
import { ProviderModelRow } from './provider-model-row'
import { providerModelMetricKey, type ProviderModelMetrics } from '../lib/model-metrics'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION } from '@common/schemas'
import type { ProviderModelRoute, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>
export type ProviderModelHealthMap = Record<string, ProviderModelHealth>

interface LogicalModelCardProps {
  logicalModelName: string
  /** 逻辑模型的用途说明；空串时以 `—` 占位，避免卡片头高度随数据有无变化。 */
  logicalModelDescription: string
  /** 内建兜底逻辑模型（请求未命中任何其他逻辑模型时的落点）。 */
  builtIn?: boolean
  models: ProviderModelRoute[]
  providers: ProviderMap
  health: HealthMap
  providerModelHealth: ProviderModelHealthMap
  modelMetrics: Record<string, ProviderModelMetrics>
  mode: 'auto' | 'manual'
  manualModelId: string
  switchingMode: boolean
  isCooling: (providerId: string, providerModelId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: ProviderModelRoute) => void
  onToggleEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
  onAddModel?: () => void
  onRemoveModel?: (model: ProviderModelRoute) => void
  /** 改名称与说明（卡片头上的编辑入口）。 */
  onEdit?: () => void
  /** 删除整个逻辑模型（软删除；内建默认不提供，它是请求的兜底落点）。 */
  onDelete?: () => void
  dragHandleProps?: Record<string, unknown>
  dragging?: boolean
}

export function LogicalModelCard(props: LogicalModelCardProps) {
  const {
    logicalModelName,
    logicalModelDescription,
    builtIn,
    models,
    providers,
    health,
    providerModelHealth,
    modelMetrics,
    mode,
    manualModelId,
    switchingMode,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
    onAddModel,
    onRemoveModel,
    onEdit,
    onDelete,
    dragHandleProps,
    dragging,
  } = props
  const t = useTranslation()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const itemIds = useMemo(() => models.map(model => model.id), [models])
  const rows = models.map(model => ({
    model,
    cooling: isCooling(model.providerId, model.id),
    selected: mode === 'manual' && manualModelId === model.id,
  }))
  const coolingCount = rows.filter(row => row.cooling).length

  // 内建默认逻辑模型的说明来自服务端种子。
  // 值恰好等于种子常量时换成目录里的本地化文案；一旦用户改过，就照原样显示用户写的说明。
  const description = builtIn && logicalModelDescription === BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION
    ? t('logicalModels.card.builtInDescription')
    : logicalModelDescription

  // 卡片头分两行：上行是身份（名称 + 状态）与调度模式，下行是说明。
  // 单行放不下「标题 + 添加模型 + 模式切换」——瀑布流最窄 420px，标题会被挤断。
  const renderHeader = () => (
    <CardHeader className="group/header relative border-b border-border/50 pb-3">
      {/* 手柄跟着标题所在的那一行：拆成「手柄列 + 两行文字」时它会按整块高度居中，
          而这一行被右侧的模式标签页撑高了，图标就比标题低半个字。 */}
      <div className="flex w-full items-center">
        <button
          type="button"
          className={cn(
            // 静止时宽度收成 0（图标被裁掉），浮入卡片头才撑开，所以不显示时它完全不占位置。
            'flex h-5 w-0 shrink-0 cursor-grab touch-none select-none items-center justify-center overflow-hidden rounded text-text-quaternary transition-[width,color] hover:text-text-primary focus-visible:w-7 focus-visible:bg-accent focus-visible:text-text-primary focus-visible:outline-none active:cursor-grabbing',
            // 静态画面里它只是一个没有文字的图标，浮入卡片头才出现（20px + 8px 间距）。
            dragging ? 'w-7' : 'group-hover/header:w-7',
          )}
          aria-label={t('logicalModels.card.dragAria', { name: logicalModelName })}
          title={t('logicalModels.card.dragTitle')}
          {...dragHandleProps}
        >
          <GripVertical size={16} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="truncate">{logicalModelName}</CardTitle>
            {builtIn && <Badge variant="muted" className="shrink-0">{t('logicalModels.card.builtIn')}</Badge>}
            {coolingCount > 0 && <Badge variant="destructive" className="shrink-0">{t('logicalModels.card.cooling', { count: coolingCount })}</Badge>}
          </div>
          <div className={cn(
            'flex shrink-0 items-center gap-2 transition-[padding] duration-150',
            // 空位只在浮入期间存在：编辑、删除静止时不显示，也就不该预先占着地方。
            // 宽度也只按真正存在的按钮算——图标 28px + 彼此 4px 间距 + 左缘 8px 淡出边
            // （遮罩的 pl-2）→ 一个按钮 36px、两个 68px。内建默认没有删除入口，
            // 就只留编辑那一格，不留它本该在的空位，否则图标左边会多出一块看着像占位的空白。
            // 让路而不是让遮罩压住标签页，是因为遮罩的触发区是整个卡片头——盖到谁，谁在浮入
            // 期间就点不动；所以标签页必须待在遮罩左边，而空位只在浮入时才出现。
            // 键盘不走 hover：焦点落进遮罩里的按钮时（has-…）同样让开。
            (onEdit || onDelete) && (onDelete
              ? 'group-hover/header:pr-[68px] has-[[data-slot=card-header-actions]:focus-within]:pr-[68px]'
              : 'group-hover/header:pr-[36px] has-[[data-slot=card-header-actions]:focus-within]:pr-[36px]'),
          )}>
            {onAddModel && <Button variant="outline" size="sm" onClick={onAddModel}>{t('logicalModels.card.addModel')}</Button>}
            <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
              <TabsList>
                <TabsTrigger value="auto" disabled={switchingMode} className="px-2.5 system-xs-medium"><RefreshCw size={12} className={switchingMode ? 'animate-spin' : undefined} /> {t('logicalModels.card.mode.auto')}</TabsTrigger>
                <TabsTrigger value="manual" disabled={switchingMode} className="px-2.5 system-xs-medium"><Target size={12} /> {t('logicalModels.card.mode.manual')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {/* 编辑与删除挂在卡片头右侧的一整条模糊遮罩上（同供应商模型行的做法）：静止时不显示，
                浮入时也只压住让开后的空位，不会盖住「添加模型」与模式标签页。
                遮罩按整个卡片头铺满（inset-y-0），按钮却对齐上面那一行：编辑与删除是对「这张卡片」
                的操作，与名称同一水平线才读得出归属，落在说明行上会被读成说明的一部分。
                左缘只留 8px 淡出边（pl-2，渐变的实心部分刚好铺满按钮）：浮出时图标左边
                不再多出一块看着像占位的空白。
                挂在这一组里，是为了让「焦点落进遮罩按钮」与「浮入」走同一条让位逻辑（见上）。 */}
            {(onEdit || onDelete) && (
              <div
                data-slot="card-header-actions"
                className={cn(
                  'pointer-events-none absolute inset-y-0 right-(--card-spacing) flex flex-col bg-linear-to-l from-components-panel-bg-blur from-[calc(100%-8px)] to-transparent pl-2 opacity-0 backdrop-blur-[5px] transition-opacity',
                  'group-hover/header:pointer-events-auto group-hover/header:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
                )}
              >
                {/* 这一格与上面那一行同高（模式标签页撑出的 32px），按钮在其中居中，
                    于是与名称、模式标签页在同一条水平线上。 */}
                <div className="flex h-8 shrink-0 items-center gap-1">
                  {onEdit && (
                    <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t('logicalModels.card.editAria', { name: logicalModelName })} title={t('logicalModels.card.editTitle')}><Pencil size={16} /></Button>
                  )}
                  {onDelete && (
                    <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t('logicalModels.card.deleteAria', { name: logicalModelName })} title={t('logicalModels.card.deleteTitle')}><Trash2 size={16} /></Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* 说明不跟着手柄挪：手柄只在浮入时撑开 28px，说明跟着缩会把整行的字往右推，
          看着像自己在跳。它本来就贴左，保持贴左就好。 */}
      <CardDescription className="w-full truncate" title={description || undefined}>
        {description || '—'}
      </CardDescription>
    </CardHeader>
  )

  const renderProviderModelTable = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={event => void onDragEnd(event)}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-b-lg">
          {rows.map(row => (
            <SortableProviderModel key={row.model.id} id={row.model.id}>
              {(handleProps, dragging) => (
                <ProviderModelRow
                  model={row.model}
                  provider={providers[row.model.providerId]}
                  providerHealth={health[row.model.providerId]}
                  providerModelHealth={providerModelHealth[row.model.id]}
                  metrics={modelMetrics[providerModelMetricKey(row.model.providerId, row.model.id)]}
                  mode={mode}
                  selected={row.selected}
                  cooling={row.cooling}
                  dragging={dragging}
                  dragHandleProps={handleProps}
                  onSelect={() => void onSelectManualModel(row.model)}
                  onToggleEnabled={enabled => void onToggleEnabled(row.model, enabled)}
                  onRemove={() => onRemoveModel?.(row.model)}
                />
              )}
            </SortableProviderModel>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )

  // 空状态不再挂「添加模型」按钮：卡片头已经有了，同一张卡里放两遍只会分不清主次。
  const renderEmptyState = () => (
    <EmptyState
      icon={ListTree}
      title={t('logicalModels.card.empty.title')}
      description={t('logicalModels.card.empty.description')}
      className="min-h-48 border-0 py-10"
    />
  )

  const renderContent = () => {
    if (models.length === 0) return renderEmptyState()
    return renderProviderModelTable()
  }

  return (
    <Card className={cn('group overflow-hidden', dragging && 'bg-accent')}>
      {renderHeader()}
      <CardContent className="p-0">{renderContent()}</CardContent>
    </Card>
  )
}
