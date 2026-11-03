# Development Plan: Rooms and Word Exploration

This plan translates [VISION.md](VISION.md) into a proposed sequence of work. It describes future behavior, not features that are already implemented. Implementation details and open decisions require review before code changes. The current application is described in [README.md](README.md).

## Desired Experience

The reader chooses a passage in a work and creates a Dream, a focused room for reading and memory. The reader selects Signals and writes their own observations. From that room, they can explore a word across the entire current work, find Greek passages and related forms, and follow possible connections back to the text. English can help describe a word and its range, but does not replace the Greek or reduce it to one fixed equivalent.

Chora holds the reader's attention by surfacing the objects in the chosen room. The model acts like an animated object that speaks when asked: it offers information in response to the reader's requests, but does not make the reader's personal connections or impose a viewpoint. The reader examines sources, decides what matters, and preserves their own observations. Markers allow the reader to return to earlier encounters and remember and connect them personally. A future visualization may present overlapping relationships, but must not replace that act of discovery.

## Guiding Constraints

- The reader chooses the room, Signals, questions, and direction of inquiry.
- Surface Greek text, locations, and requested linguistic information; do not generate or impose the reader's interpretation or automatically connect their Dreams.
- Make earlier passages and reader-created observations available as markers for the reader to revisit, not as a model-created memory presented in place of their own.
- The model responds when asked. It may provide information about linguistic relationships the reader requests, but it should not make unsolicited connections among the reader's experiences or observations.
- English is useful support for understanding, not a substitute for returning to the Greek.
- New UX should feel native to Chora's existing CSS design. Reuse its theme variables, typography, spacing, controls, icons, and panel patterns where appropriate rather than introducing a separate visual language. Support both light and dark themes, keyboard and focus states, and existing responsive layouts.

## Current Starting Point

- Chora obtains its Plato catalogue, canonical reading text, and organized word evidence from PlatoSI. It owns PlatoSI-versioned selections, Dream-owned Signals, reader-authored reflections, and the native presentation of returned evidence.
- The main process owns persistence and the PlatoSI connection. The renderer uses the typed preload bridge, feature gateways, stores, and event bus.
- The Dream editor no longer shows Clarity Check, and the unused Chora model-provider runtime has been removed. Existing conversation data remains recoverable through Dream Trash.
- The workspace has an activity rail and built-in sidebar-extension host. Explorer and Word Exploration are built-in panels; the Dream tab strip has a separate owner.
- PlatoSI is a local dependency providing canonical text and deterministic linguistic evidence. Its `linguistics.evidence` operation validates one exact canonical word selection and organizes attributed lemma candidates, the local LSJ entry, normalization, spelling suggestions, attestation distributions and citations, compact paradigms, warnings, and provenance. After the reader selects a lemma candidate, Chora matches its returned paradigm forms against the canonical current dialogue and owns the exact occurrence navigation. Roots, compounds, and broader lexical relationships remain future work.

## Phase 1: Remove the Chat Surface Safely

The Clarity Check panel and its unreachable chat/provider runtime have been removed. Dream editing, Signal workflows, saves, and navigation remain. `ChatRepository` retains only the persistence needed to preserve existing conversation files in Dream Trash.

**Completion:** The chat surface is no longer presented; existing reader data remains recoverable and the remaining Dream workflows continue to work.

## Phase 2: Built-in Workspace Extensions

Add a narrow contribution contract for features shipped as part of Chora. Each extension provides an identity, title, icon, and panel lifecycle. A workspace host owns registration, activity-bar selection, visibility, and cleanup. This is not a third-party extension marketplace or a promise to load arbitrary code.

Move Explorer into the new host as an always-available built-in extension. Separate Explorer ownership from the Dream tab strip where the existing UI combines them. Preserve the reader and Dream editor while switching panels, and retain panel state, resizing, collapse, keyboard access, and saved layout. Use the existing typed events, stores, and feature gateways for shared capabilities rather than having panels call one another.

**Completion:** Explorer remains usable, and a second built-in panel can be registered without rewriting the workspace shell or disrupting an open Dream. The activity bar and sidebar fit the existing visual design in both themes and remain usable at supported window sizes.

