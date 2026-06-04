/**
 * Standalone unit-test runner.
 *
 * The default `npm test` uses @vscode/test-electron, which launches a real
 * editor and can't run headless. These unit tests exercise pure logic
 * (providers, registry, fallback, JSON/prompt-injection parsing) with the
 * `vscode` module aliased to a lightweight stub, so they run in plain Node.
 *
 *   node scripts/run-tests.mjs
 */
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'src', 'test');
const outDir = path.join(root, 'out-unit');
const stub = path.join(testDir, 'stubs', 'vscode.ts');

const entries = fs
	.readdirSync(testDir)
	.filter((f) => f.endsWith('.unit.test.ts'))
	.map((f) => path.join(testDir, f));

if (entries.length === 0) {
	console.error('No *.unit.test.ts files found in', testDir);
	process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
	entryPoints: entries,
	outdir: outDir,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	sourcemap: 'inline',
	alias: { vscode: stub },
	logLevel: 'warning',
	outExtension: { '.js': '.mjs' },
});

const outFiles = fs
	.readdirSync(outDir)
	.filter((f) => f.endsWith('.mjs'))
	.map((f) => path.join(outDir, f));

console.log(`Running ${outFiles.length} unit test bundle(s)…\n`);
const res = spawnSync(process.execPath, ['--test', ...outFiles], { stdio: 'inherit' });
process.exit(res.status ?? 1);
