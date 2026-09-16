// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RequestContentsSheet } from './request-contents-sheet'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/features/settings/hooks', () => ({ useSettings: () => null }))

interface WrapperProps { children: ReactNode }

function Wrapper(props: WrapperProps) {
  return (
    <I18nProvider>
      <ToastProvider>
        <TooltipProvider>{props.children}</TooltipProvider>
      </ToastProvider>
    </I18nProvider>
  )
}

function attemptOf(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http-stream',
    ttftMilliseconds: 12,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 100,
    createdTime: 0,
    ...overrides,
  }
}

function clientContentOf(overrides: Partial<RequestContent> = {}): RequestContent {
  return {
    id: 'content_1',
    requestId: 'req_1',
    captureStatus: 'captured',
    requestMethod: 'POST',
    requestPath: '/v1/responses',
    requestHeaders: '{}',
    requestBody: '{"model":"default"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: 'data: {"type":"response.output_text.delta","delta":"ok"}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

function attemptContentOf(overrides: Partial<AttemptContent> = {}): AttemptContent {
  return {
    id: 'attempt_content_1',
    attemptId: 'att_1',
    captureStatus: 'captured',
    requestHeaders: '{}',
    requestBody: '{"model":"upstream"}',
    responseStatus: 200,
    responseHeaders: '{}',
    responseBody: 'data: {"type":"response.output_text.delta","delta":"ok"}',
    createdTime: 0,
    updatedTime: 0,
    ...overrides,
  }
}

interface RenderInput {
  client?: Partial<RequestContent>
  upstream?: Partial<AttemptContent>
  attempt?: Partial<RequestLogEntryAttempt>
}

function renderSheet(input: RenderInput = {}) {
  return render(
    <RequestContentsSheet
      contents={[clientContentOf(input.client)]}
      attemptContents={[attemptContentOf(input.upstream)]}
      attempts={[attemptOf(input.attempt)]}
      requestRewriteRules={[]}
      clientProtocol="openai-responses"
      loading={false}
      error={null}
      selectedAttemptId="att_1"
      onClose={() => {}}
    />,
    { wrapper: Wrapper },
  )
}

describe('capture status hint', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
  })

  it('says nothing when the whole body was captured', () => {
    renderSheet()

    expect(screen.queryByText('Partial capture')).toBeNull()
  })

  it('marks a client body that was only partially captured, on the client response stage', () => {
    renderSheet({ client: { captureStatus: 'partial' } })

    const chip = screen.getByText('Partial capture')
    expect(chip.closest('section')?.textContent).toContain('Response returned to the client')
  })

  it('marks an upstream body that was only partially captured, on the upstream response stage', () => {
    renderSheet({ upstream: { captureStatus: 'partial' } })

    const chip = screen.getByText('Partial capture')
    expect(chip.closest('section')?.textContent).toContain('Response from the real channel')
  })
})
