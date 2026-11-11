# The Agentian Stranger: Optional Local Interlocutor / Goose Experiment

## Status and purpose

This is the design and acceptance contract for the experimental PR. The first
implementation adds an optional sidebar conversation, a replaceable backend
interface, and six read-only evidence tools. The runtime remains disabled until
the reader sends a message in the current work. Behavioral acceptance is a
separate reader-led evaluation; implementation alone does not establish it.

### Canonical retrieval follow-up

The exact request “Can you find other areas in the Republic where Plato suggests
interesting properties of space and time?” was checked through an isolated real
Electron application, typed preload/IPC, PlatoSI and the installed local model.
The final run made four tool calls, retrieved only canonical Republic evidence,
finished without the action limit, and cited 517a, 531a and 432c. A disposable
Vision about space and time was available but was not retrieved as a substitute.
No personal writing was used in this check. The build and all 149 tests passed.

Earlier live runs exposed repeated searching and an invented citation. The
host now budgets retrieval and checks recognizable explicit Stephanus references
against sections actually retrieved in that turn. A failed check allows one
correction pass with tool access revoked; the replacement is checked again.
Repeated failure produces an inline explanation marked incomplete, rather than
certifying the invented reference. Existing tests cover correction, rejection,
closed retrieval, and replacing the displayed answer without appending it.

This is citation checking, not semantic verification. Quotations, translations,
claims about what a passage means and broad philosophical generalizations still
require reader review. Model-generated reasons for relevance are provisional;
the reported locations do not establish that those reasons are sound. The
experiment must not be described as a reliable philosophical authority.

### Running the Windows experiment

1. Run `powershell -ExecutionPolicy Bypass -File scripts/InstallGoose.ps1`.
   The installer verifies the official Goose 1.59.0 archive and executable.
2. Add the printed `CHORA_GOOSE_BINARY` setting to `.env.local` and restart Chora.
3. Start Ollama with the model selected in Settings → Chora settings installed.
   The default is qwen3.5:9b; qwen3.5:4b is an explicit alternative.
   Once per installed model, run
   `powershell -ExecutionPolicy Bypass -File scripts/ConfigureLocalModel.ps1 -Model qwen3.5:9b`
   (substitute qwen3.5:4b for the smaller choice). This creates a separate Chora
   profile using the installed weights; it does not modify the original model.
4. Open The Agentian Stranger in the activity bar. The open work is already its
   context. Type a message and press Send or Enter. Shift+Enter inserts a newline.
5. The open Vision is automatic supporting context at submission; unsaved editor
   prose is explicitly identified as a draft. Every saved Vision in the work is available through tools when asked;
   no checklist is required to say “read all my Visions so far.”
6. Inspect Sources for actual retrieved material. Stop interrupts a response.
   The next message continues without a separate launch or context-selection step.
7. Switching works opens that work's conversation and retains the prior work's
   history and unsent draft. Returning restores it without executing a task.

Conversations are saved separately per work under the application's interlocutor
directory, using hashed canonical work identities as filenames. The earlier
latest.json checkpoint is migrated to its work's record on first load. A work
change stops prior execution and cannot retarget an in-flight request. Reopening
a backend supplies earlier attributed messages as context only; it never replays
old requests. Native ACP-session reconnection is not used. Goose keeps isolated
local session files under the application's goose directory, separately from
ordinary Goose configuration. Tool isolation is not an operating-system sandbox.

The initial binary pin is Windows x64 only. Other platforms and Goose versions
fail closed until their capability behavior and binary are verified. No hosted
provider settings or keys are inherited. Missing runtime/model availability is
an interlocutor failure and does not prevent reading or writing.

### Verified implementation, 11 November 2026

- Full application build and 149 tests passed, including focused scope, MCP,
  streaming, cancellation and retained-input checks.
- A hidden, isolated Electron 37.10.3 application exercised the actual renderer,
  preload, IPC, feature services, Goose 1.59.0 and Ollama `qwen3.5:9b` together.
  It used a disposable Vision, retrieved that writing and Republic 327a, and
  displayed a completed response. Stop during a subsequent turn retained a
  partial response; history reopened without executing another turn.
- The word tool queried the existing local PlatoSI service for κατέβην and
  returned its dictionary entry and seven occurrences. Dictionary text and
  occurrence inventories use explicit bounded pages; candidate lemmas remain
  separate in the overview.
