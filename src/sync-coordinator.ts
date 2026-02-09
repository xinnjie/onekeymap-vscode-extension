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
	showStatusMessage(message: string): void;
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
			console.debug('Skipping VS Code → onekeymap.json sync: already syncing');
			return;
		}

		let content: string;
		try {
			content = this.fileSystem.readFile(this.keybindingsPath);
		} catch (e) {
			console.error(`Failed to read ${this.keybindingsPath}`, e);
			return;
		}

		const hash = contentHash(content);
		if (this.lastWrittenHash.get(this.keybindingsPath) === hash) {
			console.debug('Skipping VS Code → onekeymap.json sync: content hash matches last written');
			return;
		}

		console.debug('VS Code keybindings changed, starting sync');

		try {
			const currentOnekeymapKeymap = await this.loadOnekeymapKeymap();

			const analyzeResponse = await this.client.analyzeEditorConfig(content, currentOnekeymapKeymap ?? undefined);
			if (!analyzeResponse.keymap) {
				console.warn('AnalyzeEditorConfig returned no keymap');
				return;
			}

			const changes = analyzeResponse.changes;
			const summary = formatChangeSummary(changes);
			if (changes && changes.add.length === 0 && changes.remove.length === 0 && changes.update.length === 0) {
				console.debug('No changes detected from VS Code keybindings (hash change only or no structural changes)');
				// still update hash to avoid re-analyzing
				this.lastWrittenHash.set(this.keybindingsPath, hash);
				return;
			}

			console.debug(`Analyzed keybindings: ${summary}`);

			const generateResponse = await this.client.generateKeymap(analyzeResponse.keymap);
			const newOnekeymapContent = generateResponse.content;

			this.syncing = true;
			try {
				this.fileSystem.ensureDir(this.onekeymapPath);
				const newHash = contentHash(newOnekeymapContent);
				this.lastWrittenHash.set(this.onekeymapPath, newHash);
				this.fileSystem.writeFile(this.onekeymapPath, newOnekeymapContent);
				console.info(`Wrote update to ${this.onekeymapPath} (hash: ${newHash.slice(0, 8)})`);
			} finally {
				this.syncing = false;
			}

			this.status.showStatusMessage(`OneKeymap: Synced from VS Code (${summary})`);
			console.info(`Synced VS Code → onekeymap.json (${summary})`);
		} catch (e) {
			console.error('Failed to sync VS Code → onekeymap.json', e);
			this.status.showStatusMessage('OneKeymap: Sync failed (VS Code → onekeymap)');
		}
	}

	public async onOnekeymapConfigChanged(): Promise<void> {
		if (this.syncing) {
			console.debug('Skipping onekeymap.json → VS Code sync: already syncing');
			return;
		}

		let content: string;
		try {
			content = this.fileSystem.readFile(this.onekeymapPath);
		} catch (e) {
			console.error(`Failed to read ${this.onekeymapPath}`, e);
			return;
		}

		const hash = contentHash(content);
		if (this.lastWrittenHash.get(this.onekeymapPath) === hash) {
			console.debug('Skipping onekeymap.json → VS Code sync: content hash matches last written');
			return;
		}

		console.debug('onekeymap.json changed, starting sync');

		try {
			const parseResponse = await this.client.parseKeymap(content);
			if (!parseResponse.keymap) {
				console.warn('ParseKeymap returned no keymap');
				return;
			}

			let currentVscodeContent = '';
			try {
				currentVscodeContent = this.fileSystem.readFile(this.keybindingsPath);
			} catch {
				// keybindings.json may not exist yet
			}

			console.debug('Generating editor configuration from unified keymap');
			const generateResponse = await this.client.generateEditorConfig(parseResponse.keymap, currentVscodeContent);
			const newVscodeContent = generateResponse.content;

			if (newVscodeContent === currentVscodeContent) {
				console.debug('No changes to write to keybindings.json');
				return;
			}

			this.syncing = true;
			try {
				const newHash = contentHash(newVscodeContent);
				this.lastWrittenHash.set(this.keybindingsPath, newHash);
				this.fileSystem.writeFile(this.keybindingsPath, newVscodeContent);
				console.info(`Wrote update to ${this.keybindingsPath} (hash: ${newHash.slice(0, 8)})`);
			} finally {
				this.syncing = false;
			}

			this.status.showStatusMessage('OneKeymap: Synced from onekeymap.json');
			console.info('Synced onekeymap.json → VS Code');
		} catch (e) {
			console.error('Failed to sync onekeymap.json → VS Code', e);
			this.status.showStatusMessage('OneKeymap: Sync failed (onekeymap → VS Code)');
		}
	}

	public async initializeIfNeeded(): Promise<void> {
		const onekeymapExists = this.fileSystem.exists(this.onekeymapPath);
		const keybindingsExists = this.fileSystem.exists(this.keybindingsPath);

		if (!onekeymapExists && keybindingsExists) {
			console.log('onekeymap.json not found, creating from current VS Code keybindings');
			await this.onVscodeKeybindingsChanged();
		} else {
			console.log(`Initialization: onekeymap.json exists: ${onekeymapExists}, keybindings.json exists: ${keybindingsExists}`);
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
