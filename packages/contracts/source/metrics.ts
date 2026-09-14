/**
 * 请求观测指标的口径。
 *
 * 同一批数据会在三层各写一遍：SQL 聚合、接口映射、界面展示。三层各自凭印象算一遍，
 * 结果就是同一件事在不同页面显示成不同的数字。**这个文件是这些数值唯一的定义处**：
 * 谁要展示延迟和速度，都必须从这里取公式与格式，不得就地重写一份。
 *
 * 四个量的关系：
 *
 * ```
 * 尝试耗时 attemptDuration ──┬─ 首字延迟 ttft          （还没有内容的那一段）
 *                            └─ 生成时段 generation     （真正在产出 Token 的那一段）
 * ```
 *
 * 请求耗时是另一条轴：它整条链路的长度，不等于任何一次尝试的耗时。
 */

import type { RequestLogEntry, RequestLogEntryAttempt } from './schemas'

/** 一次尝试里与输出速度有关的三个值，同一条尝试记录上的同一批样本。 */
export interface OutputSpeedSample {
  /** 这次尝试产出的输出 Token；上游没报时为 `null`（没报不等于 0）。 */
  outputTokens: number | null
  /** 这次尝试的端到端耗时，即 `request_attempts.durationMilliseconds`。 */
  attemptDurationMilliseconds: number
  /** 这次尝试的首字延迟；整包响应（非流式）没有首字，为 `null`。 */
  ttftMilliseconds: number | null
}

/**
 * 服务该请求的那次尝试：尝试顺序里的**最后一条**。
 *
 * 故障转移一旦交付就停止，被放弃的尝试不会排在它后面，客户端拿到的响应或最终错误
 * 都由它产生。请求级的派生值——用量镜像、首字延迟、输出速度——都按它现算，
 * 不落库，避免出现第二份会漂移的副本。
 *
 * 取历次尝试的**最小值**是错的：被放弃的尝试从没向客户端写出过一个字节。
 */
export function servingAttemptOf(log: RequestLogEntry): RequestLogEntryAttempt | null {
  return log.attempts[log.attempts.length - 1] ?? null
}

/**
 * 一条请求的输出速度样本，口径与 {@link servingAttemptOf} 一致。
 *
 * 请求级用量本来就是服务该请求那次尝试镜像过来的一份，所以分子取请求级、分母取那次尝试，
 * 两者是同一次尝试的两个视角，不是两次统计。整条请求都没走到上游时才退回请求级总耗时，
 * 此时也没有尝试级的首字延迟可用。
 */
export function outputSpeedSampleOf(log: RequestLogEntry): OutputSpeedSample {
  const attempt = servingAttemptOf(log)
  return {
    outputTokens: log.outputTokens,
    attemptDurationMilliseconds: attempt?.durationMilliseconds ?? log.totalDurationMilliseconds,
    ttftMilliseconds: attempt ? attempt.ttftMilliseconds : log.ttftMilliseconds,
  }
}

/** 一条请求的输出速度。 */
export function requestOutputTokensPerSecond(log: RequestLogEntry): number | null {
  return outputTokensPerSecond(outputSpeedSampleOf(log))
}

/**
 * 生成时段：这次尝试里真正在产出 Token 的那段时间。
 *
 * 整包响应（非流式）没有「首字」这回事——第一批字节就是全部内容，整段都在产出。
 * 所以首字延迟缺失时按 0 处理，而不是当作「算不出来」：只有这样，流式与整包响应
 * 用的才是同一个公式，两种传输形态的速度才可比。
 *
 * 结果是时长，下限钳在 0：首字延迟记到整段耗时之外只会是采集误差，不该变成负的分母。
 */
export function generationDurationMilliseconds(attemptDurationMilliseconds: number, ttftMilliseconds: number | null): number {
  return Math.max(0, attemptDurationMilliseconds - (ttftMilliseconds ?? 0))
}

