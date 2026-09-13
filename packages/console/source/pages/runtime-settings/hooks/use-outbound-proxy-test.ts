import { useCallback, useRef, useState } from 'react'
import { outboundProxyApi, type OutboundProxyTestInput, type OutboundProxyTestResult } from '@/api/runtime'
import { localizeErrorCode } from '@/api/errors'
import { useTranslation } from '@/i18n/provider'

interface ProxyTestState {
  status: 'idle' | 'running' | 'success' | 'error'
  result?: OutboundProxyTestResult
  errorMessage?: string
}

/**
 * 探测请求的客户端超时。
 *
 * 管理服务把这次探测交给真实的代理链路，链路要是被一个黑洞地址挂住，
 * 服务端自己的超时可能比用户愿意等的久得多；没有这个计时器，按钮就只会一直转。
 */
const TEST_TIMEOUT_MILLISECONDS = 30_000

export function useOutboundProxyTest() {
  const t = useTranslation()
  const controllerRef = useRef<AbortController | null>(null)
  const [state, setState] = useState<ProxyTestState>({ status: 'idle' })

  const run = useCallback(async (input: OutboundProxyTestInput) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'running' })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, TEST_TIMEOUT_MILLISECONDS)

    try {
      const response = await outboundProxyApi.test(input, controller.signal)
      // 超时也会让上面的 `abort()` 落地，所以必须先判断超时：否则用户看到的会是
      // 「请求被取消」这类由我们自己的计时器造出来的假错误。
      if (timedOut) {
        setState({ status: 'error', errorMessage: t('settings.outboundProxy.testTimeout') })
        return
      }
      // 被下一次点击取代了，这一次的结果直接丢掉。
      if (controller.signal.aborted) return
      if (response.success) setState({ status: 'success', result: response.data })
      // 服务端只发英文诊断，这里按 errorCode 本地化；带 errorParams 的模板会把上下文补回去。
      else setState({ status: 'error', errorMessage: localizeErrorCode(response.errorCode, response.errorMessage, response.errorParams) })
    } finally {
      clearTimeout(timer)
    }
  }, [t])

  return { ...state, run }
}
