import * as vscode from 'vscode';
import { Telemetry } from './Telemetry';

/**
 * First-run consent prompt. Non-blocking — fires asynchronously so it
 * never holds up activation. Shows only once; subsequent runs honor the
 * stored decision.
 *
 * On Open VSX / fork hosts (VSCodium, Cursor, Windsurf, Antigravity) the
 * audience skews privacy-conscious so we always ask before sending.
 */
export async function maybePromptForConsent(telemetry: Telemetry): Promise<void> {
	const state = telemetry.consentState();
	if (state !== 'unanswered') {
		return;
	}

	telemetry.track('consent.prompted', { trigger: 'first-run' });

	const PRIVACY_URL = 'https://github.com/ekontoTURBO/vibe-check/blob/main/PRIVACY.md';
	const choice = await vscode.window.showInformationMessage(
		'Vibe Check would like to send anonymous usage events to help improve the extension. ' +
			'No code, no file contents, no API keys, no personal info — just counts and timings. ' +
			"You can change this anytime via 'Vibe Check: Telemetry Settings'.",
		{ modal: false },
		'Allow',
		'No thanks',
		'See what we collect'
	);

	if (choice === 'Allow') {
		await telemetry.grant('first-run');
	} else if (choice === 'No thanks') {
		await telemetry.deny('first-run');
	} else if (choice === 'See what we collect') {
		await vscode.env.openExternal(vscode.Uri.parse(PRIVACY_URL));
		// Re-prompt on the next activation since they didn't decide yet.
	}
}

/**
 * Command handler for the explicit "Telemetry Settings…" command. Lets
 * users opt in/out at any time after first run.
 */
export async function showTelemetrySettings(telemetry: Telemetry): Promise<void> {
	const current = telemetry.consentState();
	const items: Array<vscode.QuickPickItem & { value: 'grant' | 'deny' | 'reset' | 'view' }> = [
		{
			label: current === 'granted' ? '$(check) Allow anonymous telemetry' : 'Allow anonymous telemetry',
			description: 'Counts, timings, host, ext version. No code or personal info.',
			value: 'grant',
		},
		{
			label: current === 'denied' ? '$(check) Disable telemetry' : 'Disable telemetry',
			description: 'No events leave your machine. Existing queue is dropped.',
			value: 'deny',
		},
		{
			label: 'View privacy policy',
			description: 'See the full list of fields we collect',
			value: 'view',
		},
		{
			label: 'Reset (ask me again next session)',
			value: 'reset',
		},
	];
	const pick = await vscode.window.showQuickPick(items, {
		title: 'Vibe Check — Telemetry',
		placeHolder: `Currently: ${current}`,
	});
	if (!pick) {
		return;
	}
	switch (pick.value) {
		case 'grant':
			await telemetry.grant('command');
			vscode.window.showInformationMessage('Vibe Check: anonymous telemetry enabled. Thanks!');
			return;
		case 'deny':
			await telemetry.deny('command');
			vscode.window.showInformationMessage('Vibe Check: telemetry disabled. Pending events dropped.');
			return;
		case 'reset':
			await telemetry.resetConsent();
			vscode.window.showInformationMessage('Vibe Check: telemetry reset — you will be prompted on next activation.');
			return;
		case 'view':
			await vscode.env.openExternal(
				vscode.Uri.parse('https://github.com/ekontoTURBO/vibe-check/blob/main/PRIVACY.md')
			);
			return;
	}
}
