import * as vscode from 'vscode';
import {
	ALL_PROVIDERS,
	DIRECT_PROVIDERS,
	PROVIDER_KEY_URLS,
	PROVIDER_LABELS,
	ProviderId,
} from './types';
import { ProviderRegistry } from './registry';
import { Telemetry } from '../telemetry/Telemetry';

function track(name: Parameters<Telemetry['track']>[0], props: object): void {
	try {
		Telemetry.get().track(name, props as Parameters<Telemetry['track']>[1]);
	} catch {
		/* telemetry not initialized — fine */
	}
}

const CUSTOM_MODEL_PICK = '$(edit) Other…';

export function registerProviderCommands(
	context: vscode.ExtensionContext,
	registry: ProviderRegistry
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('vibeCheck.configureProvider', () =>
			configureProvider(registry)
		),
		vscode.commands.registerCommand('vibeCheck.setApiKey', () => setApiKey(registry)),
		vscode.commands.registerCommand('vibeCheck.clearApiKey', () => clearApiKey(registry)),
		vscode.commands.registerCommand('vibeCheck.selectModel', () => selectModel(registry)),
		vscode.commands.registerCommand('vibeCheck.switchProvider', () => switchProvider(registry))
	);
}

/**
 * Single guided flow: pick provider → paste API key (if needed) → pick model.
 * Replaces the old three-step "discover Set API Key, then Switch Provider, then Select Model" dance.
 */
async function configureProvider(registry: ProviderRegistry): Promise<void> {
	track('provider.configure_started', { from: 'wizard' });
	// Step 1: pick provider
	const providerItems: vscode.QuickPickItem[] = [
		{
			label: 'auto',
			description: 'Use built-in AI if available (Copilot in VS Code), else any direct provider with a key',
		},
		...ALL_PROVIDERS.map((id) => ({
			label: id,
			description: PROVIDER_LABELS[id],
		})),
	];
	const providerPick = await vscode.window.showQuickPick(providerItems, {
		title: 'Vibe Check Setup — Step 1 of 3: Pick a provider',
		placeHolder: 'Which AI backend should generate your quizzes?',
		ignoreFocusOut: true,
	});
	if (!providerPick) {
		track('provider.configure_canceled', { atStep: 'provider' });
		return;
	}
	await vscode.workspace
		.getConfiguration('vibeCheck')
		.update('modelProvider', providerPick.label, vscode.ConfigurationTarget.Global);

	if (providerPick.label === 'auto') {
		track('provider.configure_completed', { provider: 'auto', model: '' });
		vscode.window.showInformationMessage(
			'Vibe Check: provider set to auto. Configure individual providers separately as needed.'
		);
		return;
	}

	const id = providerPick.label as ProviderId;
	const provider = registry.get(id);

	// Step 2: API key (only for direct providers that need one)
	if (provider.requiresApiKey) {
		const existing = await registry.secrets.get(id);
		const action = existing
			? await vscode.window.showQuickPick(
					[
						{ label: 'Keep existing key', value: 'keep' as const },
						{ label: 'Replace with new key', value: 'replace' as const },
					],
					{
						title: `Vibe Check Setup — Step 2 of 3: ${PROVIDER_LABELS[id]} API key`,
						placeHolder: 'A key is already saved for this provider. Replace it?',
					}
			  )
			: { value: 'replace' as const };
		if (!action) {
			track('provider.configure_canceled', { atStep: 'apiKey' });
			return;
		}
		if (action.value === 'replace') {
			const url = PROVIDER_KEY_URLS[id];
			const key = await vscode.window.showInputBox({
				title: `Vibe Check Setup — Step 2 of 3: ${PROVIDER_LABELS[id]} API key`,
				prompt: url ? `Get a key at ${url}` : 'Paste your API key',
				password: true,
				ignoreFocusOut: true,
				placeHolder: 'sk-... / AIzaSy... / sk-or-... etc',
				validateInput: (v) => (v.trim().length < 8 ? 'That looks too short.' : undefined),
			});
			if (!key) {
				track('provider.configure_canceled', { atStep: 'apiKey' });
				return;
			}
			await registry.secrets.set(id, key.trim());
			track('provider.api_key_set', { provider: id });
		}
	}

	// Step 3: model
	const currentModel = registry.getModelFor(id);
	const modelItems = await loadModelItems(provider, currentModel);
	const modelPick = await vscode.window.showQuickPick(modelItems, {
		title: `Vibe Check Setup — Step 3 of 3: ${PROVIDER_LABELS[id]} model`,
		placeHolder: `Currently: ${currentModel}`,
		matchOnDescription: true,
		ignoreFocusOut: true,
	});
	if (!modelPick) {
		track('provider.configure_canceled', { atStep: 'model' });
		return;
	}

	let chosen: string;
	let isCustom = false;
	if (modelPick.label === CUSTOM_MODEL_PICK) {
		isCustom = true;
		const custom = await vscode.window.showInputBox({
			title: `${PROVIDER_LABELS[id]} — custom model id`,
			prompt: 'Enter the model id exactly as the provider expects it',
			value: currentModel,
			ignoreFocusOut: true,
		});
		if (!custom) {
			track('provider.configure_canceled', { atStep: 'model' });
			return;
		}
		chosen = custom.trim();
	} else {
		chosen = modelPick.label;
	}
	await registry.setModelFor(id, chosen);
	track('provider.model_selected', { provider: id, model: chosen, isCustom });
	track('provider.configure_completed', { provider: id, model: chosen });

	vscode.window.showInformationMessage(
		`Vibe Check: configured ${PROVIDER_LABELS[id]} with model ${chosen}. You're ready to go.`
	);
}

