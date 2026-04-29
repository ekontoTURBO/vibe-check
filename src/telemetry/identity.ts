import * as vscode from 'vscode';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { EnvironmentDetector, Host } from '../EnvironmentDetector';

const ANON_ID_KEY = 'vibeCheck.telemetry.anonId.v1';

export interface IdentityFingerprint {
	anonId: string;
	sessionId: string;
	host: Host;
	appName: string;
	appVersion: string;
	extVersion: string;
	osPlatform: string;
}

/**
 * Stable per-installation identity used for analytics. Anonymous — never
 * incorporates `os.userInfo()`, hostname, machineId, or anything that could
 * be deanonymized. Persists across activations via globalState.
 */
export class TelemetryIdentity {
	private cached: IdentityFingerprint | null = null;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly extVersion: string
	) {}

	get(): IdentityFingerprint {
		if (this.cached) {
			return this.cached;
		}

		let anonId = this.context.globalState.get<string>(ANON_ID_KEY);
		if (!anonId || typeof anonId !== 'string' || anonId.length < 16) {
			anonId = randomUUID();
			void this.context.globalState.update(ANON_ID_KEY, anonId);
		}

		this.cached = {
			anonId,
			sessionId: randomUUID(),
			host: EnvironmentDetector.host(),
			appName: vscode.env.appName ?? '',
			appVersion: (vscode.version ?? '').toString(),
			extVersion: this.extVersion,
			osPlatform: os.platform(),
		};
		return this.cached;
	}

	/** Reset the anonymous id. Used when the user opts out and back in. */
	async rotate(): Promise<void> {
		const next = randomUUID();
		await this.context.globalState.update(ANON_ID_KEY, next);
		this.cached = null;
	}
}
