# Bidirectional Keymap Sync

The OneKeymap VS Code extension automatically synchronizes keybindings between VS Code (`keybindings.json`) and the shared OneKeymap configuration (`onekeymap.json`). Changes in either file propagate to the other, enabling cross-editor keymap synchronization via `onekeymap.json` as the hub.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  VS Code Extension                    │
│                                                       │
│  ┌────────────────┐       ┌────────────────────────┐ │
│  │ KeymapWatcher  │       │ KeymapWatcher          │ │
│  │ (keybindings   │       │ (onekeymap.json)       │ │
│  │  .json)        │       │                        │ │
│  └───────┬────────┘       └───────────┬────────────┘ │
│          │                            │               │
│          ▼                            ▼               │
│  ┌────────────────────────────────────────────────┐  │
│  │              SyncCoordinator                    │  │
│  │  - syncing flag (loop prevention)              │  │
│  │  - lastWrittenHash per file (loop prevention)  │  │
│  └───────────────────┬────────────────────────────┘  │
│                      │                                │
│                      ▼                                │
│  ┌────────────────────────────────────────────────┐  │
│  │           OneKeymapClient (gRPC)                │  │
│  │  - AnalyzeEditorConfig                         │  │
│  │  - GenerateEditorConfig                        │  │
│  │  - ParseKeymap                                 │  │
│  │  - GenerateKeymap                              │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
              onekeymap-server (remote)
```

## Sync Flows

### VS Code → OneKeymap

Triggered when the user edits `keybindings.json`.

1. `KeymapWatcher` detects file change (debounced 1s)
2. `SyncCoordinator.onVscodeKeybindingsChanged()`:
   - Read `keybindings.json`
   - Guard: skip if `syncing` flag set or content hash matches last written hash
   - Load current `onekeymap.json` via `ParseKeymap` (if exists)
   - Call `AnalyzeEditorConfig(VSCODE, keybindingsContent, currentKeymap)` → returns new `Keymap` + `KeymapChanges`
   - Skip write if `KeymapChanges` is empty
   - Call `GenerateKeymap(newKeymap)` → returns new `onekeymap.json` content
   - Write `onekeymap.json` (with loop prevention guards)
   - Show status bar summary (e.g. "2 added, 1 updated")

### OneKeymap → VS Code

Triggered when `onekeymap.json` changes (e.g. from Zed or Xcode syncing their keybindings).

1. `KeymapWatcher` detects file change (debounced 1s)
2. `SyncCoordinator.onOnekeymapConfigChanged()`:
   - Read `onekeymap.json`
   - Guard: skip if `syncing` flag set or content hash matches last written hash
   - Call `ParseKeymap(content)` → returns `Keymap` object
   - Read current `keybindings.json` (empty string if missing)
   - Call `GenerateEditorConfig(VSCODE, keymap, currentKeybindingsContent)` → returns new VS Code config
   - Skip write if generated content equals current content
   - Write `keybindings.json` (with loop prevention guards)
   - Show status bar message

### Cross-Editor Sync

Each editor plugin only watches two files: its own config and `onekeymap.json`. The `onekeymap.json` file acts as the hub:

```
Zed config ──→ onekeymap.json ──→ keybindings.json (VS Code)
Xcode config ──→ onekeymap.json ──→ keybindings.json (VS Code)
keybindings.json ──→ onekeymap.json ──→ Zed/Xcode (via their plugins)
```

## Loop Prevention

Writing a file triggers its watcher, which could cause an infinite sync loop. Two mechanisms prevent this:

1. **`syncing` flag**: Set `true` synchronously before writing, cleared in a `finally` block. The watcher callback checks this flag first and skips if set. Safe because Node.js is single-threaded.

2. **Content hash**: Before each write, the SHA-256 hash of the new content is stored in `lastWrittenHash[filePath]`. When the watcher fires, if the file's current content hash matches the stored hash, the sync is skipped. This catches cases where the watcher fires after the `syncing` flag is already cleared.

## Conflict Resolution

**Last writer wins.** If both files change within the debounce window, whichever watcher fires last overwrites the other. No merge UI is provided.

## Initialization

On first activation, if `onekeymap.json` does not exist but `keybindings.json` does, the extension creates `onekeymap.json` by running the VS Code → OneKeymap sync flow.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `onekeymap.onekeymapConfigPath` | `~/.config/onekeymap/onekeymap.json` | Path to the shared OneKeymap config |
| `onekeymap.keybindingsPath` | (auto-detect per OS) | Path to VS Code `keybindings.json` |
| `onekeymap.serverUrl` | `onekeymap.xinnjiedev.com:443` | gRPC server URL |
| `onekeymap.rootCertPath` | (empty) | Custom root CA certificate |

## gRPC API Usage

| RPC | Direction | Purpose |
|---|---|---|
| `AnalyzeEditorConfig` | VS Code → OneKeymap | Parse VS Code config into universal `Keymap`, diff against current |
| `GenerateKeymap` | VS Code → OneKeymap | Serialize `Keymap` to `onekeymap.json` format |
| `ParseKeymap` | OneKeymap → VS Code | Parse `onekeymap.json` into `Keymap` object |
| `GenerateEditorConfig` | OneKeymap → VS Code | Generate VS Code config from `Keymap`, preserving unmapped bindings |

## Testability

`SyncCoordinator` accepts three injectable interfaces:

- **`FileSystem`**: `readFile`, `writeFile`, `exists`, `ensureDir`
- **`StatusReporter`**: `showStatusMessage`
- **`KeymapClient`**: `analyzeEditorConfig`, `generateEditorConfig`, `parseKeymap`, `generateKeymap`

Production code passes real implementations (Node.js `fs`, VS Code status bar, gRPC client). Tests pass in-memory mocks. Run unit tests with:

```
pnpm run test:unit
```

## Source Files

```
src/
├── client.ts              # gRPC client wrapper (implements KeymapClient)
├── sync-coordinator.ts    # Core sync logic, interfaces, formatChangeSummary
├── watcher.ts             # File watcher with debounce
├── extension.ts           # VS Code activation, wiring
└── test/
    └── sync-coordinator.test.ts  # 21 unit tests
```
