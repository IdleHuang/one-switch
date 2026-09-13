/**
 * 给用户看的错误描述。
 *
 * 只取 `message`、不打栈：终端里第一眼要看到的是「哪儿失败了」，栈是给诊断日志的。
 * 各命令共用一份，避免每个文件各写一遍 `instanceof` 判断。
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
