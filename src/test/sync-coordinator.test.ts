import * as assert from 'assert';
import {
	SyncCoordinator,
	formatChangeSummary,
	type FileSystem,
	type StatusReporter,
	type KeymapClient,
} from '../sync-coordinator';
import type {
	AnalyzeEditorConfigResponse,
	GenerateEditorConfigResponse,
	GenerateKeymapResponse,
	KeymapChanges,
	ParseKeymapResponse,
} from '../proto/keymap/v1/onekeymap_service';
import type { Action, Keymap } from '../proto/keymap/v1/keymap';

function makeKeymap(name: string): Keymap {
	return { name, actions: [] };
}

function makeAction(name: string): Action {
	return { name, bindings: [], comment: '', actionConfig: undefined };
}

function makeChanges(add = 0, remove = 0, update = 0): KeymapChanges {
	return {
		add: Array.from({ length: add }, () => makeAction('a')),
		remove: Array.from({ length: remove }, () => makeAction('r')),
		update: Array.from({ length: update }, () => ({ origin: undefined, updated: undefined })),
	};
}

class MockFileSystem implements FileSystem {
	files = new Map<string, string>();
	writtenFiles: Array<{ path: string; content: string }> = [];
	dirs = new Set<string>();

	readFile(path: string): string {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return content;
	}

	writeFile(path: string, content: string): void {
		this.files.set(path, content);
		this.writtenFiles.push({ path, content });
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	ensureDir(path: string): void {
		this.dirs.add(path);
	}
}

class MockStatusReporter implements StatusReporter {
	messages: string[] = [];

	showStatusMessage(message: string): void {
		this.messages.push(message);
	}
}

class MockKeymapClient implements KeymapClient {
	analyzeResult: AnalyzeEditorConfigResponse = { keymap: makeKeymap('test'), changes: makeChanges(1) };
	generateKeymapResult: GenerateKeymapResponse = { content: '{"keymaps":[]}' };
	parseKeymapResult: ParseKeymapResponse = { keymap: makeKeymap('test') };
	generateEditorConfigResult: GenerateEditorConfigResponse = { content: '[]', diff: '' };

	analyzeCalls: Array<{ content: string; originalConfig?: Keymap }> = [];
	generateKeymapCalls: Keymap[] = [];
	parseKeymapCalls: string[] = [];
	generateEditorConfigCalls: Array<{ keymap: Keymap; originalContent: string }> = [];

	shouldThrow = false;

	async analyzeEditorConfig(content: string, originalConfig?: Keymap): Promise<AnalyzeEditorConfigResponse> {
		this.analyzeCalls.push({ content, originalConfig });
		if (this.shouldThrow) { throw new Error('gRPC error'); }
		return this.analyzeResult;
	}

	async generateEditorConfig(keymap: Keymap, originalContent: string): Promise<GenerateEditorConfigResponse> {
		this.generateEditorConfigCalls.push({ keymap, originalContent });
		if (this.shouldThrow) { throw new Error('gRPC error'); }
		return this.generateEditorConfigResult;
	}

	async parseKeymap(content: string): Promise<ParseKeymapResponse> {
		this.parseKeymapCalls.push(content);
		if (this.shouldThrow) { throw new Error('gRPC error'); }
		return this.parseKeymapResult;
	}

