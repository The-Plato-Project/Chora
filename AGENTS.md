# Agent Guidance for Chora

## Project Identity

Chora is an Electron research reading environment. Its top-level source folders represent real Electron runtime boundaries:

- `src/main/` — privileged Electron host code, organized into Library, Dreams, Signals, models, prompts, shell, bootstrap, and diagnostics, with IPC controllers at feature boundaries
- `src/preload/` — the deliberately small, context-isolated IPC bridge
- `src/renderer/` — the browser UI, organized into Library, Dreams, Signals, workspace, application composition, shared UI, and renderer infrastructure under `core/`
- `src/shared/` — pure cross-process contracts, types, and deterministic domain logic

Within a process, organize primarily by product feature. Renderer panels own DOM behavior, controllers coordinate workflows, stores own state, and gateways own IPC. Related features share an existing owning store where appropriate: Signal editing uses `DreamStore`. Main-process IPC controllers expose use cases; domain owners, services, and repositories separate domain behavior, external responsibilities, and persistence. `DreamLibrary` owns the `Dream` aggregates and their child Signals. Do not add empty layers or generic manager classes. Use `core/` only for mechanisms shared across multiple renderer features, such as events, diagnostics, and session persistence.

PlatoSI supplies the canonical Plato catalogue and text used by Chora, including *Republic*.

## Product Vision

Read `VISION.md` in full before making product, UX, architecture, or implementation decisions. Treat it as Chora's design compass, not as optional background material.

Evaluate every proposed feature against its guiding question:

> **Does this feature deepen the conversation between the reader and the text?**

Keep the reader-text relationship at the center. The model should support attention, memory, and continuing inquiry without replacing the reader's judgment or presenting itself as the authority.

## Build and Development

Prerequisites: Node.js 24+, npm

```bash
npm install
npm start               # builds and starts Chora with PlatoSI
```

Other essential commands:

```bash
npm run typecheck       # TypeScript only, no emit
npm test                # vitest
npm run build           # main + preload + renderer
npm run package         # electron-forge package
```

## Code Conventions

Read `CODING_STANDARDS.md` first. This project uses the C#-style rules described there, applied to TypeScript:

- PascalCase for exported functions, types, classes, interfaces, and public members.
- camelCase for local variables, parameters, and private fields.
- Tabs for indentation.
- Opening braces on the next line (Allman style).
- One operation per line; no combined statements.
- Single `return` at the end of a function; avoid early returns.
- Explicit types when clarity matters.
- Async methods named with an `Async` suffix where applicable.
- Import with `.js` extensions for cross-module TypeScript imports (NodeNext module resolution).
- Prefer `const` / `readonly`; mutable `let` only when necessary.
- Keep main-process responsibilities out of the renderer; use `IPC_CHANNELS` for all cross-layer communication.
- Panels own DOM and local user interaction; controllers coordinate workflows; stores own renderer state; gateways own IPC.
- Components communicate through the typed `ChoraEventBus`; do not call other panels directly.
- Use `ErrorManager` for application logs, diagnostics, and user-facing errors; do not scatter raw `console` calls through application code.
- Reader inquiries use the owning feature gateway, typed preload API, and main-process PlatoSI client.

## Architecture Boundaries

- The renderer has no direct filesystem or network access. Use the IPC channels defined in `src/shared/contracts/IpcChannels.ts`.
- PlatoSI owns model-provider configuration; Chora stores only its local PlatoSI paths in `.env.local`.
- Dreams and Signals are local Markdown files under `Documents/Chora/<work name>/Dreams/` and `Documents/Chora/<work name>/Signals/`. The main process owns persistence, folder placement, and recoverable aggregate trash.
- Catalogue reads use the in-memory `DreamLibrary`; explicit **Reload from disk** stages and validates a filesystem rescan before replacing it.
- Reading uses PlatoSI's canonical catalogue and text; opening or importing external text files is not supported.
- Dream sources and Signal selections use PlatoSI's versioned Stephanus-relative location contract.

## Current Model Workflow

PlatoSI owns model configuration and inquiry execution. Chora has no model-provider or chat runtime. `ChatRepository` remains only to preserve previously saved conversation data when Dreams enter or leave Trash.

## Configuration

Copy `.env.example` to `.env.local` and configure the PlatoSI paths described in [README.md](README.md#development). Never commit `.env.local`.

## Testing

Tests are in `tests/` and run with Vitest. Mirror the source layout:

- `tests/main/*` for main-process modules
- `tests/renderer/*` for renderer modules

Follow the Build and Test Discipline section in CODING_STANDARDS.md. Run one targeted validation pass appropriate to the change. Create new tests only when explicitly required by the task or approved by the user; do not automatically repeat full builds, test suites, or lint passes. If validation fails, report the failure and likely cause before making further changes, and obtain approval before entering an iterative test-and-fix cycle.

## Common Gotchas

- TypeScript module resolution is `NodeNext`; always include the `.js` extension in relative imports, e.g. `../shared/chat/ChatTypes.js`.
- `tsconfig.json` extends `tsconfig.main.json`; the latter is the source of compiler options.
- The renderer build uses Vite; the main build uses `tsc`.
- The bundled app loads from `.vite/build/` and `.vite/renderer/`.

## When in Doubt

Preserve the existing architecture and conventions. Match the style of neighboring files. Do not introduce new dependencies without checking `package.json` first.
