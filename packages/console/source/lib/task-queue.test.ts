import { describe, expect, it, vi } from 'vitest'
import { runTaskQueue, type TaskOutcome } from './task-queue'

/**
 * 队列的三条约定各有一组断言：并发上限是真的、失败不互相牵连、取消之后每个任务都有结局。
 * 这里的时间由测试自己控制（手动 resolve），所以不依赖定时器，也不会有抖动。
 */

interface Deferred<R> {
  promise: Promise<R>
  resolve: (value: R) => void
  reject: (error: unknown) => void
}

function deferred<R>(): Deferred<R> {
  let resolve!: (value: R) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<R>((resolveTask, rejectTask) => {
    resolve = resolveTask
    reject = rejectTask
  })
  return { promise, resolve, reject }
}

/** 让出一次微任务，把 `await` 链推到下一个稳定点。 */
function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('runTaskQueue — 并发上限', () => {
  it('同时在飞的任务数不超过 concurrency', async () => {
    const gates = Array.from({ length: 6 }, () => deferred<number>())
    let inFlight = 0
    let peak = 0

    const queue = runTaskQueue([0, 1, 2, 3, 4, 5], {
      concurrency: 2,
      run: async task => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        const value = await gates[task].promise
        inFlight -= 1
        return value
      },
    })

    await tick()
    // 只有两个任务真的开始跑：这是「并发」而不是「分片」的分水岭。
    expect(peak).toBe(2)

    for (const [index, gate] of gates.entries()) {
      gate.resolve(index)
      await tick()
    }
    await queue
    expect(peak).toBe(2)
  })

  it('空出来的槽立刻领下一个任务，不等整片跑完', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()]
    const started: number[] = []

    const queue = runTaskQueue([0, 1, 2], {
      concurrency: 2,
      run: async task => {
        started.push(task)
        return gates[task].promise
      },
    })

    await tick()
    expect(started).toEqual([0, 1])

    // 第 0 个先结束：第 2 个应该马上接上去，而不是等第 1 个。
    gates[0].resolve('a')
    await tick()
    expect(started).toEqual([0, 1, 2])

    gates[1].resolve('b')
    gates[2].resolve('c')
    await queue
  })

  it('并发数超过任务数时不会凭空多开 worker', async () => {
    const run = vi.fn(async (task: number) => task)
    await runTaskQueue([1, 2], { concurrency: 50, run })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('并发数非法时落到 1：并发没有「不跑」这个含义', async () => {
    const gates = [deferred<number>(), deferred<number>()]
    const started: number[] = []
    const queue = runTaskQueue([0, 1], {
      concurrency: 0,
      run: async task => {
        started.push(task)
        return gates[task].promise
      },
    })

    await tick()
    expect(started).toEqual([0])

    gates[0].resolve(0)
    await tick()
    gates[1].resolve(1)
    await queue
  })

  it('空列表什么都不做', async () => {
    const run = vi.fn()
    const onSettled = vi.fn()
    await runTaskQueue([], { concurrency: 3, run, onSettled })
    expect(run).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
  })
})

describe('runTaskQueue — 结局', () => {
  it('单个任务失败不打断队列，其它任务照跑', async () => {
    const outcomes: Array<[number, TaskOutcome<number>]> = []
    await runTaskQueue([0, 1, 2], {
      concurrency: 2,
      run: async task => {
        if (task === 1) throw new Error('boom')
        return task
      },
      onSettled: (task, outcome) => outcomes.push([task, outcome]),
    })

    expect(outcomes).toHaveLength(3)
    const failed = outcomes.find(([task]) => task === 1)?.[1]
    expect(failed).toEqual({ status: 'failed', error: expect.any(Error) })
    expect(outcomes.filter(([, outcome]) => outcome.status === 'done')).toHaveLength(2)
  })

  it('每个任务恰好收尾一次，且先 onStart 后 onSettled', async () => {
    const events: string[] = []
    await runTaskQueue([0, 1, 2, 3], {
      concurrency: 3,
      run: async task => task,
      onStart: task => events.push(`start:${task}`),
      onSettled: task => events.push(`settle:${task}`),
    })

    expect(events.filter(event => event.startsWith('start:'))).toHaveLength(4)
    expect(events.filter(event => event.startsWith('settle:'))).toHaveLength(4)
    for (const task of [0, 1, 2, 3]) {
      expect(events.indexOf(`start:${task}`)).toBeLessThan(events.indexOf(`settle:${task}`))
    }
  })

  it('任务结束顺序就是完成顺序，不是入队顺序', async () => {
    const gates = [deferred<string>(), deferred<string>()]
    const settled: number[] = []
    const queue = runTaskQueue([0, 1], {
      concurrency: 2,
      run: async task => gates[task].promise,
      onSettled: task => settled.push(task),
    })

    await tick()
    gates[1].resolve('second')
    await tick()
    gates[0].resolve('first')
    await queue

    expect(settled).toEqual([1, 0])
  })
})

describe('runTaskQueue — 取消', () => {
  it('取消后不再领新任务，队列里的任务收成 cancelled', async () => {
    const controller = new AbortController()
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()]
    const outcomes = new Map<number, TaskOutcome<number>>()

    const queue = runTaskQueue([0, 1, 2], {
      concurrency: 1,
      signal: controller.signal,
      run: async task => gates[task].promise,
      onSettled: (task, outcome) => outcomes.set(task, outcome),
    })

    await tick()
    controller.abort()
    gates[0].resolve(0)
    await queue

    // 一个都没轮到的两个任务也必须各有结局，否则界面上那两行永远停在「排队的」。
    expect(outcomes.get(0)).toEqual({ status: 'cancelled' })
    expect(outcomes.get(1)).toEqual({ status: 'cancelled' })
    expect(outcomes.get(2)).toEqual({ status: 'cancelled' })
  })

  it('在飞的任务被取消时收成 cancelled，而不是 failed', async () => {
    const controller = new AbortController()
    const gate = deferred<number>()
    const outcomes: TaskOutcome<number>[] = []

    const queue = runTaskQueue([0], {
      concurrency: 1,
      signal: controller.signal,
      run: async () => gate.promise,
      onSettled: (_task, outcome) => outcomes.push(outcome),
    })

    await tick()
    controller.abort()
    // 上游通常以 abort 的形式报错退出：这不叫失败，用户自己按的取消。
    gate.reject(new Error('aborted'))
    await queue

    expect(outcomes).toEqual([{ status: 'cancelled' }])
  })

  it('一开始就已经取消时一个任务都不发', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn()
    const onSettled = vi.fn()

    await runTaskQueue([0, 1], { concurrency: 2, signal: controller.signal, run, onSettled })

    expect(run).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledWith(0, { status: 'cancelled' })
  })

  it('取消信号透传给任务，自己能中断上游请求', async () => {
    const controller = new AbortController()
    const received: AbortSignal[] = []
    const queue = runTaskQueue([0], {
      concurrency: 1,
      signal: controller.signal,
      run: async (_task, signal) => {
        received.push(signal)
        return Promise.resolve(0)
      },
    })

    await queue
    expect(received[0]).toBe(controller.signal)
  })
})
