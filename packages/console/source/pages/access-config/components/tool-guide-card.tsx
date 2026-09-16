import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plug, ScrollText } from 'lucide-react'
import { routePaths } from '@/routes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import {
  PROTOCOL_HINT_KEYS,
  PROTOCOL_LABEL_KEYS,
  buildVerifyCommand,
  resolveToolValues,
  type AccessTool,
} from '../tools'
import { CodeBlock } from './code-block'
import { CopyButton } from './copy-button'
import { StepMarker } from './step-marker'

interface GuideSectionProps {
  index: number
  title: string
  children: ReactNode
  /** 段与段之间用发丝线分开；第一段紧贴卡片头的分隔线，不需要再来一条。 */
  divided?: boolean
}

/**
 * 引导段：序号 + 小标题 + 内容。
 *
 * 序号复用第一步那条状态带之外的同一个标记，全页只有一套数字，
 * 「① 拿地址 → ② 写进去 → ③ 验一下」这条顺序就不会被别处的编号搅浑。
 */
function GuideSection(props: GuideSectionProps) {
  const { index, title, children, divided } = props
  return (
    <section
      className={cn(
        'grid min-w-0 gap-3 px-4 py-4',
        divided && 'border-t border-border/50',
      )}
    >
      <h3 className="flex items-center gap-2 system-xs-medium text-text-secondary">
        <StepMarker index={index} />
        {title}
      </h3>
      <div className="grid min-w-0 gap-3">{children}</div>
    </section>
  )
}

interface ToolGuideCardProps {
  tool: AccessTool
  /** 服务根地址，形如 `http://127.0.0.1:19300`；服务没跑时是空串。 */
  origin: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/**
 * 右栏：把选中的工具配起来的三步。
 *
 * 这一步是整页唯一的目的地——用户来这一页就是为了「把我们的服务配进他自己的工具里」，
 * 所以它占一整张卡，而且三段的重心按「用户真正要动手的程度」排：
 *
 * ① Base URL 是答案本身，字号最大、全页唯一带文字的复制按钮，而且按钮紧贴它，不推到另一端；
 * ② 「写进这里」是唯一需要用户打开别的东西去操作的一段，所以它拿到片段块 / 编号步骤，
 *    以及一句「这个值是从哪来的」——配置文件类工具给的是一整份能粘贴的片段，
 *    图形界面工具给的是照着四个框填，两者形态不同但不分厚薄；
 * ③ 验证放在最后，因为它只在出问题时才有用，平时扫一眼就走。
 *
 * 三段都成卡、厚薄相同的时候，顺序读不出来；这里靠「段内形态」而不是「卡片厚度」区分权重，
 * 因为这一页的形态已经被「左栏选、右栏配」定下来了，再叠一层粗细只会更乱。
 */
export function ToolGuideCard(props: ToolGuideCardProps) {
  const { tool, origin, copiedKey, onCopy } = props
  const t = useTranslation()
  const navigate = useNavigate()

  const values = resolveToolValues(tool, origin)
  const verifyCommand = buildVerifyCommand(origin, tool.protocol)

  return (
    <Card className="pb-0">
      <SettingsCardHeader
        icon={<Plug />}
        title={tool.name}
        description={t(tool.descriptionKey)}
        actions={<Badge variant="outline">{t(PROTOCOL_LABEL_KEYS[tool.protocol])}</Badge>}
      />

      <CardContent className="p-0">
        <GuideSection index={1} title={t('access.address.baseUrl')}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-mono system-xl-medium text-text-primary select-all">
              {values.baseUrl || '—'}
            </span>
            <CopyButton
              showLabel
              itemKey={`base-url:${tool.id}`}
              value={values.baseUrl}
              copiedKey={copiedKey}
              onCopy={onCopy}
              label={t('access.address.copyBaseUrl')}
            />
          </div>
          {/* 这一句是整页最值钱的一句：多带或少带那个 /v1，在客户端里只表现为一个 404。 */}
          <p className="system-xs-regular text-text-tertiary">{t(PROTOCOL_HINT_KEYS[tool.protocol])}</p>
        </GuideSection>

        <GuideSection index={2} title={t('access.guide.setup.title')} divided>
          <span className="font-mono system-xs-regular text-text-quaternary select-all">
            {t(tool.locationKey)}
          </span>

          {tool.setup.kind === 'snippet' ? (
            <CodeBlock
              itemKey={`snippet:${tool.id}`}
              code={tool.setup.snippet.render(values)}
              copiedKey={copiedKey}
              onCopy={onCopy}
              copyLabel={t('access.guide.setup.copy')}
            />
          ) : (
            <ol className="grid min-w-0 gap-2.5">
              {tool.setup.steps.map((step, stepIndex) => (
                <li key={step.labelKey} className="grid min-w-0 gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="w-3.5 shrink-0 font-mono system-2xs-medium text-text-quaternary tabular-nums">
                      {stepIndex + 1}
                    </span>
                    <span className="min-w-0 system-xs-regular text-text-secondary">
                      {t(step.labelKey)}
                    </span>
                  </div>
                  {step.value && (
                    <div className="flex min-w-0 items-center gap-1 pl-5.5">
                      <span className="min-w-0 truncate font-mono system-sm-medium text-text-primary select-all">
                        {step.value(values) || '—'}
                      </span>
                      <CopyButton
                        itemKey={`step:${tool.id}:${stepIndex}`}
                        value={step.value(values)}
                        copiedKey={copiedKey}
                        onCopy={onCopy}
                        label={step.copyLabelKey ? t(step.copyLabelKey) : t('access.guide.value.copy')}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="system-xs-regular text-text-tertiary">{t(tool.noteKey)}</p>
        </GuideSection>

        <GuideSection index={3} title={t('access.guide.verify.title')} divided>
          <p className="system-xs-regular text-text-tertiary">{t('access.guide.verify.hint')}</p>
          <CodeBlock
            itemKey={`verify:${tool.id}`}
            code={verifyCommand}
            copiedKey={copiedKey}
            onCopy={onCopy}
            copyLabel={t('access.guide.verify.commandCopy')}
          />
          {/* 验完不等于看得到：请求记录里能查到这一条，才说明真的走过了代理。 */}
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => void navigate({ to: routePaths.requestLogs })}
            >
              <ScrollText />
              {t('access.guide.verify.openLogs')}
            </Button>
          </div>
        </GuideSection>
      </CardContent>
    </Card>
  )
}
