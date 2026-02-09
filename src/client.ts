import * as grpc from '@grpc/grpc-js';
import {
  OnekeymapServiceClient,
  type AnalyzeEditorConfigResponse,
  type GenerateEditorConfigResponse,
  type GenerateKeymapResponse,
  GenerateEditorConfigRequest_DiffType,
  type ParseKeymapResponse,
} from 'src/proto/keymap/v1/onekeymap_service';
import { EditorType } from 'src/proto/keymap/v1/editor';
import { type Keymap } from 'src/proto/keymap/v1/keymap';

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

  public async analyzeEditorConfig(content: string, originalConfig?: Keymap): Promise<AnalyzeEditorConfigResponse> {
    return new Promise((resolve, reject) => {
      this.client.analyzeEditorConfig(
        { editorType: EditorType.VSCODE, sourceContent: content, baseContent: "", originalConfig },
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response!);
          }
        },
      );
    });
  }

  public async generateEditorConfig(keymap: Keymap, originalContent: string): Promise<GenerateEditorConfigResponse> {
    return new Promise((resolve, reject) => {
      this.client.generateEditorConfig(
        {
          editorType: EditorType.VSCODE,
          keymap,
          originalContent,
          diffType: GenerateEditorConfigRequest_DiffType.DIFF_TYPE_UNSPECIFIED,
          filePath: "",
        },
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response!);
          }
        },
      );
    });
  }

  public async parseKeymap(content: string): Promise<ParseKeymapResponse> {
    return new Promise((resolve, reject) => {
      this.client.parseKeymap(
        { content, includeAllActions: false },
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response!);
          }
        },
      );
    });
  }

  public async generateKeymap(keymap: Keymap): Promise<GenerateKeymapResponse> {
    return new Promise((resolve, reject) => {
      this.client.generateKeymap(
        { keymap },
        (err, response) => {
          if (err) {
            reject(err);
          } else {
            resolve(response!);
          }
        },
      );
    });
  }

  public getClient(): OnekeymapServiceClient {
    return this.client;
  }
}
