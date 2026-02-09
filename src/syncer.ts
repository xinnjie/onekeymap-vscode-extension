import * as vscode from 'vscode';
import * as fs from 'fs';
import { OneKeymapClient } from './client';

export class KeymapSyncer {
	constructor(
		private readonly filePath: string,
		private readonly client: OneKeymapClient
	) { }

	public async sync(): Promise<void> {
		try {
			console.log(`Reading file content from ${this.filePath}`);
			const content = fs.readFileSync(this.filePath, 'utf-8');
			console.log(`Syncing keymap content (${content.length} characters)`);
			await this.client.importKeymap(content);
			console.log('Synced keymap to server successfully');
			vscode.window.setStatusBarMessage('OneKeymap: Synced', 3000);
		} catch (e) {
			console.error('[OneKeyMap] Failed to sync keymap', e);
			vscode.window.showErrorMessage('[OneKeyMap] Sync failed');
		}
	}
}
