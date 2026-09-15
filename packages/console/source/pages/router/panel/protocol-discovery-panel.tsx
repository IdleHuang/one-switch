import { ALL_WORKFLOW_PROTOCOLS } from '@common/router/types'
import { requestShapeOf } from '@common/router/request-shape'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelShapeCard } from './panel-fields'

/**
 * 协议发现节点面板。
 *
 * 节点本身没有任何配置项（协议由系统按路径与请求头认出），所以这里只把
 * 「这个节点会交出什么」摆出来：每种协议分支下列出它声明的请求体字段。
 * 声明表的唯一来源是 `@common/router/request-shape.ts`，与下游条件节点的候选表同源，
 * 因此面板里读到的就是下游真正能选的。
 *
 * 这里**只列路径与类型、不列字段说明**：这张表是用来跨四个分支比对的（同一个
 * `request.body.model` 在四种协议里都是同一个位置），插进说明就把对照关系冲散了；
 * 每条字段的说明在下游节点的字段候选表里读得到。
 *
 * 零配置节点面板里只有这一块只读参考表：节点定位由外壳那条提示条讲，
 * 分支出口在画布上看得见，再堆说明条只会让整屏都是灰盒子。
 */
export function ProtocolDiscoveryPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <NodePanelShapeCard
        title={t('router.panel.protocolShapeTitle')}
        groups={ALL_WORKFLOW_PROTOCOLS.map((protocol) => {
          const shape = requestShapeOf(protocol)

          return {
            label: protocol,
            fields: shape
              ? shape.fields.map(field => ({ path: field.path, valueType: field.valueType }))
              : [],
            emptyHint: t('router.panel.protocolShapeEmpty'),
          }
        })}
      />
    </div>
  )
}
