import { INPUT_NODE_FIELDS } from '../input-shape'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelShapeCard } from './panel-fields'

/**
 * 输入节点面板。
 *
 * 节点本身没有任何配置项（请求行、请求头、请求体都是调用方给出的事实），所以这里只把
 * 「这个节点会交出什么」摆出来：每条字段的路径与静态类型，有说明的再附一句。
 * 清单的唯一来源是 `../input-shape.ts`，与下游条件节点的字段候选表同源，
 * 因此面板里列出的就是下游真正能选的 —— 请求体里的字段不在其中，
 * 体里有什么由协议决定，那是协议发现节点的事。
 *
 * 「输入节点没有可配置项」这句话由外壳那条提示条统一讲（`nodePanelHint`），
 * 面板里不再抄一遍：两张一样的说明条叠在一起，读的人只会以为自己眼花了。
 * 表本身的样式在 `./panel-fields` 的 `NodePanelShapeCard` 里，几个零配置节点共用。
 */
export function InputPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <NodePanelShapeCard
        title={t('router.panel.inputShapeTitle')}
        groups={[{
          fields: INPUT_NODE_FIELDS.map(field => ({
            path: field.path,
            valueType: field.valueType,
            ...(field.noteKey ? { note: t(field.noteKey) } : {}),
          })),
        }]}
      />
    </div>
  )
}
