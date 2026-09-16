import type { RouterRulePresetId } from '@common/router/rule-presets'
import type { PresetTextKeys } from '../components/preset-menu'

/**
 * 内置规则预设的展示文案键。
 *
 * 与策略预设（`../policy-preset-text.ts`）完全同一个口径：预设本身在 `@common/router/rule-presets.ts`，
 * 里边只有标识符与建表函数（服务端也会引用它，而服务端没有「界面语言」），
 * 名称与说明是纯展示内容，所以落在渲染层。表用 `RouterRulePresetId` 作键，漏配会在类型检查阶段被拦住。
 */
export type RulePresetTextKeys = PresetTextKeys

export const RULE_PRESET_TEXT_KEYS: Record<RouterRulePresetId, RulePresetTextKeys> = {
  'model-direct': { name: 'router.rules.preset.model-direct.name', description: 'router.rules.preset.model-direct.description' },
  'client-source': { name: 'router.rules.preset.client-source.name', description: 'router.rules.preset.client-source.description' },
  'model-prefix': { name: 'router.rules.preset.model-prefix.name', description: 'router.rules.preset.model-prefix.description' },
  'protocol-routing': { name: 'router.rules.preset.protocol-routing.name', description: 'router.rules.preset.protocol-routing.description' },
}

/**
 * 按预设 id 取文案键。
 *
 * 入参刻意放宽成 `string`：`activePresetId` 是**内容比对得出的结论**，类型上不是联合字面量
 * （旧版本可能存着现在已经不存在的预设内容），所以表外返回 `undefined`，由调用方兜底。
 */
export function rulePresetTextKeys(id: string): RulePresetTextKeys | undefined {
  return (RULE_PRESET_TEXT_KEYS as Record<string, RulePresetTextKeys>)[id]
}
