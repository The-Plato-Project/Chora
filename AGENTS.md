# Agent Guidance for Chora

## Project Identity

Chora is an Electron environment for sustained reading and writing about Plato.
PlatoSI supplies the canonical text and linguistic material. Chora owns the
reader's workspace, Visions, exact text anchors, notes, and settings.

The top-level source folders are real Electron runtime boundaries:

- `src/main/` — privileged host code for Library, Visions, anchors, PlatoSI,
  shell integration, bootstrap, and diagnostics.
- `src/preload/` — the small context-isolated IPC bridge.
- `src/renderer/` — Library, Vision, Word Lookup, workspace, shared UI, and
  renderer infrastructure.
- `src/shared/` — pure cross-process contracts, types, and deterministic logic.

Within a process, organize by product feature. Panels own DOM behavior,
controllers coordinate workflows, stores own renderer state, and gateways own
IPC. Main-process services own use cases; repositories own persistence. Do not
add empty layers or generic manager classes.

## Product Direction

Read `docs/VISION.md` before making product, UX, or architecture decisions.
Use this question as the design test:

> Does this deepen the conversation between the reader and the text?

The permanent workflow is writing-first:

- A reader can create a Vision without first selecting a passage.
- A Vision is an authoritative Markdown document associated with one work.
- Exact Greek words, phrases, and passages can be placed inside Vision prose.
- Those placements remain connected to exact, versioned source locations.
- The reader's prose expresses relationships. Chora must not decide what a
  passage means or establish a connection for the reader.
- Linguistic material and reader writing remain distinct.
- Uncertainty is valuable and must not be rewritten as a conclusion.
- Any future retrieval system may resurface candidates with reasons, but only
  the reader can make a relationship part of their writing.

## Storage Invariants

- Visions are local Markdown files under
  `Documents/Chora/<work name>/Visions/`.
- Nested Vision folders are real directories. Empty folders are part of the
  catalogue and must be retained.
- Exact anchors are work-scoped JSON records under
  `Documents/Chora/<work name>/Anchors/`.
- Anchor identity is deterministic from its kind and canonical versioned range.
- An anchor is independent of every Vision placement that uses it.
- Word placements are serialized as `chora-word` directives and larger
  selections as `chora-range` directives.
- Placements retain stable anchor, placement, and Vision identities.
- Markdown mode and clipboard output may conceal directive metadata behind an
  atomic `[[selected Greek]]` token, but canonical storage must remain intact.
- A reverse index is only an accelerator. If it is absent or stale, Chora must
  fall back to authoritative anchors and Vision documents rather than hide a
  valid result.

## Active User Experience

- The Explorer lists Library works, Visions, and Vision folders.
- Each open Vision has a document tab. Its editor provides **Write**,
  **Markdown**, and **Preview** modes over one authoritative document.
- The reader can drag an exact selection into a Vision or copy and paste it as
  an anchor.
- Each Greek word inside a range placement remains independently clickable for
  Word Lookup.
- Word and range references use the configured light highlight without a bold
  border or focus outline.
- Greek anchor highlight color is a persisted reading setting. The default is
  `#b65e3b`.
- Word Lookup has Dictionary and Occurrences as its primary columns.
- Multiple lemma candidates remain separate; Chora must not silently decide
  which one is contextually correct.
- Occurrence detail shows the passage, exact-occurrence morphology, and linked
  Visions in that order.
- Linked Visions are resolved from exact versioned anchors, including each word
  contained in a phrase or passage anchor.
- Reader Back and Forward track explicit source navigation, not ordinary scroll.

## Architecture Boundaries

- The renderer has no direct filesystem or network access.
- Use `IPC_CHANNELS` and the typed preload API for every cross-process call.
- Components communicate through `ChoraEventBus`; panels do not call each other.
- Use `ErrorManager` for application logs, diagnostics, and user-facing errors.
- PlatoSI owns canonical texts, dictionary material, morphology, occurrences,
  related lexical material, and name research.
- Chora has no model-provider or chat runtime.
- Reading uses PlatoSI's canonical catalogue. Arbitrary external text import is
  not supported.

## Build and Development

Prerequisites: Node.js 24+ and npm.

```bash
npm install
npm start
npm run typecheck
npm test
npm run build
npm run package
```

On Windows, use `npm.cmd` when PowerShell blocks `npm.ps1`.

## Code Conventions

Keep design documents, architecture reports, and behavioral specifications under
`docs/`, and maintain the index in `docs/README.md`.

Read `CODING_STANDARDS.md` first. Important rules include:

- PascalCase for exported functions, types, classes, interfaces, and public
  members.
- camelCase for locals, parameters, and private fields.
- Tabs and Allman braces.
- One operation per line.
- Prefer a single return at the end of a function.
- Async methods use an `Async` suffix where applicable.
- Relative TypeScript imports include `.js`.
- Prefer `const` and `readonly`.
- Keep main-process responsibilities out of the renderer.
- Preserve type safety and report failures explicitly.

## Configuration and Tests

Copy `.env.example` to `.env.local` and configure the PlatoSI paths described in
`README.md`. Never commit `.env.local`.

Tests use Vitest:

- `tests/main/*` covers main-process modules.
- `tests/renderer/*` covers renderer modules.

Use the smallest validation command that covers a change, then run the full
build and suite for architecture-wide work.
