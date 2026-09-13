import { useCallback } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'
import { NOTE_DEFAULT_HEIGHT, NOTE_DEFAULT_WIDTH, type NoteNode } from '@common/router/types'
import { WorkflowButton } from '../components/workflow-button'
import { resolveNoteNodeSize } from '../node-meta'
import type { NodePanelProps } from '../node-data'
import { NodePanelField } from './panel-fields'

/**
 * 备注面板。
 *
 * 便签只有两件事：正文与卡片尺寸。尺寸平时靠拖画布上那个右下角手柄改，
 * 这里只报出当前值并留一条「恢复默认尺寸」的退路 —— 拖小了、拖大了都还能回来。
 */
export function NotePanel(props: NodePanelProps) {
  const { model, update } = props
  const t = useTranslation()
  const node = model.kind === 'note' ? model : undefined

  const patch = useCallback((patchValue: Partial<NoteNode>) => {
    update(current => current.kind === 'note' ? { ...current, ...patchValue } : current)
  }, [update])

  if (!node) return null

  const size = resolveNoteNodeSize(node)
  const isDefaultSize = size.width === NOTE_DEFAULT_WIDTH && size.height === NOTE_DEFAULT_HEIGHT

  return (
    <div className="grid gap-2.5">
      <NodePanelField label={t('router.panel.noteText')}>
        <Textarea
          value={node.text}
          placeholder={t('router.panel.noteTextPlaceholder')}
          onChange={event => patch({ text: event.target.value })}
          className="min-h-40 text-xs"
        />
      </NodePanelField>

      <NodePanelField label={t('router.panel.noteSize')}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono system-xs-regular text-text-tertiary">
            {t('router.panel.noteSizeValue', { width: size.width, height: size.height })}
          </span>
          <WorkflowButton
            variant="ghost"
            disabled={isDefaultSize}
            onClick={() => patch({ size: { width: NOTE_DEFAULT_WIDTH, height: NOTE_DEFAULT_HEIGHT } })}
          >
            {t('router.panel.noteResetSize')}
          </WorkflowButton>
        </div>
      </NodePanelField>
    </div>
  )
}