- The effective Goose session contained exactly the five declared tools. No
  developer, shell, file-editing, browser or inherited plugin tools were active.
- Shared controls rendered square corners, unchanged focused-input borders,
  and no outline. The feature introduces no typing subscription or editor
  refresh path.

The adapter uses a separate local profile with a 16,384-token context and a
4,096-token response limit, with explicit thinking effort off. Goose's request
parameters alone did not change Ollama's effective context: the compatibility
endpoint continued to load 4,096 tokens. ConfigureLocalModel.ps1 therefore creates
chora-qwen3.5:9b-16k or chora-qwen3.5:4b-16k from the existing selected base model.
The adapter validates its persisted parameters and effective Goose model choice.
The original model and ordinary Goose configuration remain unchanged.
Effective model selection is checked before
any reader turn. Empty, interrupted and token-limited responses are incomplete,
not successful answers. There is no automatic model fallback or turn retry.

These checks establish integration behavior, not reliable interpretation.
During the disposable conversation the model attributed the opening Greek to
the wrong speaker. Source cards identify actual retrieved material; they do not
certify every claim in the response. The contextual acceptance scenarios below
remain unvalidated and should guide evaluation with the reader.

### Simplified chat validation

The revised interface has no work chooser, Vision checklist, selected-Greek
attachment, local-start button or model selector. The work label follows the
Library; sending starts execution lazily. Model choice lives in Chora settings.
The open same-work Vision is captured automatically on Send, including editor
prose explicitly marked as a draft when unsaved. It remains linked in the
reader's message history. Per-work conversation files preserve history across
navigation, and unsent drafts remain in their work's renderer state.

The full build and 149 tests passed. An isolated real Electron run verified that
the first Send started execution and listed both disposable current-work Visions.
The next request read both saved documents and returned the requested quotations
without an interpretive detour. A subsequent interrupted turn was saved as partial.
Ollama's runtime status confirmed chora-qwen3.5:9b-16k loaded with 16,384 context
tokens. The normal chat surface was rendered separately to verify its new name,
absence of setup controls, square corners, and unchanged focused-input borders.

This is a narrow behavioral check, not a guarantee of reliable future answers.

The agent's role is **interlocutor** and its reader-facing name is
**The Agentian Stranger**. It executes specific reader tasks using permitted
canonical evidence and reader writing. It does not independently interpret,
elaborate on meaning, review documents, or continue an inquiry without a request.
Interpretation or criticism is available only when specifically requested and
only within that task.

The first backend to evaluate is Goose with a local model. Goose is replaceable;
Chora's evidence, conversation contract, and behavioral instructions are not
owned by that backend. Sharing through Buzz is a possible later adapter, not a
prerequisite for private study.

## Identity and application-owned directives

The name refers to the unnamed Athenian participant in Plato's *Laws*. It names
a relationship, not a historical persona. The Agentian Stranger is a contemporary
interlocutor in the reader's encounter with the text. It does not impersonate
Plato's character, perform ancient dialogue, or claim philosophical authority.
It can address a requested interpretation, comparison or criticism without
adopting a Socratic interrogation routine or pursuing its own agenda.

**The Agentian Stranger is an interlocutor, not an authority.** The text remains
the primary object of inquiry; the reader remains the principal investigator.

[Interlocutor directives](STUDY_PARTNER_DIRECTIVES.md) are Chora's canonical
behavioral specification. The optional module loads these directives through
the application-owned backend contract,
including when starting or restoring a session with another backend. Do not
maintain a second persona or competing role instructions in Goose configuration.

Use The Agentian Stranger in the experimental interface's name and conversation
attribution when that interface is implemented. Keep `StudyPartner`, the existing
technical identifiers, and the evidence contracts unless functionality requires
a change. Replacing a backend changes execution, not this identity or role.

## Task-driven workflow

1. The open Library work determines the conversation and available canonical text.
2. The reader sends an ordinary message. Sending starts local execution if needed.
3. Each message refreshes the saved Visions belonging to that work. The model can
   list, search and read them on request; no per-document access checklist exists.
4. The open same-work Vision supplies automatic supporting context, including
   the editor snapshot at submission. This does not exclude other saved Visions.
5. The model completes the specific request with inspectable evidence and stops.
   Opening chat, changing works or restoring history never starts analysis.

