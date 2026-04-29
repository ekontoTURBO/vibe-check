import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { QueuedEvent, Sender } from './queue';

const REQUEST_TIMEOUT_MS = 6000;

export interface TransportConfig {
	url: string;
	anonKey: string;
}

/**
 * POSTs a batch of events to a Supabase REST `/rest/v1/events` endpoint.
 * The anon key is INSERT-only via Row Level Security, so leaking this
 * key (it ships in the extension bundle) cannot read or modify data.
 */
export class SupabaseSender implements Sender {
	constructor(private readonly cfg: TransportConfig) {}

	async send(events: QueuedEvent[]): Promise<{ ok: boolean }> {
		if (events.length === 0) {
			return { ok: true };
		}
		if (!this.cfg.url || !this.cfg.anonKey) {
			return { ok: false };
		}
		if (this.cfg.url === 'disabled') {
			return { ok: false };
		}

		const body = JSON.stringify(events);
		let parsed: URL;
		try {
			parsed = new URL(this.cfg.url);
		} catch {
			return { ok: false };
		}

		return new Promise((resolve) => {
			const lib = parsed.protocol === 'http:' ? http : https;
			const req = lib.request(
				{
					method: 'POST',
					hostname: parsed.hostname,
					port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
					path: parsed.pathname + parsed.search,
					headers: {
						'Content-Type': 'application/json',
						'apikey': this.cfg.anonKey,
						'Authorization': `Bearer ${this.cfg.anonKey}`,
						'Prefer': 'return=minimal',
						'Content-Length': Buffer.byteLength(body),
					},
					timeout: REQUEST_TIMEOUT_MS,
				},
				(res) => {
					// Drain the response so the socket can be released.
					res.on('data', () => {});
					res.on('end', () => {
						const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
						resolve({ ok });
					});
				}
			);

			req.on('timeout', () => {
				req.destroy();
				resolve({ ok: false });
			});
			req.on('error', () => {
				resolve({ ok: false });
			});

			req.write(body);
			req.end();
		});
	}
}

/**
 * No-op sender. Used when consent is denied or transport is misconfigured.
 */
export class NullSender implements Sender {
	async send(): Promise<{ ok: boolean }> {
		return { ok: true };
	}
}
