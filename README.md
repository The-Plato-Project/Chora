# Chora — User Guide

*Where texts dream.*

## What is Chora?

Chora is a desktop environment for sustained reading and inquiry. Its new direction is a writing-first workspace in which exact Greek words and passages remain connected to a reader's developing thought. Over time, reader-confirmed relationships become Signals: a durable memory of what the reader noticed across sections and distant parts of a dialogue.

The central relationship is between **you and the text**. Chora may return you to earlier writing and suggest material that could be relevant, but it does not establish those connections for you. Dictionary evidence, exact source anchors, and optional local-model retrieval support attention without deciding what Plato means.

Chora was built to work with **PlatoSI**, which supplies Plato's canonical Greek texts, dictionary and linguistic evidence, dialogue-wide occurrences, and personal-name research. Chora provides the reading workspace and saves your contributions. PlatoSI's separate browser playground is a development and testing tool; you do not use it to read in Chora.

This guide describes the currently implemented Chora workflows inspected on **7 November 2026**. The existing passage-bound Dreams and Dream-owned Signals are transitional and remain available while their replacement is built. [VISION.md](VISION.md) defines the new product direction, and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) describes the build-first, remove-later transition.

## What you can do

- Read the installed collection of 35 Platonic works, navigate books and Stephanus passages, and find text within the open work.
- Create **Dreams** around exact passages, give them titles, and write formatted Reflections.
- Mark **Signals** within a Dream and add further exact passages from the same work to a selected Signal.
- Keep several Dreams open, organize them in folders, filter your collection, and return explicitly to their source passages.
- Explore a Greek word's candidate lemmas and available LSJ entry, compare mapped forms across the whole dialogue, and inspect explicitly supported related lemmas.
- Save your own notes for a lemma and for its name research.
- Consult optional personal-name research with linked sources and a local-model summary.
- Copy a Dream as Markdown, recover deleted Dreams and their Signals from Trash, and reload records edited outside Chora.
- Adjust reading appearance and workspace dimensions to suit your attention.

Reading and writing Dreams do not require a language model. Word exploration depends on configured linguistic resources in PlatoSI. Personal-name synthesis additionally needs a configured local model and internet access for reference results that are not cached.

## A first reading

