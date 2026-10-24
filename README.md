# Chora

*Where texts dream.*

Chora is an Electron environment for close reading. The reader remains in direct conversation with the text; the model sustains that encounter without replacing it. Read [VISION.md](VISION.md) before making product or design decisions.

## Current experience

Chora has a workspace with a persistent reader, Explorer, and contextual editor:

- **DocumentPanel** — the source text, exact locators, selection, and reading controls.
- **DreamPanel** — capture and editing of reader-authored Dreams.
- **Ideas** — work-scoped interpretations connected to reader-authored Signals.

A Dream contains an immutable source passage, zero or more manually selected signals, an optional title, and open-form exegesis. It has no required metadata, automatic signals, tags, folders, or automatic links.

## Dream capture

1. Select text in the source document.
2. Right-click and choose **Create Dream**, or press `Ctrl/Cmd+D`.
3. Write exegesis and optionally provide a title.
4. To add a signal, select exact text in either the original document or the copied source passage and choose **Add Signal**.
5. Chora autosaves after you pause, when the window loses focus, and before the editor closes. `Ctrl/Cmd+Enter` remains available for an immediate save.

The source passage remains immutable inside the editor. To extend it, select more source text in the Document panel and choose **Add to Dream**. Signal descriptions are optional, multiple signals retain source order, and a newly added signal is brought into view automatically. Deleting a Dream always requires an explicit in-app confirmation with Cancel as the default action.

Signals and Dream descriptions use a shared Milkdown editor with bold, italic, lists, quotations, links, and undo/redo. Formatting is saved as Markdown in the existing Signal description and Dream reflection fields. Editors retain their contents and undo history when switching views or selecting another Signal. Links are editable but do not navigate from the editor; remote images are displayed as alt text without fetching them. The Dream action menu can copy the complete Dream as Markdown, including its source passage, Signals, observations, resonances, attached passages, and General Observations.

Signals are work-owned observations rather than children of Dreams or Ideas. Each Signal owns one or more exact text selections and one shared description; Dreams and Ideas only associate with Signal identities, and the same Signal may belong to either or both. When the final Dream or Idea association is removed, the unassociated Signal is deleted. A Signal component may contain a text selection of any length. While a Signal is selected, selecting another passage from the same work and choosing **Add to Selected Signal** adds that exact component without including the intervening text. The action is available in both the main text and Dream source passage, and is disabled when the selected passage is already an exact component of that Signal. The Signal editor lists every passage in source order; each row navigates to its exact text and can be removed unless it is the final passage. A Signal title defaults to the first passage and can be renamed independently. Components highlight together when the Signal is opened.

Signal description editors keep typing and selection state locally while persistence runs. Description writes are serialized per Signal, newer pending text supersedes older pending text, and an obsolete save response is never applied over the active editor.

Ideas use the same catalogue-and-editor structure as Dreams: the left tab contains a searchable flat list with a new-Idea action, while the selected Idea opens in the shared editor pane. The Idea title remains above a bounded **Signals | Seeing** tab control. Seeing is the full-height Markdown writing surface for the Idea's existing persisted content, giving the reader the same spacious, internally scrolling composition used by Dream Reflections. The Signal rail and selected-Signal editor scroll independently inside the available editor height, so Save remains visible without scrolling the whole document. Their shared divider can be dragged horizontally or adjusted with the keyboard, and truncated Signal rows show the complete Signal text on hover. The Dream source passage is open by default and has a dedicated horizontal divider for vertical resizing. Chora restores user-adjusted workspace columns, Explorer collapse state, Signal-list width, dictionary height, source-passage height, and writing-surface heights across application launches. Dream and Idea deletion is available only from the active document's upper-right actions menu and always requires explicit confirmation. Idea rows show their connected Signal count and are not grouped by Book. An Idea may be saved without Signals as a placeholder and receive Signals later. Closing a populated new Idea prompts the reader to save it, close it without saving, or keep it open; a failed save never discards the draft. Creating a new Idea from the Add Signal to Idea picker saves it immediately, places it in the Idea catalogue, and opens the persisted Idea. With an Idea or Dream open, selecting text and choosing **Add Signal** routes the Signal to the documents that already contain its selection or relationship: one matching Dream or Idea opens immediately, several produce a destination popup, and no match produces a popup for creating a Dream or Idea. The exact Signal is selected for immediate editing without duplicating an existing relationship. Expected workflow choices and application failures use dismissible popups rather than persistent page banners. The menu action is disabled when neither document type is open. An Idea's single **Add new** action opens the searchable work-wide Signal browser. Manual search is the default; readers may enable **Use AI** to search all observed work-owned Signals, including Signals associated only with Ideas, and receive up to five strong connections with concise rationales. Accepting an AI suggestion stores its rationale on that Idea-Signal relationship and displays it as **Why this Signal connects** inside the Idea; it does not alter the shared Signal description or appear in other Ideas. Dream and Idea editors use the same Signal list/detail control, and selecting a Signal navigates the reader to its source text. Signal association actions appear as icons at the far right of the description formatting bar, with labels available through hover tooltips and accessible names. A Dream Signal's single **Add to Idea** menu lists connected Ideas first with lightbulb icons and direct navigation, followed by unconnected Ideas with plus icons for immediate association. Every Signal also provides a confirmed **Remove from Dream** or **Remove from Idea** action that changes only the current association. Dragging a Signal onto an existing Idea associates it without removing it from its current Dream or Idea; dropping it on the Ideas heading creates a new Idea containing that Signal.

