import { ROUTER_RULE_PRESETS, type RouterRulePreset, type RouterRulePresetId } from '@common/router/rule-presets'
import { PresetMenu, type PresetMenuLabels } from '../components/preset-menu'
import { rulePresetTextKeys } from './rules-preset-text'

type RulesPresetMenuProps = {
  /** 当前规则表与某个预设一致时高亮它；不一致时为 `null`。 */
  activePresetId: RouterRulePresetId | null
  onApply: (preset: RouterRulePreset) => void
}

const RULES_PRESET_MENU_LABELS: PresetMenuLabels = {
  aria: 'router.rules.preset.aria',
  fallbackName: 'router.rules.preset.fallbackName',
  title: 'router.rules.preset.title',
  subtitle: 'router.rules.preset.subtitle',
  builtInDefault: 'router.rules.preset.builtInDefault',
  current: 'router.rules.preset.current',
}

/**
 * 内置规则预设下拉：一按就把整张规则表换成预设内容，第一项是系统默认表。
 *
 * 与图模式的 `PolicyMenu` 是同一个组件（`PresetMenu`）换一份数据 —— 两个模式都有「内置预设」，
 * 长相与交互就该是同一套，只是标题里的「画布」换成「规则表」。
 */
export function RulesPresetMenu(props: RulesPresetMenuProps) {
  const { activePresetId, onApply } = props

  return (
    <PresetMenu
      presets={ROUTER_RULE_PRESETS}
      textKeysOf={rulePresetTextKeys}
      labels={RULES_PRESET_MENU_LABELS}
      activeId={activePresetId}
      onApply={onApply}
    />
  )
}
