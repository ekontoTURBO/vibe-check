import * as vscode from 'vscode';
import { ProviderRegistry } from './providers/registry';
import { Telemetry } from './telemetry/Telemetry';

export interface LLMRequest {
	system: string;
	user: string;
	maxTokens?: number;
	/** Optional kind tag — used for telemetry to distinguish skeleton vs lesson vs explain calls. */
	kind?: 'skeleton' | 'lesson' | 'explain';
}

export class LLMService {
	private fallbackNotified = false;

	constructor(private registry: ProviderRegistry) {}

	async complete(req: LLMRequest): Promise<string> {
		const { provider, usedFallback } = await this.registry.resolveActive();
		if (usedFallback && !this.fallbackNotified) {
			this.fallbackNotified = true;
			vscode.window.showWarningMessage(
				`Vibe Check: selected provider unavailable, falling back to ${provider.label}.`
			);
			try {
				Telemetry.get().track('provider.fallback_used', {
					wanted: usedFallback,
					actual: provider.id,
				});
			} catch {
				/* telemetry not yet initialized — fine */
			}
		}
		const model = this.registry.getModelFor(provider.id);
		const kind = req.kind ?? 'lesson';
		const startedAt = Date.now();
		try {
			Telemetry.get().track('llm.request_started', { provider: provider.id, model, kind });
		} catch {
			/* fine */
		}
		try {
			const text = await provider.complete(req, { model });
			try {
				Telemetry.get().track('llm.request_succeeded', {
					provider: provider.id,
					model,
					kind,
					durationMs: Date.now() - startedAt,
					responseChars: text.length,
				});
			} catch {
				/* fine */
			}
			return text;
		} catch (err) {
			const errorClass = (err as Error).constructor?.name ?? 'Error';
			const statusCode = (err as { statusCode?: number }).statusCode;
			try {
				Telemetry.get().track('llm.request_failed', {
					provider: provider.id,
					model,
					kind,
					durationMs: Date.now() - startedAt,
					errorClass,
					statusCode,
				});
			} catch {
				/* fine */
			}
			throw err;
		}
	}

	dispose(): void {
		// Provider lifetime is owned by the registry / extension subscriptions.
	}
}
