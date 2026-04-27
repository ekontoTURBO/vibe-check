import * as vscode from 'vscode';
import * as path from 'path';
import { Capabilities, Topic } from './types';

const MAX_FILE_BYTES = 5000;
const MAX_TOTAL_BYTES = 16000;

/** Files we look for when generating Infrastructure / Security modules. Order matters — earlier wins on tie. */
const INFRASTRUCTURE_CANDIDATES: string[] = [
	// JavaScript / TypeScript
	'package.json',
	'tsconfig.json',
	'jsconfig.json',
	'eslint.config.mjs',
	'eslint.config.js',
	'.eslintrc.json',
	'biome.json',
	'.prettierrc',
	'.prettierrc.json',
	'esbuild.js',
	'vite.config.ts',
	'vite.config.js',
	'webpack.config.js',
	'rollup.config.js',
	'next.config.js',
	'next.config.ts',
	'turbo.json',
	'nx.json',
	'jest.config.ts',
	'jest.config.js',
	'vitest.config.ts',
	'vitest.config.js',
	'tailwind.config.js',
	'tailwind.config.ts',
	'postcss.config.js',
	'babel.config.js',
	'.swcrc',
	// Bun / Deno
	'bunfig.toml',
	'deno.json',
	'deno.jsonc',
	// Python
	'pyproject.toml',
	'requirements.txt',
	'setup.py',
	'setup.cfg',
	'Pipfile',
	'poetry.lock',
	// Rust
	'Cargo.toml',
	// Go
	'go.mod',
	// Java / Kotlin / JVM
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
	'settings.gradle',
	'settings.gradle.kts',
	// .NET
	'global.json',
	'Directory.Build.props',
	// Ruby
	'Gemfile',
	'Rakefile',
	// PHP
	'composer.json',
	// C / C++
	'CMakeLists.txt',
	'Makefile',
	'conanfile.txt',
	'vcpkg.json',
	// Swift / iOS / macOS
	'Package.swift',
	'Podfile',
	// Elixir / Erlang
	'mix.exs',
	'rebar.config',
	// Haskell
	'package.yaml',
	'stack.yaml',
	// Dart / Flutter
	'pubspec.yaml',
	// Containers
	'Dockerfile',
	'docker-compose.yml',
	'docker-compose.yaml',
	'.dockerignore',
	// CI
	'.github/workflows/ci.yml',
	'.gitlab-ci.yml',
	'.circleci/config.yml',
	'azure-pipelines.yml',
	'Jenkinsfile',
	'.drone.yml',
	'.travis.yml',
	// Editor / repo standards
	'.editorconfig',
	'.gitattributes',
];

/** Regex used by the last-chance scan for any config-shaped file at workspace root. */
const CONFIG_FILE_PATTERN =
	/^(\.[^/]+|.+\.(json|jsonc|yaml|yml|toml|ini|conf))$|^Makefile$|^Dockerfile.*|^[A-Z][a-zA-Z]+file$|.+\.(gradle|gradle\.kts|gemspec|cabal)$/;

