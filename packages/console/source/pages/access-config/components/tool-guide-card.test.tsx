// @vitest-environment jsdom

import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'
import { useLanguageStore } from '@/i18n/store'
import { DEFAULT_ACCESS_TOOL_ID, findAccessTool, type AccessToolId } from '../tools'
import { ToolGuideCard } from './tool-guide-card'
import { ToolListCard } from './tool-list-card'

// `I18nProvider` 会读取服务端设置，单测里不需要也不该走 react-query。
vi.mock('@/features/settings/hooks', () => ({ useSettings: () => null }))

// 「查看请求记录」要跳页，单测里只需要确认它存在，不需要真路由。
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const ORIGIN = 'http://127.0.0.1:19300'

type WrapperProps = { children: ReactNode }

type HarnessProps = { origin: string; onCopy?: (key: string, value: string) => void }

type RenderOptions = { origin?: string; onCopy?: (key: string, value: string) => void }

function Wrapper(props: WrapperProps) {
  return <I18nProvider>{props.children}</I18nProvider>
}

/**
 * 左栏 + 右栏按页面里的方式拼起来测：选中哪一行决定右栏是哪个工具，
 * 这条联动是这一页的核心行为，拆开各测一半就会漏掉它。
 */
function Harness(props: HarnessProps) {
  const { origin, onCopy } = props
  const [toolId, setToolId] = useState<AccessToolId>(DEFAULT_ACCESS_TOOL_ID)

  return (
    <>
      <ToolListCard selectedId={toolId} onSelect={setToolId} />
      <ToolGuideCard
        tool={findAccessTool(toolId)}
        origin={origin}
        copiedKey={null}
        onCopy={onCopy ?? (() => {})}
      />
    </>
  )
}

function renderHarness(options: RenderOptions = {}) {
  render(<Harness origin={options.origin ?? ORIGIN} onCopy={options.onCopy} />, { wrapper: Wrapper })
}

describe('接入引导', () => {
  beforeEach(() => {
    useLanguageStore.setState({ preference: 'en' })
    navigate.mockClear()
  })

  it('默认给出的地址停在端口，因为 Claude Code 自己会补 /v1/messages', () => {
    renderHarness()

    expect(screen.getByText(ORIGIN)).toBeTruthy()
    // 回归点：带上 /v1 的那条是 OpenAI 系的地址，默认工具下不能出现。
    expect(screen.queryByText(`${ORIGIN}/v1`)).toBeNull()
  })

  it('换成 OpenAI 系的工具后地址带 /v1，且整页不会出现 /v1/v1', () => {
    renderHarness()

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))

    expect(screen.getByText(`${ORIGIN}/v1`)).toBeTruthy()
    expect(screen.queryByText(ORIGIN)).toBeNull()
    expect(screen.queryByText(new RegExp(`${ORIGIN}/v1/v1`))).toBeNull()
  })

  it('配置文件类工具给一整份能粘贴的配置，图形界面类工具给照着填的编号步骤', () => {
    renderHarness()

    expect(screen.getByText(/export ANTHROPIC_BASE_URL=/)).toBeTruthy()
    expect(screen.queryByText('Set API Provider to OpenAI Compatible')).toBeNull()

    // 两个图形界面工具各有各的步骤，不能共用一个通用模板。
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(screen.getByText('Open Settings → Models and expand OpenAI API Key')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cline' }))
    expect(screen.getByText('Set API Provider to OpenAI Compatible')).toBeTruthy()
    expect(screen.queryByText(/export ANTHROPIC_BASE_URL=/)).toBeNull()
  })

  it('复制按钮交出的是当前工具、当前字段的值', () => {
    const onCopy = vi.fn()
    renderHarness({ onCopy })

    fireEvent.click(screen.getByRole('button', { name: 'Copy Base URL' }))
    expect(onCopy).toHaveBeenCalledWith('base-url:claudeCode', ORIGIN)

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Base URL' }))
    expect(onCopy).toHaveBeenLastCalledWith('base-url:cursor', `${ORIGIN}/v1`)
  })

  it('根地址为空时摆占位符并禁用复制，而不是把版面收掉', () => {
    renderHarness({ origin: '' })

    // Base URL、片段、验证命令三处都占着位。
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect((screen.getByRole('button', { name: 'Copy Base URL' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('验证那一节能跳到请求记录', () => {
    renderHarness()

    fireEvent.click(screen.getByRole('button', { name: /Open Request Logs/ }))
    expect(navigate).toHaveBeenCalledWith({ to: '/request-logs' })
  })
})
