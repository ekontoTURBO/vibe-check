import * as vscode from 'vscode';
import { ProviderId, DIRECT_PROVIDERS } from './types';

const SECRET_PREFIX = 'vibeCheck.apiKey.';

export class ProviderSecrets {
	constructor(private context: vscode.ExtensionContext) {}

	async get(id: ProviderId): Promise<string | undefined> {
		return this.context.secrets.get(SECRET_PREFIX + id);
	}

	async set(id: ProviderId, key: string): Promise<void> {
		await this.context.secrets.store(SECRET_PREFIX + id, key);
	}

	async clear(id: ProviderId): Promise<void> {
		await this.context.secrets.delete(SECRET_PREFIX + id);
	}

	/**
	 * One-time migration: if any plain `vibeCheck.<id>ApiKey` setting is set,
	 * push it into SecretStorage and blank the setting. Safe to run repeatedly.
	 */
	async migrateFromSettings(): Promise<{ migrated: ProviderId[] }> {
		const migrated: ProviderId[] = [];
		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		for (const id of DIRECT_PROVIDERS) {
			const settingKey = id + 'ApiKey';
			const plain = cfg.get<string>(settingKey, '').trim();
			if (!plain) {
				continue;
			}
			const existing = await this.get(id);
			if (!existing) {
				await this.set(id, plain);
			}
			// Blank the plain setting so it doesn't sync further. We update
			// at the global scope; if the user has a workspace override, they
			// can clear it themselves.
			await cfg.update(settingKey, '', vscode.ConfigurationTarget.Global);
			migrated.push(id);
		}
		return { migrated };
	}
}
