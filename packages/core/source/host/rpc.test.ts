import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { createCaller, createRpcEndpoint, describeError, type RpcPort } from './rpc'
import type { HostCalls } from './protocol'

interface Pair {
  host: RpcPort
  service: RpcPort
  close(): void
}

/**
 * 一对互相连通的端口，形状与 `worker_threads` 的 `parentPort`/`Worker` 一致。
 *
 * 用真的 `MessageChannel` 而不是手搓的事件对象：消息往返的**异步性**是这层协议里
 * 最容易踩空的地方（同步 resolve 会让挂起表在错误的时间点被清空），假端口很难复现。
 */
function createPortPair(): Pair {
  const channel = new MessageChannel()
  return {
    host: channel.port1,
    service: channel.port2,
    close() {
      channel.port1.close()
      channel.port2.close()
    },
  }
}

describe('rpc endpoint', () => {
  it('round-trips a call and its result', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    const service = createRpcEndpoint(pair.service)
    service.handle('sum', params => {
      const { left, right } = params as { left: number; right: number }
      return left + right
    })

    await expect(host.call('sum', { left: 1, right: 2 })).resolves.toBe(3)
    pair.close()
  })

  it('rejects on the host when the service handler throws', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    const service = createRpcEndpoint(pair.service)
    service.handle('boom', () => {
      const error = new Error('database is locked')
      error.name = 'SqliteError'
      throw error
    })

    await expect(host.call('boom', undefined)).rejects.toMatchObject({ name: 'SqliteError' })
    pair.close()
  })

  it('reports an unknown method instead of hanging', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    createRpcEndpoint(pair.service)

    await expect(host.call('nope', undefined)).rejects.toThrow('Unknown remote method: nope')
    pair.close()
  })

  it('delivers events to every listener', () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    const service = createRpcEndpoint(pair.service)
    const seen: unknown[] = []
    host.on('tick', payload => seen.push(payload))
    host.on('tick', payload => seen.push(payload))

    service.emit('tick', { value: 1 })

    // 事件是单向的，等它真正落进端口再断言。
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(seen).toEqual([{ value: 1 }, { value: 1 }])
        pair.close()
        resolve()
      }, 20)
    })
  })

  it('keeps a failing listener from breaking the channel', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    const service = createRpcEndpoint(pair.service)
    const seen: unknown[] = []
    host.on('tick', () => {
      throw new Error('listener exploded')
    })
    host.on('tick', payload => seen.push(payload))
    service.handle('echo', params => params)

    service.emit('tick', 1)
    await expect(host.call('echo', 'still alive')).resolves.toBe('still alive')

    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(seen).toEqual([1])
    pair.close()
  })

  it('rejects pending calls when disposed', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    createRpcEndpoint(pair.service)
    const pending = host.call('never-answered', undefined)

    host.dispose(new Error('Service worker terminated'))

    await expect(pending).rejects.toThrow('Service worker terminated')
    await expect(host.call('after-dispose', undefined)).rejects.toThrow('Service worker terminated')
    pair.close()
  })

  it('refuses to send events after dispose', () => {
    const pair = createPortPair()
    const service = createRpcEndpoint(pair.service)
    const received: unknown[] = []
    pair.host.on('message', message => received.push(message))
    service.dispose(new Error('stopped'))
    service.emit('tick', 1)

    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(received).toEqual([])
        pair.close()
        resolve()
      }, 20)
    })
  })
})

describe('typed caller', () => {
  it('passes method names and payloads through', async () => {
    const pair = createPortPair()
    const host = createRpcEndpoint(pair.host)
    const service = createRpcEndpoint(pair.service)
    service.handle('secrets.get', params => {
      const { reference } = params as HostCalls['secrets.get']['params']
      return reference === 'missing' ? null : `value:${reference}`
    })

    const call = createCaller<HostCalls>(host)
    await expect(call('secrets.get', { reference: 'a' })).resolves.toBe('value:a')
    pair.close()
  })
})

describe('error serialization', () => {
  it('keeps a non-Error throw readable', () => {
    expect(describeError('disk full')).toEqual({ name: 'Error', message: 'disk full' })
  })

  it('keeps name and stack for a real error', () => {
    const serialized = describeError(new TypeError('bad shape'))
    expect(serialized.name).toBe('TypeError')
    expect(serialized.message).toBe('bad shape')
    expect(serialized.stack).toContain('bad shape')
  })
})
