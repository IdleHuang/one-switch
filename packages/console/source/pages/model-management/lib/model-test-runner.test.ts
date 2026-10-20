import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { ModelTestRunner, type TestTask, type TestRunOptions } from './model-test-runner'

/*
 * 诊断执行器。
 *
 * 这一层的每一行都关系到**用户的钱**——每个任务都是一次真实的上游请求、真的计费。
 * 执行器是一个普通类，所以这些约定可以在**没有 React** 的情况下直接钉住：
 *
 * 1. 同一个时刻只有一批在跑（连点两下不能打两批出去）；
 * 2. 取消是「不再继续花钱」，不是「把手上这个做完」，而且取消**不是失败**；
 * 3. 每一行都收尾，不会有行永远停在「进行中」；
 * 4. 结论只看服务端给的那一份，界面不自己重算。
 *
 * 并发本身由 `@/lib/task-queue` 负责（那一份有自己的单测），这里只验证它被真的接上了。
 */

vi.mock('@/api/tools', () => ({ modelTestApi: { run: vi.fn() } }))

const { modelTestApi } = await import('@/api/tools')

const runMock = vi.mocked(modelTestApi.run)

/** 一次「已经发出去、还没回来」的请求。测试自己决定它什么时候回、回什么。 */
interface InFlight {
  modelId: string
  signal: AbortSignal | undefined
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

let inFlight: InFlight[] = []

/** 让 `modelTestApi.run` 挂住，把控制器交给测试。 */
function holdRequests() {
  const held: typeof modelTestApi.run = (_protocol, _mode, filters, _options, signal) => new Promise((resolve, reject) => {
    inFlight.push({
      modelId: filters?.modelIds?.[0] ?? '',
      signal,
      resolve: resolve as (value: unknown) => void,
      reject,
    })
  })
  runMock.mockImplementation(held)
}

function success(modelId: string, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      results: [{
        modelId,
        modelName: modelId,
        providerId: 'prov_1',
        providerName: '示例渠道',
        mode: 'connectivity',
        success: true,
        durationMilliseconds: 120,
        statusCode: 200,
        ...overrides,
      }],
    },
  }
}

function task(overrides: Partial<TestTask> = {}): TestTask {
  const modelId = overrides.modelId ?? 'm1'
  return {
    id: `${modelId}:openai-completions`,
    modelId,
    modelName: modelId,
    providerId: 'prov_1',
    providerName: '示例渠道',
    protocol: 'openai-completions',
    converted: false,
    status: 'queued',
    ...overrides,
  }
}

const zh = createAppTranslator('zh-CN')

const OPTIONS: TestRunOptions = { mode: 'connectivity', concurrency: 2, rounds: 1, prompt: '', inputLength: 0, translate: zh }

