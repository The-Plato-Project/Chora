# Remaining Vision typing latency

November 9, 2026

**Write-mode serialization is a measured bottleneck, but the shared cause of the reader's reported sluggishness is not yet established.** The reader subsequently confirmed that both Write and Markdown modes feel slow. Whole-document rich-text serialization cannot explain the Markdown-mode symptom. The previous event correction removed broad UI invalidations; the investigation below distinguishes the additional Write-mode cost from the unresolved cross-mode issue.

This investigation changed no application code or reader documents. It inspected the current source and installed dependencies, then profiled the actual editor wrappers in an isolated Electron renderer using synthetic writing. The results establish a scaling problem in the current input path; they are not a recording of the reader's visible session.

## What still happens for each character

In Write mode, `MarkdownEditor.CreateChangePlugin` detects the changed ProseMirror document and calls `serialize(view.state.doc)`. That passes the whole document to Milkdown's serializer. The installed serializer traverses the document to construct a Markdown syntax tree and then stringifies that tree. Its work is not limited to the paragraph containing the edit.

The resulting string then enters `VisionController.UpdateMarkdown` and `VisionStore.Update`. The store scans that string for reference directives and compares placement identities. The controller reschedules autosave and publishes only actual state transitions. Finally, `MarkdownEditor.UpdateToolbar` writes button state, even when formatting has not changed.

Sources: [MarkdownEditor.ts:275](src/renderer/ui/MarkdownEditor.ts), [VisionStore.ts:222](src/renderer/visions/VisionStore.ts), [VisionController.ts:217](src/renderer/visions/VisionController.ts), [installed Milkdown serializer](node_modules/@milkdown/transformer/lib/index.js).

Markdown mode has a different path. CodeMirror already owns text, so it does not perform rich-document serialization. It still converts its text representation to a string, scans references to rebuild decorations, and passes the Markdown to the store for another reference scan.

Source: [VisionMarkdownSourceEditor.ts:46 and :97](src/renderer/visions/VisionMarkdownSourceEditor.ts).

## Measurements

The profiler used the installed Electron 37.10.3 / Chromium 138 runtime, the real Milkdown/CodeMirror wrappers, and the real Vision store/controller. It mounted a full Write toolbar, enabled Vision references, and inserted characters at the document end. Each scenario had eight warmup edits and 40 measured edits per phase. Documents contained repeated paragraphs with bold text; the final scenario also contained 40 atomic word references.

The table shows median synchronous edit-dispatch time. Sizes are decimal KB of initial Markdown, not words or visible characters.

| Document | Write edit | Within that: serialization | Markdown-mode edit |
| --- | ---: | ---: | ---: |
| 8 paragraphs, 1.17 KB | 0.5 ms | 0.3 ms | 0.3 ms |
| 80 paragraphs, 11.83 KB | 2.0 ms | 1.8 ms | 0.3 ms |
| 400 paragraphs, 59.49 KB | 8.9 ms | 8.3 ms | 0.3 ms |
| 400 paragraphs + 40 references, 68.05 KB | 9.4 ms | 8.8 ms | 0.5 ms |

For the 59.49 KB Write document, the 95th-percentile dispatch time was 9.3 ms. For the document with references, it was 10.2 ms. Serialization accounts for most of the measured synchronous work in both cases. An 8–9 ms operation consumes about half a 60 Hz frame interval, or approximately an entire 120 Hz interval, before additional browser work is considered.

Store/controller work had a median below the timer's useful resolution for the reference-free examples and 0.1 ms for the reference-bearing example. These rounded values must not be read as literally zero cost. The reference scan itself had a 0.1 ms median with 40 references. It is repeated work, but it was not the dominant cost in these measurements.

Raw results: [Write measurements](.tmp/typing-exploration/results.json), [Markdown measurements](.tmp/typing-exploration/source-results.json). The temporary profiler is retained under [.tmp/typing-exploration](.tmp/typing-exploration/Run.cjs); it does not enter the application bundle or test suite.

## Other findings and ruled-out explanations

