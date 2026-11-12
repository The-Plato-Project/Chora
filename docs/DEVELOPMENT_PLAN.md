# Development Plan: Visions, Anchors, and Reader Memory

This plan turns [VISION.md](VISION.md) into a staged implementation. The core
architecture is Library + Visions + exact anchors + Word Lookup. The reader's
prose remains authoritative; Chora does not require a separate relationship
record or use a model to interpret the text.

## Product Invariants

- A reader can create a Vision without selecting a passage.
- A Vision is a sustained Markdown document scoped to one work.
- Exact text becomes anchored only through an explicit reader action.
- The same anchor may appear in several Visions and several places in one
  Vision.
- Every placement can return to its exact canonical source.
- Every Greek word displayed in a range can open Word Lookup for its exact
  occurrence.
- Candidate lemmas remain unresolved until the reader chooses one.
- An index may accelerate discovery but must never restrict valid results.
- Reader writing stays local.
- Model-assisted retrieval is deferred until the deterministic workflow has
  been exercised in ordinary use.

## Implemented Foundation

### 1. Vision documents

- Vision storage is independent and work-scoped.
- Each Vision has a stable ID, title, Markdown body, folder path, and
  timestamps.
- The Explorer supports nested folders, empty folders, creation, deletion, and
  drag-to-move.
- Open Visions use a shared document tab strip.
- Tab actions include Rename, Save, Copy as Markdown, and Delete.
- The editor provides Write, Markdown, and Preview modes.

### 2. Exact anchor contract

- Anchors use the shared versioned text-selection contract.
- Identity is deterministic from kind and canonical range.
- The canonical PlatoSI-backed text validates every stored anchor.
- Anchors are persisted as work-scoped JSON records.
- Invalid locations, changed Greek, and stale text versions fail explicitly.

### 3. Embedded placements

- Word and range placements are structured editor nodes.
- Canonical Markdown stores `chora-word` and `chora-range` directives.
- Placements retain stable anchor, placement, and Vision identities.
- Write and Preview reconstruct structured nodes.
- Markdown mode and clipboard output conceal metadata behind atomic
  `[[selected Greek]]` tokens.
- Editing surrounding prose does not alter source identity.

### 4. Reader insertion and navigation

- Native reader selection supports exact words, phrases, and cross-segment
  passages.
- Drag and drop inserts at the chosen Vision position.
- Anchor copy and paste inserts at the Vision cursor while retaining plain
  Greek clipboard text for other applications.
- Word placements open Word Lookup.
- Range placements navigate to the complete source.
- Each word displayed inside a range can independently open Word Lookup.
- Reader Back and Forward preserve explicit navigation history.

### 5. Reverse Vision discovery

- Word Lookup resolves linked Visions from exact versioned anchors.
- A range placement contributes every exact word occurrence it contains.
- Linked results open the parent placement inside the Vision.
- The authoritative anchors and Vision documents are the fallback when an
  accelerator is absent or stale.
- Occurrence rows show an icon only when linked Visions exist.

### 6. Reading appearance

- Reading font family and size are persisted.
- Greek anchor highlight color is persisted.
- The default anchor color remains `#b65e3b`.
- Anchors use a light background without a bold border or selected-node
  outline.
- Focusing the Vision editor does not draw an accent frame around the document.

## Current Phase: Use and Refine the Deterministic Loop

The next work is not model integration. The current workflow must be used during
real reading and writing so its friction becomes visible.

Focus areas:

- writing continuously in a Vision for an extended session;
- adding words, phrases, and passages while writing;
- selecting individual words inside range placements;
- returning to exact source locations;
- reopening linked Visions from later occurrences;
- managing many Visions and nested folders;
- confirming autosave, close, rename, copy, and delete behavior;
- checking that highlight color and layout settings remain comfortable.

Fix concrete problems discovered through this use before expanding the product.

## Next Deterministic Work

### Vision discovery

- Add search that can find Vision titles and reader prose without losing folder
  context.
- Improve direct opening at a placement when a Vision contains many anchors.
- Keep result explanations factual: exact occurrence, exact anchor, or explicit
  reader choice.

### Reader-created structure

- Design exact named markers for movements or sections noticed by the reader.
- Keep markers independent from Vision documents and anchor placements.
- Build a personal table of contents without changing the canonical Greek.

### Reliability

- Preserve unsaved writing when a save fails.
- Make catalogue operations atomic and report filesystem failures clearly.
- Validate anchor reconstruction after restart and canonical text changes.
- Add targeted tests for nested folders, cross-segment anchors, placement
  round-trips, and reverse links.
- Profile visible-workspace typing before making broad performance changes.

### Backup and portability

- Define a complete export that includes Vision Markdown, anchors, notes, and
  relevant preferences.
- Keep exported data inspectable and avoid opaque databases where plain files
  are sufficient.
- Do not imply multi-device synchronization until conflict behavior is
  explicitly designed.

## Optional Local Interlocutor Experiment

The reader has requested a separate, removable Goose experiment with a local
model. Its reader-facing interlocutor is **The Agentian Stranger**. Chora owns
the [behavioral directives](STUDY_PARTNER_DIRECTIVES.md), including discernment
about when a contribution serves the present inquiry. These remain consistent
across backends. The experiment's context, read-only evidence tools, backend
boundary, and acceptance gates are defined in
[the interlocutor experiment](GOOSE_STUDY_PARTNER_EXPERIMENT.md).
The current [topic-retrieval trial](TOPIC_RETRIEVAL_EXPERIMENT.md) is canonical-only:
dictionary-backed passage candidates and exact context reads, without Visions or
editor drafts. The [reading principles](READING_PRINCIPLES.md) guide attention
without authorizing hidden-meaning claims. Evaluate useful and incidental
matches before expanding the tools. Runtime starts only on Send; ordinary
reading and writing remain independent of an agent.

## Deferred Work

The following work is deliberately deferred:

- semantic retrieval over reader writing;
- local-model comparison of Visions;
- automatic thematic suggestions;
- a derived relationship graph;
- cross-work relationships;
- translations beside the Greek;
- multi-device synchronization.

When retrieval is eventually considered, it must:

- be optional and local-first;
- state exactly what reader material it reads;
- return candidates rather than conclusions;
- explain why each candidate appeared;
- preserve deterministic and model-derived reasons separately;
- leave every permanent relationship to the reader.

## Completion Standard

A phase is complete only when:

1. the measurable behavior works through the full UI path;
2. saved data survives restart;
3. failures are visible and do not look like success;
4. exact source navigation remains correct;
5. authoritative data remains available when an index is missing;
6. focused tests and all production builds pass;
7. the user has exercised the behavior in the actual application.
