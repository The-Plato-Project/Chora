# The Agentian Stranger: optional local Goose integration

## Current experiment

The current branch narrows the interlocutor to canonical topic retrieval. This
is a test of whether an existing local model can return useful passages and
improve with better tools and constraints. It is not a claim that the model
understands Plato or that source checks validate its interpretations.

See [reading principles](READING_PRINCIPLES.md), [runtime directives](STUDY_PARTNER_DIRECTIVES.md)
and the [retrieval trial](TOPIC_RETRIEVAL_EXPERIMENT.md) for the current contract.
The earlier general-chat and Vision-context experiment is superseded here.

## Windows setup

1. Run `powershell -ExecutionPolicy Bypass -File scripts/InstallGoose.ps1`.
   The helper verifies the installed signed Goose 1.59.0 runtime. If absent, it
   downloads and verifies the official Windows desktop installer; run that
   installer, then rerun the helper. The unsigned portable CLI is not used.
2. Set the printed `CHORA_GOOSE_BINARY` path in `.env.local`; never commit that file.
3. Start Ollama with the chosen base model installed. Chora settings selects
   qwen3.5:9b by default or qwen3.5:4b as an explicit alternative.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/ConfigureLocalModel.ps1 -Model qwen3.5:9b`
   for the selected installed model. This creates a separate 16k-context Chora
   profile using existing weights, without modifying the base model or downloading weights.
5. Open The Agentian Stranger, enter a topic question and send. The open Library
   work determines scope. No context chooser or separate launch action is required.
6. Inspect Sources for model-proposed vocabulary, dictionary excerpts, coverage
   and actual canonical matches. Stop cancels a response; the next Send reconnects.

On 12 November 2026 Windows Smart App Control blocked the unsigned portable CLI.
Installing the official desktop bundle resolved startup: its bundled CLI has a
valid LF Open Source, LLC signature, runs as version 1.59.0, and has the pinned
SHA-256 cd4a06fe6811a50394138916517668ba816dee20fa482c0e157b3bbd4279ffcf.
Chora uses that signed CLI under `Programs/Goose/resources/bin/goose.exe`.
No Windows security setting was changed. Desktop setup can use the existing
Ollama provider; its separate Hugging Face model download is unnecessary.

## Runtime boundaries

Chora owns UI, work scope, tool contracts, prompts, source checking and persisted
conversation history. The replaceable StudyBackend owns model execution and a
native runtime session. Goose-specific configuration, process launch and ACP
translation stay in its adapter. Reading, writing, autosave and Word Lookup do
not depend on this optional module.

The renderer sends only the work ID, question and selected model through typed
preload/IPC. It does not read an open Vision or submit editor prose. Main rejects
Vision attachment fields and has no Vision service in the interlocutor's
capability graph.

The host exposes exactly two read-only MCP tools over an authenticated loopback
endpoint. A session-random bearer capability, request bounds, turn revocation and
an explicit effective-tool inventory prevent accidental access to other Goose
extensions. Model permission requests are allowed only for verified Chora tools.
These are application restrictions, not an operating-system sandbox.

| Tool | Fixed application behavior | Existing authority |
| --- | --- | --- |
| `find_topic_passages` | Accept one to four proposed Greek headwords with tentative reasons; check dictionary material; inspect supplied work-scoped lemma-form occurrences; return four candidate sections per page | WordExplorationService, PlatoSiGateway and LibraryService |
| `read_passage` | Return a bounded exact Greek section with offsets and continuation information | LibraryService's PlatoSI document |

StudyTopicSearch owns the first workflow, not a competing dictionary, canonical
corpus, morphology engine or persistence store. Alternatives remain separate.
Missing dictionary material excludes that proposal from candidate generation
and is reported as missing evidence, not proof of linguistic invalidity.

Candidates retain exact versioned selections. Excerpts contain up to 1,400
characters around the first match, with up to six visible match examples. At
most two 700-character dictionary excerpts per proposal are returned, with
truncation metadata. Pagination and canonical ordering do not rank philosophical
importance. All supplied mappings are examined, but missing provider coverage
and lexical ambiguity limit what can be claimed about the whole work.

## Context and history

The current experiment persists conversations under the application's internal
`interlocutor/canonical-topic-retrieval-v1/` directory, separately per work.
Earlier general-chat files remain intact in their original directory and are
not loaded or replayed into this experiment. A new Goose session uses a fresh
isolated configuration and working directory; no prior native session is resumed.

Within this experiment, previous research conversation can provide context for
follow-up questions. Restoring history never replays tasks. Switching works
stops the prior execution and restores the new work's own transcript and draft.
No typing is monitored and no background interpretation runs between requests.

## Completion and source checks

Each explicit request admits six evidence calls. Results report the remaining
allowance; at exhaustion the host stops performing reads and directs synthesis.
The model should return up to three candidates, not an essay or continued
investigation. Coverage limits must remain visible.

The model's final response selects up to three current-turn candidateId values
and short provisional English reasons. Chora supplies the citation and Greek
directly from its corresponding receipts; model-provided quotations and reference
fields cannot replace them. Raw JSON and tool-loop narration remain private.

One invalid selection permits a bounded correction with retrieval revoked. If
that fails, the application still presents up to three actual lexical candidates,
without model endorsements, and marks the result incomplete. It does not discard
successfully retrieved evidence merely because the model's selection failed.
No retrieved candidates produces a clear incomplete-search message, not a claim
that the topic is absent.

The old whole-answer citation/quotation scanner was removed. It falsely rejected
a corrected answer for mentioning unread references as excluded, despite matching
Greek quotations. Structured selection checks source membership directly.

Reasons can still misjudge relevance or dramatic significance. Reader evaluation
is the acceptance test. A valid ID or a passing software suite is not sufficient.

Pinned Goose reports its action-limit notice as ACP end_turn. The adapter also
recognizes that pinned runtime notice across chunks and classifies it as
incomplete. This release-specific handling must be reviewed with any upgrade.
Ollama profile limits are verified because request-level context settings alone
were ignored by its compatibility endpoint in the earlier live check.

## Validation and limits

The affected tests and full build passed. The existing full suite passed all
149 tests. Coverage includes tool inventory, dictionary-backed candidates,
writing exclusion, scope, retrieval closure, structured selection, cancellation,
replacement of rejected answers and separate work histories. The current live
model trial uses the signed installed runtime. Its first run failed because
malformed headwords caused a whole batch to be rejected and generic feedback
was mistaken for missing dictionary coverage. Per-term feedback now preserves
valid headwords and identifies rejected inputs without implying absence.
The repeated time question returned actual passages 327c, 328b and 345c with one
tool call and matching Greek quotations. Its relevance, glosses and presentation
remain provisional. The money contrast failed: no retrieval tool was called,
and unsupported output was replaced with an incomplete response. Neither trial
accessed the Vision catalogue. See the trial report for these mixed results.
After the structured-result change, the reader's actual question with the
opening Greek passage returned host-rendered 357b, 328b and 363c with a valid
structured selection. No Vision reads or raw JSON reached the displayed result.
This validates result handling, not the strength of the proposed thematic parallels.
Direct fixed-vocabulary retrieval against the real local database succeeded for
χρόνος and ἅμα, returning dictionary evidence and 88 candidate sections. That
checks the tool, not the model's vocabulary selection or thematic judgment.
Previous successful general-chat trials are not evidence that this new tool
performs well. No personal writing was sent for the attempted live trial.

The initial comparison is time versus a contrast topic such as money. Record
useful candidates, incidental matches, missing passages, unsupported statements
and reader corrections. Theme marking, verb-form projects, broader implicit
patterns, access to Visions and model training are later work.

## References

- [Chora product direction](VISION.md)
- [Ollama profiles](https://docs.ollama.com/api/create)
- [Ollama compatibility context limits](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx)
- [Pinned Goose ACP completion mapping](https://github.com/block/goose/blob/v1.59.0/crates/goose/src/acp/server.rs)
