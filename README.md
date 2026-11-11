# Chora

Chora is a desktop environment for reading Plato and developing sustained
writing beside the Greek text. It keeps exact words and passages connected to
the reader's own writing without asking a model to interpret the text or choose
which connections matter.

PlatoSI supplies the canonical texts and linguistic material. Chora supplies
the reading workspace, Visions, exact anchors, Word Lookup, and local
persistence.

## What You Can Do

- Read Plato's works with book and Stephanus navigation.
- Search within the open work.
- Create Markdown-based **Visions** without first selecting a passage.
- Organize Visions in nested folders.
- Keep multiple Visions open in document tabs.
- Write in **Write**, **Markdown**, or **Preview** mode.
- Drag a Greek word, phrase, or passage from the reader into a Vision.
- Copy a reader selection as an anchor and paste it at the Vision cursor.
- Return from an anchored placement to its exact source.
- Open Word Lookup from one Greek word inside a Vision placement.
- Explore candidate lemmas, dictionary material, occurrences, morphology,
  related lexical material, and personal-name research.
- See which Visions contain an exact occurrence.
- Choose the highlight color used for Greek anchors.

## First Use

1. Start Chora and choose a work in the Explorer.
2. Select **New Vision**.
3. Write normally in the Vision.
4. Select a Greek word, phrase, or passage in the reader.
5. Drag it into the Vision or copy and paste it as an anchor.
6. Select a placed Greek word to open Word Lookup for that exact occurrence.
7. Use a placement's context menu to return to its source.

A Vision can begin before the reader has selected any source text. The exact
selection supports the writing; it does not contain or limit the thought.

## Reading

The Library catalogue comes from PlatoSI. Chora prefers the last opened work at
startup and otherwise opens the Republic when available.

The reading toolbar supports book navigation where applicable, Stephanus
navigation, and text search. Explicit source jumps made through anchored
placements or Word Lookup are recorded in Reader Back and Forward history.
Ordinary scrolling is not added to that history.

The reading settings panel controls:

- serif or sans-serif reading text;
- reading text size;
- light or dark appearance;
- the Greek anchor highlight color.

## Visions

A Vision is a sustained Markdown document associated with one work. It may
contain ordinary prose, headings, lists, quotations, links, code, tables, and
exact Greek placements.

### Editor modes

- **Write** — rich Markdown editing with anchored Greek placements.
- **Markdown** — direct Markdown editing. Placement metadata is concealed
  behind atomic `[[selected Greek]]` tokens.
- **Preview** — read-only rendered Markdown with active placements.

All three modes operate on the same authoritative document.

### Folders and tabs

The Explorer shows Visions beneath their work. Create nested folders, create a
Vision in a chosen folder, and drag a Vision between folders. Empty folders are
preserved. A folder must be empty before it can be deleted.

Each opened Vision has a document tab. Its context menu provides **Rename**,
**Save**, **Copy as Markdown**, and **Delete**.

### Exact placements

An exact selection can be added by drag and drop or anchor copy and paste. Chora
validates the selection against the canonical text before storing it. Reader
copy includes ordinary Greek text for pasting outside Chora; **Copy text only**
omits the anchor metadata.

- A word placement opens Word Lookup for its original occurrence.
- A phrase or passage placement returns to the complete exact source.
- Each Greek word displayed inside a phrase or passage can also open Word
  Lookup for that word's exact occurrence.
- A placement retains its source identity when prose around it changes.

## Word Lookup

Word Lookup preserves ambiguity rather than forcing one analysis. If PlatoSI
returns several lemma candidates, the reader chooses which one to inspect.

Its primary columns are:

- **Dictionary** — dictionary material, related lemmas, personal-name research,
  and reader notes where available.
- **Occurrences** — a compact occurrence list and selected-occurrence detail.

The selected occurrence detail shows:

1. the Greek passage;
2. morphology for that exact occurrence and selected lemma;
3. Visions linked through exact anchors.

An occurrence icon appears only when one or more Vision placements contain that
exact word. Selecting a linked Vision opens it at the relevant placement.

Dictionary order, morphology candidates, name research, and lexical relations
are material for the reader. Chora does not use them to decide the meaning of a
word in context.

## Local Files

Reader-authored documents and anchors are stored under the user's Documents
folder:

```text
Documents/Chora/<work name>/Visions/
Documents/Chora/<work name>/Anchors/
```

Visions are Markdown files. Nested Explorer folders correspond to real
directories beneath `Visions`. Anchors are work-scoped JSON records.

Lemma notes, name-research notes, reading preferences, and layout preferences
use Chora's local application data. Backing up only the Documents directory
does not preserve those preferences and notes.

Chora has no built-in account synchronization or complete backup command.
Maintain an independent backup of both locations.

## Privacy and Models

Reading, writing, anchors, dictionary material, morphology, and occurrence
navigation do not require a language model.

PlatoSI may use a configured local model for optional personal-name synthesis.
PlatoSI owns that configuration and its research cache. Chora does not contain
a general chat runtime and does not send the reader's complete Vision library
to a model.

## Development

### Prerequisites

- Node.js 24 or newer
- npm
- a local PlatoSI checkout and Python environment

Copy `.env.example` to `.env.local` and set the local PlatoSI paths. Do not
commit `.env.local`.

### Commands

```bash
npm install
npm start
npm run typecheck
npm test
npm run build
npm run package
```

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

See [VISION.md](VISION.md) for product principles,
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for current delivery phases, and
[CODING_STANDARDS.md](CODING_STANDARDS.md) for implementation conventions.
