import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	// Electron-host tests only. The standalone unit tests (`*.unit.test.ts`) run
	// in plain Node via `npm run test:unit` and must NOT be launched in the editor.
	files: ['out/test/**/*.test.js', '!out/test/**/*.unit.test.js'],
});