/** 等一轮微任务，让被 `await` 的链路往下走。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  inFlight = []
  runMock.mockReset()
})

describe('开跑', () => {
  it('把整批任务摆进表里，成功的那几行就地变成结论', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)

    expect(runner.getSnapshot().running).toBe(true)
    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['running'])
    // 服务端一次只测一个目标：筛选必须收窄到这一行的那一个模型。
    expect(runMock.mock.calls[0][2]).toEqual({ providerIds: ['prov_1'], modelIds: ['m1'] })

    inFlight[0].resolve(success('m1'))
    await tick()

    expect(runner.getSnapshot().running).toBe(false)
    expect(runner.getSnapshot().tasks[0]).toMatchObject({ status: 'success', errorMessage: undefined })
    expect(runner.getSnapshot().tasks[0].result?.statusCode).toBe(200)
  })

  it('同时在飞的数量等于用户填的并发数，空出一个槽立刻补下一个', async () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const batch = ['m1', 'm2', 'm3', 'm4'].map(modelId => task({ modelId }))

    void runner.run(batch, { ...OPTIONS, concurrency: 2 })

    // 4 个任务、并发 2：一开始只飞 2 个，不是「分两片一次飞 2 个」也不是一次全飞。
    expect(inFlight.map(item => item.modelId)).toEqual(['m1', 'm2'])

    // 第一个回来，第三个立刻接上——槽位是「谁空出来谁取」，不是等整片跑完。
    inFlight[0].resolve(success('m1'))
    await tick()
    expect(inFlight.map(item => item.modelId)).toEqual(['m1', 'm2', 'm3'])
    expect(runner.getSnapshot().tasks[2].status).toBe('running')

    inFlight[1].resolve(success('m2'))
    await tick()
    inFlight[2].resolve(success('m3'))
    await tick()
    inFlight[3].resolve(success('m4'))
    await tick()

    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['success', 'success', 'success', 'success'])
    expect(runner.getSnapshot().running).toBe(false)
  })

  it('连点两下只跑一批：诊断会计费，第二下必须被同步闸门挡掉', () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const batch = ['m1', 'm2'].map(modelId => task({ modelId }))

    void runner.run(batch, OPTIONS)
    void runner.run(batch, OPTIONS)

    // 第一次已经占满 2 个槽；第二次如果没被挡住，这里会是 4 次调用。
    expect(runMock).toHaveBeenCalledTimes(2)
  })

  it('空批次什么也不做，不会闪一下「进行中」', async () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const listener = vi.fn()
    runner.subscribe(listener)

    await runner.run([], OPTIONS)

    expect(runMock).not.toHaveBeenCalled()
    expect(runner.getSnapshot()).toEqual({ tasks: [], running: false })
    expect(listener).not.toHaveBeenCalled()
  })

  it('重测就地刷新那几行，其它行的结论原样保留', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task({ modelId: 'm1' }), task({ modelId: 'm2' })], OPTIONS)
    inFlight[0].resolve(success('m1'))
    await tick()
    inFlight[1].resolve({ success: false, errorCode: 'NETWORK_ERROR', errorMessage: '连接被重置' })
    await tick()

    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['success', 'failed'])

    // 只重跑失败的那一行。
    void runner.run(runner.getSnapshot().tasks.filter(item => item.status === 'failed'), OPTIONS)
    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['success', 'running'])

    inFlight[2].resolve(success('m2'))
    await tick()

    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['success', 'success'])
    // 行数没变：重测是就地刷新，不是追加一轮结果。
    expect(runner.getSnapshot().tasks).toHaveLength(2)
    expect(runner.getSnapshot().tasks[0].result?.statusCode).toBe(200)
  })
})

describe('结论映射', () => {
  it('请求本身失败（网络、超时、5xx 被包成错误响应）算失败，并带上原话', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    inFlight[0].resolve({ success: false, errorCode: 'NETWORK_ERROR', errorMessage: '连接被重置' })
    await tick()

    expect(runner.getSnapshot().tasks[0]).toMatchObject({ status: 'failed', errorMessage: '连接被重置' })
  })

  it('抛异常也收成失败，而不是让那一行永远停在进行中', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    inFlight[0].reject(new Error('socket hang up'))
    await tick()

    expect(runner.getSnapshot().tasks[0]).toMatchObject({ status: 'failed', errorMessage: 'socket hang up' })
    expect(runner.getSnapshot().running).toBe(false)
  })

  it('响应里没有这一行时不说「成功」：那是筛选没命中，不是测通了', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    inFlight[0].resolve({ success: true, data: { results: [] } })
    await tick()

    expect(runner.getSnapshot().tasks[0]).toMatchObject({
      status: 'failed',
      errorMessage: zh('modelTest.error.missingEndpoint'),
    })
    expect(runner.getSnapshot().tasks[0].result).toBeUndefined()
  })
})

describe('取消', () => {
  it('取消后排队与在飞的行都收成 cancelled，一个都不留在进行中', async () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const batch = ['m1', 'm2', 'm3'].map(modelId => task({ modelId }))

    void runner.run(batch, { ...OPTIONS, concurrency: 1 })
    expect(inFlight).toHaveLength(1)

    runner.cancel()
    // 在飞的那一个真的被中断了：取消的是「还要不要继续花钱」。
    expect(inFlight[0].signal?.aborted).toBe(true)

    inFlight[0].resolve(success('m1'))
    await tick()

    // 取消不是失败：状态是 cancelled，错误清空，也不再发后续请求。
    expect(runner.getSnapshot().tasks.map(item => item.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(runner.getSnapshot().tasks.every(item => item.errorMessage === undefined)).toBe(true)
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runner.getSnapshot().running).toBe(false)
  })

  it('取消之后可以立刻重新开跑', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    runner.cancel()
    inFlight[0].resolve(success('m1'))
    await tick()

    void runner.run([task()], OPTIONS)
    inFlight[1].resolve(success('m1'))
    await tick()

    expect(runner.getSnapshot().tasks[0].status).toBe('success')
  })

  it('dispose（切走页面）时掐掉在飞的请求，避免用户已经离开还在计费', () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    runner.dispose()

    expect(inFlight[0].signal?.aborted).toBe(true)
  })

  it('dispose 之后不再通知订阅者，队列剩下的收尾也不会把状态写回去', async () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const listener = vi.fn()
    runner.subscribe(listener)

    void runner.run(['m1', 'm2'].map(modelId => task({ modelId })), OPTIONS)
    runner.dispose()
    listener.mockClear()

    inFlight[0].resolve(success('m1'))
    inFlight[1].resolve(success('m2'))
    await tick()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('清空结果表', () => {
  it('在跑时不清：那会让「进行中」的行凭空消失', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], OPTIONS)
    runner.clear()
    expect(runner.getSnapshot().tasks).toHaveLength(1)

    inFlight[0].resolve(success('m1'))
    await tick()
    runner.clear()
    expect(runner.getSnapshot().tasks).toEqual([])
  })
})

describe('订阅', () => {
  it('每次状态真的变了才通知一次，退订之后不再通知', async () => {
    holdRequests()
    const runner = new ModelTestRunner()
    const listener = vi.fn()
    const unsubscribe = runner.subscribe(listener)

    void runner.run([task()], OPTIONS)
    // 开跑：入队 + 开始跑，两次变更。
    expect(listener).toHaveBeenCalledTimes(2)

    inFlight[0].resolve(success('m1'))
    await tick()
    // 结论一轮 + 收尾一轮。
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    runner.clear()
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('快照在没变时是同一个引用：外部 store 靠它判断「不用重渲染」', async () => {
    holdRequests()
    const runner = new ModelTestRunner()

    const before = runner.getSnapshot()
    expect(runner.getSnapshot()).toBe(before)

    void runner.run([task()], OPTIONS)
    const running = runner.getSnapshot()
    expect(running).not.toBe(before)
    // 同一个状态再取一次，不能换新对象。
    expect(runner.getSnapshot()).toBe(running)

    inFlight[0].resolve(success('m1'))
    await tick()
    expect(runner.getSnapshot()).not.toBe(running)
  })
})

describe('参数透传', () => {
  it('轮次与补齐长度原样发出去，空提示词不发（让服务端按模式取默认）', () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], { ...OPTIONS, rounds: 3, inputLength: 2000, prompt: '   ' })

    expect(runMock.mock.calls[0][3]).toEqual({ rounds: 3, prompt: undefined, inputLength: 2000 })
  })

  it('自定义提示词 trim 后发出去，模式跟着这一次的选择走', () => {
    holdRequests()
    const runner = new ModelTestRunner()

    void runner.run([task()], { ...OPTIONS, mode: 'speed', prompt: '  只输出数字  ' })

    expect(runMock.mock.calls[0][1]).toBe('speed')
    expect(runMock.mock.calls[0][3]).toMatchObject({ prompt: '只输出数字' })
  })
})
