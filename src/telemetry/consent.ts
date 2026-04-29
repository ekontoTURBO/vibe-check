import * as vscode from 'vscode';

export type ConsentState = 'unanswered' | 'granted' | 'denied';

const CONSENT_DECISION_KEY = 'vibeCheck.telemetry.consent.v1';

/**
 * Dual-gate consent. We honor BOTH:
 * - `vscode.env.isTelemetryEnabled` (host-level — must be true)
 * - `vibeCheck.telemetry.enabled` (our own — must be true)
 *
 * The default for our own setting is `null` (unanswered) so we can prompt
 * once on first activation. After that the user's stored decision is
 * authoritative until they change it via the toggle command.
 */
export class TelemetryConsent {
	constructor(private readonly context: vscode.ExtensionContext) {}

	state(): ConsentState {
		// Host-level OFF wins over everything.
		if (!vscode.env.isTelemetryEnabled) {
			return 'denied';
		}

		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const setting = cfg.get<boolean | null>('telemetry.enabled', null);
		if (setting === false) {
			return 'denied';
		}
		if (setting === true) {
			return 'granted';
		}

		// Setting is null/undefined — fall back to one-time decision (in case
		// the user clicked through the prompt but the setting write was racy).
		const stored = this.context.globalState.get<ConsentState>(CONSENT_DECISION_KEY);
		if (stored === 'granted' || stored === 'denied') {
			return stored;
		}
		return 'unanswered';
	}

	async grant(): Promise<void> {
		await this.context.globalState.update(CONSENT_DECISION_KEY, 'granted');
		await vscode.workspace
			.getConfiguration('vibeCheck')
			.update('telemetry.enabled', true, vscode.ConfigurationTarget.Global);
	}

	async deny(): Promise<void> {
		await this.context.globalState.update(CONSENT_DECISION_KEY, 'denied');
		await vscode.workspace
			.getConfiguration('vibeCheck')
			.update('telemetry.enabled', false, vscode.ConfigurationTarget.Global);
	}

	async reset(): Promise<void> {
		await this.context.globalState.update(CONSENT_DECISION_KEY, undefined);
		await vscode.workspace
			.getConfiguration('vibeCheck')
			.update('telemetry.enabled', undefined, vscode.ConfigurationTarget.Global);
	}

	/**
	 * True iff we're allowed to send a single event right now. Cheap — call
	 * before every send.
	 */
	allowed(): boolean {
		return this.state() === 'granted';
	}
}
