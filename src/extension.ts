// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { OneKeymapClient } from './client';
import { KeymapWatcher } from './watcher';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "onekeymap" is now active!');

	const config = vscode.workspace.getConfiguration('onekeymap');
	const serverUrl = config.get<string>('serverUrl', 'onekeymap.xinnjiedev.com:443');
	const rootCertPath = config.get<string>('rootCertPath');

	let rootCert: Buffer | undefined;
	if (rootCertPath) {
		try {
			rootCert = fs.readFileSync(rootCertPath);
			console.log(`Loaded root certificate from ${rootCertPath}`);
		} catch (e) {
			console.error(`Failed to load root certificate from ${rootCertPath}`, e);
			vscode.window.showErrorMessage(`[OneKeyMap] Failed to load root certificate from ${rootCertPath}`);
		}
	}

	const client = new OneKeymapClient(serverUrl, rootCert);
	const connected = await client.checkConnection();

	let keymapWatcher: KeymapWatcher | undefined;

	if (connected) {
		vscode.window.showInformationMessage(`[OneKeyMap] Connected to at ${serverUrl}`);
		console.log(`Connected to at ${serverUrl}`);

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
			keymapWatcher = new KeymapWatcher(keybindingsPath, client);
			keymapWatcher.start();
			context.subscriptions.push(keymapWatcher);
		} else {
			console.warn(`Keybindings file not found at ${keybindingsPath}`);
			vscode.window.showWarningMessage(`[OneKeyMap] Keybindings file not found at ${keybindingsPath}`);
		}
	} else {
		console.error(`Failed to connect to server at ${serverUrl}`);
		vscode.window.showErrorMessage(`[OneKeyMap] Failed to connect to OneKeymap at ${serverUrl}`);
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('onekeymap.helloWorld', () => {
		console.log('helloWorld command executed');
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('[OneKeyMap] Hello World from onekeymap!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
