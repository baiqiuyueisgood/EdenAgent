/** WSL_UTF8 handles current WSL; retain decoding for older list implementations. */
export function decodeWslListOutput(output: Buffer): string {
  const utf16 = (output[0] === 0xff && output[1] === 0xfe)
    || output.includes(0)
  return output.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\ufeff/, '')
}

export function wslDetectionFailure(error: Error & { killed?: boolean | undefined; code?: string | number | null | undefined }, stdout: Buffer, stderr: Buffer): Error {
  const timeout = error.killed && error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  const detail = [decodeWslListOutput(stderr), decodeWslListOutput(stdout)].filter(value => value.trim()).join('\n').trim().slice(0, 4096)
  const message = timeout
    ? 'WSL 发行版检测超时（5 秒）；无法确认当前状态，不代表发行版未安装。'
    : `WSL 发行版检测失败（${error.code ?? error.message}）；无法确认当前状态。`
  return Object.assign(new Error(`${message}${detail ? `\n${detail}` : ''}`, { cause: error }),
    { code: timeout ? 'WSL_DETECTION_TIMEOUT' : 'WSL_DETECTION_FAILED', toolOutcome: 'failed' })
}
