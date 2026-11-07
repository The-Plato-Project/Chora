# Development Plan: Writing, Signals, and Reader Memory

This plan translates [VISION.md](VISION.md) into a staged transition from the current passage-bound Dream workflow to a writing-first workspace with durable, reader-confirmed relationships.

The replacement must be built and exercised before old code is removed. Existing Dreams, Signals, Reflections, passages, and Trash records remain reader data and must stay recoverable until an explicit migration or archival decision is made. [README.md](README.md) documents the currently implemented behavior during this transition.

## Target Experience

The reader opens a dialogue and writes continuously in the middle workspace without first creating a container from a text selection. They can bring exact Greek words and passages into that writing as anchored evidence. Clicking an anchor returns to the source; clicking a Greek word can open the same linguistic evidence available through Word Lookup.

When the reader notices that several pieces of evidence may belong together, they can preserve that relationship as a Signal. A Signal can grow across sections and distant parts of a dialogue. It can remain a question or unresolved possibility.

While the reader continues, Chora can surface a small number of earlier thoughts that may be relevant. Each candidate explains why it appeared. The reader decides whether to open it, connect it, dismiss it, or ignore it. No model or retrieval system establishes the relationship for them.

The first release does not require semantic retrieval. It succeeds when a reader who referenced a money-related word while writing about Cephalus can select that word later in Thrasymachus, see the earlier Dream in Word Lookup, reopen it at the reference, add the new passage, and continue the existing inquiry.

## Transition Rules

- Build the new workflow beside the existing Dream and Signal workflow.
- Do not delete, rewrite, or silently migrate reader files while the replacement is experimental.
- Keep current exact-selection reconstruction and navigation working.
- Reuse proven Markdown editing, autosave, layout, Word Lookup, and PlatoSI boundaries where they fit.
- Treat the current Dream-owned Signal model as transitional, not as the target domain.
- Remove old UI and persistence code only after the replacement is working and migration behavior has been decided and tested.

## Product Invariants

- The writing surface is primary; a passage selection is not required to begin thinking.
- Exact text remains available beside every observation that cites it.
- A selection or note does not automatically become a completed Signal.
- A Signal is a reader-authored relationship among evidence.
- The same evidence may participate in several Signals.
- A Signal may cross authored sections and distant dialogue locations.
- Uncertainty and unresolved questions must be preserved.
- Retrieval may suggest; only the reader confirms.
- Every suggestion must state why it appeared.
- Deterministic textual or linguistic evidence must remain distinguishable from model similarity.
- The graph is an underlying result of reading, not a form the reader must maintain manually.
- Reader writing remains local unless a future, explicit model action identifies exactly what will be read.

## Working Domain Concepts

These names describe responsibilities, not final class or storage names.

### Structural section

An authored division or transition in a dialogue. Chora may provide a cultivated structural map, and readers may eventually create personal divisions. A structural section is navigation and context; it must not imply that adjacent parts are unrelated.

### Writing document

A sustained reader-authored text associated with a dialogue or inquiry. The current working product name may remain **Dream** during the transition. It can cite many distant passages and words. It may remember an origin passage, but it is not owned or bounded by that passage.

### Text anchor

An exact, PlatoSI-versioned reference to a word, phrase, or passage. It preserves the original Greek, canonical location, and enough context to reconstruct and navigate safely.

### Signal

A reader-authored relationship that gathers one or more anchors and the reader's developing account of why they may belong together. A Signal can grow and can remain unresolved.

### Candidate memory

An earlier piece of reader writing or a Signal surfaced for possible relevance. It records why it was retrieved but is not a graph relationship until the reader confirms one.

### Confirmed connection

A durable reader action connecting evidence, writing, or Signals. This forms the graph beneath the reading experience.

## Foundation Data Model

The names below are provisional, but their separation is required.

### Dream document

The durable reader-authored document:

- stable identity;
- work or dialogue scope;
- title;
- Markdown or structured editor content;
- created and modified times;
- optional origin anchor recording where the thought began;
- no required owning passage.

### Anchor

One canonical reference:

