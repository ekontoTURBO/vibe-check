import * as vscode from 'vscode';
import { TelemetryConsent } from './consent';
import { TelemetryIdentity } from './identity';
import { TelemetryQueue } from './queue';
import { NullSender, SupabaseSender } from './transport';
import { EventName, EventPropMap } from './events';

/**
 * Compile-time-baked Supabase REST endpoint + anon (insert-only) key.
 *
 * It's safe to ship the anon key in the bundle: Row Level Security on the
 * `events` table allows INSERT only — no SELECT, UPDATE, DELETE. A leaked
 * anon key cannot read or modify any data.
 *
 * Replace these values with your own project's URL + anon key after running
 * `supabase/migrations/0001_events.sql`. Empty values disable transport.
 */
const TELEMETRY_URL = process.env.VIBE_CHECK_TELEMETRY_URL ?? '';
const TELEMETRY_ANON_KEY = process.env.VIBE_CHECK_TELEMETRY_ANON_KEY ?? '';

export class Telemetry {
	private static instance: Telemetry | null = null;

	private readonly consent: TelemetryConsent;
	private readonly identity: TelemetryIdentity;
	private readonly queue: TelemetryQueue;
	private readonly sessionStartedAt = Date.now();

	private constructor(context: vscode.ExtensionContext) {
		const extVersion = (vscode.extensions.getExtension('cognitra.vibe-check')?.packageJSON?.version ?? 'dev') as string;
		this.consent = new TelemetryConsent(context);
		this.identity = new TelemetryIdentity(context, extVersion);

		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const overrideUrl = cfg.get<string>('telemetry.endpoint', '').trim();
		const url = overrideUrl || TELEMETRY_URL;

		const sender =
			url && url !== 'disabled' && TELEMETRY_ANON_KEY
				? new SupabaseSender({ url, anonKey: TELEMETRY_ANON_KEY })
				: new NullSender();

		this.queue = new TelemetryQueue(context, sender, () => this.identity.get());
	}

	static init(context: vscode.ExtensionContext): Telemetry {
		if (!this.instance) {
			this.instance = new Telemetry(context);
		}
		return this.instance;
	}

	static get(): Telemetry {
		if (!this.instance) {
			throw new Error('Telemetry not initialized — call Telemetry.init() first.');
		}
		return this.instance;
	}

	/**
	 * Record a single anonymous event. Synchronous, never throws, never
	 * awaits the network. Drops silently when consent is denied.
	 */
	track<K extends EventName>(name: K, props: EventPropMap[K]): void {
		try {
			if (!this.consent.allowed()) {
				return;
			}
			this.queue.enqueue(name, props as Record<string, unknown>);
		} catch (err) {
			console.warn('[VibeCheck.telemetry] track failed', err);
		}
	}

	consentState(): ReturnType<TelemetryConsent['state']> {
		return this.consent.state();
	}

	async grant(trigger: 'first-run' | 'command'): Promise<void> {
		await this.consent.grant();
		this.track('consent.granted', { trigger });
	}

	async deny(trigger: 'first-run' | 'command'): Promise<void> {
		// Track the denial *before* we flip the gate, otherwise it'd be dropped.
		this.track('consent.denied', { trigger });
		await this.queue.flush('manual');
		await this.consent.deny();
		this.queue.clear();
	}

	async resetConsent(): Promise<void> {
		await this.consent.reset();
	}

	async dispose(): Promise<void> {
		try {
			this.track('extension.deactivated', {
				sessionDurationMs: Date.now() - this.sessionStartedAt,
			});
			await this.queue.dispose();
		} catch (err) {
			console.warn('[VibeCheck.telemetry] dispose failed', err);
		}
	}
}
