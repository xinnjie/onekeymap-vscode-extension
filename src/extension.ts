// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { OneKeymapClient } from './client';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "onekeymap" is now active!');

	const config = vscode.workspace.getConfiguration('onekeymap');
	const serverUrl = config.get<string>('serverUrl', 'onekeymap.xinnjiedev.com:443');

	const client = new OneKeymapClient(serverUrl);
	const connected = await client.checkConnection();

	if (connected) {
		vscode.window.showInformationMessage(`Connected to OneKeymap at ${serverUrl}`);

		// Resolve keybindings.json path
		// Default to standard macOS path for now, but should be configurable
		// TODO: Better detection
		const homeDir = process.env.HOME || process.env.USERPROFILE;
		let keybindingsPath = path.join(homeDir!, 'Library/Application Support/Code/User/keybindings.json');

		// On Linux it might be ~/.config/Code/User/keybindings.json
		if (process.platform === 'linux') {
			keybindingsPath = path.join(homeDir!, '.config/Code/User/keybindings.json');
		} else if (process.platform === 'win32') {
			keybindingsPath = path.join(process.env.APPDATA!, 'Code/User/keybindings.json');
		}

		// Override from config if present
		const configuredPath = config.get<string>('keybindingsPath');
		if (configuredPath) {
			keybindingsPath = configuredPath;
		}

		console.log(`Watching keybindings at: ${keybindingsPath}`);

		if (fs.existsSync(keybindingsPath)) {
			watchFile(keybindingsPath, client);
		} else {
			vscode.window.showWarningMessage(`Keybindings file not found at ${keybindingsPath}`);
		}
	} else {
		vscode.window.showErrorMessage(`Failed to connect to OneKeymap at ${serverUrl}`);
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('onekeymap.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from onekeymap!');
	});

	context.subscriptions.push(disposable);
}

let fsWatcher: fs.FSWatcher | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

function watchFile(filePath: string, client: OneKeymapClient) {
	if (fsWatcher) {
		fsWatcher.close();
	}

	try {
		fsWatcher = fs.watch(filePath, (eventType) => {
			if (eventType === 'change') {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					syncKeymap(filePath, client);
				}, 1000);
			}
		});
		console.log(`Started watching ${filePath}`);
	} catch (e) {
		console.error(`Failed to watch file ${filePath}`, e);
	}
}

async function syncKeymap(filePath: string, client: OneKeymapClient) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		await client.importKeymap(content);
		console.log('Synced keymap to server');
		vscode.window.setStatusBarMessage('OneKeymap: Synced', 3000);
	} catch (e) {
		console.error('Failed to sync keymap', e);
		vscode.window.showErrorMessage('OneKeymap: Sync failed');
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (fsWatcher) {
		fsWatcher.close();
	}
}
