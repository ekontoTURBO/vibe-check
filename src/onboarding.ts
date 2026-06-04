import * as vscode from 'vscode';
import { Telemetry } from './telemetry/Telemetry';

const ONBOARDING_DONE_KEY = 'vibeCheck.onboarding.completed.v1';
const USER_NAME_KEY = 'vibeCheck.userName';

/** Frequency choices offered when the user opts into auto-mode (minutes between auto-quizzes). */
const FREQUENCY_CHOICES: Array<{ label: string; detail: string; minutes: number }> = [
	{
		label: '$(clock) At most once per hour',
		detail: 'Recommended — keeps token spend modest.',
		minutes: 60,
	},
	{
		label: '$(clock) At most every 4 hours',
		detail: 'Lighter touch.',
		minutes: 240,
	},
	{
		label: '$(clock) At most once per day',
		detail: 'Lowest token burn.',
		minutes: 1440,
	},
	{
		label: '$(flame) Every large insertion',
		detail: '⚠️ Highest token burn — fires on every big AI insertion.',
		minutes: 0,
	},
];

function track(name: Parameters<Telemetry['track']>[0], props: object): void {
	try {
		Telemetry.get().track(name, props as Parameters<Telemetry['track']>[1]);
	} catch {
		/* telemetry not initialized — fine */
	}
}

export function getUserName(context: vscode.ExtensionContext): string | null {
	const v = context.globalState.get<string>(USER_NAME_KEY);
	return v && v.trim() ? v.trim() : null;
}

export function hasCompletedOnboarding(context: vscode.ExtensionContext): boolean {
	return !!context.globalState.get<boolean>(ONBOARDING_DONE_KEY);
}

/**
 * First-run setup: ask the user's name, then ask whether to enable auto-mode
 * (off by default, with an explicit token-burn warning before turning it on).
 * Runs once; subsequent activations are no-ops unless invoked via the command.
 *
 * Returns `true` when it actually ran the flow (first run or forced), so the
 * caller can decide whether to chain the provider walkthrough afterwards.
 */
export async function runFirstRunOnboarding(
	context: vscode.ExtensionContext,
	opts: { force?: boolean } = {}
): Promise<boolean> {
	if (!opts.force && hasCompletedOnboarding(context)) {
		return false;
	}

	track('onboarding.started', { trigger: opts.force ? 'command' : 'first-run' });

	// Step 1 — name (optional; Escape skips).
	const existingName = getUserName(context);
	const name = await vscode.window.showInputBox({
		title: 'Welcome to Vibe Check — 1 of 2',
		prompt: 'What should I call you? (optional — press Enter to skip)',
		placeHolder: 'e.g. Eryk',
		value: existingName ?? '',
		ignoreFocusOut: true,
		validateInput: (v) => (v.length > 40 ? 'Keep it under 40 characters.' : undefined),
	});
	const trimmedName = (name ?? '').trim();
	if (trimmedName) {
		await context.globalState.update(USER_NAME_KEY, trimmedName);
	}

	// Step 2 — auto-mode question (separate, explicit, default OFF).
	const MANUAL = {
		label: '$(check) Keep it manual (recommended)',
		detail: 'You generate a quiz with the + NEW button. No tokens are spent until you click.',
	};
	const AUTO = {
		label: '$(zap) Turn on auto-mode',
		detail: '⚠️ Spends your API tokens automatically every time an AI writes a big chunk of code.',
	};
	const greeting = trimmedName ? `Nice to meet you, ${trimmedName}! ` : '';
	const modePick = await vscode.window.showQuickPick([MANUAL, AUTO], {
		title: 'Welcome to Vibe Check — 2 of 2',
		placeHolder: `${greeting}How should Vibe Check create quizzes?`,
		ignoreFocusOut: true,
	});

	let autoMode = false;
	let throttleMinutes = readThrottle();

	if (modePick === AUTO) {
		const result = await enableAutoModeFlow(context, 'onboarding');
		autoMode = result.enabled;
		throttleMinutes = result.throttleMinutes;
	} else {
		// Explicitly keep auto OFF (also covers the user pressing Escape).
		await setAutoQuiz(false);
	}

	await context.globalState.update(ONBOARDING_DONE_KEY, true);
	track('onboarding.completed', {
		nameProvided: !!trimmedName,
		autoMode,
		throttleMinutes,
	});

	const who = trimmedName ? `, ${trimmedName}` : '';
	const modeMsg = autoMode
		? `Auto-mode is ON (throttled to ${describeThrottle(throttleMinutes)}).`
		: 'Quizzes are manual — hit + NEW in the Vibe Check sidebar whenever you want one.';
	void vscode.window.showInformationMessage(`Vibe Check is ready${who}! ${modeMsg}`);

	return true;
}

/**
 * Shared "turn auto-mode on" flow: shows the token-burn warning, and on
 * confirmation lets the user pick a frequency and writes both settings.
 * Used by onboarding, the settings-toggle watcher, and the command.
 */
export async function enableAutoModeFlow(
	context: vscode.ExtensionContext,
	trigger: 'onboarding' | 'settings' | 'command'
): Promise<{ enabled: boolean; throttleMinutes: number }> {
	const confirm = await vscode.window.showWarningMessage(
		'Heads up: auto-mode spends your API tokens automatically. Every time an AI inserts a large chunk of code, Vibe Check calls your model to build a quiz — no click required. This can add up fast on metered API keys.\n\nEnable auto-mode anyway?',
		{ modal: true },
		'Enable auto-mode',
		'Keep it manual'
	);

	if (confirm !== 'Enable auto-mode') {
		await setAutoQuiz(false);
		return { enabled: false, throttleMinutes: readThrottle() };
	}

	const freqPick = await vscode.window.showQuickPick(
		FREQUENCY_CHOICES.map((c) => ({ label: c.label, detail: c.detail, minutes: c.minutes })),
		{
			title: 'Auto-mode frequency',
			placeHolder: 'How often may auto-mode fire? (you can change this later in Settings)',
			ignoreFocusOut: true,
		}
	);

	// If they cancelled the frequency step, default to the safest throttle.
	const throttleMinutes = freqPick?.minutes ?? 60;
	await setThrottle(throttleMinutes);
	await setAutoQuiz(true);
	track('onboarding.auto_mode_enabled', { trigger, throttleMinutes });
	return { enabled: true, throttleMinutes };
}

export function readThrottle(): number {
	return vscode.workspace.getConfiguration('vibeCheck').get<number>('autoQuizThrottleMinutes', 60);
}

async function setThrottle(minutes: number): Promise<void> {
	await vscode.workspace
		.getConfiguration('vibeCheck')
		.update('autoQuizThrottleMinutes', minutes, vscode.ConfigurationTarget.Global);
}

async function setAutoQuiz(on: boolean): Promise<void> {
	await vscode.workspace
		.getConfiguration('vibeCheck')
		.update('autoQuiz', on, vscode.ConfigurationTarget.Global);
}

export function describeThrottle(minutes: number): string {
	if (minutes <= 0) {
		return 'every large insertion';
	}
	if (minutes < 60) {
		return `once per ${minutes} min`;
	}
	if (minutes === 60) {
		return 'once per hour';
	}
	if (minutes < 1440) {
		return `once per ${minutes / 60} h`;
	}
	return 'once per day';
}
