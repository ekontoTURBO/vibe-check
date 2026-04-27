import * as vscode from 'vscode';
import { ProviderRegistry } from './providers/registry';

export interface LLMRequest {
	system: string;
	user: string;
	maxTokens?: number;
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
		}
		const model = this.registry.getModelFor(provider.id);
		return provider.complete(req, { model });
	}

	dispose(): void {
		// Provider lifetime is owned by the registry / extension subscriptions.
	}
}