	async generateKeymap(keymap: Keymap): Promise<GenerateKeymapResponse> {
		this.generateKeymapCalls.push(keymap);
		if (this.shouldThrow) { throw new Error('gRPC error'); }
		return this.generateKeymapResult;
	}
}

const KB_PATH = '/mock/keybindings.json';
const OK_PATH = '/mock/onekeymap.json';

function createTestContext() {
	const fs = new MockFileSystem();
	const status = new MockStatusReporter();
	const client = new MockKeymapClient();
	const coordinator = new SyncCoordinator(KB_PATH, OK_PATH, client, fs, status);
	return { fs, status, client, coordinator };
}

// --- formatChangeSummary tests ---

suite('formatChangeSummary', () => {
	test('returns empty string for undefined', () => {
		assert.strictEqual(formatChangeSummary(undefined), '');
	});

	test('returns "no changes" for empty changes', () => {
		assert.strictEqual(formatChangeSummary(makeChanges(0, 0, 0)), 'no changes');
	});

	test('formats add only', () => {
		assert.strictEqual(formatChangeSummary(makeChanges(3, 0, 0)), '3 added');
	});

	test('formats remove only', () => {
		assert.strictEqual(formatChangeSummary(makeChanges(0, 2, 0)), '2 removed');
	});

	test('formats update only', () => {
		assert.strictEqual(formatChangeSummary(makeChanges(0, 0, 5)), '5 updated');
	});

	test('formats all types', () => {
		assert.strictEqual(formatChangeSummary(makeChanges(1, 2, 3)), '1 added, 2 removed, 3 updated');
	});
});

// --- SyncCoordinator: VS Code → OneKeymap ---

suite('SyncCoordinator: onVscodeKeybindingsChanged', () => {
	test('reads keybindings, analyzes, generates, and writes onekeymap.json', async () => {
		const { fs, status, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[{"key":"ctrl+s","command":"workbench.action.files.save"}]');

		await coordinator.onVscodeKeybindingsChanged();

		assert.strictEqual(client.analyzeCalls.length, 1);
		assert.strictEqual(client.generateKeymapCalls.length, 1);
		assert.strictEqual(fs.writtenFiles.length, 1);
		assert.strictEqual(fs.writtenFiles[0].path, OK_PATH);
		assert.strictEqual(fs.writtenFiles[0].content, '{"keymaps":[]}');
		assert.ok(status.messages.some(m => m.includes('Synced from VS Code')));
	});

	test('passes existing onekeymap keymap as originalConfig', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		client.parseKeymapResult = { keymap: makeKeymap('existing') };

		await coordinator.onVscodeKeybindingsChanged();

		assert.strictEqual(client.analyzeCalls.length, 1);
		assert.deepStrictEqual(client.analyzeCalls[0].originalConfig, makeKeymap('existing'));
	});

	test('skips write when no changes detected', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		client.analyzeResult = { keymap: makeKeymap('test'), changes: makeChanges(0, 0, 0) };

		await coordinator.onVscodeKeybindingsChanged();

		assert.strictEqual(fs.writtenFiles.length, 0);
	});

	test('skips when keybindings file is unreadable', async () => {
		const { fs, client, coordinator } = createTestContext();
		// KB_PATH not set → readFile will throw

		await coordinator.onVscodeKeybindingsChanged();

		assert.strictEqual(client.analyzeCalls.length, 0);
	});

	test('shows error status on gRPC failure', async () => {
		const { fs, status, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		client.shouldThrow = true;

		await coordinator.onVscodeKeybindingsChanged();

		assert.ok(status.messages.some(m => m.includes('Sync failed')));
	});

	test('skips when content hash matches last written hash (loop prevention)', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		client.analyzeResult = { keymap: makeKeymap('test'), changes: makeChanges(1) };
		client.generateKeymapResult = { content: 'generated-onekeymap' };

		// VS Code change triggers write to onekeymap.json
		await coordinator.onVscodeKeybindingsChanged();
		assert.strictEqual(client.analyzeCalls.length, 1);
		assert.strictEqual(fs.writtenFiles.length, 1);

		// The watcher on onekeymap.json fires with the content we just wrote.
		// The coordinator should skip because the hash matches what it wrote.
		assert.strictEqual(fs.files.get(OK_PATH), 'generated-onekeymap');
		await coordinator.onOnekeymapConfigChanged();
		assert.strictEqual(client.parseKeymapCalls.length, 0);
	});
});

// --- SyncCoordinator: OneKeymap → VS Code ---

