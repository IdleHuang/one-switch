import { Fragment } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, Clock, Database, RefreshCw, SearchX, Zap } from 'lucide-react'
import type { RequestLogDetail, RequestLogEntry } from '@common/schemas'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, TableFrame } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { PROTOCOL_SHORT_LABEL, formatNumber, formatTime, formatTPS, formatTTFT, formatTransport } from '../lib/format'
import { RequestLogDetailRow, RequestStatusBadge } from './request-log-detail-row'

interface CachedTokensCellProps {
  value: number | null
}

interface RequestLogTableRowProps {
  log: RequestLogEntry
  expanded: boolean
  detail: RequestLogDetail | undefined
  detailLoading: boolean
  detailError: string | null
  modelName: string
  toggleExpand: (id: string) => void
}

interface RequestLogsTableProps {
  logs: RequestLogEntry[]
  loading: boolean
  error: string | null
  filtered: boolean
  expandedId: string | null
  details: Record<string, RequestLogDetail>
  detailLoadingIds: Record<string, boolean>
  detailErrors: Record<string, string>
  getModelName: (id: string | null) => string
  toggleExpand: (id: string) => void
  onRetry: () => void
}

/**
 * 这个请求一共走了几次尝试。
 *
 * 次数**固定显示**，只走了一次也照挂 `×1`：同一列每行都是同一个形状，横向扫一眼就能比出
 * 谁多试了几次，不会出现「有徽章的行才需要留意」这种要逐行找的区别。
 * 但只说次数，不说是换到了哪一家：具体每一次是怎么失败的、落在哪个模型上，是展开区该讲的事，
 * 塞进这一列只会把逻辑模型名挤成省略号。
 */
function attemptCount(log: RequestLogEntry): number {
  return log.attempts.length
}

export function CachedTokensCell(props: CachedTokensCellProps) {
  if (props.value === null) {
    return <span className="text-text-quaternary">—</span>
  }

  if (props.value > 0) {
    return (
      <Badge variant="secondary" className="h-5 px-1.5 font-mono system-2xs-medium">
        {formatNumber(props.value)}
      </Badge>
    )
  }

  return <span className="system-2xs-medium text-text-quaternary">MISS</span>
}

function RequestLogsTableHeader() {
  const t = useTranslation()
  return (
    <thead className={tableHeaderClass}>
      <tr className="h-8">
        <th className={cn(tableHeaderCellClass, 'w-8 py-1.5')} />
        <th className={cn(tableHeaderCellClass, 'py-1.5')}>{t('requestLogs.table.status')}</th>
        <th className={cn(tableHeaderCellClass, 'py-1.5')}>{t('requestLogs.table.time')}</th>
        <th className={cn(tableHeaderCellClass, 'py-1.5')}>{t('requestLogs.table.logicalModel')}</th>
        <th className={cn(tableHeaderCellClass, 'py-1.5')}>{t('requestLogs.table.protocol')}</th>
        <th className={cn(tableHeaderCellClass, 'py-1.5')}>{t('requestLogs.table.transport')}</th>
        <th className={cn(tableHeaderCellClass, 'py-1.5 text-center')}>
          <ArrowUpFromLine size={11} className="mr-0.5 inline" />
          {t('requestLogs.table.input')}
        </th>
        <th className={cn(tableHeaderCellClass, 'py-1.5 text-center')}>
          <Database size={11} className="mr-0.5 inline" />
          {t('requestLogs.table.cachedInput')}
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <ArrowDownToLine size={11} className="mr-0.5 inline" />
          {t('requestLogs.table.output')}
        </th>
        <th className={cn(tableHeaderCellClass, 'py-1.5 text-center')}>
          <Clock size={11} className="mr-0.5 inline" />
          TTFT
        </th>
        <th className={cn(tableHeaderCellClass, 'text-center')}>
          <Zap size={11} className="mr-0.5 inline" />
          TPS
        </th>
      </tr>
    </thead>
  )
}

function RequestLogsLoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, index) => (
        <tr key={index}>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3.5 w-3.5" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-5 w-12" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-20" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-28" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-16" />
          </td>
          <td className="px-2.5 py-2.5">
            <Skeleton className="h-3 w-14" />
          </td>
          {Array.from({ length: 5 }).map((__, cell) => (
            <td key={cell} className="px-2.5 py-2.5">
              <Skeleton
                className={cn(
                  'mx-auto h-3',
                  cell === 4 && 'ml-auto',
                  cell === 3 || cell === 4 ? 'w-10' : 'w-8',
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function RequestLogTableRow(props: RequestLogTableRowProps) {
  const locale = useLocale()
  const t = useTranslation()
  const successfulAttempt = props.log.attempts.find(attempt => attempt.status === 'success')
  const attempts = attemptCount(props.log)
  const tps = formatTPS(
    props.log.outputTokens,
    successfulAttempt?.durationMilliseconds ?? props.log.totalDurationMilliseconds,
  )

  return (
    <Fragment key={props.log.id}>
      <tr
        onClick={() => props.toggleExpand(props.log.id)}
        className={cn(
          'cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-state-base-hover',
          props.expanded && 'bg-inset',
        )}
      >
        <td className={cn(tableCellClass, 'text-text-quaternary')}>
          {props.expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </td>
        <td className={tableCellClass}>
          <RequestStatusBadge status={props.log.status} />
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap font-mono text-text-tertiary')}>
          {formatTime(locale, props.log.createdTime)}
        </td>
        <td className={cn(tableCellClass, 'max-w-40')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate system-xs-medium text-text-primary">{props.modelName}</span>
            <span
              className="shrink-0 rounded-md bg-components-input-bg-normal px-1.5 py-0.5 font-mono system-2xs-medium text-text-tertiary"
              title={t('requestLogs.route.totalAttempts', { count: attempts })}
            >
              ×{attempts}
            </span>
          </div>
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap')}>
          {props.log.clientProtocol === null
            ? <span className="text-text-quaternary">—</span>
            : <span className="text-text-tertiary">{PROTOCOL_SHORT_LABEL[props.log.clientProtocol] ?? props.log.clientProtocol}</span>}
        </td>
        <td className={cn(tableCellClass, 'whitespace-nowrap text-text-tertiary')}>
          {formatTransport(t, props.log.transport)}
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.inputTokens != null && 'text-text-primary')}>
            {formatNumber(props.log.inputTokens)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center')}>
          <CachedTokensCell value={props.log.cachedInputTokens} />
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.outputTokens != null && 'text-text-primary')}>
            {formatNumber(props.log.outputTokens)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(props.log.ttftMilliseconds != null && 'text-foreground')}>
            {formatTTFT(props.log.ttftMilliseconds)}
          </span>
        </td>
        <td className={cn(tableCellClass, 'text-center font-mono')}>
          <span className={cn(tps !== '—' && 'text-foreground')}>{tps}</span>
        </td>
      </tr>
      {props.expanded && (
        <RequestLogDetailRow
          log={props.detail ?? props.log}
          modelName={props.modelName}
          detailLoading={props.detailLoading}
          detailError={props.detailError}
        />
      )}
    </Fragment>
  )
}

export function RequestLogsTable(props: RequestLogsTableProps) {
  const t = useTranslation()
  let body

  if (props.loading) {
    body = <RequestLogsLoadingRows />
  } else if (props.error !== null && props.logs.length === 0) {
    body = (
      <TableStateRow colSpan={11} icon={AlertTriangle} tone="destructive" title={t('requestLogs.table.error.title')} description={props.error} action={
        <Button variant="outline" className="mt-1" onClick={props.onRetry}>
          <RefreshCw size={14} />
          {t('common.action.retry')}
        </Button>
      } />
    )
  } else if (props.logs.length === 0) {
    body = props.filtered
      ? <TableStateRow colSpan={11} icon={SearchX} title={t('requestLogs.table.empty.title')} description={t('requestLogs.table.empty.description')} />
      : <TableStateRow colSpan={11} icon={SearchX} title={t('requestLogs.table.emptyAll.title')} description={t('requestLogs.table.emptyAll.description')} />
  } else {
    body = props.logs.map(log => (
      <RequestLogTableRow
        key={log.id}
        log={log}
        expanded={props.expandedId === log.id}
        detail={props.details[log.id]}
        detailLoading={props.detailLoadingIds[log.id] ?? false}
        detailError={props.detailErrors[log.id] || null}
        modelName={props.getModelName(log.logicalModelId)}
        toggleExpand={props.toggleExpand}
      />
    ))
  }

  return (
    <TableFrame>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <RequestLogsTableHeader />
          <tbody>{body}</tbody>
        </table>
      </div>
    </TableFrame>
  )
}
