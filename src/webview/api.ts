import type { ClientMessage } from './types';

interface VsCodeApi {
	postMessage(msg: unknown): void;
	getState<T>(): T | undefined;
	setState<T>(value: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | null = null;

function getApi(): VsCodeApi | null {
	if (cached) {
		return cached;
	}
	if (typeof acquireVsCodeApi === 'function') {
		cached = acquireVsCodeApi();
		return cached;
	}
	return null;
}

export function send(msg: ClientMessage): void {
	const api = getApi();
	if (!api) {
		console.warn('[VibeCheck webview] no vscode api', msg);
		return;
	}
	api.postMessage(msg);
}