The tools support paginated canonical Greek substring search, literal Vision search/listing, bounded document and
canonical-passage reads, anchor validation and word evidence. Reading “all”
Visions can require multiple pages/windows and is subject to explicit tool and
context budgets. Results must disclose partial coverage. Full corpus-wide
conceptual search remains a separate capability; model memory is not a substitute
for a completed source search.

## Task boundaries and growing guidance

Reader writing is the main source of personal guidance. The more the user
writes, the more their permitted Visions can tell the model about the questions,
distinctions, references, corrections and developing thought behind a task.
This is a central reason to build and preserve the Vision corpus.

More context can make assistance more faithful and useful over time. Trust grows
through repeated results that use that context accurately and visibly. This is
not automatic model training, guaranteed factual reliability, or permission for
independent interpretation. Earlier writing is context, not an irrevocable belief
or an instruction to enforce consistency.

Each submitted message captures the current saved Vision catalogue for that work.
Newly saved writing becomes available on the next request without a setup step.
The host does not stream editor drafts or review changes between submissions.
The open Vision is supporting context, not the work's document-access scope.
Its submitted editor snapshot never saves or changes the authoritative file.
Canonical search belongs to LibraryService, uses its existing PlatoSI document,
and scans all sections with accent/case/final-sigma normalization. Up to eight
Greek terms or stems match with OR semantics; results contain six sections per
page, match reasons, snippet offsets, versions and exact navigation selections.
Topic requests require choosing Greek search terms and inspecting candidates;
lexical coverage must not be represented as exhaustive conceptual coverage.

Retrieval is limited to six evidence calls per reader submission. Every result
reports remaining calls and directs the model to finish when two remain. Once
closed, the host returns a completion instruction without performing another
read. The passage-finding prompt requests one or two searches followed by up to
three verified candidates, preserving space for an answer before Goose's outer
twelve-turn safety limit. Budget limits require an honest partial-coverage
statement, not another unsolicited investigation.

