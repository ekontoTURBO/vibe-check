import * as vscode from 'vscode';
import * as path from 'path';
import { Capabilities, Topic } from './types';

const MAX_FILE_BYTES = 5000;
const MAX_TOTAL_BYTES = 16000;

export interface GatheredContext {
	label: string;
	content: string;
	sourceFile?: string;
	lineRange?: { start: number; end: number };
}

export async function detectCapabilities(): Promise<Capabilities> {
	const hasActiveEditor = !!vscode.window.activeTextEditor;
	const hasWorkspaceFolder =
		!!vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

	let hasPackageJson = false;
	if (hasWorkspaceFolder && vscode.workspace.workspaceFolders) {
		const root = vscode.workspace.workspaceFolders[0].uri;
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'package.json'));
			hasPackageJson = true;
		} catch {
			hasPackageJson = false;
		}
	}

	return { hasActiveEditor, hasWorkspaceFolder, hasPackageJson };
}

export function isTopicAvailable(topic: Topic, caps: Capabilities): boolean {
	switch (topic) {
		case 'code':
			return caps.hasActiveEditor;
		case 'infrastructure':
		case 'architecture':
			return caps.hasWorkspaceFolder;
		case 'tools':
			return caps.hasPackageJson;
		case 'security':
			return caps.hasActiveEditor || caps.hasWorkspaceFolder;
	}
}

export class ContextGatherer {
	async gather(topic: Topic, opts?: { explicitCode?: string; explicitFile?: string; explicitRange?: { start: number; end: number } }): Promise<GatheredContext> {
		if (opts?.explicitCode) {
			return {
				label: `Code from ${opts.explicitFile ? path.basename(opts.explicitFile) : 'selection'}`,
				content: opts.explicitCode,
				sourceFile: opts.explicitFile,
				lineRange: opts.explicitRange,
			};
		}

		switch (topic) {
			case 'code':
				return this.gatherActiveFile();
			case 'infrastructure':
				return this.gatherInfrastructure();
			case 'tools':
				return this.gatherTools();
			case 'architecture':
				return this.gatherArchitecture();
			case 'security':
				return this.gatherSecurity();
		}
	}

	private async gatherActiveFile(): Promise<GatheredContext> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			throw new Error('Open a file or select code first to generate a code lesson.');
		}
		const text = editor.selection.isEmpty
			? editor.document.getText()
			: editor.document.getText(editor.selection);
		if (text.trim().length < 40) {
			throw new Error('Selected code is too short — pick at least a few lines.');
		}
		const truncated = this.truncate(text, MAX_FILE_BYTES);
		const range = editor.selection.isEmpty
			? { start: 0, end: editor.document.lineCount - 1 }
			: { start: editor.selection.start.line, end: editor.selection.end.line };
		return {
			label: path.basename(editor.document.fileName),
			content: truncated,
			sourceFile: editor.document.fileName,
			lineRange: range,
		};
	}

	private async gatherInfrastructure(): Promise<GatheredContext> {
		const candidates = [
			'package.json',
			'tsconfig.json',
			'esbuild.js',
			'vite.config.ts',
			'vite.config.js',
			'webpack.config.js',
			'.eslintrc.json',
			'eslint.config.mjs',
			'next.config.js',
			'next.config.ts',
			'Dockerfile',
			'docker-compose.yml',
			'.github/workflows/ci.yml',
			'pyproject.toml',
			'requirements.txt',
			'Cargo.toml',
			'go.mod',
		];
		return this.collectFiles(candidates, 'Infrastructure & build configuration');
	}

	private async gatherTools(): Promise<GatheredContext> {
		const pkg = await this.readWorkspaceFile('package.json');
		if (!pkg) {
			throw new Error('No package.json found — cannot generate a tools lesson.');
		}
		let parsed: Record<string, unknown> = {};
		try {
			parsed = JSON.parse(pkg.content);
		} catch {
			parsed = {};
		}
		const trimmed = {
			name: parsed.name,
			scripts: parsed.scripts,
			dependencies: parsed.dependencies,
			devDependencies: parsed.devDependencies,
			engines: parsed.engines,
		};
		return {
			label: 'package.json (deps + scripts)',
			content: JSON.stringify(trimmed, null, 2),
			sourceFile: pkg.path,
		};
	}

	private async gatherArchitecture(): Promise<GatheredContext> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			throw new Error('Open a workspace to generate an architecture lesson.');
		}
		const root = folders[0].uri;
		const tree = await this.buildTree(root, 0, 3);
		return {
			label: 'Project structure',
			content: tree,
		};
	}

	private async gatherSecurity(): Promise<GatheredContext> {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const text = editor.document.getText();
			return {
				label: `Security review of ${path.basename(editor.document.fileName)}`,
				content: this.truncate(text, MAX_FILE_BYTES),
				sourceFile: editor.document.fileName,
				lineRange: { start: 0, end: editor.document.lineCount - 1 },
			};
		}
		return this.collectFiles(['package.json', 'tsconfig.json'], 'Security review of project config');
	}

	private async collectFiles(paths: string[], label: string): Promise<GatheredContext> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			throw new Error('Open a workspace folder first.');
		}
		const root = folders[0].uri;
		const parts: string[] = [];
		let total = 0;
		for (const rel of paths) {
			if (total >= MAX_TOTAL_BYTES) {
				break;
			}
			const file = await this.readFile(vscode.Uri.joinPath(root, rel));
			if (!file) {
				continue;
			}
			const trimmed = this.truncate(file, MAX_FILE_BYTES);
			parts.push(`=== ${rel} ===\n${trimmed}`);
			total += trimmed.length;
		}
		if (parts.length === 0) {
			throw new Error('No relevant config files found in the workspace.');
		}
		return {
			label,
			content: parts.join('\n\n'),
		};
	}

	private async readWorkspaceFile(rel: string): Promise<{ path: string; content: string } | null> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return null;
		}
		const uri = vscode.Uri.joinPath(folders[0].uri, rel);
		const content = await this.readFile(uri);
		return content ? { path: uri.fsPath, content } : null;
	}

	private async readFile(uri: vscode.Uri): Promise<string | null> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return new TextDecoder('utf-8').decode(bytes);
		} catch {
			return null;
		}
	}

	private async buildTree(uri: vscode.Uri, depth: number, maxDepth: number): Promise<string> {
		if (depth > maxDepth) {
			return '';
		}
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(uri);
		} catch {
			return '';
		}
		const ignore = new Set(['node_modules', '.git', 'dist', 'out', '.vscode-test', 'build']);
		const lines: string[] = [];
		for (const [name, type] of entries) {
			if (ignore.has(name) || name.startsWith('.')) {
				continue;
			}
			const indent = '  '.repeat(depth);
			if (type === vscode.FileType.Directory) {
				lines.push(`${indent}${name}/`);
				const sub = await this.buildTree(vscode.Uri.joinPath(uri, name), depth + 1, maxDepth);
				if (sub) {
					lines.push(sub);
				}
			} else {
				lines.push(`${indent}${name}`);
			}
		}
		return lines.join('\n');
	}

	private truncate(s: string, max: number): string {
		if (s.length <= max) {
			return s;
		}
		return s.slice(0, max) + `\n\n... [truncated, ${s.length - max} more chars]`;
	}
}
