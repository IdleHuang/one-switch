import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AppTranslator } from '@/i18n/provider'
import { ModelTestRunner, type TestTask, type TestRunOptions } from '../lib/model-test-runner'

/**
 * 执行器的 React 绑定。
 *
 * **这里没有队列逻辑**：状态、并发、取消全在 {@link ModelTestRunner} 那个类里，
 * 这个 hook 只做三件 React 必须做的事——把类的变更订阅成渲染、在卸载时释放执行器、
 * 在调用 `run()` 时把当前语言的文案函数带进去。
 *
 * 之所以还留一层 hook 而不是让面板直接 `new` 一个执行器：执行器必须与组件同生共死
 * （用户切走页面就该掐掉在飞的请求，否则他离开了还在付费），而「什么时候创建、
 * 什么时候销毁」正是 React 的职责——那属于生命周期，不属于队列。
 */

export type { TestRunOptions, TestTask, TestTaskStatus } from '../lib/model-test-runner'

export interface ModelTestRunnerHandle {
  /** 只读：状态归执行器所有，界面改不了它。 */
  tasks: readonly TestTask[]
  running: boolean
  /** 文案函数由这一层补上，界面只管「跑哪一批、用什么参数」。 */
  run: (batch: readonly TestTask[], options: Omit<TestRunOptions, 'translate'>) => Promise<void>
  cancel: () => void
  clear: () => void
}

export function useModelTestRunner(translate: AppTranslator): ModelTestRunnerHandle {
  // 执行器跟着组件走：挂载时建一个，卸载时 `dispose()`（中断在飞的请求、退掉订阅）。
  const runner = useMemo(() => new ModelTestRunner(), [])
  useEffect(() => () => runner.dispose(), [runner])

  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot)

  const run = useCallback(
    (batch: readonly TestTask[], options: Omit<TestRunOptions, 'translate'>) => runner.run(batch, { ...options, translate }),
    [runner, translate],
  )

  const cancel = useCallback(() => runner.cancel(), [runner])
  const clear = useCallback(() => runner.clear(), [runner])

  return { tasks: snapshot.tasks, running: snapshot.running, run, cancel, clear }
}
