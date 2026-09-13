/**
 * 等待类的小工具。
 *
 * 只有两种需要：「等一会儿」与「等另一个进程退出」，都是几行代码，不值得引入依赖，
 * 也不值得做通用定时器抽象。
 */

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * 轮询直到条件成立，超时返回 `false`。
 *
 * 先判断再等待：调用时条件可能已经成立了，不该白白等一个间隔。
 * 结束前再判一次，避免恰好卡在最后一个间隔上时把「已经好了」报成超时。
 */
export async function waitFor(predicate: () => boolean, timeoutMilliseconds: number, intervalMilliseconds = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(intervalMilliseconds)
  }
  return predicate()
}
