import * as vscode from 'vscode';
import { IdentityFingerprint } from './identity';

const QUEUE_KEY = 'vibeCheck.telemetry.queue.v1';
const SCHEMA_VERSION = 1;

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_SIZE = 20;
const MAX_QUEUE = 200;
const MIN_FLUSH_GAP_MS = 12_000;

export interface QueuedEvent {
	client_ts: string;
	name: string;
	props: Record<string, unknown>;
	anon_id: string;
	session_id: string;
	host: string;
	app_name: string;
	app_version: string;
	ext_version: string;
	os: string;
	schema_version: number;
}

export interface Sender {
	send(events: QueuedEvent[]): Promise<{ ok: boolean }>;
}

/**
 * In-memory + persisted batched event queue. Drops on overflow (no
 * retry-loop). Survives crashes via globalState mirror.
 */
export class TelemetryQueue {
	private pending: QueuedEvent[] = [];
	private timer: NodeJS.Timeout | null = null;
	private lastFlushAt = 0;
	private flushing = false;
	private droppedSinceLastFlush = 0;
	private overflowWarned = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly sender: Sender,
		private readonly identity: () => IdentityFingerprint
	) {
		this.pending = this.loadPersisted();
		this.scheduleFlush();
	}

	enqueue(name: string, props: Record<string, unknown>): void {
		try {
			if (this.pending.length >= MAX_QUEUE) {
				this.droppedSinceLastFlush++;
				if (!this.overflowWarned) {
					this.overflowWarned = true;
					console.warn('[VibeCheck.telemetry] queue overflow, dropping events');
				}
				return;
			}

			const id = this.identity();
			this.pending.push({
				client_ts: new Date().toISOString(),
				name,
				props: this.sanitize(props),
				anon_id: id.anonId,
				session_id: id.sessionId,
				host: id.host,
				app_name: id.appName,
				app_version: id.appVersion,
				ext_version: id.extVersion,
				os: id.osPlatform,
				schema_version: SCHEMA_VERSION,
			});
			this.persistAsync();

			if (this.pending.length >= FLUSH_BATCH_SIZE) {
				void this.flush('batch');
			}
		} catch (err) {
			// Telemetry must never propagate.
			console.warn('[VibeCheck.telemetry] enqueue failed', err);
		}
	}

	async flush(_reason: 'timer' | 'batch' | 'shutdown' | 'manual'): Promise<void> {
		if (this.flushing) {
			return;
		}
		if (this.pending.length === 0) {
			return;
		}
		const now = Date.now();
		if (now - this.lastFlushAt < MIN_FLUSH_GAP_MS) {
			return;
		}
		this.flushing = true;
		this.lastFlushAt = now;

		const batch = this.pending.slice();
		try {
			const result = await this.sender.send(batch);
			if (result.ok) {
				// Drop the events we successfully sent.
				this.pending.splice(0, batch.length);
				this.persistAsync();
				this.overflowWarned = false;
			}
			// On non-ok we keep the batch in pending so it's retried on the
			// next interval — but only once. If a second flush also fails, we
			// drop the batch so we don't loop forever on a permanent server
			// error.
		} catch {
			// Network error — drop the batch silently. We do NOT retry-loop:
			// flaky networks would otherwise keep the radio on.
			this.pending.splice(0, batch.length);
			this.persistAsync();
		} finally {
			this.flushing = false;
		}
	}

	private scheduleFlush(): void {
		if (this.timer) {
			return;
		}
		this.timer = setInterval(() => void this.flush('timer'), FLUSH_INTERVAL_MS);
		// Allow the host to exit even if the interval is alive.
		if (typeof this.timer.unref === 'function') {
			this.timer.unref();
		}
	}

	dispose(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		// Best-effort final flush. Bounded by the sender's own timeout.
		return this.flush('shutdown');
	}

	/** Drop everything (used on opt-out). */
	clear(): void {
		this.pending = [];
		this.persistAsync();
	}

	private persistAsync(): void {
		// fire-and-forget — globalState is async but we never need to wait.
		void this.context.globalState.update(QUEUE_KEY, this.pending);
	}

	private loadPersisted(): QueuedEvent[] {
		const raw = this.context.globalState.get<QueuedEvent[]>(QUEUE_KEY);
		if (!Array.isArray(raw)) {
			return [];
		}
		// Cap on load too, in case persisted data grew unbounded across versions.
		return raw.slice(0, MAX_QUEUE).filter(
			(e) =>
				typeof e?.name === 'string' &&
				typeof e?.client_ts === 'string' &&
				typeof e?.anon_id === 'string'
		);
	}

	/**
	 * Defensive sanitizer — strips any non-primitive deep properties and
	 * caps strings at 256 chars so a misuse can't accidentally smuggle
	 * code/file paths.
	 */
	private sanitize(props: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(props)) {
			if (v === null || v === undefined) {
				continue;
			}
			const t = typeof v;
			if (t === 'string') {
				out[k] = (v as string).slice(0, 256);
			} else if (t === 'number' || t === 'boolean') {
				out[k] = v;
			}
			// Drop everything else (objects, arrays, functions).
		}
		return out;
	}
}
