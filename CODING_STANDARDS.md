# Coding Standards

This repository uses a strict, architecture-first C#-style discipline, applied to TypeScript.

## Core Principles

- Use strongly typed TypeScript. Avoid `any`; prefer explicit interfaces and types.
- Prefer object-oriented design with classes and interfaces for stateful or multi-step behavior.
- Build from the architecture, not from shortcuts or ad hoc fixes.
- Keep code readable, explicit, and easy to reason about.
- Every declaration must have a concise comment that explains what it represents or does. This includes constants, types, interfaces, classes, properties, functions, methods, and private helpers. Local variables and obvious control flow do not require comments.

## Object-Oriented Architecture

- Model real domain concepts as classes. Chora's literary hierarchy is `Library -> Text -> Segment`; its reader-owned record hierarchy is `DreamLibrary -> Dream -> Signal`.
- Put behavior on the object that owns the data and persistence affected by that behavior. A `DreamLibrary` owns Dream identity, validation, persistence location, and origin; a `Dream` owns its signals and reflection.
- Do not create generic `Manager`, `Helper`, `Utility`, or `Service` classes merely to hold unrelated operations. A collaboration boundary is justified only when it owns a concrete external responsibility, such as an IPC gateway, model provider, repository, or prompt loader.
- Prefer an explicit domain method over a free function that accepts the domain object as its first parameter. A method communicates ownership; a wrapper function obscures it.
- Keep orchestration at the boundary. Renderer controllers select workflows and invoke domain operations; domain records do not understand DOM events, Electron IPC, or model-provider implementation details they do not own.
- Keep dependency direction inward: Electron IPC, repositories, model providers, and panels may depend on domain objects, but domain objects must not depend on Electron, DOM APIs, prompt files, or UI naming.
- Use composition by default. A class should hold the collaborators and child objects it genuinely owns rather than inheriting implementation for convenience.

### Encapsulation And Persistence

- Keep state `private` unless a caller has a clear domain reason to observe it. Expose intention-revealing methods and immutable snapshots instead of mutable internal objects, collections, file paths, or persistence records.
- A class is responsible for maintaining the validity of its own state. Validation, normalization, identifier assignment, origin tracking, and persistence rules belong with the object whose state they protect.
- Do not let callers mutate a child collection or record owned by another object. Return readonly, deeply immutable views for observation and provide a named owner method when mutation is required.
- Do not duplicate state in parallel objects, wrapper classes, caches, or sidecar files. Persist one authoritative representation and let its owner read and write it.
- The main process owns filesystem paths, canonical identifiers, persistence, and validation at every IPC boundary. The renderer submits narrow commands or drafts; it must not supply trusted paths, persistence origins, or authoritative aggregate entities.
- Resolve external identifiers through an owner-controlled manifest or registry before I/O. Validate them before use and prove resolved filesystem paths remain inside the owner-controlled root.
- Keep implementation helpers `private` and close to the behavior they support. Promote a helper to a public API only when another owner has a legitimate domain need for it.

### Renderer And Main-Process Boundaries

- Renderer features separate `Panel`, `Controller`, `Store`, and `Gateway` responsibilities. Panels own DOM rendering and browser events only. Controllers coordinate workflows and typed application events. Stores are the sole renderer-side owners of feature state. Gateways are stateless typed IPC clients. Related features may share an existing owning store; Signal editing uses `DreamStore` rather than a separate Signal state registry. Do not introduce empty layers merely to satisfy a folder template.
- Main-process features contain an `IpcController`, concrete external-boundary collaborator, and `Repository` where canonical data access or persistence is required.
- Publish typed application events through `ChoraEventBus` for cross-component communication. Event names describe completed facts in past tense or requests with a `requested` suffix.
- Panels own persistent DOM roots and register delegated DOM events once. Do not rebuild the entire application DOM in response to state changes.
- Retain and dispose subscriptions when a component has a shorter lifetime than the application.
- Use `ErrorManager` for debug output, operational logs, and user-facing errors. Preserve the original failure for diagnosis at the owning boundary.
- Renderer requests for language-model operations go through the owning feature gateway, the typed preload API, and main-process IPC. The main-process operation loads prompts and invokes the configured model provider. For conversational Clarity Check, this path uses `ChatGateway`, `ChatService`, and the Dream-owned canonical context integration; model selection and provider transport use main-process `ModelApi`. Panels never call providers directly; credentials and provider configuration remain in the main process.

## Required Rules

- Use `PascalCase` for module filenames, exported functions, types, classes, interfaces, and public members. Conventional entrypoints and declaration files may retain their required names.
- Use `camelCase` for local variables, parameters, and private fields.
- Use `const` for values that do not change; `readonly` for class fields that do not change after construction.
- Use tabs for indentation. Do not use spaces for indentation.
- Write no more than one operation per line. Do not combine multiple actions into a single statement.
- Do not pass an operation result directly into another operation. Store it in a named local first.
- Do not perform operations inside `return` statements.
- Do not use early returns inside a function. Use a single `return` only at the end of a function.
- Place opening curly braces on the next line.
- Avoid hacks, workarounds, and brittle shortcuts.

## Style Expectations

- Prefer explicit types over implicit behavior when clarity matters.
- Keep functions focused on one responsibility.
- Keep control flow simple and explicit.
- Make state changes easy to trace.
- Use declaration comments to explain purpose and ownership, not to restate syntax.
- Prefer `async`/`await` over raw Promise chaining for I/O.
- Name asynchronous functions and methods with the `Async` suffix.
- Prefer named functions and explicit class methods with block bodies.
- Do not use lambdas or arrow functions. Use named functions or explicit class methods instead.
- Keep access modifiers explicit on class members.
- Prefer `private` by default for class members.
- Import with `.js` extensions for relative TypeScript imports (NodeNext module resolution).

