# Chora

*Where texts dream.*

Chora is an Electron environment for close reading. The reader remains in direct conversation with the text; the model sustains that encounter without replacing it. Read [VISION.md](VISION.md) before making product or design decisions.

## Current experience

Chora has a workspace with a persistent reader, Explorer, and contextual editor:

- **DocumentPanel** — the source text, exact locators, selection, and reading controls.
- **DreamPanel** — capture and editing of reader-authored Dreams.

A Dream contains an exact source passage, zero or more manually selected Signals, an optional title, reader-authored Reflections, and an optional Clarity Check. Reader-created folders organize Dreams within each work. Signals and links are not generated automatically.

## Dream capture

1. Select text in the source document.
2. Right-click and choose **Create Dream**, or press `Ctrl/Cmd+D`.
3. Write Reflections and optionally provide a title.
4. To add a signal, select exact text in either the original document or the copied source passage and choose **Add Signal**.
5. Chora autosaves after you pause, when the window loses focus, and before the editor closes. `Ctrl/Cmd+Enter` remains available for an immediate save.

The source passage is read-only in the editor and can be extended through the explicit source command. To extend it, select more source text in the Document panel and choose **Add to Dream**. Signal descriptions are optional and multiple Signals retain source order. Creating, editing, or selecting a Dream or Signal never moves the reader automatically; only explicit jump controls navigate the text. Deleting a Dream always requires an explicit in-app confirmation with Cancel as the default action.

Signals and Dream descriptions use a shared Milkdown editor with bold, italic, lists, quotations, links, and undo/redo. Formatting is saved as Markdown in the existing Signal description and Dream reflection fields. Editors retain their contents and undo history when switching views or selecting another Signal. Links are editable but do not navigate from the editor; remote images are displayed as alt text without fetching them. The Dream action menu can copy the complete Dream as Markdown, including its source passage, Signals, observations, resonances, attached passages, and General Observations.

Every Signal has exactly one owning Dream. Other Dreams may eventually refer to that Signal as a link, but they cannot own, edit, or delete it. A Signal owns one main passage and may contain later exact passages from the same work. While a Signal is selected, selecting another passage and choosing **Add to Selected Signal** adds that exact component without including the intervening text. The Signal editor distinguishes passages inside the Dream source from external passages. Passage text remains selectable and copyable, and explicit jump controls navigate to exact text. A passage can be removed unless it is the final one. A Signal title defaults to its main passage and can be renamed independently. Deleting a Signal permanently deletes it from its owning Dream.

Signal description editors keep typing and selection state locally while persistence runs. Description writes are serialized per Signal, newer pending text supersedes older pending text, and an obsolete save response is never applied over the active editor.

The Signal rail and selected-Signal editor scroll independently inside the available editor height, so Save remains visible without scrolling the whole document. Their shared divider can be dragged horizontally or adjusted with the keyboard, and truncated Signal rows show the complete Signal text on hover. The Dream source passage is open by default and has a dedicated horizontal divider for vertical resizing. Chora restores user-adjusted workspace columns, Explorer collapse state, Signal-list width, dictionary height, source-passage height, and writing-surface heights across application launches. Dream deletion is available only from the active document's upper-right actions menu and always requires explicit confirmation. With a Dream open, selecting text inside its source passage and choosing **Create Signal** uses the same Dream-owned creation API whether the selection came from the main reader or the Dream source view. There is no destination popup, catalogue lookup, association workflow, or automatic reveal. Expected workflow choices and application failures use dismissible popups rather than persistent page banners.

Each Dream also has a conversational **Clarity Check**. The reader can discuss the current Dream, its source passage, Reflections, and Signals with a selected model. Conversations are saved independently, follow Dreams through Trash and restoration, and preserve drafts when a request fails.

The Explorer may be collapsed by dragging its divider to the left. Its collapsed rail retains a Dreams button that restores the Explorer and focuses that folder. Dragging the collapsed divider to the right also restores the Explorer immediately.

## Local Dream library

New Dreams are readable Markdown files under:

```text
Documents\Chora\Dreams\<work-id>\<title>--<id>.md
```

