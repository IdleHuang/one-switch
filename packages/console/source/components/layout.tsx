import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

export interface PageBreadcrumb {
  label: string
  onClick?: () => void
}

interface PageHeaderProps {
  title: string
  /**
   * 紧跟在标题后面的控件。
   *
   * 与 `actions` 的区别是它属于**标题本身**而不是页面的操作：切换标题指的是哪个对象（如路由的两种模式）
   * 应该紧跟标题，而「试运行 / 新建」这类动作在右侧。两者位置不同，是因为读完标题后的下一个问题是
   * 「现在看的是哪一个」，而不是「能做什么」。
   */
  titleAdornment?: ReactNode
  description?: string
  actions?: ReactNode
  breadcrumbs?: PageBreadcrumb[]
  className?: string
}

interface PageContentProps {
  children: ReactNode
  className?: string
}

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout(props: AppLayoutProps) {
  const { sidebar, children } = props
  return (
    <div className="grid h-screen w-full grid-cols-[3rem_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <aside className="relative z-30 min-h-0 overflow-visible border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        {sidebar}
      </aside>
      <main className="relative isolate min-w-0 overflow-auto overscroll-contain">
        <div className="relative z-10 mx-auto min-h-full w-full max-w-7xl px-6 py-5">{children}</div>
      </main>
    </div>
  )
}

export function PageLayout(props: PageLayoutProps) {
  const { children, className } = props
  return <div className={cn('space-y-5', className)}>{children}</div>
}

export function PageHeader(props: PageHeaderProps) {
  const { title, titleAdornment, description, actions, breadcrumbs, className } = props
  const t = useTranslation()
  return (
    <header
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label={t('nav.breadcrumb')} className="mb-2 flex items-center gap-1 system-xs-regular text-text-tertiary">
            {breadcrumbs.map((breadcrumb, index) => (
              <span key={`${breadcrumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3" aria-hidden="true" />}
                {breadcrumb.onClick ? (
                  <button type="button" className="rounded-sm hover:text-text-secondary" onClick={breadcrumb.onClick}>{breadcrumb.label}</button>
                ) : <span>{breadcrumb.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="system-xl-semibold text-text-primary">{title}</h1>
          {titleAdornment}
        </div>
        {description && <p className="mt-1 system-xs-regular text-text-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageContent(props: PageContentProps) {
  const { children, className } = props
  return <section className={cn('grid gap-4', className)}>{children}</section>
}
