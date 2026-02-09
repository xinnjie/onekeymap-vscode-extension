import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { OneKeymapClient } from './client';
import { KeymapWatcher } from './watcher';
import { SyncCoordinator, type FileSystem, type StatusReporter } from './sync-coordinator';

const DEFAULT_ONEKEYMAP_CONFIG_PATH = '~/.config/onekeymap/onekeymap.json';

const nodeFileSystem: FileSystem = {
	readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
	writeFile: (p: string, content: string) => fs.writeFileSync(p, content, 'utf-8'),
	exists: (p: string) => fs.existsSync(p),
	ensureDir: (p: string) => {
		const dir = path.dirname(p);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	},
};

const vscodeStatusReporter: StatusReporter = {
	showStatusMessage: (message: string) => {
		vscode.window.showInformationMessage(message);
	},
};

function resolveHome(filePath: string): string {
	if (filePath.startsWith('~/')) {
		const homeDir = process.env.HOME || process.env.USERPROFILE || '';
		return path.join(homeDir, filePath.slice(2));
	}
	return filePath;
}

function resolveKeybindingsPath(config: vscode.WorkspaceConfiguration): string {
	const configuredPath = config.get<string>('keybindingsPath');
	if (configuredPath) {
		return resolveHome(configuredPath);
	}

	const homeDir = process.env.HOME || process.env.USERPROFILE || '';
	if (process.platform === 'darwin') {
		return path.join(homeDir, 'Library/Application Support/Code/User/keybindings.json');
	} else if (process.platform === 'linux') {
		return path.join(homeDir, '.config/Code/User/keybindings.json');
	} else {
		return path.join(process.env.APPDATA || '', 'Code/User/keybindings.json');
	}
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('Extension activating');

	const config = vscode.workspace.getConfiguration('onekeymap');
	const serverUrl = config.get<string>('serverUrl', 'onekeymap.xinnjiedev.com:443');
	const rootCertPath = config.get<string>('rootCertPath');

	let rootCert: Buffer | undefined;
	if (rootCertPath) {
		try {
			rootCert = fs.readFileSync(rootCertPath);
		} catch (e) {
			console.error(`Failed to load root certificate from ${rootCertPath}`, e);
			vscode.window.showErrorMessage(`OneKeymap: Failed to load root certificate from ${rootCertPath}`);
		}
	}

	const client = new OneKeymapClient(serverUrl, rootCert);
	const connected = await client.checkConnection();

	if (!connected) {
		console.error(`Failed to connect to server at ${serverUrl}`);
		vscode.window.showErrorMessage(`OneKeymap: Failed to connect to server at ${serverUrl}`);
		return;
	}

	console.log(`Connected to ${serverUrl}`);

	const keybindingsPath = resolveKeybindingsPath(config);
	const onekeymapConfigPath = resolveHome(
		config.get<string>('onekeymapConfigPath', DEFAULT_ONEKEYMAP_CONFIG_PATH),
	);

	console.log(`keybindings.json: ${keybindingsPath}`);
	console.log(`onekeymap.json: ${onekeymapConfigPath}`);

	if (!fs.existsSync(keybindingsPath)) {
		console.warn(`keybindings.json not found at ${keybindingsPath}`);
		vscode.window.showWarningMessage(`OneKeymap: keybindings.json not found at ${keybindingsPath}`);
		return;
	}

	const coordinator = new SyncCoordinator(keybindingsPath, onekeymapConfigPath, client, nodeFileSystem, vscodeStatusReporter);

	await coordinator.initializeIfNeeded();

	const vscodeWatcher = new KeymapWatcher(
		keybindingsPath,
		() => coordinator.onVscodeKeybindingsChanged(),
	);
	vscodeWatcher.start();
	context.subscriptions.push(vscodeWatcher);

	const onekeymapWatcher = new KeymapWatcher(
		onekeymapConfigPath,
		() => coordinator.onOnekeymapConfigChanged(),
	);
	if (fs.existsSync(onekeymapConfigPath)) {
		onekeymapWatcher.start();
	}
	context.subscriptions.push(onekeymapWatcher);

	const syncCommand = vscode.commands.registerCommand('onekeymap.sync', async () => {
		await coordinator.onVscodeKeybindingsChanged();
		vscode.window.showInformationMessage('OneKeymap: Manual sync triggered');
	});
	context.subscriptions.push(syncCommand);
}

export function deactivate() { }