## Prompt Management

- Do not embed model prompts or natural-language model instructions in source code.
- Store every model prompt in a dedicated Markdown file under `Prompts/`.
- Use one clearly named prompt file per role or operation.
- Load prompts through the main-process prompt loader; do not read prompt files directly from the renderer or individual providers.
- Keep source code responsible only for selecting prompts, supplying structured context, and assembling model requests.
- Add prompt files to packaged application resources when introducing a new prompt location.
- Ordinary interface labels, validation messages, and error messages are not model prompts and may remain in code.

## Decision Rule

If a solution conflicts with these standards, choose the design that preserves the architecture.

If a task cannot be solved cleanly within these standards, redesign the implementation rather than forcing it.

## Workflow Rule

Before making any code changes in this repository, read this document first and follow it exactly.

## Existing Code and Change Discipline

- Before implementing a feature, inspect the existing code paths, domain objects, and interfaces relevant to the requested behavior.
- Identify the object that currently owns the behavior before deciding where a change belongs.
- Extend or modify the existing implementation rather than introducing a parallel implementation.
- Do not create duplicate code paths, alternative representations, redundant state, or replacement abstractions when an existing implementation can be adapted.
- Trace the callers and dependencies of any method, interface, or type before changing its contract.
- Preserve existing functionality unless the requested change explicitly requires altering it.
- Preserve unrelated working-tree changes. Do not overwrite, revert, or remove them while completing a task.
- Do not introduce architectural refactoring unrelated to the requested task.
- Do not create compatibility wrappers, fallback implementations, or temporary workarounds to avoid updating the correct implementation.
- Keep changes narrowly scoped, but update all affected callers and contracts when a coherent change requires it.
- Follow the Build and Test Discipline section below when validating changes.
- Documentation-only changes require a targeted content and diff review rather than application tests or builds.
- Review the resulting diff for unnecessary files, duplicate logic, and unintended changes before considering the task complete.

## Build and Test Discipline

- Do not create new tests unless the task explicitly requires them or I approve them.
- After implementing a change, run one targeted validation pass appropriate to the affected code.
- Do not run repeated full builds, test suites, or lint passes automatically.
- Do not enter iterative test-and-fix cycles without my approval.
- If validation fails, report the failure and its likely cause before attempting additional changes.
- Prefer targeted checks over repository-wide verification.
- Summarize the changes made, the validation performed, and any remaining issues.

### Before Implementation

For changes involving multiple components or architectural decisions:

1. Identify the existing implementation and its owner.
2. Explain the proposed modification and affected components.
3. Identify any risks to existing behavior.
4. Obtain approval before implementing, unless the user has already approved that scope in the current conversation.

For small, localized changes, proceed directly while following the same architectural principles.


## Error Handling and Diagnostics

- Expected domain rejections use `ApplicationError` with a stable code, category, and recovery instruction. Cancellation is an explicit outcome, not a user-facing error.
- Register privileged invoke handlers through `IpcErrorBoundary`. The boundary sends `OperationResult<T>` envelopes and records the original exception once with a diagnostic reference. Never log IPC arguments, reading documents, or provider request bodies.
- Preload transports plain result envelopes; feature gateways use `ReadOperationAsync` to reconstruct process-local failures. Do not rely on custom Error properties surviving Electron serialization.
- Use the existing `DiagnosticManager` for diagnostics and renderer `ErrorManager.Report` for user notifications. Preserve a failure's diagnostic identity through subsequent catches. Do not add parallel loggers or scatter error-message formatting across panels.
- A feature-owned error dialog may present a captured diagnostic instead of a global notification; do not present the same failure twice. Retain unsaved state and expose an explicit failed operation outcome to callers.
- Do not claim a failed multi-file or transport operation left everything unchanged. Communicate known completion separately from pending cleanup or failed refresh. Retry requires an explicit workflow decision.
- Main-process diagnostics own persistent, sanitized JSON-lines storage. Logging failures retain bounded in-memory records and must not replace the original application failure or recursively log themselves.


## Renderer Workflow Ownership

- Keep `DreamController` focused on editing commands, source extension, and editor-tab lifecycle. Save scheduling, catalogue operations, Explorer organization, exports, and model requests belong to their respective owners.
- `DreamSaveCoordinator` owns autosave timing, persistence ordering, revision checks, and suspension for deletion. Close and delete must drain the relevant active save before proceeding. Save outcomes apply to the captured Dream identity, even if the active tab changes.
- `DreamCatalogueController` owns catalogue reads, explicit reconciliation, filtering, and grouped projections. `DreamExplorerController` owns creation, folders, moves, and Explorer selection; it invokes the gateway for its actual mutations rather than forwarding them back to the editing controller.
- `DreamExportController` owns export commands and uses the existing `DreamMarkdownExport` formatter. Conversational Clarity Check state belongs to generic Chat and must not be duplicated in `DreamStore`.
- `WorkspaceShellPanel` owns shell DOM and shortcut event translation; `WorkspaceLayoutPanel` owns resizing and Explorer collapse; `ReadingAppearancePanel` owns preference-control DOM. Durable values remain in the existing settings stores. `WorkspaceController` coordinates activation and typed workspace requests without owning DOM.
- `ChoraApplication` is the composition root: construct collaborators, mount feature owners, start them in dependency order, and dispose them in reverse order. Do not implement layout gestures, feature workflows, or notification presentation there.
