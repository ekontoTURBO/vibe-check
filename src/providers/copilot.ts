import * as vscode from 'vscode';
import { CompleteOptions, LLMProvider, LLMRequest } from './types';

/**
 * Provider for VS Code's built-in language model API (`vscode.lm`).
 * Used by Copilot in VS Code, and by Antigravity / Cursor / Windsurf for their built-in AI
 * (each registers under its own vendor name). Tries `copilot` first, then any vendor.
 */
export class CopilotProvider implements LLMProvider {
	readonly id = 'copilot' as const;
	readonly label = 'VS Code LM (Copilot / built-in AI)';
	readonly requiresApiKey = false;
	readonly defaultModel = 'gpt-4o';

	private cancellation = new vscode.CancellationTokenSource();

	async isAvailable(): Promise<boolean> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm || typeof lm.selectChatModels !== 'function') {
			return false;
		}
		try {
			let models = await lm.selectChatModels({ vendor: 'copilot' });
			if (models.length === 0) {
				// In Antigravity / Cursor / Windsurf etc., the built-in AI registers
				// under a different vendor — try any vendor as fallback.
				models = await lm.selectChatModels();
			}
			return models.length > 0;
		} catch {
			return false;
		}
	}

	async complete(req: LLMRequest, opts?: CompleteOptions): Promise<string> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm || typeof lm.selectChatModels !== 'function') {
			throw new Error('VS Code LM API unavailable. No built-in AI in this host.');
		}
		const family = (opts?.model && opts.model.trim()) || this.defaultModel;
		// Selection order: copilot+family → copilot any → any vendor any family
		let models = await lm.selectChatModels({ vendor: 'copilot', family });
		if (models.length === 0) {
			models = await lm.selectChatModels({ vendor: 'copilot' });
		}
		if (models.length === 0) {
			models = await lm.selectChatModels({ family });
		}
		if (models.length === 0) {
			models = await lm.selectChatModels();
		}
		const model = models[0];
		if (!model) {
			throw new Error(
				'No VS Code language model available. Install GitHub Copilot, or run inside an editor that ships a built-in AI.'
			);
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
		// List ALL available vendors and their families
		const models = await lm.selectChatModels();
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