- stable identity;
- work and canonical text version;
- start and end `{ stephanus, offset }` locations;
- exact selected Greek;
- reference kind such as word, phrase, passage, or range;
- enough context to validate and reconstruct the selection.

An anchor is reusable. The same anchor may appear in several Dreams and Signals.

### Word evidence selection

Word-specific state associated with a word anchor:

- exact surface form;
- unresolved lemma candidates returned by PlatoSI;
- reader-selected lemma when the reader explicitly chooses one;
- evidence version or digest needed to detect stale derived data.

Dictionary entries, morphology, and occurrence lists should be retrieved from PlatoSI rather than copied permanently into every Dream.

### Dream reference placement

The many-to-many relationship between a Dream and an anchor:

- Dream identity;
- anchor identity;
- stable placement identity inside the document;
- display mode such as inline word, phrase, quotation, or collapsed range;
- optional reader-authored label;
- ordering or editor position needed to reopen the Dream at the reference.

This relationship is what makes reverse discovery possible.

### Reverse reference index

A rebuildable accelerator from canonical evidence to Dream placements:

- exact anchor to Dream placements;
- confirmed lemma to word-anchor placements;
- unresolved candidate lemma to separately labelled possible matches;
- confirmed Signal membership to related anchors and Dreams.

The index is not the source of truth. If it is incomplete or stale, Chora must rebuild it or fall back to authoritative Dream-reference records rather than hiding valid reader material.

## Foundation User Flow

The first implementation should support this complete loop before adding model retrieval.

1. The reader creates a Dream without selecting a passage.
2. The Dream opens as a continuous writing document.
3. The reader selects a Greek word in the dialogue and drags it into the Dream.
4. Chora inserts an inline word reference backed by an exact anchor.
5. Selecting that reference opens Word Lookup for the original occurrence.
6. The Dream saves its writing and reference placement locally.
7. Later, the reader selects another occurrence of that word or confirmed lemma.
8. Word Lookup shows a **Your Dreams** section with the earlier Dream and the reason it matched.
9. Selecting the result opens the Dream at the earlier reference.
10. The reader adds the current occurrence to that Dream and continues writing.

Phrase and passage references use the same flow. Their visual presentation becomes more compact as the selected range grows, but they use the same anchor contract.

## Foundation UI Surfaces

### Dream editor

- Create and open a Dream without requiring a source selection.
- Accept dropped words, phrases, and passages.
- Render short references inline and longer references as compact quotation or range cards.
- Preserve ordinary Markdown writing around references.
- Open the source or Word Lookup from a reference.
- Save failures explicitly without losing the unsaved document.

### Word Lookup: Your Dreams

Present reader history separately from dictionary and morphology evidence:

- **Exact occurrence** — this canonical anchor appears in these Dreams.
- **Same selected lemma** — the reader explicitly chose the same lemma for these references.
- **Possible same lemma** — evidence candidates overlap, but the reader has not resolved them.
- **Connected by you** — a confirmed Signal joins this word to other evidence.

Each result includes the Dream title, cited occurrence, a short surrounding excerpt from the reader's writing when available, and a direct open-at-reference action.

### Reader

- Preserve the current selection and reading position while opening an earlier Dream.
- Allow the current selection to be added to the open Dream.
- Show that a word or passage has reader-authored references without turning every referenced item into visual noise.

## Foundation Delivery Slices

Each slice should leave the application usable and preserve the old workflow.

### Slice A: New Dream document contract

- Define the writing-first Dream document independently of the current aggregate that owns a source and child Signals.
- Add local persistence with stable identity, dialogue scope, title, content, timestamps, and optional origin anchor.
- Add repository and IPC operations without changing existing Dream files.
- Open, edit, autosave, close, and reopen the new document.

**Exit check:** A new Dream survives restart without any source selection.

### Slice B: Exact anchor contract

- Define one shared versioned selection type for word, phrase, passage, and range references.
- Validate every anchor against PlatoSI before it is saved.
- Persist anchors independently from their visual placement.
- Reconstruct and navigate to an anchor after restart.

**Exit check:** A saved anchor either reconstructs exactly or reports an explicit text-version failure.

