/**
 * Minimal `vscode` stub for STANDALONE (non-electron) unit tests.
 *
 * The real `@vscode/test-electron` harness launches a full editor — which can't
 * run in a headless CI/agent box. For pure logic (providers, registry, fallback,
 * JSON parsing) we don't need the editor at all, so `scripts/run-tests.mjs`
 * aliases `import 'vscode'` to this file via esbuild. Anything the code-under-test
 * touches must exist here.
 */

interface TestState {
	/** Flat config map keyed by `section.key` (e.g. `vibeCheck.modelProvider`). */
	config: Record<string, unknown>;
	warnings: string[];
	infos: string[];
	statusBar: string[];
	/** When set, CopilotProvider sees these as available VS Code LM models. */
	lmModels: Array<{ family?: string; vendor?: string }> | null;
	/** Canned text a single `model.sendRequest` should stream back (copilot). */
	lmResponseText: string;
	appName: string;
}

export const __test: TestState & { reset(): void } = {
	config: {},
	warnings: [],
	infos: [],
	statusBar: [],
	lmModels: null,
	lmResponseText: '',
	appName: 'Visual Studio Code',
	reset() {
		this.config = {};
		this.warnings = [];
		this.infos = [];
		this.statusBar = [];
		this.lmModels = null;
		this.lmResponseText = '';
		this.appName = 'Visual Studio Code';
	},
};

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export const workspace = {
	getConfiguration(section: string) {
		const prefix = section ? section + '.' : '';
		return {
			get<T>(key: string, def?: T): T {
				const full = prefix + key;
				return (full in __test.config ? __test.config[full] : def) as T;
			},
			async update(key: string, value: unknown): Promise<void> {
				__test.config[prefix + key] = value;
			},
		};
	},
	onDidChangeConfiguration() {
		return { dispose() {} };
	},
	onDidChangeWorkspaceFolders() {
		return { dispose() {} };
	},
};

export const env = {
	get appName() {
		return __test.appName;
	},
	appHost: 'desktop',
	machineId: 'test-machine',
	isTelemetryEnabled: false,
	openExternal: async () => true,
};

export const version = '1.95.0';

export const extensions = {
	getExtension() {
		return undefined;
	},
};

export const window = {
	showWarningMessage(message: string, ..._rest: unknown[]) {
		__test.warnings.push(message);
		return Promise.resolve(undefined);
	},
	showInformationMessage(message: string, ..._rest: unknown[]) {
		__test.infos.push(message);
		return Promise.resolve(undefined);
	},
	showQuickPick() {
		return Promise.resolve(undefined);
	},
	showInputBox() {
		return Promise.resolve(undefined);
	},
	setStatusBarMessage(text: string) {
		__test.statusBar.push(text);
		return { dispose() {} };
	},
	createTextEditorDecorationType() {
		return { dispose() {} };
	},
};

export const Uri = {
	parse(value: string) {
		return { toString: () => value, scheme: value.split(':')[0] };
	},
	file(p: string) {
		return { fsPath: p, toString: () => p };
	},
	joinPath(base: unknown, ...parts: string[]) {
		return { fsPath: parts.join('/'), toString: () => parts.join('/') };
	},
};

export const commands = {
	registerCommand() {
		return { dispose() {} };
	},
	executeCommand() {
		return Promise.resolve(undefined);
	},
};

export class CancellationTokenSource {
	token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
	cancel() {
		this.token.isCancellationRequested = true;
	}
	dispose() {}
}

export const LanguageModelChatMessage = {
	User(content: string) {
		return { role: 1, content };
	},
	Assistant(content: string) {
		return { role: 2, content };
	},
};

export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 } as const;

/**
 * `vscode.lm` — present only when a test sets `__test.lmModels`. Mirrors the
 * shape CopilotProvider relies on (`selectChatModels` + `model.sendRequest`).
 */
export const lm = {
	async selectChatModels(filter?: { vendor?: string; family?: string }) {
		if (!__test.lmModels) {
			return [];
		}
		let models = __test.lmModels;
		if (filter?.vendor) {
			models = models.filter((m) => !m.vendor || m.vendor === filter.vendor);
		}
		return models.map((m) => ({
			family: m.family ?? 'gpt-4o',
			vendor: m.vendor ?? 'copilot',
			async sendRequest() {
				const text = __test.lmResponseText;
				return {
					text: (async function* () {
						yield text;
					})(),
				};
			},
		}));
	},
};