## Phase 3: Evaluate PlatoSI and Greek Evidence

Chora now uses PlatoSI as its sole source of canonical text, catalogue metadata, version fingerprints, and reader-requested inquiries. The local PlatoSI process remains an explicit development/runtime dependency configured through environment variables.

Chora does not bundle Plato texts, lexical indexes, morphology data, or generated corpus artifacts. PlatoSI owns source acquisition, revision pinning, normalization, licensing metadata, and evidence-provider policy.

PlatoSI supplies one rendered section per Stephanus location. Chora persists PlatoSI's exact `dialogue`, `text_version`, and start/end `{ stephanus, offset }` contract and validates every selection against the active version before reconstruction or navigation.

**Completion:** Chora has one canonical text source and no independent corpus pipeline or bundled text copy.

### Evidence Review

- Chora treats PlatoSI's text-version fingerprint as part of every persisted passage address. A location from another version is rejected rather than silently mapped.
- Chora uses UTF-16, section-relative, start-inclusive and end-exclusive offsets, matching the contract exposed by PlatoSI to Chora.
- PlatoSI corpus search finds literal forms. Its experimental word reader uses morphology candidates to look up dictionary headwords and can join a selected lemma's direct provider mappings to forms attested in a requested source scope. This is not exhaustive or contextual disambiguation, and a missing candidate does not prove that no analysis exists.  The Dilemma and GLEM providers remain optional and have unresolved data or artifact licensing questions.
- PlatoSI identifies its LSJ source as CC BY-SA 4.0, but its inclusion and redistribution still require review of the selected files, attribution, and applicable obligations. GLEM and derived indexes must not be bundled or used commercially without resolving the rights identified in [PlatoSI's licensing review](../PlatoSI/docs/glem-licensing-review.md).

#### Local evaluation, 1 November 2026

The configured PlatoSI `0.1.0.dev1` process reported the 35-work canonical catalogue. Its *Republic* has 1,355 canonical sections. A live `canonical.resolve` request returned κατέβην at 327a; additional checks reconstructed a newline both between segments in one section and between sections, and rejected a different text fingerprint. Chora's existing focused integration and selection tests also passed. These checks do not establish exhaustive navigation correctness or morphology coverage.

The first configured check found both Dilemma and GLEM disabled. A subsequent comprehensive isolated Dilemma 1.3.10 evaluation exercised all discovered public capabilities and downloaded the optional attestation and citation databases. Provider-specific evaluation belongs to PlatoSI; Chora does not expose Dilemma controls or import Dilemma. GLEM remains disabled.

An earlier research measurement in [PlatoSI's morphology manifest](../PlatoSI/docs/morphology-manifest.json) found exact GLEM form overlap for 82,554 of 88,231 tokens (93.6%) in its separately indexed *Republic* source. This is case- and accent-sensitive orthographic overlap, not lemma recall, contextual accuracy, or coverage of Chora's canonical text. The GLEM lists and derived indexes have unresolved commercial and redistribution rights. The [comprehensive Dilemma evaluation](../PlatoSI/docs/dilemma-phase1-evaluation.md) records capability outputs, ambiguity, false-positive risks, artifact gaps, and performance observations. Dilemma's separate artifacts still require rights and provenance review.

The local dependency remains a development distribution requiring separately installed Python and corpus setup; it does not bundle morphology resources or models. A sibling checkout, local archive, and a successful lookup on one computer do not establish a packaged end-user installation.

### Integration Direction

The reader has clarified that PlatoSI should supply the text and own linguistic processing, with Chora depending on its capabilities rather than choosing providers itself. Chora starts and stops PlatoSI as a local helper and owns its reader records and presentation. Its Library uses PlatoSI's canonical catalogue and text directly, and persisted selections carry the text fingerprint and section-relative offsets. Word evidence uses PlatoSI's local-process API without an LLM.

The helper does not require a separate remote server. PlatoSI may itself communicate with a locally running model through the model's own interface; that is PlatoSI's responsibility, not Chora's API. Packaging, process lifecycle details, versioning, and failure handling still need implementation decisions. If Chora and PlatoSI use different text representations, their results need verified mapping to the displayed edition. Source-based matching must preserve exact original offsets through any normalization. The model is not a morphology database: proposed analyses or forms can be wrong or incomplete and must not be presented as an exhaustive list.

The locally configured Dilemma provider uses Morpheus-backed generation and several separately licensed artifacts. Its data provenance, rights, Windows packaging, and coverage remain unresolved for distribution. Chora does not bundle those artifacts or the separate local LSJ dataset.

In all options, literal form search is not a substitute for lemma-wide evidence, and a model suggestion must remain visibly distinct from source-backed morphology. No verified mapping or morphology coverage should be claimed until it has been measured against curated examples.

Chora's current Word lookup panel sends an exact PlatoSI location, renders the organized deterministic response, and separately searches the displayed canonical text for exact occurrences. It does not use an embedded Logeion web view, ask an LLM, guarantee exhaustive morphology, or bundle the locally configured Dilemma artifact set.

### Chora-PlatoSI API Direction

The reader should be able to see what they can look up, expressed in terms of Greek words and passages rather than models, providers, prompts, or technical settings. PlatoSI's interface to Chora should make its available capabilities discoverable, including information beyond a single word. Its playground should likewise make those possibilities clear to a reader; its developer-oriented controls are not the reader experience to reproduce in Chora.

PlatoSI's experimental version 1 local-process API offers canonical text, capability discovery, organized canonical word evidence, lower-level word analyses, form mappings, text and passage lookups, separately requested model-backed inquiries, and provider-owned evaluation operations. See its [README](../PlatoSI/README.md#local-reader-api) for request and result shapes and current limits. Chora currently uses canonical catalogue and work operations plus `linguistics.evidence`; provider-specific evaluation and model inquiry remain outside this reader flow. Playground HTTP routes are separate.

**Ownership**

- PlatoSI supplies canonical displayed text; Chora's main process owns exact selections, navigation, Dreams, Signals, and reader-authored notes. The renderer reaches the helper only through Chora's existing typed IPC boundary.
- PlatoSI owns linguistic resources, their attribution and availability, and provider configuration. Chora requests organized evidence, not a particular provider. Any future model inquiry is a separate explicit feature.
- Opening a word exploration is an explicit request for information about that word. Exactly which results and brief contextual descriptions appear in response, and which broader inquiries require another reader action, remain open. Nothing automatically interprets the reader's notes or links their Dreams.

**Local connection and lifecycle**

PlatoSI's experimental transport is UTF-8 newline-delimited JSON over standard input and output, without exposing a network port. Standard output is reserved for protocol messages. Each request carries a contract version, a unique request ID, an operation, and its payload; each response echoes the ID and version. Chora manages the process, distinguishes outstanding requests, bounds message sizes, and surfaces connection failures through its existing diagnostics.

On startup, Chora negotiates a compatible protocol with PlatoSI and owns helper startup, monitoring, and orderly shutdown, including cancelling outstanding work. Unexpected exit or malformed responses fail affected requests rather than appearing as empty results. The reader currently requires PlatoSI; a failed helper prevents startup or affected requests rather than silently switching text. Capability discovery, packaged runtime, resources, configuration, restart policy, and offline behavior require further work; a developer's sibling checkout or Python installation is not a distribution strategy.

**Proposed operations**

| Operation | Request | Result |
|---|---|---|
| `capabilities` | Contract version. | Discoverable kinds of lookup and inquiry and their availability, including actionable reasons when resources or model-backed inquiries are unavailable. New kinds can be added through compatible contract versions without hard-coding model or provider choices into Chora. |
| `linguistics.evidence` | One exact versioned PlatoSI location selecting a Greek word. | Grouped lemma possibilities, local dictionary entries, normalization and spelling evidence, form and lemma attestation, citations and distributions, compact paradigms, provider notices, and provenance. It does not select contextual meaning. |
| `word.analyze` | Selected Greek form. | Attributed candidate lemmas and morphology, available lexical entries, evidence, and limitations. Candidates remain alternatives, not contextual facts. The current API does not yet accept Chora's passage context. |
| `lemma.matchForms` | One reader-selected candidate lemma and a bounded batch of distinct exact forms from Chora's current work. | For each matched input form, attributable candidate mappings to that lemma; indicate missing resources, incomplete coverage, and any truncation. |
| `text.search` and `text.passage` | Greek text to find, or a work, edition and citation. | Available source passages with citations, attribution, and limitations. PlatoSI's source locations require verification before they can become Chora navigation targets. |
| `inquiry.ask` | A reader question and a canonical location, Greek text to search, or a PlatoSI edition and citation. | A fallible model-generated response and retrieved evidence, if available. The desired relationship inquiry remains future work; morphology, shared roots, and possible connections in use or meaning must not be collapsed into one relation. |
| `request.cancel` | The ID of an outstanding request. | Acknowledgement of the cancellation request and, separately, a terminal outcome for the original request. Completion can race cancellation; Chora ignores a late result when the reader has moved on. |

Responses distinguish successful, partial, unavailable, invalid, failed, and cancelled outcomes. A partial response contains any usable results together with specific warnings; an empty successful result is not used to conceal unavailable resources or a failure. The detailed error codes, batch limits, timeout behavior, and whether model responses stream are open contract decisions.

An evidence item must identify its kind (such as primary-text passage, morphology, lexical source, or model suggestion), source attribution and available license information, and limitations. Results identify which evidence supports each claim; a model response remains a suggestion even when it cites valid evidence. Conflicting analyses stay separate. Missing attribution or unavailable license details must be reported rather than invented. Checking that a response has valid evidence references does not prove its interpretation is correct.

**Exact passage navigation**

Chora derives the distinct surface forms and their exact occurrences from its own displayed current work. It may send forms to PlatoSI in batches and join each returned mapping back to the exact input form and Chora-owned occurrences. Internal normalization must not lose the original input form or turn an uncertain mapping into a confirmed analysis. The resulting passages and exact selections come from Chora's text; navigation must not replace the reader's Dream or Signal highlights. Scope is the entire current work, not only the current numbered book.

PlatoSI's older search and passage operations may also return evidence from its separately indexed source, which can use a different revision, representation, and offset units from the canonical text Chora displays. Those records are not automatically Chora selections. Even a matching edition or citation does not prove an exact location. Until a mapping is verified, show such a passage as sourced evidence without an exact jump; do not guess an offset or silently substitute a different passage.

**Reader data and retention**

The proposed initial requests send only the selected Greek, the necessary bounded text or form batches, and relevant work identifiers. They do not send Dream reflections, Signals, other reader notes, or prior reading history by default. Any future use of those records needs an explicit reader-directed interaction and a separate privacy and retention design. PlatoSI's resource or model configuration might allow external providers, so the final design must disclose the destination and data sent before such use; local process transport alone does not guarantee local model processing. Define cache contents, retention, deletion, and diagnostic redaction before enabling persistence of request data.

**Illustrative flow**

1. The reader selects **κατέβην** and opens Word Exploration. Chora sends its exact versioned location to `linguistics.evidence`.
2. PlatoSI returns organized candidate analyses, dictionary evidence, attestation, and paradigms with attribution and uncertainty. If evidence is unavailable, the panel says so rather than inventing it.
3. If the reader selects a candidate lemma, Chora compares the returned candidate paradigm forms with its canonical current dialogue. Only exact Chora-owned occurrences become navigation targets.
4. An explicitly requested broader inquiry may later include a labeled, evidence-linked description. The reader decides what to notice and what, if anything, to write.

**Migration and verification**

Further work must resolve source rights, runtime packaging, limits, and privacy, and continue verifying partial and unavailable results. Model-backed inquiry remains a separate future phase. Do not delete stored conversations or Dream Trash contents.

Use curated examples including **κατέβην** and **πομπή**, ambiguous and missing analyses, multiple text segments sharing a citation, and non-BMP characters. Measure occurrence coverage and demonstrate exact selection mapping; do not infer completeness from a successful example. Obtain approval for new tests and follow the project's targeted validation discipline.

## Phase 4: Word Exploration

**Status:** Implemented for organized deterministic evidence, reader-selected lemma candidates, exact selected-form occurrences, and exact current-dialogue occurrences of associated paradigm forms. Roots, compounds, and broader relationships remain future work.

Add a built-in Word Exploration extension. Starting from a reader-selected word in the current room, present:

- The selected Greek form, possible lemma analyses, and relevant forms, with ambiguity visible.
- Occurrences and exact locations across the whole current work, with Greek passages and explicit navigation.
- Available lexical information and English assistance without making one English equivalent the final meaning.
- Separate views or labels for same-lemma forms, related words or roots, and possible connections in use or meaning.
- Clear empty, incomplete, unavailable, and error states, including source coverage and any truncated results.

The first example should include **κατέβην** in the *Republic*. Evaluate **πομπή** and **πέμπω** as another inquiry, including words that may be related in context without sharing a root. Do not assume an occurrence count or an exhaustive analysis before verifying the source and coverage. Greek normalization, accents, punctuation, elision, and multiple analyses require explicit handling.

The panel keeps the reader's selected Dream and writing available. The obsolete embedded Logeion web view has been removed; local LSJ content is now part of the attributed PlatoSI response. Reuse existing Dream and Signal markers where possible so the reader can return to their own earlier observations.

**Completion:** The reader can select a supported word, examine attributable Greek evidence across the current work, and jump to a verified passage without losing their Dream or unsaved writing.

## Phase 5: Information on Request

Extend the existing PlatoSI inquiry boundary to answer reader-initiated requests about forms, word relationships, passages, and context; PlatoSI owns model selection and provider integration. This can go beyond simple form matching: for example, the reader may explicitly ask about words related by morphology or use. Supply relevant text and available evidence without replacing the reader's act of making connections or imposing a fixed interpretation.

Distinguish source evidence, scholarly classifications, model-generated possibilities, and reader-authored observations. Make it possible to inspect the passages behind a proposed connection. A source location can be checked without implying that a model's description of it is correct. Missing evidence, uncertainty, conflicting analyses, and model failures should remain visible.

Explore an appropriate reader-facing control for the breadth of a requested inquiry. Do not assume that a model's numerical temperature alone reliably controls relevance, accuracy, or the kinds of information found. Model interaction, question assistance, and how the reader may retain requested information are open design decisions. Do not initiate model-generated personal connections or automatic links between Dreams.

**Completion:** The reader can request information, inspect its basis, and continue reading even if the model is unavailable. The model does not act unprompted or make the reader's personal connections; its output is not presented as the reader's own observation or as settled textual fact.

## Phase 6: Memory Markers and Future Visualization

Design how reader-chosen markers, observations, and passages can be retained and revisited with their room and source references. These are cues for the reader's own memory and connections, not an automatically generated account of what they remember. Preserve distinctions among word forms, possible lemmas, passages, linguistic relationships, and the reader's own reflections. Allow overlapping, contextual, and uncertain relationships rather than forcing each word into one group or meaning.

The persistence owner, format, sharing across Dreams, deletion and Trash behavior, and how the reader chooses to retain requested information remain to be decided. Preserve existing reader data and avoid a second authoritative copy of Dream or Signal state.

Only after useful evidence and relationships can be collected and revisited should a graph extension be designed. It should use shared feature data rather than depend on the Word Exploration panel's DOM or private state.

**Completion:** The reader can return to their chosen markers and observations without losing context or confusing model output with their own work. A visualization can be evaluated against real collected data rather than invented requirements, and must leave the reader to make their own connections.

## Validation and Decisions

Before implementation, agree on the evidence sources, integration boundary, offline and packaging requirements, treatment of ambiguous analyses, the role of the dictionary, and what is saved. Establish a small curated set of Greek forms and passages with expected results and coverage criteria; measure retrieval and source mapping against it rather than assuming completeness. Include ambiguous and missing cases as well as successful examples.

Validate workspace switching, reader navigation, exact citations, Dream and Signal persistence, existing conversation and Trash preservation, model failure, and accessibility. Review the new panels and pop-ups against the existing CSS in both themes, including focus, contrast, resizing, and narrow layouts. Follow the repository's build and test discipline: use targeted checks, and obtain approval before adding new tests or entering an iterative test-and-fix cycle. Update current-experience documentation only as behavior actually changes.

Dream remains the current product name. Any rename to Room or another term is a separate decision and is not part of this plan's initial implementation.
