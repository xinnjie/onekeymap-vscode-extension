
import { OneKeymapClient } from 'src/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const serverUrl = 'onekeymap.xinnjiedev.com:443';
    console.log(`Testing connection to ${serverUrl}...`);

    // Load root CA for dev environment
    const rootCaPath = '/Users/xinnjie/Library/Application Support/mkcert/rootCA.pem';
    let rootCert: Buffer | undefined;
    try {
        rootCert = fs.readFileSync(rootCaPath);
        console.log(`Loaded root CA from ${rootCaPath}`);
    } catch (e) {
        console.warn(`Could not load root CA from ${rootCaPath}, proceeding without it.`);
    }

    const clientWrapper = new OneKeymapClient(serverUrl, rootCert);
    const client = clientWrapper.getClient();

    // Try to make a call
    try {
        console.log('Calling configDetect...');
        const result = await new Promise((resolve, reject) => {
            // EditorType.VSCODE is 1
            client.configDetect({ editorType: 1 }, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
        console.log('SUCCESS: Connected to OneKeymap service');
        console.log('Response:', JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (e) {
        console.error('FAILURE: Could not connect to OneKeymap service', e);
        process.exit(1);
    }
}

main();
