import * as vscode from 'vscode';
import { CompleteOptions, LLMProvider, LLMRequest } from './types';

export class CopilotProvider implements LLMProvider {
	readonly id = 'copilot' as const;
	readonly label = 'GitHub Copilot (VS Code LM)';
	readonly requiresApiKey = false;
	readonly defaultModel = 'gpt-4o';

	private cancellation = new vscode.CancellationTokenSource();

	async isAvailable(): Promise<boolean> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm || typeof lm.selectChatModels !== 'function') {
			return false;
		}
		try {
			const models = await lm.selectChatModels({ vendor: 'copilot' });
			return models.length > 0;
		} catch {
			return false;
		}
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm || typeof lm.selectChatModels !== 'function') {
			throw new Error('Copilot LM API unavailable. Install GitHub Copilot.');
		}
		const family = (opts?.model && opts.model.trim()) || this.defaultModel;
		const models =
			(await lm.selectChatModels({ vendor: 'copilot', family })) ??
			(await lm.selectChatModels({ vendor: 'copilot' }));
		const model = models[0];
		if (!model) {
			throw new Error('No Copilot chat model available. Sign into Copilot.');
		}

		const messages = [vscode.LanguageModelChatMessage.User(`${req.system}\n\n${req.user}`)];
		const response = await model.sendRequest(messages, {}, this.cancellation.token);
		let text = '';
		for await (const chunk of response.text) {
			text += chunk;
		}
		return text;
	}

	curatedModels(): string[] {
		return [
			'gpt-5.5',
			'gpt-5.4-mini',
			'gpt-5',
			'gpt-4o',
			'gpt-4o-mini',
			'o3-mini',
			'claude-sonnet-4-6',
			'claude-haiku-4-5',
			'claude-3.5-sonnet',
		];
	}

	async listModels(): Promise<string[]> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm) {
			return this.curatedModels();
		}
		const models = await lm.selectChatModels({ vendor: 'copilot' });
		const families = new Set<string>();
		for (const m of models) {
			if (m.family) {
				families.add(m.family);
			}
		}
		return Array.from(families).sort();
	}

	dispose(): void {
		this.cancellation.cancel();
		this.cancellation.dispose();
	}
}