**The toolbar does unnecessary work, but it does not explain the measured scaling.** The profiler observed 17 toolbar attribute mutations per ordinary edit. A diagnostic phase bypassed toolbar updating while retaining document serialization and store updates. The 59.49 KB document's median dispatch time changed from 8.9 to 8.6 ms; the reference-bearing document remained at 9.4 ms. Phase order and warmup can affect these small differences, so they are not an exact estimate of toolbar cost. The direct toolbar timings were generally at or below 0.1 ms.

`UpdateToolbar` also runs for selection updates. Its unconditional `aria-pressed` writes and repeated disabled-state assignments can cause avoidable DOM/style work. It even iterates controls when the toolbar is hidden. Those are worthwhile secondary cleanup targets. Source: [MarkdownEditor.ts:589](src/renderer/ui/MarkdownEditor.ts).

**The undo and redo availability checks do not execute undo/redo operations.** The installed ProseMirror history implementation checks its event count and only constructs/applies an undo transaction when a dispatch function is provided. Chora's toolbar calls omit dispatch. These checks are inexpensive predicates, not accidental history replay. Source: [installed ProseMirror history, `buildCommand`](node_modules/prosemirror-history/dist/index.js).

**The previous global refresh defect is not the current steady-state path.** The current source only publishes dirty, save-state, metadata, or reference events when their values change. The generated renderer bundle contains the new `vision.dirty-changed` path, and its build time is later than the corrected controller source. The running Electron process was started after that renderer build. This supports the conclusion that the prior source correction was rebuilt; it does not independently prove which in-memory bundle every window is executing.

**Autosave is not a filesystem call per character.** Ordinary edits cancel and reschedule the 750 ms clock. Save-start, save-completion, metadata ordering, and IPC can contribute separate work after a pause, but they do not account for the synchronous per-character serialization measured here. The isolated profiler disposed its controllers before autosave and supplied no persistence gateway.

**A Vision Write editor has no editor-height ResizeObserver.** `VisionPanel` passes a null layout dimension to `MarkdownEditor`, so the wrapper does not install its height-persistence observer for this surface. That removes one plausible per-edit layout/storage path. Source: [VisionPanel.ts:95](src/renderer/visions/VisionPanel.ts).

## Follow-up after the reader confirmed both modes

