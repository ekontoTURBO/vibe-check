const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/* ============================================================
   Telemetry env loader.
   Reads `.env.telemetry` from the repo root if it exists, parses
   simple KEY=VALUE pairs, and bakes the values into the bundle
   via esbuild's `define`. The file is gitignored — secrets never
   enter source control. If absent, telemetry transport is wired
   to NullSender at runtime (events are queued but never sent).

   Format:
     VIBE_CHECK_TELEMETRY_URL=https://xxx.supabase.co/rest/v1/events
     VIBE_CHECK_TELEMETRY_ANON_KEY=eyJhbGciOi...
   ============================================================ */
function loadTelemetryEnv() {
	const file = path.join(__dirname, '.env.telemetry');
	const env = { url: '', anonKey: '' };
	if (!fs.existsSync(file)) {
		return env;
	}
	const text = fs.readFileSync(file, 'utf8');
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (key === 'VIBE_CHECK_TELEMETRY_URL') env.url = val;
		if (key === 'VIBE_CHECK_TELEMETRY_ANON_KEY') env.anonKey = val;
	}
	return env;
}

const telemetryEnv = loadTelemetryEnv();
if (telemetryEnv.url || telemetryEnv.anonKey) {
	console.log(
		`[esbuild] telemetry env loaded — url=${telemetryEnv.url ? 'set' : 'missing'}, anonKey=${telemetryEnv.anonKey ? 'set' : 'missing'}`
	);
} else {
	console.log('[esbuild] no .env.telemetry found — telemetry transport will be a no-op (NullSender).');
}

const TELEMETRY_DEFINE = {
	'process.env.VIBE_CHECK_TELEMETRY_URL': JSON.stringify(telemetryEnv.url),
	'process.env.VIBE_CHECK_TELEMETRY_ANON_KEY': JSON.stringify(telemetryEnv.anonKey),
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'node',
	outfile: 'dist/extension.js',
	external: ['vscode'],
	logLevel: 'silent',
	define: TELEMETRY_DEFINE,
	plugins: [esbuildProblemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
	entryPoints: ['src/webview/index.ts'],
	bundle: true,
	format: 'iife',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'browser',
	target: ['es2020'],
	outfile: 'media/sidebar.js',
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
	const ctxExt = await esbuild.context(extensionOptions);
	const ctxWeb = await esbuild.context(webviewOptions);
	if (watch) {
		await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
	} else {
		await Promise.all([ctxExt.rebuild(), ctxWeb.rebuild()]);
		await Promise.all([ctxExt.dispose(), ctxWeb.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