/**
 * 速度公式本体：同一批样本的输出 Token 合计 ÷ 生成时段合计。
 *
 * 单条尝试与多条尝试的平均走的都是这一步，只是合计来自一条还是多条。
 * 判据只有一条：**分子与分母必须来自同一批样本**。哪个样本进了分子，它的生成时段
 * 就必须进分母；反过来，算不出生成时段的样本的输出 Token 也不能只留在分子里，
 * 那会让比值被单方面抬高。
 *
 * 不满足时返回 `null`，而不是一个数：没有输出 Token 就是没有分子；生成时段不为正
 * 说明首字延迟已经吃掉整段耗时，这次尝试根本没在产出 Token。**分母趋近 0 不是极高速度，
 * 是没有速度**——除出来的天文数字不该被读成「很快」。
 */
export function tokensPerSecondFromTotals(outputTokens: number, generationDurationMilliseconds: number): number | null {
  if (!(outputTokens > 0) || !(generationDurationMilliseconds > 0)) return null
  return outputTokens / (generationDurationMilliseconds / 1000)
}

/**
 * 单条尝试的输出速度（TPS）：输出 Token ÷ 生成时段。
 *
 * 够不够格给出速度由 {@link tokensPerSecondFromTotals} 判定。
 */
export function outputTokensPerSecond(sample: OutputSpeedSample): number | null {
  const { outputTokens, attemptDurationMilliseconds, ttftMilliseconds } = sample
  if (outputTokens == null) return null
  return tokensPerSecondFromTotals(
    outputTokens,
    generationDurationMilliseconds(attemptDurationMilliseconds, ttftMilliseconds),
  )
}

/**
 * 一组尝试的平均输出速度。
 *
 * 用「先各自求和、再相除」，而不是「先算每条的速度、再取算术平均」。后者让每个样本等权：
 * 一次 20 Token 的短响应和一次 4000 Token 的长响应会占同样的分量，均值被短样本带着走。
 * 求和把分子与分母放在同一个口径上，长响应自然拿到它应有的权重。
 *
 * 没有任何一个样本够格时返回 `null`，而不是 0——没有速度和有速度但为零是两件事。
 */
export function averageOutputTokensPerSecond(samples: readonly OutputSpeedSample[]): number | null {
  let outputTokens = 0
  let generation = 0
  for (const sample of samples) {
    if (sample.outputTokens == null || sample.outputTokens <= 0) continue
    const duration = generationDurationMilliseconds(sample.attemptDurationMilliseconds, sample.ttftMilliseconds)
    if (!(duration > 0)) continue
    outputTokens += sample.outputTokens
    generation += duration
  }
  return tokensPerSecondFromTotals(outputTokens, generation)
}

/**
 * 延迟的展示分解：显示的数值、单位与小数位。
 *
 * {@link formatMilliseconds} 是它的文本形态，两者共用同一个「不足一秒写毫秒」的规则。
 * 需要数字动画而不是一段文本的界面用这个，避免第二条规则冒出来。
 */
export function millisecondsDisplayParts(milliseconds: number): { value: number; decimalPlaces: number; unit: 'ms' | 's' } {
  return milliseconds < 1000
    ? { value: milliseconds, decimalPlaces: 0, unit: 'ms' }
    : { value: milliseconds / 1000, decimalPlaces: 1, unit: 's' }
}

/**
 * 延迟的展示值：不足一秒写毫秒，一秒以上写秒。
 *
 * 毫秒与秒的分界点是 1000 而不是 1024：这是给人看的耗时，不是存储单位换算。
 * 没有样本时为 `—`，不写 `0ms`——「没测到」和「测得 0」必须在界面上分得开。
 */
export function formatMilliseconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const parts = millisecondsDisplayParts(value)
  return `${parts.value.toFixed(parts.decimalPlaces)}${parts.unit}`
}

/**
 * 输出速度的展示小数位：两位数以上取整，个位数保留一位小数。
 *
 * 10 以下的差别是有信息的（3.3 与 4.7 是两种速度），10 以上再带小数只剩噪声。
 */
export function outputSpeedDecimalPlaces(tokensPerSecond: number): number {
  return tokensPerSecond >= 10 ? 0 : 1
}

/**
 * 输出速度的展示值。
 *
 * 展示规则只有这一处，避免同一个数在排行榜写 `24.0`、在详情写 `24`。
 */
export function formatOutputSpeed(tokensPerSecond: number | null | undefined): string {
  if (tokensPerSecond == null || !Number.isFinite(tokensPerSecond)) return '—'
  return tokensPerSecond.toFixed(outputSpeedDecimalPlaces(tokensPerSecond))
}