Chora calls `app.disableHardwareAcceleration()` unconditionally at startup. This has been present since the initial application commit, with no explanatory comment at that call site. The first CPU-dispatch profiler did not apply this startup setting. Its synchronous JavaScript measurements remain useful, but its graphics configuration differed from Chora's. Sources: [main.ts:15](src/main/main.ts), [Electron's hardware-acceleration API](https://www.electronjs.org/docs/latest/api/app#appdisablehardwareacceleration).

A follow-up probe compared that setting with Electron's default hardware-acceleration policy in separate isolated processes. The feature reports confirmed `gpu_compositing` and `rasterization` as `disabled_software` with Chora's setting, and `enabled` under the default policy. This confirms a shared rendering configuration difference; it does not establish that the setting causes the reported delay.

The initial hidden-window input experiment did not yield a usable frame sample: a sample subsequently showed that trusted input arrived, but its first animation callback was delayed by roughly a second. That hidden-window scheduling behavior is unsuitable for estimating foreground typing latency, so those attempts were excluded from the comparison.

The completed comparison used offscreen rendering to obtain consistent animation scheduling without opening a visible diagnostic window. It inserted text through Chromium's debugging input API, observed trusted `beforeinput`/`input` events, and recorded the following animation callbacks. Each case used five warmup insertions and 30 samples. The primary display reported 59 Hz; the profiler used that requested offscreen frame rate.

| Scenario | Software rendering: input to first animation callback, median | Default GPU policy: same metric, median |
| --- | ---: | ---: |
| Write, 8 paragraphs | 16.6 ms | 16.4 ms |
| Write, 400 paragraphs | 16.3 ms | 16.0 ms |
| Markdown, 8 paragraphs | 16.0 ms | 15.8 ms |
| Markdown, 400 paragraphs | 16.1 ms | 16.1 ms |

There was no clear mode-independent delay attributable to the graphics setting in this probe. These callback timings mostly reflect frame cadence and the probe's scheduling. They are **not** measurements of screen presentation, keyboard-device latency, or the reader's full workspace; the second animation callback is not a paint-completion signal either. They do not justify claiming that enabling acceleration would fix the issue.

The actual editors also reported `spellcheck="true"` in Write mode and `spellcheck="false"` in Markdown mode. Native spellchecking alone therefore does not fit the shared symptom. The common store/controller and reference-scan path was inexpensive for the synthetic documents in the earlier measurements. Full-workspace layout, paint/compositing, foreground input scheduling, and costs specific to the reader's document remain unmeasured.

Raw follow-up results: [software-rendering probe](.tmp/typing-exploration/native-software-results.json), [default-GPU-policy probe](.tmp/typing-exploration/native-gpu-results.json).

**The next diagnostic step for the shared symptom is a performance trace in the visible Chora workspace while typing in both modes.** It should correlate input events with scripting, style recalculation, layout, paint, and compositor presentation, and include the exact displayed document and open panes. That trace should precede a claim about the common cause or an application-wide graphics-policy change. No application settings, code, or reader writing were changed by these probes.

## Separate Write-mode optimization

Make the rich editing state revision-aware and make Markdown serialization an explicitly materialized snapshot. An ordinary character insertion should update the immutable editor document, local revision, and necessary dirty/reference facts. It should not require serializing all the writing before the editor can finish handling that character.

The ownership should remain within the existing feature boundaries:

1. `MarkdownEditor` provides an immutable content snapshot associated with its document identity. A snapshot must remain usable independently of the live DOM; it must not turn into a mutable callback to whichever editor happens to be active later.
2. `VisionStore` owns the current content revision and caches its materialized Markdown by that revision. Metadata and tab reads must remain cheap and must not accidentally force document serialization. Every caller that actually needs writing must obtain a current snapshot through this owner.
3. `VisionController` captures and materializes the appropriate document revision for autosave or explicit Save. Copy, switching editing modes, tab close, editor disposal, and any catalogue replacement must also obtain/flush current writing at their existing boundaries. A save response must retain the existing protection for newer edits and inactive documents.
4. Exact-reference changes should come from the atomic rich-document nodes or changed subtrees. Markdown-mode edits still need directive-aware reconciliation. References must preserve placement, Vision, anchor, work, and version identity across insertion, removal, paste, undo, and redo.
5. `MarkdownEditor.UpdateToolbar` should compute the needed button state and assign only changed values, skipping hidden-toolbar presentation work. This is secondary to removing whole-document conversion from the ordinary input path.

This is a document-model change, not simply an extra debounce. Delaying the current `onChange(markdown)` callback would leave the store stale, allowing immediate Save, Copy, mode switching, or disposal to observe old writing. Deferring conversion is safe only after current revision ownership and every materialization boundary are explicit.

Likewise, do not optimize by independently serializing paragraphs and concatenating their strings without proving equivalent Markdown semantics. Lists, neighboring blocks, tables, escaping, and atomic reference directives must continue to use the established Milkdown/GFM behavior. The proposed snapshot approach can retain that serializer while moving its full-document cost out of the ordinary keystroke path.

## Limits and next validation

The profiler measured programmatic single-character edit dispatch in a hidden, isolated renderer. It did not measure physical keyboard delivery, composition/IME input, native spellchecking, displayed frames, font rasterization, full-workspace layout, or input-to-paint latency. Toolbar mutation delivery was counted synchronously; later browser style/paint cost is outside the attributed timings. The isolated process used separate storage and synthetic writing, not the reader's files.

For a very short Vision, these measurements do not establish that serialization alone explains a noticeable delay: the complete synchronous dispatch measured only 0.5 ms in that scenario. If short documents or Markdown mode also feel sluggish, a visible-renderer input/paint trace is still needed to examine the costs outside this benchmark.

After implementing the next change, repeat this same bounded profile and verify that typing cost no longer scales with full-document serialization. Existing editing and persistence scenarios should also verify immediate Save/Copy, mode switching, disposal, late save responses, and reference undo/redo against the latest revision. No application tests or full builds were rerun during this exploration because application code was unchanged.
