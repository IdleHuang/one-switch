import { describe, expect, it } from 'vitest'
import { findPresetByName, getBuiltInProviderSuggestions } from './provider-presets'

describe('provider presets', () => {
  it('finds known aliases for built-in providers', () => {
    const preset = findPresetByName('gpt')
    expect(preset?.name).toBe('OpenAI')
  })

  it('resolves Ollama aliases to the built-in local provider', () => {
    const preset = findPresetByName('ollama-local')
    expect(preset?.key).toBe('ollama')
    expect(preset?.endpoints['openai-completions']).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('shows missing built-in providers as suggestions before users create them', () => {
    const suggestions = getBuiltInProviderSuggestions(['OpenAI'])
    expect(suggestions.some(preset => preset.name === 'OpenAI')).toBe(false)
    expect(suggestions.some(preset => preset.name === 'Anthropic')).toBe(true)
  })
})
