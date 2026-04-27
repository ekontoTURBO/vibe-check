import * as vscode from 'vscode';
import { EnvironmentDetector } from './EnvironmentDetector';

export interface LLMRequest {
	system: string;
	user: string;
	maxTokens?: number;
}

export class LLMService {
	private cancellation = new vscode.CancellationTokenSource();

	async complete(req: LLMRequest): Promise<string> {
		const env = EnvironmentDetector.detect();

		if (env === 'antigravity') {
			const result = await this.callAntigravity(req);
			if (result !== null) {
				return result;
			}
		}

		return this.callVscodeLM(req);
	}

	private async callAntigravity(req: LLMRequest): Promise<string | null> {
		const ag = EnvironmentDetector.getAntigravity();
		if (!ag?.ai?.generateText) {
			return null;
		}
		try {
			const out = await ag.ai.generateText({
				model: 'gemini-3-flash',
				prompt: `${req.system}\n\n---\n\n${req.user}`,
			});
			return out.text;
		} catch (err) {
			console.error('[VibeCheck] Antigravity LLM failed, falling back:', err);
			return null;
		}
	}

	private async callVscodeLM(req: LLMRequest): Promise<string> {
		const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
		if (!lm || typeof lm.selectChatModels !== 'function') {
			throw new Error(
				'No language model available. Install GitHub Copilot or run in Antigravity.'
			);
		}

		const models = await lm.selectChatModels({
			vendor: 'copilot',
			family: 'gpt-4o',
		});

		const model = models[0] ?? (await lm.selectChatModels({ vendor: 'copilot' }))[0];
		if (!model) {
			throw new Error('No Copilot chat model selected. Sign into Copilot to enable.');
		}

		const messages = [
			vscode.LanguageModelChatMessage.User(`${req.system}\n\n${req.user}`),
		];

		const response = await model.sendRequest(
			messages,
			{},
			this.cancellation.token
		);

		let text = '';
		for await (const chunk of response.text) {
			text += chunk;
		}
		return text;
	}

	dispose(): void {
		this.cancellation.cancel();
		this.cancellation.dispose();
	}
}