### Slice C: Embedded reference placements

- Extend the editor schema so references are structured nodes rather than pasted HTML or plain Markdown links.
- Support an inline word presentation first.
- Add phrase, quotation, and collapsed-range presentations over the same anchor.
- Preserve surrounding Markdown and stable placement identity through editing and serialization.

**Exit check:** Editing text around a reference does not change its source address or identity.

### Slice D: Reader-to-Dream insertion

- Implement drag and drop from the canonical reader into the Dream editor.
- Use the existing selection reconstruction boundary rather than trusting drag payload text.
- Add an accessible non-drag action using the same insertion command.
- Preserve the reader's current location after insertion.

**Exit check:** Dragging and the accessible command create equivalent anchor and placement records.

### Slice E: Reference actions

- Selecting a word reference opens Word Lookup for its original occurrence.
- Selecting a phrase or passage reference returns to and highlights the source.
- Provide an explicit command to add the current reader selection to the open Dream.
- Open a Dream at a stable reference placement.

**Exit check:** Navigation works in both directions after closing and reopening the application.

### Slice F: Reverse Dream discovery

- Build the rebuildable reverse reference index.
- Add the **Your Dreams** section to Word Lookup.
- Return exact occurrence matches first.
- Add confirmed-lemma matches only when the reader explicitly selected the lemma.
- Keep unresolved lemma candidates in a separately labelled group.

**Exit check:** Word Lookup returns every authoritative matching Dream even when the accelerator is cleared and rebuilt.

### Slice G: Existing-data bridge

- Read existing Dreams and Signal passages without rewriting them.
- Decide whether they appear in **Your Dreams** as legacy results before full migration.
- Keep legacy and new identities distinct.
- Record any anchor that cannot be reconstructed rather than dropping it.

**Exit check:** Existing reader material remains accessible while new Dreams use the new contracts.

## Engineering Boundaries

- The renderer owns editor interaction and presentation, not filesystem persistence.
- The main process owns Dream, anchor, placement, and index repositories.
- Shared contracts carry stable types across IPC.
- PlatoSI remains authoritative for canonical text validation and linguistic evidence.
- The reverse index is derived and rebuildable.
- Editor serialization must not be the only source of anchor identity.
- No model dependency is permitted in foundation slices A–G.
- Every operation must distinguish unavailable evidence, invalid anchors, persistence failure, and an empty result.

## Foundation Validation

The foundation is not complete until tests establish:

- a Dream can exist without an origin passage;
- one Dream can contain many anchors;
- one anchor can appear in many Dreams;
- a Dream can contain anchors from distant sections;
- word, phrase, and passage displays retain the same canonical anchor;
- exact source navigation survives restart;
- Word Lookup finds all Dreams containing an exact occurrence;
- confirmed-lemma matches never include unresolved candidates as facts;
- clearing the reverse index does not remove authoritative results;
- opening an earlier Dream does not discard the current reader location;
- adding a new occurrence does not duplicate or corrupt an existing placement;
- malformed or stale anchors fail explicitly;
- legacy files are not changed by the new workflow.

## Phase 0: Preserve the Current System

Keep the current Dream, Signal, Reflections, navigation, Trash, and Markdown stores operational while new work proceeds. Record the current persistence contracts and identities needed for future migration.

**Completion:** New development can proceed without making existing reader material inaccessible or changing its meaning.

## Phase 1: Establish the Writing-First Workspace

Introduce a continuous Markdown writing surface in the middle workspace that can exist without a selected source passage. It should preserve the current reliable editor behavior:

- local persistence;
- autosave with explicit failure reporting;
- keyboard access;
- light and dark themes;
- shared multiline editor styling;
- stable layout and resizing;
- no dependence on a model.

The initial scope is multiple named Dreams per dialogue. A Dream may remember its origin passage, but creation and editing do not require one. Keep the current name provisionally; naming can change without altering the underlying document and anchor contracts.

**Completion:** A reader can open a dialogue, begin writing immediately, close the application, and return to the same writing.

## Phase 2: Insert Exact Text Anchors