suite('SyncCoordinator: onOnekeymapConfigChanged', () => {
	test('reads onekeymap, parses, generates editor config, writes keybindings.json', async () => {
		const { fs, status, client, coordinator } = createTestContext();
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		fs.files.set(KB_PATH, '[]');
		client.generateEditorConfigResult = { content: '[{"key":"ctrl+s"}]', diff: '' };

		await coordinator.onOnekeymapConfigChanged();

		assert.strictEqual(client.parseKeymapCalls.length, 1);
		assert.strictEqual(client.generateEditorConfigCalls.length, 1);
		assert.strictEqual(fs.writtenFiles.length, 1);
		assert.strictEqual(fs.writtenFiles[0].path, KB_PATH);
		assert.strictEqual(fs.writtenFiles[0].content, '[{"key":"ctrl+s"}]');
		assert.ok(status.messages.some(m => m.includes('Synced from onekeymap.json')));
	});

	test('skips write when generated content equals current', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		fs.files.set(KB_PATH, '[]');
		client.generateEditorConfigResult = { content: '[]', diff: '' };

		await coordinator.onOnekeymapConfigChanged();

		assert.strictEqual(fs.writtenFiles.length, 0);
	});

	test('skips when onekeymap file is unreadable', async () => {
		const { client, coordinator } = createTestContext();

		await coordinator.onOnekeymapConfigChanged();

		assert.strictEqual(client.parseKeymapCalls.length, 0);
	});

	test('shows error status on gRPC failure', async () => {
		const { fs, status, client, coordinator } = createTestContext();
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		client.shouldThrow = true;

		await coordinator.onOnekeymapConfigChanged();

		assert.ok(status.messages.some(m => m.includes('Sync failed')));
	});

	test('handles missing keybindings.json gracefully (passes empty string)', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		client.generateEditorConfigResult = { content: '[{"key":"ctrl+s"}]', diff: '' };

		await coordinator.onOnekeymapConfigChanged();

		assert.strictEqual(client.generateEditorConfigCalls[0].originalContent, '');
	});

	test('loop prevention: skips when content hash matches last written hash', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(OK_PATH, '{"keymaps":[]}');
		fs.files.set(KB_PATH, '[]');
		client.generateEditorConfigResult = { content: 'new-vscode-content', diff: '' };

		await coordinator.onOnekeymapConfigChanged();
		assert.strictEqual(client.parseKeymapCalls.length, 1);
		assert.strictEqual(fs.writtenFiles.length, 1);

		// Simulate the written content being read back by the vscode watcher
		fs.files.set(KB_PATH, 'new-vscode-content');
		await coordinator.onVscodeKeybindingsChanged();
		// Hash matches → should skip entirely
		assert.strictEqual(client.analyzeCalls.length, 0);
	});
});

// --- SyncCoordinator: initializeIfNeeded ---

suite('SyncCoordinator: initializeIfNeeded', () => {
	test('creates onekeymap.json from keybindings when onekeymap does not exist', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		client.analyzeResult = { keymap: makeKeymap('init'), changes: makeChanges(1) };
		client.generateKeymapResult = { content: '{"keymaps":[]}' };

		await coordinator.initializeIfNeeded();

		assert.strictEqual(client.analyzeCalls.length, 1);
		assert.strictEqual(fs.writtenFiles.length, 1);
		assert.strictEqual(fs.writtenFiles[0].path, OK_PATH);
	});

	test('does nothing when onekeymap.json already exists', async () => {
		const { fs, client, coordinator } = createTestContext();
		fs.files.set(KB_PATH, '[]');
		fs.files.set(OK_PATH, '{"keymaps":[]}');

		await coordinator.initializeIfNeeded();

		assert.strictEqual(client.analyzeCalls.length, 0);
	});

	test('does nothing when keybindings.json does not exist', async () => {
		const { client, coordinator } = createTestContext();

		await coordinator.initializeIfNeeded();

		assert.strictEqual(client.analyzeCalls.length, 0);
	});
});