Untitled Dreams use `dream--<id>.md`. Reader-created folders are real nested directories beneath the work directory, and Dreams can be moved between them from the Explorer. Root-level Dreams remain directly beneath the work. Empty folders may be deleted; nonempty folders must first have their Dreams and child folders moved elsewhere. The main process owns all path validation and persistence; the renderer receives only relative folder identities and has no filesystem access. Writes and moves use a temporary file followed by an atomic rename. Deleting a Dream commits its complete aggregate, including Signals, to `Documents\Chora\Trash\DreamBundles` before removing its canonical files. The Explorer's Trash view supports restoration and confirmed permanent removal; see [Dream Trash](#dream-trash).

Dream catalogue items show the source's full locator range. The Explorer's Dream document icon beside a Stephanus label opens the catalogue filtered to Dreams whose saved source spans overlap that passage, including intermediate passages. Signals do not affect this Dream association. The marker tooltip lists the associated Dream titles. Passage filtering clears the previous keyword query, can be narrowed with search, and has an explicit clear button. It does not open an editor or move the reading position; opening a different work clears the passage filter.

## Architecture

```text
src/main/         privileged Electron host, grouped by product feature
src/preload/      minimal typed context-isolated bridge
src/renderer/     browser UI with feature Panels, Controllers, Stores, and Gateways
src/shared/       cross-process contracts, types, and pure domain logic
Prompts/          model system prompts
```

Renderer panels own DOM interaction, controllers coordinate workflows, stores own state, and gateways own IPC. Signal editing shares `DreamStore`. In the main process, `DreamLibrary` owns Dream aggregates and their child Signals; repositories own canonical file access. Generic manager classes are not the feature coordination pattern.

Clarity Check uses `DreamDiscussionPanel` → `ChatPanel` → `ChatController` → `ChatGateway` → the typed preload API → `ChatIpcController` → `ChatService`. `DreamDiscussionContext` resolves the canonical Dream and source material in the main process. `ChatRepository` stores conversation history separately from Dream Markdown, and `ModelApi` owns provider discovery and execution.

See [CODING_STANDARDS.md](CODING_STANDARDS.md) and [AGENTS.md](AGENTS.md) before changing the code.

## Development

Reading uses the bundled Library catalogue. Opening or importing external text files is not supported.

Chora opens the preferred Library text at launch in a three-column workspace: Dreams Explorer on the left, source reader in the center, and Dream editor on the right. With no Dream open, the editor shows a Workspace prompt to select a Dream from the Explorer. The Explorer uses a compact filesystem-style Dream tree: root Dreams remain directly visible, reader-created folders can be nested, and Dreams can be dragged between folders or back to the root. Shift-click selects a contiguous range of visible Dreams, and dragging any selected Dream moves the complete selection together. Creating a Dream while a folder is selected creates the Dream directly in that folder. Each Dream's Stephanus range appears on the same line as its title. Opening a Dream adds it to a persistent editor tab strip; switching tabs restores that Dream's editor state without moving the reader, while closing a dirty tab saves it before removal.

Prerequisites: Node.js 24 or later and npm.

```bash
npm install
npm run dev:mock
```

Milkdown 7.22 publishes extensionless TypeScript declaration imports. The `postinstall` script runs `scripts/FixMilkdownDeclarations.mjs` to repair only installed Milkdown declaration specifiers for this project's NodeNext resolution. Runtime packages and compiler settings are unchanged. If dependencies are installed with scripts disabled, run `npm run postinstall` before typechecking.

Kimi requires a local `.env.local`:

```text
MODEL_PROVIDER=kimi
KIMI_API_KEY=your-key
KIMI_MODEL=kimi-k2.6
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MAX_COMPLETION_TOKENS=3000
```

Never commit `.env.local` or provider credentials.

### Remote Ollama

Chora can discover and use models installed on an Ollama server through Ollama's native API. Configure the server only in `.env.local`; the endpoint remains in the main process and never crosses into the renderer.

```text
# Preserve MODEL_PROVIDER as the fallback/default provider.
MODEL_PROVIDER=copilot-relay
# Explicitly enable every provider that should appear in the model picker.
MODEL_PROVIDERS=copilot-relay,kimi,ollama

OLLAMA_BASE_URL=http://<ollama-computer-ip>:11434
# Optional comma-separated allowlist. Omit or leave empty to show every installed model.
OLLAMA_MODELS=qwen3.5:9b
# Context window requested from Ollama for each Chora turn.
OLLAMA_CONTEXT_LENGTH=32768
# Bounds remote model discovery so an unavailable server cannot block the conversation UI.
OLLAMA_DISCOVERY_TIMEOUT_MS=10000
# Allows cold model loading on another computer.
OLLAMA_REQUEST_TIMEOUT_MS=300000
# Optional bearer token for an authenticated reverse proxy. Local Ollama itself requires none.
OLLAMA_API_KEY=
```