Allow the reader to bring selected Greek into the writing surface. Candidate interactions include drag and drop, a selection action, and a keyboard command; the implementation may support more than one, but all must produce the same exact anchor.

An inserted anchor must:

- retain the canonical work and text version;
- retain start-inclusive and end-exclusive locations;
- preserve the selected Greek;
- display a useful citation;
- navigate back to and highlight the source;
- fail explicitly if the text version no longer reconstructs.

Define distinct presentations of the same anchor, such as an inline citation, quoted passage, or compact reference block, without creating incompatible data types.

Persist Dream-reference placements separately enough that they can be indexed and reopened without parsing arbitrary rendered HTML.

**Completion:** A reader can cite several distant passages in one continuous account, move reliably between writing and source, and reopen the document at a specific reference.

## Phase 3: Connect Word References, Word Lookup, and Dreams

When an anchor selects a Greek word, preserve the exact occurrence and allow the reader to open Word Lookup from the writing surface. Reuse PlatoSI's evidence pipeline rather than storing a model-generated definition in the writing.

The reference must distinguish:

- exact surface form;
- candidate lemmas;
- reader-selected lemma, if any;
- morphology and dictionary evidence;
- dialogue-wide occurrences;
- related evidence and its limitations.

English equivalents must not become the reference identity.

Add the **Your Dreams** Word Lookup surface and the reverse reference index. Query authoritative reference records when the index is missing or stale.

Order and label matches by their evidence:

1. exact canonical occurrence;
2. same reader-selected lemma;
3. possible same lemma;
4. reader-confirmed Signal connection.

Do not include semantic model similarity in this phase.

**Completion:** A Greek word cited in the reader's writing remains connected to its source occurrence and inspectable linguistic evidence. Looking up the same exact occurrence or confirmed lemma later returns the earlier Dream and opens it at the reference.

## Phase 4: Redefine Signals as Growing Relationships

Create the new Signal workflow around reader attention rather than automatic selection.

The reader should be able to:

- begin a Signal from writing and anchored evidence;
- give the relationship a provisional name;
- describe a question without resolving it;
- add evidence from another section later;
- connect an existing anchor to more than one Signal;
- inspect the history of the Signal's growth;
- remove a connection without deleting the underlying writing or passage.

Bringing evidence into writing may create a **Signal seed** or mark it as available to Signals, but it must not manufacture a completed relationship or interpretation.

**Completion:** One Signal can preserve and grow a relationship such as seeing and the divine across distant passages without fragmenting the reader's writing.

## Phase 5: Build the Reader-Confirmed Graph

Persist the relationships created by reader actions. The graph should support:

- writing-to-anchor references;
- Signal-to-anchor membership;
- connections among Signals where the reader establishes them;
- structural-section context;
- reverse lookup from a passage or word to prior writing;
- exact provenance for when and how a relationship was confirmed.

Do not require the reader to edit graph nodes or edges directly. A visualization can come later.

**Completion:** Returning to an anchored passage can reveal the reader's earlier writing and confirmed relationships without scanning every document manually.

## Phase 6: Add Deterministic Memory Retrieval

Before introducing semantic model retrieval, surface useful earlier material through inspectable signals:

- the same exact anchor;
- the same selected lemma;
- an explicitly related lemma;
- the same named person or place where evidence supports the identity;
- reader-assigned terms;
- membership in an existing confirmed Signal;
- structural-section relationships.

Every candidate must identify the retrieval reason.

**Completion:** Chora can remind the reader of relevant earlier work using local, explainable evidence without a model.

## Phase 7: Add Optional Local Model Retrieval

Evaluate a local model as an assistant to memory. Its task is to find potentially relevant earlier reader writing, not to interpret Plato on the reader's behalf.

The model may receive a bounded context containing:

- the current exact passage;
- reader-selected writing or Signal text;
- candidate earlier local writing;
- deterministic linguistic evidence retrieved through PlatoSI.

The result must be a small candidate list with:

- the earlier item;
- its exact source anchors;
- a concise explanation of possible relevance;
- the deterministic or semantic reason it was retrieved;
- clear model attribution and limitations.

