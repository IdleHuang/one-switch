import { describe, expect, it } from 'vitest'
import { ToolNameRegistry } from './tool-name-registry'

describe('ToolNameRegistry', () => {
  it('展平命名空间工具名并记住原始坐标', () => {
    const registry = new ToolNameRegistry()

    const flattened = registry.flatten('crm', 'lookup')

    expect(flattened).toBe('crm__lookup')
    expect(registry.restore(flattened)).toEqual({ namespace: 'crm', name: 'lookup' })
  })

  it('同一组入参稳定返回同一个名字', () => {
    const registry = new ToolNameRegistry()

    const first = registry.flatten('crm', 'lookup')
    const second = registry.flatten('crm', 'lookup')

    expect(second).toBe(first)
    // 幂等：重复登记不会把名字挤成 `crm__lookup__2`
    expect(registry.restore(first)).toEqual({ namespace: 'crm', name: 'lookup' })
  })

  it('不同命名空间的同名工具拿到互不相同的展平名', () => {
    const registry = new ToolNameRegistry()

    const crm = registry.flatten('crm', 'lookup')
    const billing = registry.flatten('billing', 'lookup')

    expect(crm).not.toBe(billing)
    expect(registry.restore(crm)).toEqual({ namespace: 'crm', name: 'lookup' })
    expect(registry.restore(billing)).toEqual({ namespace: 'billing', name: 'lookup' })
  })

  it('顶层工具名优先占用，展平结果让位', () => {
    const registry = new ToolNameRegistry()
    // 顶层工具名必须保持原样，因此先占位；否则同名展平结果会把它挤掉
    registry.reserve('crm__lookup')

    const flattened = registry.flatten('crm', 'lookup')

    expect(flattened).toBe('crm__lookup__2')
    expect(registry.restore(flattened)).toEqual({ namespace: 'crm', name: 'lookup' })
    // 顶层工具名不在表里，响应侧查不到就按原样输出
    expect(registry.restore('crm__lookup')).toBeUndefined()
  })

  it('多个展平名撞车时逐个换后缀', () => {
    const registry = new ToolNameRegistry()
    registry.reserve('crm__lookup')
    registry.reserve('crm__lookup__2')

    expect(registry.flatten('crm', 'lookup')).toBe('crm__lookup__3')
  })

  it('把非法字符换成下划线，并截到 64 字符以内', () => {
    const registry = new ToolNameRegistry()
    const namespace = 'n'.repeat(60)

    const flattened = registry.flatten(namespace, 'a.b c')

    expect(flattened).toHaveLength(64)
    expect(flattened.startsWith(namespace)).toBe(true)
    expect(flattened).toMatch(/^[A-Za-z0-9_-]+$/)
    // 名字被截断了，但还原出来仍是最初完整的坐标
    expect(registry.restore(flattened)).toEqual({ namespace, name: 'a.b c' })
  })

  it('截断后仍能通过后缀区分不同工具', () => {
    const registry = new ToolNameRegistry()
    // 62 + '__' + 1 > 64，两个名字的展平结果都会被截成同一个前缀
    const namespace = 'n'.repeat(62)

    const first = registry.flatten(namespace, 'a')
    const second = registry.flatten(namespace, 'b')

    expect(first).not.toBe(second)
    expect(first).toHaveLength(64)
    expect(second).toHaveLength(64)
    expect(registry.restore(first)).toEqual({ namespace, name: 'a' })
    expect(registry.restore(second)).toEqual({ namespace, name: 'b' })
  })

  it('空名字占位无副作用，未登记的名字查不到', () => {
    const registry = new ToolNameRegistry()
    registry.reserve('')

    expect(registry.flatten('crm', 'lookup')).toBe('crm__lookup')
    expect(registry.restore('unknown')).toBeUndefined()
  })

  it('按原始名反查展平名，供 tool_choice 改写', () => {
    const registry = new ToolNameRegistry()
    registry.flatten('crm', 'lookup')
    registry.reserve('plain')

    expect(registry.locate('lookup')).toBe('crm__lookup')
    // 顶层工具名本来就该原样下发，不能被换成别处的展平名
    expect(registry.locate('plain')).toBeUndefined()
    expect(registry.locate('unknown')).toBeUndefined()
    expect(registry.locate('')).toBeUndefined()
  })

  it('同名工具落在多个命名空间时不猜，返回 undefined', () => {
    const registry = new ToolNameRegistry()
    registry.flatten('crm', 'lookup')
    registry.flatten('billing', 'lookup')

    // `ToolChoiceFunction` 只有 `name`，没有 `namespace`，无法消歧
    expect(registry.locate('lookup')).toBeUndefined()
  })

  it('名字同时是顶层工具与组内工具时以顶层为准', () => {
    const registry = new ToolNameRegistry()
    registry.reserve('lookup')
    registry.flatten('crm', 'lookup')

    expect(registry.locate('lookup')).toBeUndefined()
  })
})
