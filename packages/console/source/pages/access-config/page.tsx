import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { useTranslation } from '@/i18n/provider'
import { AddressCard } from './components/address-card'
import { InterfaceTableCard } from './components/interface-table-card'
import { ServiceStatusBar } from './components/service-status-bar'
import { useAccessConfig } from './hooks/use-access-config'
import { useCopyToClipboard } from './hooks/use-copy-to-clipboard'

/**
 * 接入配置页是一份**本机服务的说明书**，不是一份别人的教程。
 *
 * 它只讲三件我们自己的事实：服务在哪个地址上、客户端要用的三个值是什么、服务接受哪些路径。
 * 这三件事都由本仓库的注册表决定，不会因为任何客户端改版而变——所以这一页没有「工具」这个概念，
 * 没有工具清单，也没有跟着工具走的菜单路径和字段叫法。反过来，任何工具的做法都能在这三件事上
 * 对上号，用户从客户端连不上回来时，也只需要在这三件事里找答案。
 *
 * 版面因此是单调的一列：状态 → 三个值 → 接口表。顺序就是读的顺序，页面上没有第二块和它争注意力
 * 的内容，也就没有「两处答案」的不一致。地址只出现一条（另一种写法是一句话，不是第二条值），
 * 因为这里最贵的错误是把两条只差 `/v1` 的地址抄串行。
 *
 * 启停按钮留在页头：它管的是整页的前提；换监听地址放在状态带里，次一级的选择不配独占一块版面。
 */
export function AccessConfigPage() {
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()
  const t = useTranslation()

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
        <AddressCard origin={config.origin} copiedKey={copiedKey} onCopy={copy} />
        <InterfaceTableCard />
      </PageContent>
    </PageLayout>
  )
}
