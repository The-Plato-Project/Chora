# The Athenian Stranger: Optional Local Interlocutor / Goose Experiment

## Status and purpose

This is the design and acceptance contract for the experimental PR. The first
implementation adds an optional sidebar conversation, a replaceable backend
interface, and five read-only evidence tools. The runtime remains disabled until
the reader chooses context and starts it explicitly. Behavioral acceptance is a
separate reader-led evaluation; implementation alone does not establish it.

### Running the Windows experiment

1. Run `powershell -ExecutionPolicy Bypass -File scripts/InstallGoose.ps1`.
   The installer verifies the official Goose 1.59.0 archive and executable.
2. Add the printed `CHORA_GOOSE_BINARY` setting to `.env.local` and restart Chora.
3. Start Ollama with `qwen3.5:9b` installed. The interface also offers an explicit
   `qwen3.5:4b` choice; it never switches models or providers automatically.
4. Open The Athenian Stranger in the activity bar. Choose the current work,
   check the saved Visions to share, and optionally attach the selected Greek.
   Save writing first: unsaved drafts are excluded.
5. Start the local conversation. Ask a question and inspect retrieved source
   cards below the conversation. These cards come from validated host results,
   rather than interpreting model-generated links as commands.
6. Stop ends the runtime and revokes evidence access. View last conversation
   reopens passive history without replaying a turn or launching a model.

The first slice keeps the latest transcript in application data under
`interlocutor/latest.json`. It records partial responses separately from complete
ones. Starting another conversation replaces that latest history; a conversation
archive and native-session reconnection are not implemented. Goose keeps its
own local session files in isolated application-data profiles under `goose/`.
These profiles are separate from ordinary Goose configuration. This integration
restricts exposed tools; it is not an operating-system sandbox.

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

The local profile sets a 16,384-token context and a 4,096-token response limit,
with explicit thinking effort off. Effective model selection is checked before
any reader turn. Empty, interrupted and token-limited responses are incomplete,
not successful answers. There is no automatic model fallback or turn retry.

These checks establish integration behavior, not reliable interpretation.
During the disposable conversation the model attributed the opening Greek to
the wrong speaker. Source cards identify actual retrieved material; they do not
certify every claim in the response. The contextual acceptance scenarios below
remain unvalidated and should guide evaluation with the reader.

The agent's role is **interlocutor** and its reader-facing name is
**The Athenian Stranger**. It executes specific reader tasks using permitted
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
a relationship, not a historical persona. The Athenian Stranger is a contemporary
interlocutor in the reader's encounter with the text. It does not impersonate
Plato's character, perform ancient dialogue, or claim philosophical authority.
It can address a requested interpretation, comparison or criticism without
adopting a Socratic interrogation routine or pursuing its own agenda.

**The Athenian Stranger is an interlocutor, not an authority.** The text remains
the primary object of inquiry; the reader remains the principal investigator.

[Interlocutor directives](STUDY_PARTNER_DIRECTIVES.md) are Chora's canonical
behavioral specification. The optional module loads these directives through
the application-owned backend contract,
including when starting or restoring a session with another backend. Do not
maintain a second persona or competing role instructions in Goose configuration.

Use The Athenian Stranger in the experimental interface's name and conversation
attribution when that interface is implemented. Keep `StudyPartner`, the existing
technical identifiers, and the evidence contracts unless functionality requires
a change. Replacing a backend changes execution, not this identity or role.

## Task-driven workflow

1. The reader opens The Athenian Stranger and chooses a work, saved Visions and
   an optional exact passage. This grants context access, not an analysis task.
2. They submit a specific task or question. For example: find information about
   time in the selected Visions, or compare two named passages on a stated issue.
3. The host enables bounded read tools for that submitted task only. The prompt
   identifies the current task separately from earlier conversation and sources.
4. The model returns the requested result with inspectable evidence, then stops.
   It does not add an unsolicited interpretation or start another investigation.
5. If the action is unclear, it asks what the reader wants done and waits.
6. The reader decides whether to give another task, include additional writing,
   examine a particular interpretation, or leave the matter unresolved.

The current tools support literal search of selected Vision snapshots, bounded
reads of saved writing and known canonical passages, anchor validation and word
evidence. A request such as "find discussions of time in Plato" describes an
intended retrieval task; complete corpus-wide conceptual search is not yet an
implemented capability. The model must disclose that limitation and must not
claim an exhaustive search or substitute its memory for retrieved evidence.

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

The first slice captures saved Vision snapshots at explicit session start.
Later saves do not silently replace that grant or stream drafts to the model.
Starting a new conversation with the updated selected Visions supplies the new
writing as guidance. Automatic task-time refresh and a larger retrieval index
would require a separate explicit context contract.

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
instructions, The Athenian Stranger's reader-facing identity, session metadata,
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
- A second backend must consume the same context and tool contracts. Native
  session state need not be transferable, but Chora's transcript and evidence
  references must remain readable.

## Context and the first evidence tools

Every turn has a captured context scope: allowed work and Vision IDs, attached
selection, optional explicitly shared draft excerpt, and relevant revisions.
The host validates the scope; a model cannot widen it through tool arguments.
Changing the active editor tab does not silently retarget an in-flight turn.

The first slice implements these read-only tool contracts:

| Tool | Initial behavior | Existing authority |
| --- | --- | --- |
| `find_visions` | Literal search of the captured permitted saved snapshots; return bounded excerpts and factual match reasons | VisionService snapshots |
| `read_vision` | Read a bounded window of one allowed saved Vision, preserving canonical placement metadata | VisionService snapshots |
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
- identify saved content and explicitly shared unsaved draft content separately;
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
| More relevant Visions are explicitly included in a later task context. | Use the additional reader guidance faithfully, distinguishing earlier questions, changed positions and current claims. |
| Earlier Visions appear inconsistent but the current task is retrieval. | Complete retrieval; do not launch unsolicited contradiction analysis. |
| A requested result is complete. | Stop; no automatic follow-up investigation, monitoring or commentary. |

Record actual source use, unsupported claims, task drift, missed relevant writing
and reader corrections. A long response or unexpected connection is not a measure
of success. Additional context should improve fidelity to the reader's request,
not increase the model's authority to act.

Remaining capabilities include broader canonical retrieval, a conversation
archive, deliberate native-session reconnection and evaluation of a second
backend. These should preserve the same task boundary and application-owned
identity. They do not require autonomous monitoring, fine-tuning or a belief
profile.

## References

- [Chora product direction](VISION.md)
- [The Athenian Stranger: application-owned behavioral directives](STUDY_PARTNER_DIRECTIVES.md)
- [Goose application integration through ACP](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/acp/index.md)
- [Goose GDK components](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/index.md)
- [Buzz harness architecture](https://github.com/block/buzz-app/blob/main/src/features/agent-harness/kit.ts)
- [Buzz external-app access and its separate community boundary](https://github.com/block/buzz-app/blob/main/docs/agents.md#external-app-authorization)
