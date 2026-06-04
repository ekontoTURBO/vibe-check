import * as vscode from 'vscode';
import { ProviderRegistry } from './providers/registry';
import { LLMProvider } from './providers/types';
import { Telemetry } from './telemetry/Telemetry';

export interface LLMRequest {
	system: string;
	user: string;
	maxTokens?: number;
	/** Optional kind tag — used for telemetry to distinguish skeleton vs lesson vs explain calls. */
	kind?: 'skeleton' | 'lesson' | 'explain';
	/**
	 * When true, instructs the underlying provider to emit strict JSON via
	 * its native JSON mode (Gemini `responseMimeType`, OpenAI
	 * `response_format`). Forwarded through to provider.complete().
	 */
	expectJson?: boolean;
}

/** Network/transport hiccups worth one automatic retry before giving up on a provider. */
const TRANSIENT_PATTERN =
	/\b(408|425|429|500|502|503|504)\b|timed? ?out|timeout|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|overloaded|temporarily/i;

const RETRY_DELAY_MS = 500;

function isTransient(err: unknown): boolean {
	const msg = (err as Error)?.message ?? '';
	return TRANSIENT_PATTERN.test(msg);
}

function track(name: Parameters<Telemetry['track']>[0], props: object): void {
	try {
		Telemetry.get().track(name, props as Parameters<Telemetry['track']>[1]);
	} catch {
		/* telemetry not initialized — fine */
	}
}

export class LLMService {
	/** Provider pairs we've already warned the user about this session (avoid toast spam). */
	private notifiedFallbacks = new Set<string>();

	constructor(private registry: ProviderRegistry) {}

	/**
	 * Completes a request against the best available provider, automatically rolling
	 * over to the next configured provider if one fails mid-request (bad key, rate
	 * limit, model outage). Each provider gets one retry on a transient error before
	 * we move on. Only when EVERY available provider fails do we surface an error —
	 * so a single flaky backend never dead-ends the user.
	 */
	async complete(req: LLMRequest): Promise<string> {
		const { providers, usedFallback } = await this.registry.resolveCandidates();
		const kind = req.kind ?? 'lesson';

		// The user's explicit pick wasn't available at all (no key / wrong host) and we
		// silently resolved to something else — warn once so they understand the switch.
		if (usedFallback) {
			this.warnOnce(
				`${usedFallback}→${providers[0].id}`,
				`Vibe Check: "${usedFallback}" isn't configured — using ${providers[0].label} instead. Run "Vibe Check: Configure Provider" to set it up.`
			);
			track('provider.fallback_used', { wanted: usedFallback, actual: providers[0].id });
		}

		const failures: string[] = [];
		for (let i = 0; i < providers.length; i++) {
			const provider = providers[i];
			try {
				return await this.attempt(provider, req, kind);
			} catch (err) {
				const msg = (err as Error).message;
				failures.push(`${provider.label}: ${msg}`);
				const next = providers[i + 1];
				if (next) {
					// Roll over to the next available provider.
					track('provider.fallback_used', { wanted: provider.id, actual: next.id });
					this.warnOnce(
						`runtime:${provider.id}→${next.id}`,
						`Vibe Check: ${provider.label} failed (${shortReason(msg)}) — falling back to ${next.label}.`
					);
				}
			}
		}

		throw new Error(
			`All available providers failed. ${failures.join(' · ')}. Check your API key / quota, or run "Vibe Check: Configure Provider".`
		);
	}

	/** One provider call, with a single retry on transient failure. */
	private async attempt(
		provider: LLMProvider,
		req: LLMRequest,
		kind: 'skeleton' | 'lesson' | 'explain'
	): Promise<string> {
		const model = this.registry.getModelFor(provider.id);
		let lastErr: unknown;
		for (let tryIndex = 0; tryIndex < 2; tryIndex++) {
			const startedAt = Date.now();
			track('llm.request_started', { provider: provider.id, model, kind });
			try {
				const text = await provider.complete(req, { model });
				if (!text || !text.trim()) {
					throw new Error('Empty response from model.');
				}
				track('llm.request_succeeded', {
					provider: provider.id,
					model,
					kind,
					durationMs: Date.now() - startedAt,
					responseChars: text.length,
				});
				return text;
			} catch (err) {
				lastErr = err;
				const errorClass = (err as Error).constructor?.name ?? 'Error';
				const statusCode = (err as { statusCode?: number }).statusCode;
				track('llm.request_failed', {
					provider: provider.id,
					model,
					kind,
					durationMs: Date.now() - startedAt,
					errorClass,
					statusCode,
				});
				// Retry once on a transient error; otherwise fail this provider immediately.
				if (tryIndex === 0 && isTransient(err)) {
					await delay(RETRY_DELAY_MS);
					continue;
				}
				throw err;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	private warnOnce(key: string, message: string): void {
		if (this.notifiedFallbacks.has(key)) {
			return;
		}
		this.notifiedFallbacks.add(key);
		vscode.window.showWarningMessage(message);
	}

	dispose(): void {
		// Provider lifetime is owned by the registry / extension subscriptions.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Trim a provider error to something short enough for a toast. */
function shortReason(msg: string): string {
	const status = msg.match(/\b(4\d\d|5\d\d)\b/);
	if (status) {
		return `HTTP ${status[1]}`;
	}
	return msg.length > 60 ? msg.slice(0, 57) + '…' : msg;
}
