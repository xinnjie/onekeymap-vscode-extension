import * as grpc from '@grpc/grpc-js';
import { OnekeymapServiceClient, ConfigDetectRequest } from './proto/keymap/v1/onekeymap_service';
import { EditorType } from './proto/keymap/v1/editor';

export class OneKeymapClient {
  private client: OnekeymapServiceClient;

  constructor(serverUrl: string, rootCert?: Buffer) {
    let credentials;
    if (rootCert) {
      credentials = grpc.credentials.createSsl(rootCert);
    } else {
      credentials = grpc.credentials.createSsl();
    }
    this.client = new OnekeymapServiceClient(serverUrl, credentials);
  }

  public async checkConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 5);

      this.client.waitForReady(deadline, (error) => {
        if (error) {
          console.error('Connection failed:', error);
          resolve(false);
        } else {
          console.log('Connected to OneKeymap service');
          resolve(true);
        }
      });
    });
  }

  public async importKeymap(content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // EditorType.VSCODE is 1
      this.client.importKeymap({ editorType: 1, source: content, base: "" }, (err, response) => {
        if (err) {
          console.error('ImportKeymap failed:', err);
          reject(err);
        } else {
          console.log('ImportKeymap success:', response);
          resolve();
        }
      });
    });
  }

  public getClient(): OnekeymapServiceClient {
    return this.client;
  }
}
