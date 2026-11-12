# Word Search

The magnifying-glass contribution below Explorer mounts `WordSearchPanel` through the existing sidebar extension registry. It uses the shared list control. Input requests are debounced by 350 milliseconds; Enter or Search submits immediately. Editing the query invalidates earlier responses so stale matches cannot replace current results.

`WordExplorationStore` owns search and lookup state. `WordExplorationController` coordinates both passage lookup and lexical lookup. A selected headword publishes `word.lemma-open-requested`; the existing bottom tab control displays the result. A lexical tab has a headword origin and no passage selection. The application snapshot preserves that distinction when restoring tabs.

The feature uses the existing gateway → typed preload → IPC controller → main service → PlatoSI gateway boundaries. The renderer never opens a database or invokes an analyzer. The main service resolves optional work identity and version through `LibraryService`.

PlatoSI adds two local operations:

- `word.search {query}` combines possible lemmas from enabled morphology with dictionary matches and bounded accent-insensitive headword prefix search. It returns at most 50 distinct headwords; it does not automatically choose one.
- `word.lookup {lemma, scope}` loads dictionary evidence for the chosen headword and optionally joins occurrences in a canonical work. It reuses the existing dictionary, relation, and occurrence assembly. The response is `platosi.lexical-evidence.v1`, with a null passage location and explicit optional work scope.

Dictionary-only tabs remain available with no work selected or no occurrences. The UI distinguishes no indexed occurrences from unavailable occurrence coverage. Changing works retains lexical tabs and refreshes their occurrence scope; exact passage tabs retain their existing work-scoped lifecycle. Stale responses are guarded by monotonic request generations. Selecting an occurrence loads morphology for that exact passage through the existing workflow.

The configured PlatoSI Python environment was inspected: ikelos is installed and the Morpheus provider is enabled. Search therefore needs no new dependency or provider configuration change in this environment.

Changes to the sibling PlatoSI checkout are required alongside the Chora changes: `src/platosi/reader_api.py`, `plugins/lsj-logeion/provider.py`, and its manifest. Restart the running app/service to load the new Python operations.
