import * as vscode from 'vscode';
import {
	ALL_PROVIDERS,
	DIRECT_PROVIDERS,
	PROVIDER_KEY_URLS,
	PROVIDER_LABELS,
	ProviderId,
} from './types';
import { ProviderRegistry } from './registry';

const CUSTOM_MODEL_PICK = '$(edit) Other…';

export function registerProviderCommands(
	context: vscode.ExtensionContext,
	registry: ProviderRegistry
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('vibeCheck.setApiKey', () => setApiKey(registry)),
		vscode.commands.registerCommand('vibeCheck.clearApiKey', () => clearApiKey(registry)),
		vscode.commands.registerCommand('vibeCheck.selectModel', () => selectModel(registry)),
		vscode.commands.registerCommand('vibeCheck.switchProvider', () => switchProvider(registry))
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
	await vscode.workspace
		.getConfiguration('vibeCheck')
		.update('modelProvider', pick.label, vscode.ConfigurationTarget.Global);
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
	if (pick.label === CUSTOM_MODEL_PICK) {
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
