import { describe, expect, it } from 'vitest'
import { createProtocolAuthHeaders, resolveProtocolAuthHeaders } from './protocols'

describe('createProtocolAuthHeaders', () => {
  it.each(['openai-completions', 'openai-responses'] as const)(
    'uses bearer authorization for %s',
    protocol => {
      expect(createProtocolAuthHeaders(protocol, 'secret', null)).toEqual({
        authorization: 'Bearer secret',
      })
    },
  )

  it('uses the Anthropic key and version headers', () => {
    expect(createProtocolAuthHeaders('anthropic-messages', 'secret', null)).toEqual({
      'x-api-key': 'secret',
      'anthropic-version': '2023-06-01',
    })
  })

  it('uses an explicitly configured custom header', () => {
    expect(createProtocolAuthHeaders('openai-responses', 'secret', 'X-Custom-Key')).toEqual({
      'X-Custom-Key': 'secret',
    })
  })

  it('keeps the protocol fixed headers alongside a custom authentication header', () => {
    // 认证头只决定密钥放哪，协议本身要求的固定头（Anthropic 的版本头）不能跟着一起消失。
    expect(createProtocolAuthHeaders('anthropic-messages', 'secret', 'X-Custom-Key')).toEqual({
      'X-Custom-Key': 'secret',
      'anthropic-version': '2023-06-01',
    })
  })

  it('omits auth headers entirely when the API key is absent (local/test clusters)', () => {
    expect(createProtocolAuthHeaders('openai-completions', null, null)).toEqual({})
    expect(createProtocolAuthHeaders('openai-responses', null, null)).toEqual({})
  })

  it('keeps the Anthropic version header when the API key is absent', () => {
    expect(createProtocolAuthHeaders('anthropic-messages', null, null)).toEqual({
      'anthropic-version': '2023-06-01',
    })
  })

  it('ignores an empty custom auth header name and falls back to the protocol default', () => {
    expect(createProtocolAuthHeaders('openai-completions', 'secret', '')).toEqual({
      authorization: 'Bearer secret',
    })
  })
})

describe('resolveProtocolAuthHeaders', () => {
  it('separates the credential landing spot from the protocol fixed headers', () => {
    // 转发方向的两半必须能分开：`replace` 覆盖客户端带来的同名头，`fill` 只在缺了时补上。
    // 合成一份就表达不出「anthropic-version 不该盖掉客户端的值」这件事。
    expect(resolveProtocolAuthHeaders('anthropic-messages', 'secret', null)).toEqual({
      replace: { 'x-api-key': 'secret' },
      fill: { 'anthropic-version': '2023-06-01' },
    })
  })

  it('puts an explicitly configured custom header in replace, not in fill', () => {
    expect(resolveProtocolAuthHeaders('anthropic-messages', 'secret', 'X-Custom-Key')).toEqual({
      replace: { 'X-Custom-Key': 'secret' },
      fill: { 'anthropic-version': '2023-06-01' },
    })
  })

  it('has nothing to replace when the API key is absent but still fills the fixed headers', () => {
    expect(resolveProtocolAuthHeaders('anthropic-messages', null, null)).toEqual({
      replace: {},
      fill: { 'anthropic-version': '2023-06-01' },
    })
    expect(resolveProtocolAuthHeaders('openai-completions', null, null)).toEqual({
      replace: {},
      fill: {},
    })
  })
})