/** Source-code file extensions the Security topic scans for when no editor is active. */
const SOURCE_FILE_PATTERN =
	/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|c|h|hpp|rb|php|swift|dart|ex|exs|hs|scala|clj|lua|sh|bash|zsh)$/i;

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
			return caps.hasActiveEditor || caps.hasWorkspaceFolder;
		case 'infrastructure':
		case 'architecture':
		case 'tools':
			return caps.hasWorkspaceFolder;
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
		if (editor && editor.document.uri.scheme === 'file') {
			const text = editor.selection.isEmpty
				? editor.document.getText()
				: editor.document.getText(editor.selection);
			if (text.trim().length >= 40) {
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
		}

		// No useful editor — scan the workspace for a source file.
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			throw new Error('Open a source file or workspace folder to generate a code lesson.');
		}
		const sourceFile = await this.findRepresentativeSourceFile(folders[0].uri);
		if (!sourceFile) {
			throw new Error(
				'No source files found in this workspace. Open any code file in the editor first.'
			);
		}
		return {
			label: path.basename(sourceFile.path),
			content: this.truncate(sourceFile.content, MAX_FILE_BYTES),
			sourceFile: sourceFile.path,
			lineRange: { start: 0, end: sourceFile.content.split('\n').length - 1 },
		};
	}

	private async gatherInfrastructure(): Promise<GatheredContext> {
		return this.collectFiles(INFRASTRUCTURE_CANDIDATES, 'Infrastructure & build configuration');
	}

	private async gatherTools(): Promise<GatheredContext> {
		// Try language-specific deps files in priority order.
		const candidates: Array<{ name: string; label: string }> = [
			{ name: 'package.json', label: 'package.json (deps + scripts)' },
			{ name: 'Cargo.toml', label: 'Cargo.toml (Rust deps)' },
			{ name: 'pyproject.toml', label: 'pyproject.toml (Python deps)' },
			{ name: 'requirements.txt', label: 'requirements.txt (Python deps)' },
			{ name: 'Pipfile', label: 'Pipfile (Python deps)' },
			{ name: 'go.mod', label: 'go.mod (Go deps)' },
			{ name: 'Gemfile', label: 'Gemfile (Ruby deps)' },
			{ name: 'composer.json', label: 'composer.json (PHP deps)' },
			{ name: 'pom.xml', label: 'pom.xml (Maven deps)' },
			{ name: 'build.gradle', label: 'build.gradle (Gradle deps)' },
			{ name: 'build.gradle.kts', label: 'build.gradle.kts (Gradle deps)' },
			{ name: 'pubspec.yaml', label: 'pubspec.yaml (Dart/Flutter deps)' },
			{ name: 'Package.swift', label: 'Package.swift (Swift deps)' },
			{ name: 'mix.exs', label: 'mix.exs (Elixir deps)' },
			{ name: 'deno.json', label: 'deno.json (Deno deps)' },
			{ name: 'bunfig.toml', label: 'bunfig.toml (Bun deps)' },
		];

		for (const { name, label } of candidates) {
			const found = await this.readWorkspaceFile(name);
			if (!found) {
				continue;
			}

			// Special-case package.json: trim to the relevant fields only.
			if (name === 'package.json') {
				let parsed: Record<string, unknown> = {};
				try {
					parsed = JSON.parse(found.content);
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
					label,
					content: JSON.stringify(trimmed, null, 2),
					sourceFile: found.path,
				};
			}

			return {
				label,
				content: this.truncate(found.content, MAX_FILE_BYTES),
				sourceFile: found.path,
			};
		}

		throw new Error(
			'No dependency manifest found at workspace root. Looked for: package.json, Cargo.toml, pyproject.toml, requirements.txt, go.mod, Gemfile, composer.json, pom.xml, build.gradle, pubspec.yaml, Package.swift, mix.exs, deno.json. Open a project that has one.'
		);
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
		if (editor && editor.document.uri.scheme === 'file') {
			const text = editor.document.getText();
			if (text.trim().length > 40) {
				return {
					label: `Security review of ${path.basename(editor.document.fileName)}`,
					content: this.truncate(text, MAX_FILE_BYTES),
					sourceFile: editor.document.fileName,
					lineRange: { start: 0, end: editor.document.lineCount - 1 },
				};
			}
		}

		// No useful editor content — find a representative source file from the workspace.
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			throw new Error('Open a file or workspace folder to generate a security review.');
		}
		const sourceFile = await this.findRepresentativeSourceFile(folders[0].uri);
		if (sourceFile) {
			return {
				label: `Security review of ${path.basename(sourceFile.path)}`,
				content: this.truncate(sourceFile.content, MAX_FILE_BYTES),
				sourceFile: sourceFile.path,
				lineRange: { start: 0, end: sourceFile.content.split('\n').length - 1 },
			};
		}

		// Last resort — review whatever config files we can find.
		return this.collectFiles(INFRASTRUCTURE_CANDIDATES, 'Security review of project config');
	}

	private async findRepresentativeSourceFile(
		root: vscode.Uri
	): Promise<{ path: string; content: string } | null> {
		const candidatesByDir = [
			vscode.Uri.joinPath(root, 'src'),
			vscode.Uri.joinPath(root, 'lib'),
			vscode.Uri.joinPath(root, 'app'),
			vscode.Uri.joinPath(root, 'source'),
			root,
		];
		for (const dir of candidatesByDir) {
			try {
				const entries = await vscode.workspace.fs.readDirectory(dir);
				const files = entries
					.filter(
						([name, type]) =>
							type === vscode.FileType.File && SOURCE_FILE_PATTERN.test(name)
					)
					.map(([name]) => name);
				for (const name of files) {
					const fileUri = vscode.Uri.joinPath(dir, name);
					const content = await this.readFile(fileUri);
					if (content && content.trim().length >= 100) {
						return { path: fileUri.fsPath, content };
					}
				}
			} catch {
				// directory doesn't exist or unreadable, try next
			}
		}
		return null;
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
			// Last-chance scan: glob for any small config-shaped file at workspace root.
			const fallback = await this.scanWorkspaceForConfigs(root);
			if (fallback.length === 0) {
				throw new Error(
					`No config files found at workspace root. Vibe Check looked for: ${paths.slice(0, 8).join(', ')} and ${paths.length - 8} more. ` +
						'Try the Code or Architecture topic instead, or open a project that has a build/config file.'
				);
			}
			return { label, content: fallback.join('\n\n') };
		}
		return {
			label,
			content: parts.join('\n\n'),
		};
	}

	private async scanWorkspaceForConfigs(root: vscode.Uri): Promise<string[]> {
		try {
			const entries = await vscode.workspace.fs.readDirectory(root);
			const candidates = entries
				.filter(([name, type]) => type === vscode.FileType.File && CONFIG_FILE_PATTERN.test(name))
				.map(([name]) => name)
				.slice(0, 6);
			const parts: string[] = [];
			let total = 0;
			for (const name of candidates) {
				if (total >= MAX_TOTAL_BYTES) {
					break;
				}
				const file = await this.readFile(vscode.Uri.joinPath(root, name));
				if (!file) {
					continue;
				}
				const trimmed = this.truncate(file, MAX_FILE_BYTES);
				parts.push(`=== ${name} ===\n${trimmed}`);
				total += trimmed.length;
			}
			return parts;
		} catch {
			return [];
		}
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
