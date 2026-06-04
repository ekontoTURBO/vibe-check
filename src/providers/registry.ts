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
	 * Builds the full priority-ordered candidate id list (before availability is
	 * checked). The user's explicit pick goes first; every other provider follows
	 * as a fallback so a runtime failure of the primary can roll over to the next.
	 */
	private candidateOrder(wanted: ProviderId | 'auto'): ProviderId[] {
		const ordered: ProviderId[] = [];
		const push = (id: ProviderId): void => {
			if (!ordered.includes(id)) {
				ordered.push(id);
			}
		};
		if (wanted !== 'auto') {
			push(wanted);
		}
		// Host-provided (zero-key) backends are the safest fallback — they need no
		// credentials and work for free inside Copilot / Antigravity / Cursor.
		for (const id of AUTO_ORDER) {
			push(id);
		}
		// Then any direct (bring-your-own-key) provider.
		for (const id of ['anthropic', 'openai', 'openrouter', 'gemini'] as ProviderId[]) {
			push(id);
		}
		return ordered;
	}

	/**
	 * Resolves the ordered list of providers that are actually usable right now,
	 * highest priority first. The first entry is the primary; the rest are live
	 * fallbacks for `LLMService` to try if the primary fails mid-request.
	 *
	 * `usedFallback` is the user's wanted id when the primary in the returned list
	 * is NOT what they explicitly asked for (so the UI can warn once).
	 */
	async resolveCandidates(): Promise<{
		providers: LLMProvider[];
		wanted: ProviderId | 'auto';
		usedFallback: ProviderId | 'auto' | null;
	}> {
		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const wanted = (cfg.get<string>('modelProvider', 'auto') || 'auto') as ProviderId | 'auto';

		const order = this.candidateOrder(wanted);
		const available: LLMProvider[] = [];
		for (const id of order) {
			const p = this.providers.get(id);
			if (p && (await p.isAvailable())) {
				available.push(p);
			}
		}

		if (available.length === 0) {
			throw new Error(
				'No language model is available. Run "Vibe Check: Configure Provider" to paste an API key (Gemini, OpenAI, Anthropic, or OpenRouter), or sign into Copilot.'
			);
		}

		const primary = available[0];
		const usedFallback =
			wanted !== 'auto' && primary.id !== wanted ? wanted : null;
		return { providers: available, wanted, usedFallback };
	}

	/**
	 * Resolves the single best provider to use, honouring the user's setting and
	 * falling back to the next available one if their pick is missing creds.
	 * Returns the resolved provider id and a human-readable note when a fallback fired.
	 */
	async resolveActive(): Promise<{ provider: LLMProvider; usedFallback: ProviderId | null }> {
		const { providers, usedFallback } = await this.resolveCandidates();
		return {
			provider: providers[0],
			usedFallback: usedFallback === 'auto' ? null : usedFallback,
		};
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