The pinned Goose ACP implementation reports only cancellation and output-token
limits distinctly; its action-limit notice otherwise arrives as `end_turn`
([pinned response mapping](https://github.com/block/goose/blob/v1.59.0/crates/goose/src/acp/server.rs)).
The adapter therefore also recognizes the pinned runtime's action-limit notice
across streamed chunks and treats it as incomplete. This release-specific
handling must be reviewed when upgrading the verified Goose binary.

Task discipline is the behavioral rule: no unsolicited meaning-making,
connection-finding, contradiction detection or criticism. A request to retrieve
passages returns passages and their relevance; it does not authorize an essay.
A request for a specific analysis authorizes that analysis and no broader agenda.
When no task is clear, the model asks one brief clarification and waits.

The host enforces explicit submission, work/Vision scope, read-only capabilities,
budgets and revocation between turns. Prompt instructions constrain response
behavior; they do not prove that a model will always obey. Evaluation must test
scope compliance as well as source fidelity, without rewarding elaboration.

## Replaceable integration boundary

The proposed process arrangement is:

```text
Optional renderer interlocutor feature
    typed preload API / IPC_CHANNELS
Main-process interlocutor owner
    +-- bounded context and evidence-tool service
    |       +-- VisionService
    |       +-- TextAnchorService
    |       +-- LibraryService / WordExplorationService
    |                   +-- existing PlatoSiGateway / PlatoSiClient
    +-- StudyBackend interface
            +-- Goose adapter -> local goose acp process -> local model
            +-- a future alternative adapter
```

Chora owns study context, evidence identities, tool contracts, behavioral
instructions, The Agentian Stranger's reader-facing identity, session metadata,
and the visible conversation. The backend owns
model execution and its native runtime session. No Goose types or method names
belong in Vision, anchor, Library, or Word Lookup contracts.

The backend contract should cover availability, opening a session, submitting a
turn, streaming application-owned events, cancellation, and disposal. Report
unsupported capabilities explicitly. Provider session IDs are adapter bindings,
not the permanent identities of Chora conversations.

Use Goose's documented ACP integration and its supported TypeScript SDK instead
of inventing another wire protocol. Use MCP to make Chora's evidence tools
available to Goose. ACP connects the conversation interface to the runtime;
MCP connects the runtime to tools. Neither protocol defines the study behavior.

The renderer continues to have no filesystem or network access. Model prompts,
tool dispatch, process handles, and runtime configuration stay in the main
process. Renderer panels own DOM, controllers coordinate workflows, stores own
conversation state, and a gateway owns IPC. Cross-feature requests use the typed
event bus rather than direct calls between panels.

## Optional module and removal

Start with one optional module composed at the application boundary. This does
not require a general third-party JavaScript plugin loader or an open-ended
registry. The backend interface is justified by the explicit substitution goal.

- Disabled is the initial default. Disabled startup constructs no runtime,
  opens no tool listener, sends no prompts, and installs no UI subscription that
  streams editing activity.
- Enable and launch only through an explicit reader action. Reading must not
  depend on whether Goose is installed or a model is available.
- Keep Goose process launch, ACP translation, and Goose-specific configuration
  under the adapter's owning directory.
- Module disposal cancels active work, revokes tool access, stops its processes,
  removes subscriptions, and releases its surface.
- Removing the module wiring and adapter must leave all Vision, anchor, Library,
  Word Lookup, and autosave behavior intact.
- A second backend must consume the same work-scoped context and tool contracts. Native
  session state need not be transferable, but Chora's transcript and evidence
  references must remain readable.

## Context and the first evidence tools

Every turn has a captured context scope: current canonical work, automatic open Vision snapshot, and relevant saved revisions.
The host validates the scope; a model cannot widen it through tool arguments.
Changing the active editor tab does not silently retarget an in-flight turn.

The first slice implements these read-only tool contracts:

| Tool | Initial behavior | Existing authority |
| --- | --- | --- |
| `search_text` | Search the entire current canonical Greek work for one to eight normalized terms or stems; return six candidate sections per page, match reasons and exact locations | LibraryService and its PlatoSI-backed document |
| `find_visions` | Literal search of the captured current work's saved snapshots; return bounded excerpts and factual match reasons | VisionService snapshots |
| `read_vision` | Read a bounded window of one current-work Vision; identify the submitted open-editor draft separately from saved revisions | VisionService snapshots plus the validated submitted editor context |
| `resolve_anchor` | Validate an existing anchor and return its exact Greek, versioned range, and source identity | TextAnchorService and LibraryService |
| `read_passage` | Read a bounded canonical passage in the allowed work | LibraryService and its PlatoSI-backed document |
| `get_word_evidence` | Return dictionary, morphology candidates, and occurrences for a validated exact word | WordExplorationService and PlatoSiGateway |

The next tools can expose lexical search, linked Visions, reader-authored word
notes, and personal-name research through their existing owners. Do not create
a parallel Plato database, morphology implementation, Vision catalogue, or note
store inside the agent integration.

Search belongs with its existing feature owner if a new read use case is
needed. Module composition may expose narrow read capabilities from existing
services; it must not hand the agent repositories or arbitrary filesystem paths.

Results must:

- carry stable work, Vision, anchor, placement, and version identities as
  applicable, with provenance and warnings preserved;
- distinguish direct canonical evidence, reader writing, and generated research;
- expose all relevant lemma candidates rather than quietly selecting the first;
- paginate or report truncation, with bounded tool calls and output per turn;
- validate exact references before navigation or lookup;
- fall back to authoritative anchors and Visions when reverse indexes are absent;
- distinguish saved revisions from explicitly identified submitted editor drafts;
- report unavailable or stale evidence without substituting invented content.

The authoritative Vision directives remain unchanged. A tool may present their
Greek and a structured evidence list, using the existing directive parser; it
must not discard stable identities or let model output manufacture a placement.

## Existing model-assisted behavior

The current optional model-assisted operation is personal-name research, exposed
through `WordExplorationService.GetPersonResearchAsync` and PlatoSI's
`linguistics.person-research` operation. PlatoSI owns its model configuration,
research result, and cache. Chora owns the reader's notes about that evidence.

Make this existing operation available as a separately identified tool when the
reader requests it. Its generated synthesis must remain labeled as synthesis,
with source provenance and warnings intact. Avoid invoking it automatically on
every conversation turn.

The first experiment does not replace this specialized pipeline with a Goose
prompt. That would change evidence behavior and requires its own comparison.
Goose initially orchestrates existing capabilities through tools.

## Local model and runtime gates

The reader chose a local model for the first live experiment. The inspected
machine has Ollama running, with `qwen3.5:9b`, `qwen3.5:4b`, and `qwen:latest`
installed. No prompt or reader material was sent during that inventory check.
Goose was not found on the inspected command path.

Start by evaluating `qwen3.5:9b` as a candidate, not as a verified compatible
choice. Confirm tool calling, context limits, provider connectivity, and useful
conversation behavior through the exact Goose version we select. The smaller
model can be compared explicitly; never silently fall back to a different model
or a hosted provider.

Goose owns its provider configuration. Chora should not gain a second model-key
store. Keep the experiment's runtime profile isolated from ordinary Goose
sessions and unrelated extensions. Verify the supported configuration mechanism
against the pinned Goose version before implementing it.

The effective runtime must have only the declared Chora evidence tools. Do not
enable inherited shell, file-editing, browser, or arbitrary network tools. Do not
copy Buzz's automatic permission approvals. A working directory and ACP
permission callbacks alone do not enforce isolation; verify actual loaded
capabilities and fail closed when the required restrictions cannot be achieved.
Do not describe this as an OS sandbox unless one is actually supplied.

If loopback MCP is used, bind only to loopback, require a per-session random
credential, reject unauthorized requests, bound inputs and concurrent calls,
and revoke the endpoint when its session ends. Secrets, prompts, Vision bodies,
and tool results must not enter application diagnostic logs.

## Conversation continuity and memory

The first slice needs a continuing conversation with explicit evidence access.
It does not need embeddings, fine-tuning, background interpretation, a social
graph, or a new permanent belief profile.

Keep conversation records separate from Vision prose. Preserve author roles,
partial and completed turns, tool evidence references, and model/backend
identity. A reader correction must remain distinguishable from an agent claim.
Resuming after a crash must not automatically repeat an uncertain action.

Explicit reader feedback and inferred preferences are different evidence. An
accepted suggestion does not become a permanent belief, and a rejected one is
not silently retained as an accepted interpretation. Initial evaluation uses
curated conversation examples, not implicit preference learning, fine-tuning,
an autonomous memory system, or a duplicate Vision database.

Any later working-memory layer must retain supporting citations, dates, and
the distinction between reader affirmation and agent hypothesis. It must be
inspectable and correctable. An agent proposal does not become reader memory
merely because it was generated.

## Acceptance and remaining work

The running integration and its mechanical validation are described above.
Behavioral acceptance must now check the explicit-task contract:

| Situation | Expected behavior |
| --- | --- |
| The reader opens a session but submits no task. | No model prompt, retrieval or analysis. |
| The reader asks for material about time in selected Visions. | Retrieve relevant saved excerpts with Vision identities and revisions; state search limits and stop. |
| The reader asks for passages discussing time across Plato. | Use only actual available search capabilities; disclose incomplete corpus or conceptual coverage rather than claim completeness. |
| The reader thinks aloud without asking for work. | Ask what action they want; do not launch a review or interpretation. |
| The reader asks to examine a particular argument. | Address that argument using permitted context; keep analysis provisional and within the request. |
| More Visions are saved before a later request in the same work. | Make the new writing available automatically through tools and use it when the request calls for it, preserving revisions and changed positions. |
| Earlier Visions appear inconsistent but the current task is retrieval. | Complete retrieval; do not launch unsolicited contradiction analysis. |
| A requested result is complete. | Stop; no automatic follow-up investigation, monitoring or commentary. |

Record actual source use, unsupported claims, task drift, missed relevant writing
and reader corrections. A long response or unexpected connection is not a measure
of success. Additional context should improve fidelity to the reader's request,
not increase the model's authority to act.

Remaining capabilities include broader canonical retrieval, a multi-conversation archive within a work, deliberate native-session reconnection and evaluation of a second
backend. These should preserve the same task boundary and application-owned
identity. They do not require autonomous monitoring, fine-tuning or a belief
profile.

## References

- [Ollama model profiles](https://docs.ollama.com/api/create)
- [Ollama compatibility API context limits](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx)

- [Chora product direction](VISION.md)
- [The Agentian Stranger: application-owned behavioral directives](STUDY_PARTNER_DIRECTIVES.md)
- [Goose application integration through ACP](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/acp/index.md)
- [Goose GDK components](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/index.md)
- [Buzz harness architecture](https://github.com/block/buzz-app/blob/main/src/features/agent-harness/kit.ts)
- [Buzz external-app access and its separate community boundary](https://github.com/block/buzz-app/blob/main/docs/agents.md#external-app-authorization)
