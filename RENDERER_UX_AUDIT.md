# Renderer UX controls and style audit

November 10, 2026

The complete `src/renderer/` tree was reviewed for modal dialogs, navigation collections, tabs, native form controls, floating panes, menus, editing surfaces, and shared styling. The implementation keeps feature workflows in their existing panels/controllers and moves repeated interaction behavior into `ui/controls/`.

## Implemented controls and migrations

| Element | Shared owner | Current consumers |
| --- | --- | --- |
| Modal form, question, and notification | [DialogControl](src/renderer/ui/controls/DialogControl.ts) | Vision deletion, folder deletion, Vision rename, new folder, Add work, diagnostic notifications |
| Selectable flat collection | [ListViewControl](src/renderer/ui/controls/ListViewControl.ts) | Work picker, Word Lookup occurrence navigation, lemma choice |
| Hierarchical navigation | [TreeControl](src/renderer/ui/controls/TreeControl.ts) | Explorer works, Visions, nested folders, inline folder actions, Vision drag/drop |
| Content tabs and persistent panels | [TabControl](src/renderer/ui/controls/TabControl.ts), [TabPanel](src/renderer/ui/controls/TabPanel.ts) | Word Lookup tabs and Vision Write/Markdown/Preview modes |
| Movable nonmodal research pane | [FloatingPanel](src/renderer/ui/controls/FloatingPanel.ts) | Dictionary, related lexical material, occurrences |
| Control appearance | [controls.css](src/renderer/styles/controls.css) | Dialog frames, buttons, fields, search boxes, list/tree rows, icons, selection, keyboard focus, light/dark colors |

### Dialog contract

Every modal dialog presents **Cancel** and **OK** in the same order. The title and body describe the requested action; the buttons do not duplicate feature verbs such as Delete Vision, Create folder, or Save. Opening the dialog or selecting a work row does not commit the action.

The control owns native modal focus trapping, Escape cancellation, header-close cancellation, initial focus, focus restoration, native form validation, and one commit at a time. Confirmations initially focus Cancel; form dialogs focus their input. During an asynchronous commit the draft and all dismissal controls are disabled. A rejected commit retains the input and displays feedback. Unexpected failures use `ErrorManager` and preserve a diagnostic reference inside the dialog.

The feature supplies the content and a commit callback. Controllers and gateways continue to own navigation, persistence, deletion, and validation at the process boundary. Rename and folder operations capture their document/work context rather than relying on whatever might become active later.

Add work now has two explicit steps: select a row, then press OK. Cancel discards the chooser selection without opening or adding a work.

### List and tree contracts

`ListViewControl` owns stable row identities, selected state, roving tab stops, Arrow Up/Down, Home/End, and keyboard selection. Optional badges and secondary labels are presentation slots. Occurrence lists in floating panes are mounted as separate live controls; event listeners are not assumed to survive DOM cloning. Derived Vision badges update without rebuilding navigation rows.

`TreeControl` owns keyed row/branch DOM, independent disclosure state, hierarchy semantics, keyboard movement, inline actions, and compatible drag/drop handling. The Explorer projects works, folders, and Visions into this control and translates returned identities into existing feature commands. Search no longer rebuilds the search field, and catalogue/metadata changes retain existing row nodes.

## Style consistency

Shared controls use the existing theme palette and one set of typography, row height, padding, radius, icon, hover, selection, and focus tokens. Modal titles use the same 14 px heading treatment; body and navigation UI use 13 px; action buttons use 12 px and a 30 px minimum height. Greek labels retain the configured reading font. These values have one canonical declaration in `controls.css`.

Dialogs and floating panes share window framing and header/close-button styling. Floating panes remain nonmodal research surfaces with a close action, since they do not stage a form or confirmation to be committed. Feature CSS still owns geometry such as Word Lookup column proportions and the canonical content inset.

The previous `PopupPanel` and `DeleteConfirmation` implementations were removed, along with their obsolete popup/Explorer styles, manual mode-tab markup, manual occurrence-row rendering, and separate lemma-choice keyboard handling. There are no compatibility wrappers retaining those old paths.

## Elements deliberately kept in their current owner

