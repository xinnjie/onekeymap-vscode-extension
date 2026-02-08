import * as vscode from 'vscode';
import * as fs from 'fs';
import { OneKeymapClient } from './client';

export class KeymapWatcher implements vscode.Disposable {
	private watcher: fs.FSWatcher | undefined;
	private debounceTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly filePath: string,
		private readonly client: OneKeymapClient
	) { }

	public start() {
		this.stop(); // Ensure clean state

		try {
			this.watcher = fs.watch(this.filePath, (eventType) => this.handleEvent(eventType));
			console.log(`Started watching ${this.filePath}`);
		} catch (e) {
			console.error(`Failed to watch file ${this.filePath}`, e);
		}
	}

	public stop() {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = undefined;
		}
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}
	}

	public dispose() {
		this.stop();
	}

	private handleEvent(eventType: string) {
		console.log(`File event: ${eventType} on ${this.filePath}`);

		if (eventType === 'rename') {
			this.handleRename();
		} else if (eventType === 'change') {
			this.handleChange();
		}
	}

	private handleRename() {
		// potential atomic save or delete
		if (fs.existsSync(this.filePath)) {
			console.log(`File renamed/replaced (atomic save), re-establishing watcher for ${this.filePath}`);
			this.triggerSync();
			// Re-watch to capture new inode
			this.start();
		} else {
			console.warn(`File ${this.filePath} triggered rename and no longer exists (deleted?)`);
			this.stop();
		}
	}

	private handleChange() {
		this.triggerSync();
	}

	private triggerSync() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			console.log(`Debounce finished, syncing ${this.filePath}`);
			this.syncKeymap();
		}, 1000);
	}

	private async syncKeymap() {
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
