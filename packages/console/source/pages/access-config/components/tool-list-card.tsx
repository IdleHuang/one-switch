import { Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import {
  ACCESS_TOOL_GROUPS,
  ACCESS_TOOLS,
  PROTOCOL_LABEL_KEYS,
  TOOL_GROUP_TITLE_KEYS,
  type AccessToolId,
} from '../tools'

interface ToolListCardProps {
  selectedId: AccessToolId
  onSelect: (id: AccessToolId) => void
}

/**
 * 左栏：用户手上有哪个工具。
 *
 * 这一页的主语是「你自己的工具」，所以选择权先摆出来——先认工具，再看写法，
 * 而不是先摆协议再让用户自己推「我算 OpenAI 兼容还是 Anthropic」。
 *
 * 行上只留工具名和协议徽标两样：工具名决定选谁，徽标只是给「为什么地址不一样」留个可回溯的线头，
 * 真正要读的「它会补什么路径」写在右栏——那里才是用户动手的地方。
 *
 * 整列压成一条，是为了让右栏成为这一页唯一的目的地：左栏是入口，不是内容。
 */
export function ToolListCard(props: ToolListCardProps) {
  const { selectedId, onSelect } = props
  const t = useTranslation()

  return (
    <Card className="h-fit pb-0 lg:sticky lg:top-5">
      <SettingsCardHeader
        icon={<Wrench />}
        title={t('access.tools.title')}
        description={t('access.tools.description')}
      />
      <CardContent className="p-0">
        {ACCESS_TOOL_GROUPS.map((group, groupIndex) => (
          <section key={group}>
            <h3
              className={cn(
                'px-3 pt-3 pb-1 system-2xs-medium text-text-quaternary',
                groupIndex > 0 && 'border-t border-border/50',
              )}
            >
              {t(TOOL_GROUP_TITLE_KEYS[group])}
            </h3>
            <ul>
              {ACCESS_TOOLS.filter(tool => tool.group === group).map(tool => {
                const selected = tool.id === selectedId
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      // 行里还有一个协议徽标，但按钮的无障碍名只给工具名：
                      // 「选哪个工具」才是这一行的作用，徽标是给看得见的人做回溯用的线索。
                      aria-label={tool.name}
                      aria-pressed={selected}
                      onClick={() => onSelect(tool.id)}
                      className={cn(
                        'relative flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-none focus-visible:ring-inset',
                        selected ? 'bg-state-base-hover-alt' : 'hover:bg-state-base-hover',
                      )}
                    >
                      {/* 选中态不止靠背景色：左侧指示条 + 字重一起表意（同侧边栏的写法）。 */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary transition-opacity duration-150 motion-reduce:transition-none',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate',
                          selected
                            ? 'system-sm-medium text-text-primary'
                            : 'system-sm-regular text-text-secondary',
                        )}
                      >
                        {tool.name}
                      </span>
                      <Badge variant="outline">{t(PROTOCOL_LABEL_KEYS[tool.protocol])}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
