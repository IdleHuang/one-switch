import type { RouterPolicyPreset, RouterPolicyPresetId } from '@common/router/presets'
import { ROUTER_POLICY_PRESETS } from '@common/router/presets'
import { policyPresetTextKeys } from '../policy-preset-text'
import { PresetMenu, type PresetMenuLabels } from './preset-menu'

type PolicyMenuProps = {
  /** 当前画布与某个预设一致时高亮它；不一致时为 `null`。 */
  activePolicyId: RouterPolicyPresetId | null
  onApply: (preset: RouterPolicyPreset) => void
}

const POLICY_MENU_LABELS: PresetMenuLabels = {
  aria: 'router.policy.aria',
  fallbackName: 'router.policy.fallbackName',
  title: 'router.policy.title',
  subtitle: 'router.policy.subtitle',
  builtInDefault: 'router.policy.builtInDefault',
  current: 'router.policy.current',
}

/**
 * 策略下拉：随时把画布换成内置策略，第一项是系统默认策略。
 *
 * 菜单长相与规则表模式的预设菜单完全一致（同一个 `PresetMenu`），只有标题措辞不同。
 */
export function PolicyMenu(props: PolicyMenuProps) {
  const { activePolicyId, onApply } = props

  return (
    <PresetMenu
      presets={ROUTER_POLICY_PRESETS}
      textKeysOf={policyPresetTextKeys}
      labels={POLICY_MENU_LABELS}
      activeId={activePolicyId}
      onApply={onApply}
    />
  )
}
