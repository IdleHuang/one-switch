/**
 * 一条 `MessagePort` 上的请求/响应 + 事件。
 *
 * 宿主与服务进程的**双向**调用都走它，所以两端各建一个 endpoint：本地表（`handle`）
 * 与对端表（`call`）互不干扰，谁发起谁就占用一个自增 id。
 *
 * 不用 `child_process` 的 IPC，也不自己造帧格式，是因为这层需求本质上就是「RPC 很小、
 * 消息很少」：唯一有点讲究的是错误要能跨进程还原（见 `describeError`），以及端口消失时
 * 挂起的 Promise 必须被拒绝，否则宿主会拿着一个永不 settle 的 Promise 静默卡死——
 * 那种卡死比抛异常难查得多。
 */

/**
 * `MessagePort`、`worker_threads` 的 `Port` 与 Electron `parentPort` 都满足这个形状。
 *
 * 服务进程那边看到的 `parentPort` 消息事件带 `{ data, ports }` 外皮，剥皮在
 * `service-main.ts` 里做，不滲进这里：协议层只认「一条能收发消息的通道」。
 */
export interface RpcPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
}

/** 跨进程的错误形状。`stack` 只是给日志看的。 */
export interface SerializedError {
  name: string
  message: string
  stack?: string
}

interface RequestMessage {
  kind: 'request'
  id: number
  method: string
  params: unknown
}

interface ResultMessage {
  kind: 'result'
  id: number
  value: unknown
}

interface ErrorMessage {
  kind: 'error'
  id: number
  error: SerializedError
}

interface EventMessage {
  kind: 'event'
  name: string
  payload: unknown
}

type RpcMessage = RequestMessage | ResultMessage | ErrorMessage | EventMessage

export type RpcHandler = (params: unknown) => unknown
export type RpcListener = (payload: unknown) => void

export interface RpcEndpoint {
  call(method: string, params: unknown): Promise<unknown>
  handle(method: string, handler: RpcHandler): void
  emit(name: string, payload: unknown): void
  on(name: string, listener: RpcListener): void
  /**
   * 端口那头的进程没了（崩了、被结束了）时调用：把所有挂起的调用拒掉并清空表。
   *
   * 调用方**必须**在两侧都停稳之后再 dispose，否则会顺手拒掉一个马上就要返回的调用。
   */
  dispose(reason: Error): void
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * 把错误压成能过线的形状。
 *
 * 顺带兼容「抛了个非 Error」（字符串、undefined）：跨进程之后它会被原样丢给调用方，
 * 堆栈线索就全丢了，所以这里统一转成 Error 再序列化。
 */
export function describeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    }
  }
  return { name: 'Error', message: String(error) }
}

/**
 * 还原对端错误。
 *
 * 刻意保住 `name`：调用方常常靠它分类（`InstanceLockError`、端口占用、校验失败的处理
 * 完全不同），压成一句 message 之后这些分支就都退化成同一个笼统的「启动失败」。
 * 但拿不到构造器，所以 `instanceof` 在远端错误上不成立——要分类请看 `name`。
 */
export function reviveError(serialized: SerializedError): Error {
  const error = new Error(serialized.message)
  error.name = serialized.name
  if (serialized.stack !== undefined) error.stack = serialized.stack
  return error
}

export function createRpcEndpoint(port: RpcPort): RpcEndpoint {
  const handlers = new Map<string, RpcHandler>()
  const listeners = new Map<string, Set<RpcListener>>()
  const pending = new Map<number, PendingCall>()
  let nextId = 1
  let closedReason: Error | null = null

  async function dispatch(message: RequestMessage): Promise<void> {
    const handler = handlers.get(message.method)
    if (handler === undefined) {
      const missing: ErrorMessage = {
        kind: 'error',
        id: message.id,
        error: describeError(new Error(`Unknown remote method: ${message.method}`)),
      }
      port.postMessage(missing)
      return
    }
    try {
      const value = await handler(message.params)
      const result: ResultMessage = { kind: 'result', id: message.id, value }
      port.postMessage(result)
    } catch (error) {
      const failure: ErrorMessage = { kind: 'error', id: message.id, error: describeError(error) }
      port.postMessage(failure)
    }
  }

  port.on('message', raw => {
    const message = raw as RpcMessage
    if (message.kind === 'request') {
      void dispatch(message)
      return
    }
    if (message.kind === 'result' || message.kind === 'error') {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (call === undefined) return
      if (message.kind === 'result') call.resolve(message.value)
      else call.reject(reviveError(message.error))
      return
    }
    if (message.kind === 'event') {
      for (const listener of listeners.get(message.name) ?? []) {
        try {
          listener(message.payload)
        } catch (error) {
          // 监听器是宿主/服务自己的代码，它抛异常不该拖垮整条通道。
          console.error(`[rpc] listener failed name=${message.name}`, error)
        }
      }
    }
  })

  return {
    call(method, params) {
      if (closedReason !== null) return Promise.reject(closedReason)
      const id = nextId
      nextId += 1
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        const request: RequestMessage = { kind: 'request', id, method, params }
        port.postMessage(request)
      })
    },
    handle(method, handler) {
      handlers.set(method, handler)
    },
    emit(name, payload) {
      if (closedReason !== null) return
      const event: EventMessage = { kind: 'event', name, payload }
      port.postMessage(event)
    },
    on(name, listener) {
      const existing = listeners.get(name)
      if (existing === undefined) listeners.set(name, new Set([listener]))
      else existing.add(listener)
    },
    dispose(reason) {
      closedReason = reason
      handlers.clear()
      listeners.clear()
      for (const call of pending.values()) call.reject(reason)
      pending.clear()
    },
  }
}

type CallTable = Record<string, { params: unknown; result: unknown }>

/** 调用某个方法的返回类型。 */
type CallResult<TCalls extends CallTable, TName extends keyof TCalls & string> = TCalls[TName]['result']

/**
 * 按 `CallTable` 给 `call` 套上名字与类型。
 *
 * 手写的话每个方法都要在服务进程里写一遍 `as Promise<X>`，而这些断言一旦写错方向
 * （比如拷贝粘贴时忘了改类型）编译器不会说话，只有运行时会把一个对象当字符串用。
 */
export function createCaller<TCalls extends CallTable>(endpoint: RpcEndpoint) {
  return <TName extends keyof TCalls & string>(method: TName, params: TCalls[TName]['params']): Promise<CallResult<TCalls, TName>> =>
    endpoint.call(method, params) as Promise<CallResult<TCalls, TName>>
}