async function setApiKey(registry: ProviderRegistry): Promise<void> {
	const id = await pickProvider(DIRECT_PROVIDERS, 'Provider to set the API key for');
	if (!id) {
		return;
	}
	const url = PROVIDER_KEY_URLS[id];
	const existing = await registry.secrets.get(id);
	const placeholder = existing ? 'Replace existing key (input is hidden)' : 'Paste your API key';

	const key = await vscode.window.showInputBox({
		title: `${PROVIDER_LABELS[id]} — API key`,
		prompt: url ? `Get a key at ${url}` : undefined,
		password: true,
		ignoreFocusOut: true,
		placeHolder: placeholder,
		validateInput: (v) => (v.trim().length < 8 ? 'That looks too short.' : undefined),
	});
	if (!key) {
		return;
	}
	await registry.secrets.set(id, key.trim());
	track('provider.api_key_set', { provider: id });
	vscode.window.showInformationMessage(
		`Vibe Check: ${PROVIDER_LABELS[id]} key saved. Use "Vibe Check: Switch Provider…" to activate it.`
	);
}

async function clearApiKey(registry: ProviderRegistry): Promise<void> {
	const id = await pickProvider(DIRECT_PROVIDERS, 'Provider to clear the API key for');
	if (!id) {
		return;
	}
	await registry.secrets.clear(id);
	track('provider.api_key_cleared', { provider: id });
	vscode.window.showInformationMessage(`Vibe Check: cleared ${PROVIDER_LABELS[id]} key.`);
}

async function switchProvider(registry: ProviderRegistry): Promise<void> {
	const items: vscode.QuickPickItem[] = [
		{
			label: 'auto',
			description: 'Prefer Antigravity (if hosted there), else Copilot, else any direct provider with a key',
		},
		...ALL_PROVIDERS.map((id) => ({
			label: id,
			description: PROVIDER_LABELS[id],
		})),
	];
	const pick = await vscode.window.showQuickPick(items, {
		title: 'Vibe Check — Provider',
		placeHolder: 'Which backend should Vibe Check use?',
	});
	if (!pick) {
		return;
	}
	const cfg = vscode.workspace.getConfiguration('vibeCheck');
	const previous = cfg.get<string>('modelProvider', 'auto');
	await cfg.update('modelProvider', pick.label, vscode.ConfigurationTarget.Global);
	if (previous !== pick.label) {
		track('provider.switched', { from: previous, to: pick.label });
	}
	vscode.window.showInformationMessage(`Vibe Check: provider set to ${pick.label}.`);
}

async function selectModel(registry: ProviderRegistry): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('vibeCheck');
	const current = (cfg.get<string>('modelProvider', 'auto') || 'auto') as ProviderId | 'auto';

	let id: ProviderId | undefined;
	if (current === 'auto') {
		try {
			const resolved = await registry.resolveActive();
			id = resolved.provider.id;
		} catch {
			id = await pickProvider(ALL_PROVIDERS, 'Pick the provider whose model you want to set');
		}
	} else {
		id = current;
	}
	if (!id) {
		return;
	}

	const provider = registry.get(id);
	const currentModel = registry.getModelFor(id);

	const items = await loadModelItems(provider, currentModel);
	const pick = await vscode.window.showQuickPick(items, {
		title: `${provider.label} — model`,
		placeHolder: `Currently: ${currentModel}`,
		matchOnDescription: true,
	});
	if (!pick) {
		return;
	}

	let chosen: string;
	let isCustom = false;
	if (pick.label === CUSTOM_MODEL_PICK) {
		isCustom = true;
		const custom = await vscode.window.showInputBox({
			title: `${provider.label} — custom model id`,
			prompt: 'Enter the model id exactly as the provider expects it',
			value: currentModel,
			ignoreFocusOut: true,
		});
		if (!custom) {
			return;
		}
		chosen = custom.trim();
	} else {
		chosen = pick.label;
	}

	await registry.setModelFor(id, chosen);
	track('provider.model_selected', { provider: id, model: chosen, isCustom });
	vscode.window.showInformationMessage(
		`Vibe Check: ${provider.label} model set to ${chosen}.`
	);
}

async function loadModelItems(
	provider: ReturnType<ProviderRegistry['get']>,
	currentModel: string
): Promise<vscode.QuickPickItem[]> {
	const items: vscode.QuickPickItem[] = [];
	let listed: string[] | null = null;
	let listError: string | null = null;
	if (provider.listModels) {
		try {
			listed = await provider.listModels();
		} catch (err) {
			listError = (err as Error).message;
		}
	}
	const live = listed && listed.length > 0;
	const fromCurated = !live ? provider.curatedModels() : [];
	const ordered = (live ? listed! : fromCurated).slice().sort();

	for (const id of ordered) {
		items.push({
			label: id,
			description: id === currentModel ? '(current)' : undefined,
		});
	}
	if (listError) {
		items.unshift({
			label: '$(warning) Live list failed — showing curated',
			description: listError,
			kind: vscode.QuickPickItemKind.Separator,
		});
	}
	items.push({
		label: CUSTOM_MODEL_PICK,
		description: 'Type any model id the provider accepts (e.g. a brand-new release)',
	});
	return items;
}

async function pickProvider(
	pool: readonly ProviderId[],
	placeholder: string
): Promise<ProviderId | undefined> {
	const items = pool.map((id) => ({
		label: id,
		description: PROVIDER_LABELS[id],
	}));
	const pick = await vscode.window.showQuickPick(items, {
		title: 'Vibe Check',
		placeHolder: placeholder,
	});
	return pick?.label as ProviderId | undefined;
}
