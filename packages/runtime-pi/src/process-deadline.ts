/** Monotonic liveness deadline with one bounded opportunity to drain queued IPC. */
export class ProcessDeadline {
  private activityAt = performance.now()
  private tickAt = this.activityAt
  private readonly interval: ReturnType<typeof setInterval>
  private confirmation: ReturnType<typeof setTimeout> | undefined
  private immediate: ReturnType<typeof setImmediate> | undefined
  private stopped = false

  constructor(private readonly timeout: () => number, private readonly expired: () => void, private readonly period = 1_000) {
    this.interval = setInterval(() => this.tick(), period)
    this.interval.unref()
  }

  touch(): void {
    this.activityAt = performance.now()
    this.clearConfirmation()
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.interval)
    this.clearConfirmation()
  }

  private tick(): void {
    const now = performance.now(), hostDelayed = now - this.tickAt > this.period * 2
    this.tickAt = now
    if (this.stopped || this.confirmation || this.immediate || now - this.activityAt <= this.timeout()) return
    // Even a busy host must receive queued heartbeats/replies before deciding that the child is dead.
    // A dead child gets only this single grace period, never a fresh timeout after each host pause.
    this.confirmation = setTimeout(() => {
      this.confirmation = undefined
      this.immediate = setImmediate(() => {
        this.immediate = undefined
        if (this.stopped || performance.now() - this.activityAt <= this.timeout()) return
        this.stop()
        this.expired()
      })
      this.immediate.unref()
    }, hostDelayed ? 1_000 : 200)
    this.confirmation.unref()
  }

  private clearConfirmation(): void {
    if (this.confirmation) clearTimeout(this.confirmation)
    if (this.immediate) clearImmediate(this.immediate)
    this.confirmation = undefined
    this.immediate = undefined
  }
}
