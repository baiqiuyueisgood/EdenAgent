import { performance } from 'node:perf_hooks'
import { setImmediate } from 'node:timers/promises'
import type { JsonValue } from '@eden/api'
import { jsonSnapshot } from '@eden/api'

type Payload = Record<string, JsonValue>
interface Update { kind: string; payload: Payload }
interface StreamPolicy { intervalMs?: number; maxPendingBytes?: number; maxPendingUpdates?: number }
const deltaTypes = new Set(['text_delta', 'thinking_delta', 'toolcall_delta'])
const object = (value: JsonValue | undefined): value is Payload => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Child-owned buffering: one batch in flight, one latest snapshot and bounded accumulated deltas. */
export class ProcessEventStream {
  private pending: Update | undefined
  private pendingSince = 0
  private pendingUpdates = 0
  private pendingDeltaBytes = 0
  private streamKey: string | undefined
  private flight: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private failure: unknown
  private failed = false
  private active = false
  private stopped = false
  private yieldedAt = performance.now()
  private readonly intervalMs: number
  private readonly maxPendingBytes: number
  private readonly maxPendingUpdates: number

  constructor(private readonly send: (kind: string, payload: JsonValue, coalesced: boolean) => Promise<void>, policy: StreamPolicy = {},
    private readonly onFailure?: (error: unknown) => void) {
    this.intervalMs = policy.intervalMs ?? 100
    this.maxPendingBytes = policy.maxPendingBytes ?? 256 * 1024
    this.maxPendingUpdates = policy.maxPendingUpdates ?? 1024
    if (![this.intervalMs, this.maxPendingBytes, this.maxPendingUpdates].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Process stream limits must be positive integers')
    }
  }

  begin(): void {
    this.assertHealthy()
    if (this.active || this.flight || this.pending) throw new Error('Process stream is still active')
    this.active = true
    this.streamKey = undefined
    this.yieldedAt = performance.now()
  }

  async event(kind: string, payload: JsonValue): Promise<void> {
    this.assertHealthy()
    const key = deltaKey(kind, payload)
    if (!key || !object(payload)) {
      await this.flush()
      await this.write(kind, payload, false)
      return
    }
    if (!this.active) throw new Error('A finished runtime cannot emit stream deltas')
    const first = key !== this.streamKey
    if (first) { await this.flush(); this.streamKey = key }
    const latest = jsonSnapshot(payload) as Payload
    if (this.pending) {
      const previous = this.pending.payload.assistantMessageEvent as Payload
      const next = latest.assistantMessageEvent as Payload
      next.delta = String(previous.delta) + String(next.delta)
    } else { this.pendingSince = performance.now(); this.pendingUpdates = 0; this.pendingDeltaBytes = 0 }
    this.pending = { kind, payload: latest }
    this.pendingUpdates++
    // Bound new deltas, not the accumulated message: a large history must never force one ACK per character.
    this.pendingDeltaBytes += Buffer.byteLength(String((payload.assistantMessageEvent as Payload).delta))
    const full = this.pendingUpdates >= this.maxPendingUpdates || this.pendingDeltaBytes >= this.maxPendingBytes
    if (full) await this.flush()
    else if (first) this.startSend()
    else this.schedule()
    if (performance.now() - this.yieldedAt >= 5) {
      await setImmediate()
      this.yieldedAt = performance.now()
    }
    this.assertHealthy()
  }

  /** All semantic/durable boundaries wait for both batches, including a currently delayed ACK. */
  async flush(): Promise<void> {
    this.clearTimer()
    this.assertHealthy()
    while (this.flight || this.pending) {
      if (!this.flight) this.startSend()
      await this.flight
      this.clearTimer()
      this.assertHealthy()
    }
    this.streamKey = undefined
  }

  async finish(): Promise<void> {
    try { await this.flush() }
    finally { this.active = false; this.clearTimer() }
  }

  stop(error: Error): void {
    this.stopped = true
    this.active = false
    this.fail(error)
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.begin()
    let result: T
    try { result = await work() }
    catch (error) {
      try { await this.finish() }
      catch (flushError) {
        if (flushError !== error) throw new AggregateError([error, flushError], 'Runtime failed while draining stream events')
      }
      throw error
    }
    await this.finish()
    return result
  }

  private startSend(): void {
    if (this.flight || !this.pending || this.failed || this.stopped) return
    this.clearTimer()
    const update = this.pending
    this.pending = undefined
    this.pendingUpdates = 0
    const flight = this.write(update.kind, update.payload, true).finally(() => {
      if (this.flight === flight) this.flight = undefined
      if (!this.failed && this.active) this.schedule()
    })
    this.flight = flight
    // The next event/boundary observes the stored failure; background sends never reject unobserved.
    void flight.catch(() => undefined)
  }

  private schedule(): void {
    if (this.timer || this.flight || !this.pending || !this.active || this.failed) return
    const remaining = Math.max(0, this.intervalMs - (performance.now() - this.pendingSince))
    this.timer = setTimeout(() => { this.timer = undefined; this.startSend() }, remaining)
    this.timer.unref()
  }

  private async write(kind: string, payload: JsonValue, coalesced: boolean): Promise<void> {
    try { await this.send(kind, payload, coalesced) }
    catch (error) { this.fail(error); throw error }
  }

  private fail(error: unknown): void {
    const first = !this.failed
    if (!this.failed) this.failure = error
    this.failed = true
    this.pending = undefined
    this.streamKey = undefined
    this.clearTimer()
    if (first) this.onFailure?.(error)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private assertHealthy(): void { if (this.failed) throw this.failure }
}

function deltaKey(kind: string, payload: JsonValue): string | undefined {
  if (kind !== 'message_update' || !object(payload) || !object(payload.message) || payload.message.role !== 'assistant') return undefined
  const stream = payload.assistantMessageEvent
  if (!object(stream) || !deltaTypes.has(String(stream.type)) || typeof stream.delta !== 'string') return undefined
  return JSON.stringify([payload.messageId ?? null, payload.actor ?? null, stream.type, stream.contentIndex ?? null])
}
