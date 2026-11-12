# Application state

`src/renderer/app/ApplicationState.ts` owns workspace resume and checkpoint scheduling. `ChoraApplication` constructs it and invokes `RestoreAsync` after mounting the UI. Feature stores remain authoritative during a run.

The versioned `chora:application-state` local-storage record contains:

- The active canonical work, exact passage selection, and reading-focus location.
- Ordered Vision document IDs, the active document, and each open document's Write, Markdown, or Preview mode.
- Ordered Word Lookup selections, reader-selected lemmas, selected occurrence ranges, the active tab, and lookup visibility.

Writing bodies and lookup responses are excluded. Startup loads the authoritative catalogues, reconciles Vision IDs, opens the remembered work, validates saved locations against its canonical text version, and reloads lookup evidence. A saved lemma is restored only if it is still among the returned candidates. Multiple tabs for one occurrence retain their separate lemma choices. Invalid ranges and deleted documents are discarded; a failed catalogue read preserves its last-good resume section.

Typed feature notifications schedule a checkpoint after 250 milliseconds of inactivity. Page hiding, application blur, hidden document visibility, and disposal flush pending metadata synchronously. Writing-content changes do not schedule workspace checkpoints. The old `chora:last-work` and session-only `chora:vision-session` values migrate on the first successful checkpoint; the obsolete `SessionStore` is removed.

`application.restoring` and `application.restored` bracket startup so that restored document availability does not reopen collapsed workspace hosts. Existing `LayoutSettingsStore`, `ReadingSettingsStore`, and Explorer membership persistence retain their own responsibilities. New layout panes continue to use the existing shared split-view state.

The main-process `ChoraWindowManager` separately persists native normal bounds, maximized state, and fullscreen state in `window-state.json` under Electron's user-data directory. Move and resize notifications are coalesced; closing checkpoints synchronously. Restored geometry is clamped to an attached display's work area. Minimized presentation is not restored.

For a new resumable feature, expose a small metadata projection and a restore operation on its existing owner, then include those in the versioned application snapshot and subscribe to its typed state-change facts. Keep DOM references, timers, IPC handles, document bodies, and derived response caches out of the saved record.
