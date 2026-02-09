import * as crypto from 'crypto';
import type {
	AnalyzeEditorConfigResponse,
	GenerateEditorConfigResponse,
	GenerateKeymapResponse,
	KeymapChanges,
	ParseKeymapResponse,
} from './proto/keymap/v1/onekeymap_service';
import type { Keymap } from './proto/keymap/v1/keymap';

export interface FileSystem {
	readFile(path: string): string;
	writeFile(path: string, content: string): void;
	exists(path: string): boolean;
	ensureDir(path: string): void;
}

export interface StatusReporter {
	showStatusMessage(message: string, hideAfterMs: number): void;
}

export interface KeymapClient {
	analyzeEditorConfig(content: string, originalConfig?: Keymap): Promise<AnalyzeEditorConfigResponse>;
	generateEditorConfig(keymap: Keymap, originalContent: string): Promise<GenerateEditorConfigResponse>;
	parseKeymap(content: string): Promise<ParseKeymapResponse>;
	generateKeymap(keymap: Keymap): Promise<GenerateKeymapResponse>;
}

function contentHash(content: string): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}

export function formatChangeSummary(changes: KeymapChanges | undefined): string {
	if (!changes) {
		return '';
	}
	const parts: string[] = [];
	if (changes.add.length > 0) {
		parts.push(`${changes.add.length} added`);
	}
	if (changes.remove.length > 0) {
		parts.push(`${changes.remove.length} removed`);
	}
	if (changes.update.length > 0) {
		parts.push(`${changes.update.length} updated`);
	}
	return parts.length > 0 ? parts.join(', ') : 'no changes';
}

export class SyncCoordinator {
	private syncing = false;
	private lastWrittenHash = new Map<string, string>();

	constructor(
		private readonly keybindingsPath: string,
		private readonly onekeymapPath: string,
		private readonly client: KeymapClient,
		private readonly fileSystem: FileSystem,
		private readonly status: StatusReporter,
	) { }

	public async onVscodeKeybindingsChanged(): Promise<void> {
		if (this.syncing) {
			return;
		}

		let content: string;
		try {
			content = this.fileSystem.readFile(this.keybindingsPath);
		} catch (e) {
			console.error(`[OneKeymap] Failed to read ${this.keybindingsPath}`, e);
			return;
		}

		const hash = contentHash(content);
		if (this.lastWrittenHash.get(this.keybindingsPath) === hash) {
			return;
		}

		try {
			const currentOnekeymapKeymap = await this.loadOnekeymapKeymap();

			const analyzeResponse = await this.client.analyzeEditorConfig(content, currentOnekeymapKeymap ?? undefined);
			if (!analyzeResponse.keymap) {
				console.warn('[OneKeymap] AnalyzeEditorConfig returned no keymap');
				return;
			}

			const changes = analyzeResponse.changes;
			if (changes && changes.add.length === 0 && changes.remove.length === 0 && changes.update.length === 0) {
				console.log('[OneKeymap] No changes detected from VS Code keybindings');
				return;
			}

			const generateResponse = await this.client.generateKeymap(analyzeResponse.keymap);
			const newOnekeymapContent = generateResponse.content;

			this.syncing = true;
			try {
				this.fileSystem.ensureDir(this.onekeymapPath);
				this.lastWrittenHash.set(this.onekeymapPath, contentHash(newOnekeymapContent));
				this.fileSystem.writeFile(this.onekeymapPath, newOnekeymapContent);
			} finally {
				this.syncing = false;
			}

			const summary = formatChangeSummary(changes);
			this.status.showStatusMessage(`OneKeymap: Synced from VS Code (${summary})`, 5000);
			console.log(`[OneKeymap] Synced VS Code → onekeymap.json (${summary})`);
		} catch (e) {
			console.error('[OneKeymap] Failed to sync VS Code → onekeymap.json', e);
			this.status.showStatusMessage('OneKeymap: Sync failed (VS Code → onekeymap)', 5000);
		}
	}

	public async onOnekeymapConfigChanged(): Promise<void> {
		if (this.syncing) {
			return;
		}

		let content: string;
		try {
			content = this.fileSystem.readFile(this.onekeymapPath);
		} catch (e) {
			console.error(`[OneKeymap] Failed to read ${this.onekeymapPath}`, e);
			return;
		}

		const hash = contentHash(content);
		if (this.lastWrittenHash.get(this.onekeymapPath) === hash) {
			return;
		}

		try {
			const parseResponse = await this.client.parseKeymap(content);
			if (!parseResponse.keymap) {
				console.warn('[OneKeymap] ParseKeymap returned no keymap');
				return;
			}

			let currentVscodeContent = '';
			try {
				currentVscodeContent = this.fileSystem.readFile(this.keybindingsPath);
			} catch {
				// keybindings.json may not exist yet
			}

			const generateResponse = await this.client.generateEditorConfig(parseResponse.keymap, currentVscodeContent);
			const newVscodeContent = generateResponse.content;

			if (newVscodeContent === currentVscodeContent) {
				console.log('[OneKeymap] No changes to write to keybindings.json');
				return;
			}

			this.syncing = true;
			try {
				this.lastWrittenHash.set(this.keybindingsPath, contentHash(newVscodeContent));
				this.fileSystem.writeFile(this.keybindingsPath, newVscodeContent);
			} finally {
				this.syncing = false;
			}

			this.status.showStatusMessage('OneKeymap: Synced from onekeymap.json', 5000);
			console.log('[OneKeymap] Synced onekeymap.json → VS Code');
		} catch (e) {
			console.error('[OneKeymap] Failed to sync onekeymap.json → VS Code', e);
			this.status.showStatusMessage('OneKeymap: Sync failed (onekeymap → VS Code)', 5000);
		}
	}

	public async initializeIfNeeded(): Promise<void> {
		const onekeymapExists = this.fileSystem.exists(this.onekeymapPath);
		const keybindingsExists = this.fileSystem.exists(this.keybindingsPath);

		if (!onekeymapExists && keybindingsExists) {
			console.log('[OneKeymap] onekeymap.json not found, creating from current VS Code keybindings');
			await this.onVscodeKeybindingsChanged();
		}
	}

	private async loadOnekeymapKeymap() {
		try {
			const content = this.fileSystem.readFile(this.onekeymapPath);
			const response = await this.client.parseKeymap(content);
			return response.keymap;
		} catch {
			return null;
		}
	}
}
