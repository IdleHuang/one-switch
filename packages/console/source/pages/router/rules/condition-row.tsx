import { ArrowLeftRight, X } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { getOperatorsByType } from '@common/router/presets'
import {
  ROUTE_RULE_FIELD_KINDS,
  parseRouteRuleFieldPath,
  routeRuleFieldValueType,
  toRouteRuleFieldPath,
  type RouteRuleCondition,
  type RouteRuleFieldKind,
} from '@common/router/route-rules'
import {
  CONDITION_OPERATOR_META,
  FIELD_OPERAND_OPERATORS,
  type ConditionOperator,
} from '@common/router/types'
import { FieldPathInput } from './field-path-input'
import { PANEL_POPUP_ITEM_CLASSNAME, PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'

interface ConditionRowProps {
  condition: RouteRuleCondition
  index: number
  /** 由调用方决定能不能删：展开的规则里总是可删（删空等于「恒命中」，是一种正当配置） */
  removable: boolean
  onChange: (condition: RouteRuleCondition) => void
  onRemove: () => void
}

/**
 * 取值框里该填什么，完全由操作符决定 —— 同一个格子，`equals` 填一个值、`in` 填一串、
 * `between` 填下限、`regex` 填模式，光看标签「取值」没人猜得出来。提示语与引擎的判定保持一致：
 * `in` 按英文逗号切分、`between` 是闭区间、正则走 `RegExp`。
 *
 * 六个「比一个文本」的操作符（`equals` / `contains` / `startsWith` …）此前一条提示都没有，
 * 空着的那一格是整行里唯一不说话的 —— 它们共用一条：差别在判定（全等还是包含），
 * 而**该填什么**是同一件事。
 */
const VALUE_PLACEHOLDER_KEYS: Partial<Record<ConditionOperator, UiCatalogKey>> = {
  equals: 'router.rules.valueHint.text',
  notEquals: 'router.rules.valueHint.text',
  contains: 'router.rules.valueHint.text',
  notContains: 'router.rules.valueHint.text',
  startsWith: 'router.rules.valueHint.text',
  endsWith: 'router.rules.valueHint.text',
  in: 'router.rules.valueHint.list',
  notIn: 'router.rules.valueHint.list',
  between: 'router.rules.valueHint.lowerBound',
  regex: 'router.rules.valueHint.regex',
  gt: 'router.rules.valueHint.number',
  gte: 'router.rules.valueHint.number',
  lt: 'router.rules.valueHint.number',
  lte: 'router.rules.valueHint.number',
}

/**
 * 一条条件 —— 横着排一行，读起来像一句话。
 *
 * 与条件节点的面板**判定同构**：操作符与语义来自同一张 `CONDITION_OPERATOR_META`，
 * 比较值同样支持「来自另一个字段」，所以「图里这么配」与「规则里这么配」跑出来是同一个结果。
 * 版面却是两种模式各写各的：画布右栏窄，表单项只能竖着叠；规则表整行都空着，
 * 一条条件横排成「来源 名称 操作符 取值」才真的能一眼读成句子。
 *
 * 与面板的另一处不同是**不显示字段类型**：规则模式的字段来源是一张固定短表，类型是派生的，
 * 摆在操作符旁边只是噪音 —— 换操作符时下拉里列出的本来就只有该类型能用的那几个。
 */
export function ConditionRow(props: ConditionRowProps) {
  const { condition, index, removable, onChange, onRemove } = props
  const t = useTranslation()

  const fieldSpec = parseRouteRuleFieldPath(condition.fieldPath)
  const fieldMeta = ROUTE_RULE_FIELD_KINDS.find(item => item.kind === fieldSpec.kind)
  const valueType = routeRuleFieldValueType(condition.fieldPath)
  const operators = getOperatorsByType(valueType)

  const patch = (next: Partial<RouteRuleCondition>) => onChange({ ...condition, ...next })

  /** 换来源：路径重拼、类型重算、操作符收到该类型可用的第一个 —— 三件事必须一起变。 */
  const changeKind = (kind: RouteRuleFieldKind) => {
    const fieldPath = toRouteRuleFieldPath({ kind, name: kind === fieldSpec.kind ? fieldSpec.name : '' })
    const nextType = routeRuleFieldValueType(fieldPath)
    patch({ fieldPath, valueType: nextType, operator: getOperatorsByType(nextType)[0] ?? 'equals' })
  }

  const changeName = (name: string) => patch({ fieldPath: toRouteRuleFieldPath({ kind: fieldSpec.kind, name }) })

  /** 一元判定（exists / isTrue / empty …）没有比较值，行里也就别摆一个永远用不上的输入框。 */
  const needsExpectedValue = condition.operator !== 'exists'
    && condition.operator !== 'isTrue'
    && condition.operator !== 'isFalse'
    && condition.operator !== 'empty'
    && condition.operator !== 'notEmpty'
  const supportsFieldOperand = FIELD_OPERAND_OPERATORS.includes(condition.operator)
  const usesFieldOperand = supportsFieldOperand && condition.valueSource === 'field'
  const valuePlaceholder = VALUE_PLACEHOLDER_KEYS[condition.operator]

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-module-border bg-components-panel-bg px-2 py-1.5">
      <span
        aria-label={t('router.panel.conditionIndex', { index: index + 1 })}
        className="w-4 shrink-0 text-right font-mono system-2xs-regular text-text-quaternary"
      >
        {index + 1}
      </span>

      <Select value={fieldSpec.kind} onValueChange={value => changeKind(value as RouteRuleFieldKind)}>
        <SelectTrigger className="h-8 w-32 shrink-0">
          <SelectValue>{t(fieldMeta?.labelKey ?? 'router.rules.field.custom')}</SelectValue>
        </SelectTrigger>
        <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
          {ROUTE_RULE_FIELD_KINDS.map(meta => (
            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={meta.kind} value={meta.kind}>{t(meta.labelKey)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {fieldMeta?.needsName && (
        <Input
          className="h-8 w-36 shrink-0"
          value={fieldSpec.name}
          aria-label={t('router.rules.field.name')}
          placeholder={fieldMeta.namePlaceholderKey ? t(fieldMeta.namePlaceholderKey) : undefined}
          onChange={event => changeName(event.target.value)}
        />
      )}

      <Select
        value={condition.operator}
        onValueChange={value => patch(FIELD_OPERAND_OPERATORS.includes(value as ConditionOperator)
          ? { operator: value as ConditionOperator }
          : { operator: value as ConditionOperator, valueSource: 'literal' })}
      >
        <SelectTrigger className="h-8 w-36 shrink-0">
          <SelectValue>{t(CONDITION_OPERATOR_META[condition.operator].labelKey)}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" className={PANEL_POPUP_SURFACE_CLASSNAME}>
          {operators.map(operator => (
            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={operator} value={operator}>
              {t(CONDITION_OPERATOR_META[operator].labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsExpectedValue && supportsFieldOperand && (
        <Tooltip>
          {/* 让 Radix 渲染自己的 <button>，而不是把 ref 交给普通函数组件的 `Button`：
              `asChild` 下 ref 会落在 React 拿不到的地方，浮层锚点就没了。 */}
          <TooltipTrigger
            aria-label={usesFieldOperand ? t('router.rules.operandSwitchToLiteral') : t('router.rules.operandSwitchToField')}
            className={cn(buttonVariants({ size: 'icon-sm', variant: usesFieldOperand ? 'secondary' : 'ghost' }), 'shrink-0 text-text-tertiary')}
            onClick={() => patch({ valueSource: usesFieldOperand ? 'literal' : 'field' })}
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">
            {usesFieldOperand ? t('router.rules.operandSwitchToLiteral') : t('router.rules.operandSwitchToField')}
          </TooltipContent>
        </Tooltip>
      )}

      {needsExpectedValue && usesFieldOperand && (
        <FieldPathInput
          className="min-w-40 flex-1"
          value={condition.valueFieldPath ?? ''}
          // 不借图侧那句 `router.panel.compareField`（「比较字段（上游 schema）」）：规则模式没有
          // 上游节点，这里能填的任意一条请求字段路径都不是「上游 schema 给的」。候选同样是
          // 规则表自己的来源表（`rule-path-hints.ts`），不从图那边借字段。
          ariaLabel={t('router.rules.compareField')}
          placeholder={t('router.rules.valueHint.fieldPath')}
          onChange={valueFieldPath => patch({ valueFieldPath })}
        />
      )}

      {needsExpectedValue && !usesFieldOperand && (
        <>
          <Input
            className="h-8 min-w-40 flex-1"
            value={condition.value ?? ''}
            aria-label={t('router.panel.compareValue')}
            placeholder={valuePlaceholder ? t(valuePlaceholder) : undefined}
            onChange={event => patch({ value: event.target.value })}
          />
          {condition.operator === 'between' && (
            <Input
              className="h-8 w-28 shrink-0"
              value={condition.secondaryValue ?? ''}
              aria-label={t('router.panel.upperBound')}
              placeholder={t('router.rules.valueHint.upperBound')}
              onChange={event => patch({ secondaryValue: event.target.value })}
            />
          )}
        </>
      )}

      {fieldSpec.kind === 'header' && (
        <span className="shrink-0 system-2xs-regular text-text-quaternary">{t('router.rules.field.headerNote')}</span>
      )}

      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={!removable}
        aria-label={t('router.panel.delete')}
        className="shrink-0 text-text-tertiary hover:text-text-destructive"
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}
