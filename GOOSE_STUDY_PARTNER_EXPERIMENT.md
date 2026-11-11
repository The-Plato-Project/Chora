# Optional Local Study Partner: Goose Experiment

## Status and purpose

This is the design and acceptance contract for a new experimental PR. No agent
runtime, dependency, model call, background indexing, or chat UI is enabled by
this document. The working reading and writing environment remains the baseline.

The reader wants a conversational study partner that can follow their developing
interpretation, retrieve earlier writing, notice possible connections and
tensions, and ask questions that help the reader articulate their own thinking.
The partner should offer something to examine rather than merely repeat the
reader or assume the role of a Plato instructor.

The first backend to evaluate is Goose with a local model. Goose is replaceable;
Chora's evidence, conversation contract, and behavioral instructions are not
owned by that backend. Sharing through Buzz is a possible later adapter, not a
prerequisite for private study.

## First experiment

1. The reader explicitly opens the experimental Study Partner surface.
2. They choose a work and which Visions may participate. An exact passage and
   an active Vision excerpt can be attached as initial context.
3. They start a conversation with the local model.
4. The model uses bounded, read-only Chora tools to retrieve supporting material.
5. Answers distinguish canonical evidence, reader-authored writing, and model
   proposals. Retrieved evidence has stable source references.
6. The reader can challenge the answer, explain an apparent contradiction,
   correct an attribution, or leave a question unresolved.
7. Stopping the experiment terminates its work without interrupting normal
   reading, writing, Word Lookup, or autosave.

For example: "What earlier writing of mine might bear on this passage?" The
partner might compare two dated Vision excerpts, explain a possible connection,
and ask whether the reader sees a change of position or a difference of context.
It must not record that connection as an established interpretation.

## Reader authority and useful challenge

- Cite the exact writing behind an attribution to the reader. Do not attribute
  an agent suggestion to them because it appeared earlier in a conversation.
- Distinguish an affirmed statement, an exploratory question, an older position,
  and an agent hypothesis. Ask when that distinction is unclear.
- Present a possible contradiction as a question supported by both excerpts.
  Check their dates and contexts before implying inconsistency.
- Offer alternative readings of the reader's own argument when grounded in
  evidence. Agreement and repetition are not substitutes for useful inquiry.
- Separate linguistic possibilities from contextual meaning. A dictionary entry
  or morphology candidate does not establish what Plato means in a passage.
- The reader can reject a suggestion without the partner continuing to treat it
  as accepted. Uncertainty and changes of mind remain legitimate outcomes.
- Do not modify Vision prose, create anchors or placements, choose a lemma for
  the reader, or persist a relationship. The first tool set has no write tools.
- Do not assume that a prompt alone enforces these boundaries. Tool authority,
  source validation, and conversational evaluation must support them.

## Replaceable integration boundary

The proposed process arrangement is:

```text
Optional renderer Study Partner feature
    typed preload API / IPC_CHANNELS
Main-process Study Partner owner
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
instructions, session metadata, and the visible conversation. The backend owns
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

These are proposed tool contracts, not claims that the methods already exist:

| Tool | Initial behavior | Existing authority |
| --- | --- | --- |
| `find_visions` | Search allowed Vision titles and prose; return bounded excerpts and factual match reasons | VisionService |
| `read_vision` | Read a bounded window of one allowed saved Vision, with revision and placement references | VisionService |
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

Any later working-memory layer must retain supporting citations, dates, and
the distinction between reader affirmation and agent hypothesis. It must be
inspectable and correctable. An agent proposal does not become reader memory
merely because it was generated.

## Implementation sequence and acceptance

The PR starts with this design. Runtime implementation should proceed in small
reviewable slices:

1. **Evidence tools:** implement the first read-only tool set against existing
   service owners; exercise valid, out-of-scope, missing, stale, and oversized
   requests. Preserve evidence ambiguity and provenance.
2. **Isolated Goose connection:** select and pin a compatible Goose/ACP setup;
   verify the local model and actual tool restrictions with disposable content.
   Exercise streaming, cancellation, process failure, and teardown.
3. **One contextual conversation:** mount an optional shared-control surface;
   explicitly attach a work, allowed Visions, and a selection. Show source-linked
   answers and visible failures without changing editor behavior.
4. **Study evaluation:** use reader-chosen material to assess whether the partner
   can find a useful earlier connection, distinguish changes of mind from
   contradictions, accept correction, and offer grounded questions without
   parroting or lecturing. Record examples that fail as well as those that work.
5. **Continuity and replacement:** persist and reopen a conversation, disable the
   module during work, and exercise a second backend implementation or disposable
   test backend against the same application contract. Confirm ordinary reading
   and writing still work with the integration removed.

New targeted test cases for implementation should be approved under the project's
test discipline. Run focused checks for each slice and the full build and suite
for changes spanning the runtime boundaries. A live Goose conversation is not
established by mocked protocol checks or by the existence of this plan.

## References

- [Chora product direction](VISION.md)
- [Goose application integration through ACP](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/acp/index.md)
- [Goose GDK components](https://github.com/aaif-goose/goose/blob/main/documentation/docs/gdk/index.md)
- [Buzz harness architecture](https://github.com/block/buzz-app/blob/main/src/features/agent-harness/kit.ts)
- [Buzz external-app access and its separate community boundary](https://github.com/block/buzz-app/blob/main/docs/agents.md#external-app-authorization)