Each Dream also has a **Clarity Check**. The model must account for every Signal and Reflection, then identify the overarching logos that makes those observations one developing story. It traces how each Signal advances, complicates, turns, or completes that same thread. It does not reinterpret the passage, rewrite the reader's claims, add philological corrections, or introduce outside themes. If a Signal or transition does not fit the apparent logos, the response identifies that precise gap rather than inventing a connection. The reader may revise the Dream and check again until the whole thought has become clear.

The Explorer may be collapsed by dragging its divider to the left. Its collapsed rail retains dedicated Ideas and Dreams buttons; either button restores the Explorer and focuses that folder. Dragging the collapsed divider to the right also restores the Explorer immediately.

## Local Dream library

New Dreams are readable Markdown files under:

```text
Documents\Chora\Dreams\<work-id>\<title>--<id>.md
```

Untitled Dreams use `dream--<id>.md`. The main process owns persistence; the renderer has no filesystem access. Writes use a temporary file followed by an atomic rename. Deleted Dreams are moved out of the visible library into `Documents\Chora\Trash\Dreams` rather than permanently unlinked.

Dream catalogue items show the source's full locator range. The Explorer's Dream document icon beside a Stephanus label opens the catalogue filtered to Dreams whose saved source spans overlap that passage, including intermediate passages. Signals do not affect this Dream association. A lightbulb marker lists Ideas whose connected Signals overlap the passage and opens the only Idea directly or asks the reader to choose among several. Both marker tooltips list the associated document titles. Passage filtering clears the previous keyword query, can be narrowed with search, and has an explicit clear button. It does not open an editor or move the reading position; opening a different work clears the passage filter.

## Architecture

```text
src/main/         privileged Electron host, grouped by product feature
src/preload/      minimal typed context-isolated bridge
src/renderer/     browser UI with feature Panels, Controllers, Stores, and Gateways
src/shared/       cross-process contracts, types, and pure domain logic
Prompts/          model system prompts
```

See [CODING_STANDARDS.md](CODING_STANDARDS.md) and [AGENTS.md](AGENTS.md) before changing the code.

## Development

Chora opens the preferred Library text at launch in a permanent three-column workspace: Dreams Explorer, Dream editor, and source reader. With no Dream open, the middle editor shows Open Dream and Create Dream actions. The Explorer uses a compact selected-text-to-Book-to-Dream tree with each Dream's Stephanus range on the same line as its title. Opening a Dream adds it to a persistent editor tab strip; switching tabs restores that Dream's editor navigation and follows its source in the reader, while closing a dirty tab saves it before removal.

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

When the Relay is running, the model selector lists every Copilot model family available in that VS Code session. `COPILOT_RELAY_MODEL_FAMILY` is optional; when omitted, model operations without an explicit selection use VS Code's first available Copilot model. A selected model is saved with its conversation. Choosing another model in a saved chat asks for confirmation and starts a new chat, keeping the selected signal and unsent draft; the original conversation remains in history. Model switching is disabled while a response is in progress. The Relay is loopback-only and rejects requests without the shared secret.

Verification commands:

```bash
npm run typecheck
npm test
npm run build
```

The bundled Plato corpus is generated under `corpus/generated/` from PerseusDL. Corpus maintenance commands are documented in [AGENTS.md](AGENTS.md).

## Text domain

`TextDocument` is the canonical work object. It owns immutable, ordered `TextSegment` objects and validates, reconstructs, compares, contains, overlaps, merges, and resolves citations or divisions for exact `TextSelection` ranges. A selection persists only `documentId` plus start and end segment positions; selected words, `Citation` (`system`/`value`), and `DocumentDivision` (`type`/`label`) are always derived from the document.

`TextAnnotation` is the base concept for reader-created objects anchored to one exact range, including Dream source passages. Signals are work-owned multi-range annotations with ordered exact components, while Dreams associate canonical Signals only by identity. `TextRelationship` groups any two or more annotations without source/target direction or member roles. It is currently a shared domain API; relationship persistence and UI are not yet wired into the application. IPC and filesystem data are explicit current-format snapshots decoded at those boundaries.
