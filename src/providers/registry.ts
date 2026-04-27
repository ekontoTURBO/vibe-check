import * as vscode from 'vscode';
import { LLMProvider, ProviderId } from './types';
import { ProviderSecrets } from './secrets';
import { CopilotProvider } from './copilot';
import { AntigravityProvider } from './antigravity';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { createOpenAIProvider, createOpenRouterProvider } from './openaiCompatible';

const AUTO_ORDER: ProviderId[] = ['antigravity', 'copilot'];

export class ProviderRegistry {
	private providers: Map<ProviderId, LLMProvider> = new Map();

	constructor(public readonly secrets: ProviderSecrets) {
		const copilot = new CopilotProvider();
		const antigravity = new AntigravityProvider();
		const anthropic = new AnthropicProvider(secrets);
		const gemini = new GeminiProvider(secrets);
		const openai = createOpenAIProvider(secrets);
		const openrouter = createOpenRouterProvider(secrets);

		for (const p of [copilot, antigravity, anthropic, gemini, openai, openrouter]) {
			this.providers.set(p.id, p);
		}
	}

	all(): LLMProvider[] {
		return Array.from(this.providers.values());
	}

	get(id: ProviderId): LLMProvider {
		const p = this.providers.get(id);
		if (!p) {
			throw new Error(`Unknown provider: ${id}`);
		}
		return p;
	}

	/**
	 * Resolves which provider to actually use, honouring the user's setting and
	 * falling back to the next available one if their pick is missing creds.
	 * Returns the resolved provider id and a human-readable note when a fallback fired.
	 */
	async resolveActive(): Promise<{ provider: LLMProvider; usedFallback: ProviderId | null }> {
		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const wanted = (cfg.get<string>('modelProvider', 'auto') || 'auto') as ProviderId | 'auto';

		if (wanted !== 'auto') {
			const p = this.providers.get(wanted as ProviderId);
			if (p && (await p.isAvailable())) {
				return { provider: p, usedFallback: null };
			}
		}

		// auto / fallback: try preferred direct providers if they have keys, then
		// AUTO_ORDER (antigravity → copilot).
		const candidates: ProviderId[] = [];
		if (wanted === 'auto') {
			// host-aware first, then any direct provider with a key
			for (const id of AUTO_ORDER) {
				candidates.push(id);
			}
			for (const id of ['anthropic', 'openai', 'openrouter', 'gemini'] as ProviderId[]) {
				if (!candidates.includes(id)) {
					candidates.push(id);
				}
			}
		} else {
			// explicit pick failed → try host providers as fallback
			for (const id of AUTO_ORDER) {
				candidates.push(id);
			}
		}

		for (const id of candidates) {
			const p = this.providers.get(id);
			if (p && (await p.isAvailable())) {
				return { provider: p, usedFallback: wanted !== 'auto' ? id : null };
			}
		}

		throw new Error(
			'No language model is available. Set an API key with "Vibe Check: Set API Key…" or sign into Copilot.'
		);
	}

	getModelFor(id: ProviderId): string {
		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const key = `${id}Model` as const;
		const value = cfg.get<string>(key, '').trim();
		return value || this.get(id).defaultModel;
	}

	async setModelFor(id: ProviderId, model: string): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		await cfg.update(`${id}Model`, model, vscode.ConfigurationTarget.Global);
	}
}
