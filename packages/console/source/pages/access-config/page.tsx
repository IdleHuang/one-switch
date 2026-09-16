import { useState } from 'react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { useTranslation } from '@/i18n/provider'
import { ServiceStatusBar } from './components/service-status-bar'
import { ToolGuideCard } from './components/tool-guide-card'
import { ToolListCard } from './components/tool-list-card'
import { useAccessConfig } from './hooks/use-access-config'
import { useCopyToClipboard } from './hooks/use-copy-to-clipboard'
import { DEFAULT_ACCESS_TOOL_ID, findAccessTool, type AccessToolId } from './tools'

/**
 * 接入配置页要回答的问题是「怎么把这个服务配进**我自己的**工具里」，
 * 所以版面只办两件事：先认出用户在用什么工具，再把那个工具的写法摊开。
 *
 * 形态定成「左栏选、右栏配」：左栏是一条压扁的清单（入口，不是内容），
 * 右栏才是目的地——用户动手的地方只有一处，页面上就不该出现第二块和它争注意力的内容。
 *
 * 页头之下压一条服务状态带，是因为「服务在不在跑」是前提而不是步骤：它不成立时右栏填什么都没用。
 * 它不参与右栏那 123 的编号，也不是一张卡——两条并列的卡片会立刻把顺序读没。
 * 启停按钮留在页头，换监听地址留在状态带里：次一级的选择不配独占一块版面。
 *
 * 页面上不再有「其它写法」这类补充卡片：同一个信息出现两次，用户从客户端连不上回来时就得两处找答案。
 */
export function AccessConfigPage() {
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()
  const t = useTranslation()
  const [toolId, setToolId] = useState<AccessToolId>(DEFAULT_ACCESS_TOOL_ID)

  const tool = findAccessTool(toolId)

  return (
    <PageLayout>
      <PageHeader
        title={t('access.title')}
        description={t('access.description')}
        actions={<ProxyToggleButton running={config.running} onToggle={config.toggleProxy} />}
      />

      <PageContent>
        <ServiceStatusBar
          running={config.running}
          host={config.host}
          port={config.port}
          wildcardHost={config.wildcardHost}
        />
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ToolListCard selectedId={toolId} onSelect={setToolId} />
          <ToolGuideCard
            tool={tool}
            origin={config.origin}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        </div>
      </PageContent>
    </PageLayout>
  )
}