1. Start Chora using the [setup instructions](#getting-started).
2. Read the Republic or add another available work through the Explorer's **Add work** button.
3. Select a passage that interests you, right-click, and choose **Create Dream**.
4. Give the Dream a title if useful and write in **Reflections**.
5. Select a word or phrase inside that Dream's source and choose **Create Signal**. Add your own description of what you notice.
6. To investigate one Greek word, select it in the reader or Dream source and choose **Explore word**.
7. Compare the returned evidence, follow an occurrence when you choose, and add a note about the lemma.

You can stop at any stage. A Dream does not need Signals, and a Signal does not need a description. They record your attention rather than require a completed interpretation.

## Reading Plato

### Choose a work

Chora loads its Library from PlatoSI. On startup it prefers your last-opened work, then the Republic if no previous choice is available. Use **Add work** in Explorer to choose another available text; its picker can be filtered by English or Greek title. Added works appear in the Explorer for switching between them.

The current canonical collection is:

| | | |
| --- | --- | --- |
| Euthyphro | Apology | Crito |
| Phaedo | Cratylus | Theaetetus |
| Sophist | Statesman | Parmenides |
| Philebus | Symposium | Phaedrus |
| Alcibiades I | Alcibiades II | Hipparchus |
| Lovers | Theages | Charmides |
| Laches | Lysis | Euthydemus |
| Protagoras | Gorgias | Meno |
| Greater Hippias | Lesser Hippias | Ion |
| Menexenus | Cleitophon | Republic |
| Timaeus | Critias | Minos |
| Laws | Epinomis | |

This is the supported collection, not a judgement about disputed authorship. Chora currently does not open or import arbitrary external text files.

### Navigate and find passages

The reading toolbar provides book navigation where the work has books, a Stephanus passage selector, and previous/next passage buttons. The text retains its section labels and source attribution.

Use **Find in text** to highlight a word or phrase in the open work and move between matches. Enter advances through matches; Shift+Enter goes backwards. This is a case-insensitive text search within the open work. It does not automatically search other dialogues, include inflections, remove accent distinctions, or identify related lemmas.

Selecting a Dream or Signal opens its editing context without automatically moving the reader. Use its explicit jump controls when you want to return to its passage. Word-occurrence buttons likewise navigate only when you select them.

### Reading appearance

Open **Reading settings** to choose serif or sans text, adjust text size, and switch between light and dark appearance. Preferences are retained locally when application storage is available.

## Current Dreams workflow (transitional)

A Dream currently brings together an exact source passage, an optional title, your Reflections, and any Signals you choose to create. This passage-bound container remains implemented and its data must remain recoverable, but it is not the target product model. The planned writing-first workspace will allow sustained writing across many passages without first creating a Dream from a selection.

### Create and edit a Dream

Select text in the reader and choose **Create Dream** from the context menu, or use Ctrl/Cmd+D while focused outside a writing field. The Explorer also provides a New Dream control using your current selection or reading context. Selecting a folder before creation places the new Dream in that folder.

The source passage is read-only. Write in **Reflections** and rename the Dream when a useful title emerges. Formatting tools support bold, italic, bulleted and numbered lists, quotations, links, and undo/redo. Formatting is saved as Markdown. Links can be edited without navigating away from the editor; images in Markdown are shown as descriptive text rather than fetched remotely.

Dream changes autosave after a short pause. Chora also requests saves when the window loses focus and before closing a dirty editor tab. Use **Save** or Ctrl/Cmd+Enter for an immediate save, and resolve any reported save failure before assuming the latest text is on disk.

### Extend the source

To widen a Dream's source, select text immediately before or after it in the main reader and choose **Add to Dream Source**. This extends the continuous source passage. It does not collect separated passages into one source or silently include an unrelated stretch of text.

For separated passages you want to compare, add them to a Signal instead.

### Work with several Dreams

Opening Dreams adds editor tabs. Switch between them to continue different lines of inquiry without making the reader follow every tab change. A dirty tab is saved before it is closed; a save failure keeps the unresolved work available rather than completing the close as though it succeeded.

Use the Dream actions menu to copy its source passage, citations, Signals and their descriptions, and Reflections as Markdown. This is a clipboard export, not a complete application backup.

## Current Signals workflow (transitional)

A Signal belongs to one Dream. Create it by selecting text inside the active Dream's source, either in the main reader or in the copied source passage, then choosing **Create Signal**.

This is the current storage and interface behavior, not the new definition of a Signal. In the new vision, a Signal is a reader-authored relationship among evidence that can grow across sections and distant passages. A word or selection is not automatically a Signal, and no model establishes that relationship for the reader.

Signals appear in source order. Select one to write or revise its description, give it a title, inspect its passages, or use an explicit jump control. The Signal index can be filtered. The description editor uses the same formatting tools as Reflections, and descriptions save as you edit.

A Signal can contain more than one exact passage. With the Signal selected, choose another passage in the same work and use **Add to Selected Signal**. The new component can be outside the Dream's original source. The intervening text is not added automatically, and the display distinguishes passages inside the source from external ones.

You can remove a component while retaining the Signal, provided at least one passage remains. A Signal's title can be changed independently of its passage text. Deleting an individual Signal removes it permanently from its owning Dream; it does not have its own Trash entry. Deleting a whole Dream uses the separate recoverable Dream Trash workflow.

Chora does not automatically create Signals, write their descriptions, or link them between Dreams. The reader chooses what matters and what connection to describe.

## Greek word exploration

### Open the word pane

Select a single Greek word in the reader or a Dream source and choose **Explore word**. The Word lookup pane opens across the bottom of the workspace with the selected form in its title. It starts hidden, can be closed, and reopens when you explore another word.

The pane's columns scroll horizontally. Depending on the returned evidence, they include **Lemmas**, **Dictionary**, **Name research**, **Occurrences**, **Related lemmas**, and **Notes**. A dictionary column is omitted when no matching entry is available.

### Candidate lemmas and dictionary entries

A lemma is the dictionary form associated with the selected word. One form may have several candidates; choose among the returned lemmas to inspect their evidence. An initial candidate is displayed to begin exploration, not as a verdict about the passage.

The dictionary column presents the available local LSJ entry, including its senses and references. A dictionary's sense order does not determine the appropriate reading here. Missing entries or mappings can reflect resource coverage rather than the absence of a meaningful analysis.

### Occurrences across the dialogue

For the selected lemma, PlatoSI supplies directly mapped forms that actually occur in the current canonical dialogue. In the Republic, this covers the whole dialogue, not just the current numbered book.

The occurrence list shows form, division and citation. Expand a row for its passage with the matching form highlighted. Select its citation or word button to navigate to that occurrence in the reader.

These counts reflect the available form mappings. They are not an exhaustive or contextually verified account of every use, and they do not prove that the same interpretation applies to all matches.

### Related lexical evidence

When the configured sources support a related lemma, Chora shows its relation type, source provider, presence in the current dialogue, and returned forms and passage contexts. Related lemmas remain separate from inflected forms of the original lemma.

Current relationships come from a limited subset of explicit dictionary evidence. Similar spelling, a shared possible root, and a connection you notice in context are different kinds of evidence. Chora does not automatically merge them into one linguistic conclusion.

### Your lemma notes

Write in **Notes** to keep your own note for the selected lemma. The text saves after a short pause and is associated with the dialogue, its canonical text version, and that lemma.

Opening a different form of the same lemma in the same dialogue and version returns to the same note. A different dialogue or text version has a separate note. This is distinct from a Dream's Reflections and from an individual Signal's description; it is not yet a combined cross-dialogue notebook.

## Personal-name research and optional AI

When a selected lemma has a capitalized-headword candidate, Chora requests personal-name research through PlatoSI while the rest of the word pane remains usable. There is no separate general chat pane or model-selection screen in the current Chora interface.

The **Name research** column presents a source-cited summary. Its source links appear directly below the summary and open the original pages externally. Retrieval or synthesis issues appear below the research in red.

Write in the column's **Notes** box to keep your own note about that name in the current dialogue. The note saves after a short pause and remains separate from the generated summary.

This remains experimental research. A capitalized lemma is a trigger, not proof that the word identifies a particular person. Namesakes, unclear identity, source quality, and unsupported derivations can affect the result. A possible lexical comparison is not an established etymology, and source citations do not guarantee that the model's statement follows from them.

PlatoSI owns model configuration and research caches. A local model service is optional for reading, dictionary evidence, Dreams and Signals; it is needed for the generated personal-name synthesis. Reference lookups need internet access on a cache miss. Chora does not automatically send your complete Dream library to a model or train a model on your writing.

## Organizing and revisiting your work

Explorer groups Dreams under their work. Create nested folders, drag Dreams into folders or back to the root, and use Shift-click to select a contiguous range of visible Dreams for a group move. Folders must be empty before they can be deleted. A Dream's source range appears beside its title.

Use **Filter Dreams** to narrow the collection. Small Dream markers beside Stephanus labels identify passages overlapped by saved Dream sources; their tooltips list the associated titles. Select a marker to filter Dreams for that passage. This does not open an editor or move the reader. You can narrow the passage filter with a text query or clear it explicitly. Signal passages alone do not create these source associations.

The Explorer can be collapsed and restored using its divider or activity-rail control. Drag workspace dividers to adjust column widths, the Signal list width, source-passage height, and Word lookup height. Relevant handles also support keyboard resizing. Layout dimensions are retained locally; the word pane remains hidden at startup until requested.

## Notes, files, and persistence

| Your material | Where and how it is retained |
| --- | --- |
| Dreams and Reflections | Local Markdown files, organized by work and your folders |
| Signals and descriptions | Separate local Markdown files, owned by their Dream |
| Lemma and name-research Notes | Chora's local application-data storage, separately from Dream files |
| Reading appearance and workspace dimensions | Local application preferences |
| Open drafts and tab state | Session state; saved Dream files remain the durable records |
| Deleted Dreams and Signals | Local Dream Trash until restored or permanently removed |
| Personal-name reference/model results | Cached by PlatoSI, separately from your reader-authored notes |

The normal Dream and Signal folders are:

```text
Documents/Chora/<work name>/Dreams/
Documents/Chora/<work name>/Signals/
```

For the Republic, the work folder is **The Republic**. Dream folders you create are real folders beneath Dreams. Lemma notes, name-research notes and Trash are in Chora's application data, so backing up only Documents does not preserve everything. Chora provides no built-in account synchronization or complete backup/export command; retain an independent backup of the stores you need.

### Reloading the Dream catalogue

After editing or synchronizing Markdown files outside Chora, use **Reload from disk** at the bottom of Explorer. Ordinary refreshes do not automatically rescan external changes.

Finish saving Dreams and Signal descriptions first. Reload is refused when unsaved or active operations could conflict. The new catalogue is applied only after loading and validation succeed; a failed scan keeps the last committed catalogue. Resolve malformed or conflicting records before retrying. External file synchronization is not a substitute for a coordinated multi-device editing workflow.

### Dream Trash

Delete a Dream through its actions menu and confirm the choice. Its Signals and retained legacy conversation data move with it into local Trash. Open **Trash** in Explorer to restore it, delete it permanently, or empty Trash. Records do not expire automatically; permanent removal requires confirmation and cannot be undone.

Restoration preserves the Dream and Signal identities and can recreate the original folder. Interrupted deletion/restoration work is recovered at startup. Trash is a recovery mechanism, not protection against disk loss. Old conversation files are preserved for recovery; their presence does not mean a chat interface is available.

On installations with older storage layouts, startup migration retains original copies in **StorageMigrationBackup** under application data and rejects conflicting destinations. Keep an independent backup and resolve reported conflicts before retrying a migration.

## Getting started

### Requirements

The current source checkout needs **Node.js 24 or later and npm**, plus a local PlatoSI installation, its Python runtime, and its complete canonical corpus. Chora starts the PlatoSI service itself; the PlatoSI browser playground does not need to be running.

See [PlatoSI setup](../PlatoSI/DEVELOPER.md#setup-and-configuration) for canonical text, optional morphology, local LSJ, and local model configuration. The canonical text setup is required for Chora's Library; the optional resources determine what word and name research can return.

### Configure the local service

From the Chora project folder:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` with your actual paths, using plain values without surrounding quotes:

```text
PLATOSI_PYTHON=C:\path\to\python.exe
PLATOSI_READER_API=C:\path\to\PlatoSI\scripts\reader_api.py
```

Model settings belong in PlatoSI, not in Chora's environment file. Keep `.env.local` private and out of version control.

### Launch Chora

```powershell
npm install
npm start
```

The start command builds and opens the desktop application. Once it opens, begin with the [first-reading workflow](#a-first-reading). You do not need a web-browser URL or a separate playground window.

If startup cannot connect to PlatoSI, check the two paths and that the canonical corpus has been built. If a word has no useful results, check the enabled linguistic and dictionary resources in PlatoSI before treating it as a linguistic conclusion.

## Errors and recovery

Chora reports operation failures with a diagnostic reference and recovery guidance. If saving fails, keep the editor open, resolve the reported problem, and retry Save. Reloading from disk is not a way to force unsaved changes over an external file.

Use **Help → Open Logs Folder** to locate diagnostic logs when investigating a failure. Logging is designed to redact credentials and avoid storing reading documents or request arguments, but logs are still local diagnostic files to review before sharing.

## Current limitations and future direction

Chora currently reads the Plato collection supplied by PlatoSI; arbitrary document import is not implemented. Word mappings and lexical relations depend on configured evidence and can be incomplete or wrong in context. Personal-name research is not general recognition of places, gods, or every kind of named entity, and generated summaries can be mistaken.

There is no current writing-first dialogue workspace, anchored-reference editor, reader-confirmed relationship graph, memory surface, cross-Dream linking workflow, cross-dialogue lemma notebook, or model retrieval over reader history. There is also no general Dream chat or automatic Signal writing. PlatoSI's standalone conversation and two-model examination are test/service tools rather than Chora screens.

The new vision is to make the application an extension of the reader's memory: continuous writing remains attached to exact evidence, Signals preserve relationships the reader confirms, and earlier thoughts can return as transparent possibilities rather than conclusions. The current features above provide part of that foundation but still fragment writing around passage-bound Dreams and Dream-owned Signals. See [VISION.md](VISION.md) and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Development

This README is the user guide. Contributors should read [AGENTS.md](AGENTS.md) and [CODING_STANDARDS.md](CODING_STANDARDS.md) for architecture, conventions and validation discipline. The [Getting started](#getting-started) section describes the local PlatoSI path configuration referenced by those guides.

This revision was checked against relevant Chora UI, workflow and persistence source. It was a documentation-only review: the application was not launched, and no application tests or builds were run for this change.
