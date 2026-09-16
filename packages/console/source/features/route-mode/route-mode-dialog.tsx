import { Check } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ROUTE_MODE_OPTIONS, type RouteModeOption } from '@/features/route-mode/route-mode-options'
import { useRouteMode, useRouteModeStore } from '@/features/route-mode/use-route-mode'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

/**
 * 路由模式弹窗 —— 全局只有这一份，页头的模式按钮和设置页的「生效模式」都只是它的入口。
 *
 * 为什么不用「一个开关直接切」：两个模式的差异大到不是同一个操作的两个取值，
 * 顺手滑过去会让用户在完全没意识到发生了什么的情况下换掉代理的全部行为。
 * 所以这里先把两边**并排摊开**：是什么、差在哪、现在哪个在生效，看清楚再选。
 * 左右并排而不是上下堆叠，是为了让两边逐条对着读（见 `ROUTE_MODE_OPTIONS.traitKeys`）。
 *
 * 选择即生效（不需要再点「确定」），但**切换失败就不收起**：
 * 收起弹窗等于替用户宣布「切好了」，而服务端可能刚拒绝这次写入 ——
 * 失败时留着弹窗，用户看到的就是「还停在原来那个上面」。
 */
export function RouteModeDialog() {
  const open = useRouteModeStore(state => state.dialogOpen)
  const setDialogOpen = useRouteModeStore(state => state.setDialogOpen)
  const { mode, switching, switchMode } = useRouteMode()
  const t = useTranslation()

  const select = async (next: typeof mode) => {
    if (next === mode) {
      setDialogOpen(false)
      return
    }
    const switched = await switchMode(next)
    if (switched) setDialogOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('router.mode.dialog.title')}</DialogTitle>
          <DialogDescription>{t('router.mode.hint')}</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={t('router.mode.dialog.title')} className="grid gap-3 sm:grid-cols-2">
          {ROUTE_MODE_OPTIONS.map(option => (
            <RouteModeOptionCard
              key={option.value}
              option={option}
              active={option.value === mode}
              switching={switching}
              onSelect={() => void select(option.value)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface RouteModeOptionCardProps {
  option: RouteModeOption
  active: boolean
  switching: boolean
  onSelect: () => void
}

/**
 * 一个模式的「一栏说明」。
 *
 * 整栏就是原生 radio 的标签（隐藏输入 + 可见标签），和页头上那个控件同一个理由：
 * 两个模式天然互斥、天然单选，交给浏览器就意味着方向键切换、`aria-checked`、焦点语义全都正确，
 * 不用自己拿 `role="radio"` 拼一套只做对一半的键盘支持。
 *
 * 选中态只靠**边框 + 图标底色 + 角标**：弹窗底色本身就是白，再刷一层白块等于没画；
 * 而刷一层灰块，两栏就成了一屏里最重的两块灰 —— 层次应该由边框给，不由底色给。
 */
function RouteModeOptionCard(props: RouteModeOptionCardProps) {
  const { option, active, switching, onSelect } = props
  const t = useTranslation()
  const Icon = option.icon

  return (
    <label
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3.5 transition-colors',
        'focus-within:ring-2 focus-within:ring-state-accent-solid',
        active ? 'border-state-accent-solid' : 'border-module-border hover:border-text-quaternary',
        switching ? 'cursor-progress' : 'cursor-pointer',
      )}
    >
      <input
        type="radio"
        name="route-mode"
        className="sr-only"
        value={option.value}
        checked={active}
        disabled={switching}
        aria-label={t(option.labelKey)}
        onChange={onSelect}
      />

      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
            active ? 'bg-state-accent-solid text-primary-foreground' : 'text-text-tertiary',
          )}
        >
          {switching && active ? <Spinner className="size-3.5" /> : <Icon className="size-3.5" aria-hidden />}
        </span>
        <span className="system-sm-medium text-text-primary">{t(option.labelKey)}</span>
        {/* 角标只挂在当前生效的那一栏：它是状态，不是「你选中了什么」的复述。 */}
        {active && !switching && (
          <span className="ml-auto inline-flex items-center gap-1 system-2xs-medium text-text-accent">
            <Check className="size-3" aria-hidden />
            {t('router.mode.active')}
          </span>
        )}
      </span>

      <span className="system-xs-regular text-text-tertiary">{t(option.summaryKey)}</span>

      <span className="grid gap-1.5">
        {option.traitKeys.map(key => (
          <span key={key} className="flex gap-1.5 system-xs-regular text-text-secondary">
            <span className="text-text-quaternary" aria-hidden>
              ·
            </span>
            {t(key)}
          </span>
        ))}
      </span>
    </label>
  )
}