Use `npm start` when `copilot-relay` is enabled so the launcher also starts the VS Code Relay. Use `npm run dev:ollama` for an Ollama-only development run. Chora discovers installed models from `GET /api/tags` and sends the unchanged Chora system prompt, captured Dream context, conversation history, and reader message to `POST /api/chat`. Requests set `stream: false` and `think: false`; only final `message.content` is saved.

On the remote Windows computer, install and start Ollama, run `ollama pull qwen3.5:9b`, set the user environment variable `OLLAMA_HOST=0.0.0.0:11434` (or bind to that computer's specific LAN address), then quit and relaunch Ollama. Permit inbound TCP port `11434` only on the Private network profile and preferably only from the Chora computer or trusted subnet. Do not expose an unauthenticated Ollama port to the public internet.

From the Chora computer, verify discovery before starting Chora:

```powershell
Invoke-RestMethod http://<ollama-computer-ip>:11434/api/tags
```

The response must include `qwen3.5:9b`. Ollama's local server uses HTTP without authentication by default. For stronger isolation, use a private VPN or an HTTPS reverse proxy with authentication and configure its bearer token through `OLLAMA_API_KEY`.

### VS Code Copilot Relay

The Relay provider uses the GitHub Copilot session already active in a local VS Code Extension Development Host. Configure the same non-empty secret in both places:

```json
{
	"choraCopilotRelay.sharedSecret": "choose-a-long-local-secret"
}
```

Add the matching Chora values to `.env.local`:

```text
COPILOT_RELAY_SHARED_SECRET=choose-a-long-local-secret
# Optional: omit to let VS Code select its default available Copilot model.
COPILOT_RELAY_MODEL_FAMILY=
COPILOT_RELAY_PORT=4319
```

Start Chora with the single `Chora` VS Code Run profile or run:

```bash
npm start
```

The launcher builds the Relay when necessary, opens its Extension Development Host, waits until it is ready, builds Chora, and starts Electron directly. Electron Forge is used only by the packaging commands and is not part of development startup.

`MODEL_PROVIDER` configures the legacy single-provider fallback (`mock`, `kimi`, `copilot-relay`, or `ollama`). When `MODEL_PROVIDERS` is nonempty, its ordered comma-separated provider list supplies all catalogues shown in the existing model picker. A failure in one enabled provider is recorded without hiding models discovered from healthy enabled providers; discovery fails when no enabled provider remains usable. For Relay-backed Clarity Checks, `COPILOT_RELAY_MODEL_FAMILY` optionally selects a Copilot family; when omitted, the Relay uses the first extension-accessible Copilot model returned by VS Code. VS Code-internal `copilot-*` service models are excluded from both discovery and default selection because they cannot accept extension requests. Provider and model settings come from the local environment rather than renderer input. The Relay is loopback-only and rejects requests without the shared secret.

Available verification commands (choose one targeted pass appropriate to the change, following [Build and Test Discipline](CODING_STANDARDS.md#build-and-test-discipline)):

```bash
npm run typecheck
npm test
npm run build
```

The bundled Plato corpus is generated under `corpus/generated/` from PerseusDL. Corpus maintenance commands are documented in [AGENTS.md](AGENTS.md).

## Text domain

`TextDocument` is the canonical work object. It owns immutable, ordered `TextSegment` objects and validates, reconstructs, compares, contains, overlaps, merges, and resolves citations or divisions for exact `TextSelection` ranges. A selection persists `documentId` plus start and end segment positions. A Signal additionally persists its complete passage text and displayed source citation when it is created or updated, so loading the Dream catalogue never reopens the immutable source corpus.

`TextAnnotation` is the base concept for reader-created objects anchored to one exact range, including Dream source passages. Every Signal is a multi-range annotation owned by exactly one Dream. The main-process `Dream` aggregate creates, updates, deletes, and loads its complete child Signal records; `DreamLibrary` coordinates persistence, relative folder placement, and the filesystem folder tree without maintaining a second Signal registry. Renderer editing state has one owner per open Dream tab, with the active Dream represented only by its stable identifier. IPC updates carry only reader-editable fields and relative folder commands, while identity, absolute paths, ownership, work origin, Signals, and timestamps remain authoritative in the main process. Filesystem data uses one current Dream format and one current Signal format.

The renderer's `DreamExplorerController` is the single workflow object for Explorer folder selection and folder/Dream organization commands. `WorkspacePanel` owns DOM rendering and browser events only; selected-folder state belongs to `DreamStore`. Dream creation carries the selected relative folder in its one creation command, and `DreamLibrary` validates and persists that destination atomically.


## Dream Trash

Deleting a Dream retains its complete aggregate, including all Signals, in local Trash. Open **Trash** at the bottom of the Explorer to restore a Dream, delete it permanently, or empty Trash. Records do not expire automatically. Permanent removal requires confirmation and cannot be undone.

Restore preserves the original Dream and Signal identities and recreates the original folder when necessary. Interrupted deletions and restores resume before the catalogue loads at startup. The aggregate payload is retained under `Chora/Trash/DreamBundles` until restore or explicit permanent removal; it is committed before any canonical file is removed. This is an application recovery journal, not a filesystem-wide atomic transaction or a backup against disk loss. Old Markdown files already under `Chora/Trash/Dreams` remain untouched; their previously deleted Signals cannot be reconstructed by this change.


## Reloading the Dream catalogue

Choose **Reload from disk** at the bottom of the Explorer after editing or synchronizing Dream and Signal Markdown files outside Chora. Ordinary catalogue refreshes continue to read the main-process authority; they do not rescan disk automatically. Reload waits for active repository operations, reads Dreams, Signals, and folders as one staged catalogue, then replaces the visible state only after loading and validation succeed. Missing Dreams are removed from the catalogue and their clean editor tabs close.

Reload refuses to proceed while Dream drafts, pending or failed Signal-description saves, or deletion could conflict with the scan. Finish or retry saving first; reload never forces a save that could overwrite external edits. A failed scan keeps the last committed catalogue. Initial-load failures can also be retried without restarting. Files that cannot be read, malformed Dream records, and duplicate Dream identities must be resolved before reloading. Orphan Signals remain untouched for recovery. Reconciliation coordinates Chora's own operations; an external editor or synchronization client can still change files during a scan.


## Error reporting and logs

Operation failures carry a stable error code, recovery category, and diagnostic reference. Feature controllers retain unsaved edits and report user-facing failures through the shared diagnostic mechanism. Expected cancellations do not open error popups. Notifications are queued until dismissed, and their references identify the corresponding log records.

Choose **Help → Open Logs Folder** for the application's Electron logs directory. `chora.jsonl` contains sanitized main-process and renderer diagnostics, including exception causes and stack traces. Files rotate at five MiB with three archives retained; recent in-memory diagnostics are limited to 500 records. Request arguments and reading documents are not logged, and credential fields and configured secrets are redacted. Graceful shutdown flushes admitted log writes; a forced process termination can still lose pending writes. If disk logging fails, recent records remain in memory and the logs command reports the storage problem.

Diagnostic notification UI belongs to `ErrorNotificationPanel`; global renderer exception listeners and main-process notification subscriptions belong to `RendererDiagnosticsController`. `ChoraApplication` only composes their lifecycles. Diagnostic ingestion and append queues are bounded; a failure burst or unavailable disk can omit persistent records, with recent entries retained in memory.


## Renderer workflow owners

`DreamStore` remains the single authority for Dream drafts, editor tabs, catalogue data, and selection. `DreamController` handles editing, source extension, and tab lifecycle. `DreamSaveCoordinator` owns autosave and save ordering; `DreamCatalogueController` owns refresh, reconciliation, and filtering; `DreamExplorerController` implements creation, folders, and moves; `DreamExportController` uses the existing Markdown export formatter for clipboard commands. Generic Chat owns conversational request state independently of Dream editing state.

The shell, resizing, and appearance controls belong to `WorkspaceShellPanel`, `WorkspaceLayoutPanel`, and `ReadingAppearancePanel`. `WorkspaceController` coordinates typed workspace requests and native activation. `ChoraApplication` composes these owners and manages startup and reverse-order disposal. Close and deletion drain in-flight saves, and save responses target their captured Dream.