- **Native inputs, selects, and text areas:** browser controls already supply reusable editing, validation, and keyboard behavior. Shared control styling is used for application forms; reader-toolbar layout remains with its panel. Extra wrapper classes would add no behavior.
- **Dictionary definitions, citations, prose lists, and linked-Vision links:** these are semantic document content, rather than selectable list widgets. They remain ordinary accessible HTML.
- **Top-level Vision document strip:** `VisionTabsPanel` owns document-specific dirty indicators, save actions, close behavior, and context commands. It retains keyed DOM and uses the shared type/theme tokens. Ordinary content/mode tabs use `TabControl`.
- **Reading settings and find popovers:** these are persistent native `details` surfaces using the existing `ActionMenus` dismissal mechanism, not modal commit dialogs. The existing reading-settings workflow remains immediate and feature-owned.
- **Panel layout:** `SplitViewControl` now owns nested rows/columns, host geometry, shared dividers, collapse, restoration, pointer capture, keyboard handling, and container stacking. Composition owners attach feature roots and persist snapshots; the content does not inspect its host or implement its resize gestures. `StatusBarControl` supplies the permanent footer outside those groups. See [the panel framework guide](PANEL_FRAMEWORK.md).
- **Milkdown and CodeMirror:** the editor adapters continue to own third-party editing behavior. They are not reimplemented as generic form fields, and this task does not change their typing or serialization model.
- **Workspace activity rail:** `WorkspaceSidebar` remains the reusable owner of extension selection and its persistent mounted surfaces.

## Validation

The existing regression scenarios were updated for the shared controls. They cover Cancel without commit, explicit OK, duplicate-submit suppression, pending dismissal protection, retained failed folder input, deferred work selection, tree hierarchy/moves, lookup navigation/morphology, and mode tabs. No new test cases or dependencies were added.

Light and dark modal rendering and the Explorer/list styling were inspected in an isolated Electron preview using synthetic data.

The application build passed. The initial regression suite passed 140 of 141 tests across 34 passing files and one failing file. The failure was in `WordExplorationPanel.test.ts`, where the occurrence passage was absent from the queried detail after a navigation-row click. The dialog, Explorer, mode-tab, and style scenarios passed.

`WordExplorationPanel.ts` and its existing regression scenarios were modified outside this task after that validation run, placing morphology beneath the passage. Those edits were preserved. With the reader's approval, a focused rerun of `WordExplorationPanel.test.ts` passed all six tests against the updated layout, including the previously failing scenario. No additional source fix or repeated full-suite run was needed.

## Stylesheet follow-up

The approved stylesheet review removed 94 rule blocks and 311 declarations across the nine imported topic files. Source CSS is approximately 23% smaller. All nine files retain active responsibilities: theme files own palette values, `base.css` owns workspace/reader/lookup geometry, `tabs.css` owns content and document tabs, and `controls.css` owns shared window, icon, and focus styling. Breakpoints now live in `responsive.css`.

Removed obsolete notification, form, Explorer, and Word Lookup selectors; superseded palettes and layout declarations; unused variables; the inactive CodeMirror selection-layer rule; and the disabled document-tab divider. Runtime-generated ProseMirror and active CodeMirror classes were retained. The final static inventory found no unreferenced application classes, unused declared variables, repeated selectors under the same condition, or duplicate properties within a rule.

Corrected responsive column ownership to `.workspace-main-grid`, restored `.document-tab-bar` framing, fixed the placeholder attribute owner, and restored the Find row's flex layout. Reader toolbar controls wrap when needed. Thirteen synthetic workspace states were compared before and after in isolated Electron previews, covering both themes, narrow/collapsed layouts, editor modes, Word Lookup, Find, settings, modal dialogs, and floating panes.

The renderer production build passed, and all 89 application renderer tests passed in the validation run. The command also discovered three temporary pre-cleanup test snapshots, causing an additional import failure and obsolete assertion failure outside the application suite. Those snapshots were renamed out of test discovery. No application test failure required a source fix, and the suite was not repeated. Existing cases were updated; no new test cases or dependencies were added.

## Panel framework follow-up

Explorer, Vision, Text, Word Lookup, Dictionary/Occurrences, and occurrence list/detail now use the same split-view control. Dragging an edge collapses a side to zero while leaving a centered, keyboard-accessible recovery divider. Expanded panes share a 48 px minimum instead of the old feature-specific widths and ratio limits. Window shrinking distributes space proportionally, and saved layout preserves preferred sizes and collapse choices.

Removed the old workspace drag implementation and Word Lookup's outer-height, column-width, ratio-clamp, pointer, and keyboard resize paths. The reader also no longer locates a parent panel to obtain its scrolling surface. The status bar is an independent reusable control, empty by default and mounted below the resizable workspace.

Isolated Electron previews exercised real pointer drags in ten scenes, including light/dark themes, zero-width Explorer, zero-height Word Lookup, collapsed Text and Dictionary, a roughly 80 px Vision pane, narrow containers, and editor modes. Existing regression cases were extended without adding test cases. All 141 tests passed. The full build passed after the approved `Array.from(...)` conversion required by this project's DOM library configuration.