The model must not create graph edges, merge Signals, or change reader writing. Reader dismissal should suppress or rank down that suggestion without asserting that no relationship exists.

**Completion:** The reader can receive a reminder such as “You previously wrote about seeing and the divine at Republic 327a” and independently decide what to do.

## Phase 8: Establish the Structural Map

Represent the creator's sections and transitions separately from the reader's writing and Signals. Clearly attribute these divisions as a cultivated structural reading rather than neutral source metadata.

Explore personal reader sections only after the relationship between shared and personal structure is clear. Preserve the continuity of speeches and arguments across section boundaries.

**Completion:** The application can present an authored map of the dialogue while allowing a reader's Signals to cross, ignore, or reinterpret those divisions.

## Phase 9: Migrate and Remove the Old Workflow

Only after the preceding workflow is usable:

1. Decide how each existing Dream, Reflection, source passage, Signal, and Signal component maps to the new concepts.
2. Provide a preview or reversible migration path.
3. Preserve original files or an explicit archival export.
4. Validate exact anchors against the stored PlatoSI text version.
5. Keep unresolved records visible rather than silently dropping them.
6. Remove old UI, controllers, stores, and persistence code only after migrated and archived data can be reopened.

**Completion:** The old passage-bound workflow is no longer required, and no reader-authored material has been silently lost or reinterpreted.

## Acceptance Scenario: Seeing and the Divine

1. At the opening of the *Republic*, the reader writes about narration, time, Socrates' descent, seeing the festival, and honoring the goddess.
2. They bring the exact opening passage into the writing.
3. They preserve an unresolved Signal concerning seeing and the divine.
4. Much later, they encounter another passage that may bear on that relationship.
5. Chora surfaces the earlier thought and explains whether it matched by lemma, confirmed Signal, reader language, or model similarity.
6. The reader opens both passages and their linguistic evidence.
7. The reader decides whether to add the new evidence, create another Signal, postpone judgment, dismiss the suggestion, or ignore it.
8. If confirmed, the connection becomes visible from both passages and from the writing.

The scenario fails if Chora concludes the relationship for the reader, loses the original uncertainty, or reduces the connection to an English keyword match.

## Foundation Acceptance Scenario: Money

This scenario is the minimum useful release and does not use a model.

1. The reader is in Cephalus's speech and creates a Dream titled **Money in Cephalus's speech** without making that speech the Dream's boundary.
2. The reader writes one paragraph.
3. They drag a Greek money-related word from the canonical text into the paragraph.
4. Chora inserts an inline reference whose anchor retains the exact occurrence and text version.
5. The reader closes the Dream and continues through the dialogue.
6. In a later discussion involving Thrasymachus, the reader selects another occurrence and opens Word Lookup.
7. **Your Dreams** shows the earlier Dream under the correct category: exact occurrence, same reader-selected lemma, or possible same lemma.
8. The result states why it appeared.
9. The reader opens the Dream at the earlier reference.
10. The current Thrasymachus selection remains available and can be added to the same Dream.
11. The reader continues the earlier paragraph instead of creating an isolated replacement.
12. After restart, both references still navigate to their exact passages and Word Lookup still returns the Dream.

The scenario fails if:

- the Dream is confined to Cephalus's speech;
- the dragged word is stored only as visible text;
- a possible lemma is presented as confirmed;
- the reverse index hides the Dream after becoming stale;
- opening the Dream loses the current passage;
- the reader must use a model to rediscover their own exact reference.

## Open Decisions

- Does dragging evidence create a Signal seed automatically, or merely an anchored reference?
- How are inline, quoted, and block references presented without changing their identity?
- How are the creator's structural sections distinguished from personal sections?
- Which relationship labels are useful without imposing a taxonomy?
- How should dismissal affect future retrieval?
- What bounded local context may an optional model inspect?
- How are model candidates cached, invalidated, and kept separate from confirmed connections?
- How should existing Dreams and Signals be migrated or archived?
- When, if ever, should a graph visualization become visible?

These decisions require experimentation. The invariants above do not.
