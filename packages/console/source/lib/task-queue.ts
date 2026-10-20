/**
 * 一个带并发上限的任务队列。
 *
 * 为什么它不是「`Promise.all` 分批」：诊断是真的请求上游、真的计费，一批里的每个任务
 * 耗时差异很大（连着挂的渠道 300ms 就回，慢的上游能拖十几秒）。按固定分片跑时，整批
 * 的节奏由最慢的那一片决定——上一片还剩一个在等，下一片已经开始跑，并发数在一段时间里
 * 是「片大小」，不是用户填的那个数。队列按「谁先空出来谁取下一个」发放任务，同时在飞
 * 的数量才真的等于 `concurrency`。
 *
 * 这个模块不认识 React，也不认识诊断：它只负责「怎么把一批任务发出去、每个任务怎么
 * 收尾」。所以它可以被单独测，界面那边只剩下状态映射。
 */

/** 一个任务的结局。`cancelled` 是**独立**结局，不是一种失败。 */
export type TaskOutcome<R> =
  | { status: 'done'; value: R }
  | { status: 'failed'; error: unknown }
  | { status: 'cancelled' }

export interface TaskQueueOptions<T, R> {
  /**
   * 同时在跑的任务上限。
   *
   * 只保留下界 1，不设上界：多少并发是用户的账单，不是界面的容量判断。
   * 取整、取不到有限值时都落到 1——并发数没有「不跑」这个含义。
   */
  concurrency: number
  /** 只影响「还要不要再取下一个」；已经在跑的任务由 `run` 拿到的同一个信号自行中断。 */
  signal?: AbortSignal
  run: (task: T, signal: AbortSignal) => Promise<R>
  /** 任务真正开始跑时回调；被取消而未开始的任务不会走到这里。 */
  onStart?: (task: T) => void
  /**
   * 收尾回调。**每个任务恰好一次**，先 `onStart` 后 `onSettled`（未开始的任务只有后者）。
   * 顺序是完成顺序，不是入队顺序——并发就是为了让它们不按顺序完成。
   */
  onSettled?: (task: T, outcome: TaskOutcome<R>) => void
}

const NEVER_CANCELLED = new AbortController().signal

/** 把用户填的并发数收成一个能用的值：至少 1，且不超过任务数。 */
function usableConcurrency(concurrency: number, taskCount: number): number {
  const requested = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1
  return Math.max(1, Math.min(requested, taskCount))
}

/**
 * 把一批任务跑完。
 *
 * 三条约定，界面侧不必再自己兜：
 *
 * 1. **一个任务的失败不会打断别的任务**：异常被收成 `{ status: 'failed' }`，队列继续发放。
 * 2. **每个任务恰好收尾一次**：中途取消时，还在队列里的任务以一个 `cancelled` 结局被排空，
 *    不会有行永远停在「进行中」。
 * 3. **取消之后不再取新任务**：取消的是「还要不要继续花用户的钱」，不是「把手上这个做完」。
 *
 * 这个函数不抛异常——调用方拿它当 `await` 用，不需要 try。
 */
export async function runTaskQueue<T, R>(tasks: readonly T[], options: TaskQueueOptions<T, R>): Promise<void> {
  if (tasks.length === 0) return
  const signal = options.signal ?? NEVER_CANCELLED
  const concurrency = usableConcurrency(options.concurrency, tasks.length)
  /** 下一个待取任务的位置。多个 worker 共享它，靠 JS 单线程的同步执行拿到互斥。 */
  let cursor = 0
  const settle = (task: T, outcome: TaskOutcome<R>) => options.onSettled?.(task, outcome)

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) return
      if (cursor >= tasks.length) return
      const task = tasks[cursor]
      cursor += 1
      options.onStart?.(task)
      // 取到任务与真正发请求之间还隔着一次状态更新，期间可能已经被取消：这一格直接收成取消，
      // 不要发出去再回滚（那是一次真实的费用）。
      if (signal.aborted) {
        settle(task, { status: 'cancelled' })
        return
      }
      try {
        const value = await options.run(task, signal)
        settle(task, signal.aborted ? { status: 'cancelled' } : { status: 'done', value })
      } catch (error) {
        settle(task, signal.aborted ? { status: 'cancelled' } : { status: 'failed', error })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))

  // 取消后被留在队列里的那些：它们一个请求都没发出去，但也必须有结局。
  for (let index = cursor; index < tasks.length; index += 1) settle(tasks[index], { status: 'cancelled' })
}
