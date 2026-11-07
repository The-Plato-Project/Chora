import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";

export type ReaderHighlightKind = "source" | "signal" | "word";

// Every application event name and its payload shape, published on the shared ChoraEventBus.
export interface ChoraEvents
{
	// Native activation translated by the shell's DOM owner.
	"workspace.focused": Record<string, never>;
	// Native deactivation with modal permission to save pending edits.
	"workspace.blurred": { canSave: boolean };
	// Explicit keyboard request for persistence of the active editor.
	"workspace.save-requested": Record<string, never>;
	// Explicit keyboard request to create a Dream from the current reader selection.
	"workspace.create-dream-requested": Record<string, never>;
	// Requests that the sidebar be made visible without changing its selected extension.
	"workspace.sidebar-open-requested": Record<string, never>;
	"workspace.sidebar-select-requested": { id: string };
	"word.exploration-requested": { selection: TextSelection };
	"word.exploration-changed": Record<string, never>;
	// Announces the exact canonical ranges belonging to the active Word Lookup lemma.
	"word.highlights-changed": { selections: readonly TextSelection[] };
	"lookup.changed": Record<string, never>;
	"library.text-opened": Record<string, never>;
	"library.text-open-requested": { textId: string };
	"library.focus-changed": { textId: string; segmentKey: string };
	"library.selection-changed": Record<string, never>;
	"library.jump-requested": { selection?: TextSelection; selections?: readonly TextSelection[]; target?: ReaderHighlightKind };
	"signal.selection-add-requested": { signalId: string; selection: TextSelection };
	// Requests focus on the Dreams Explorer without opening a Dream.
	"workspace.dreams-focus-requested": Record<string, never>;
	// Requests the existing Explorer-owned rename workflow for one Dream.
	"dream.rename-requested": { dreamId: string };
	"dream.create-requested": { selection: TextSelection };
	"dream.signal-add-requested": { selection: TextSelection };
	"dream.source-extend-requested": { selection: TextSelection };
	"dream.opened": Record<string, never>;
	// Requests that a specific signal be revealed within the active Dream.
	"dream.signal-focus-requested": { dreamId: string; signalId: string };
	"dream.catalogue-changed": { count: number };
	// Requests Dreams anchored to a displayed passage without navigating the text.
	"dream.passage-filter-requested": { workId: string; segmentKey: string };
	// Announces a change to the catalogue's source restriction.
	"dream.passage-filter-changed": Record<string, never>;
	"dream.closed": Record<string, never>;
	"dream.changed": Record<string, never>;
	"dream.structure-changed": { dreamId: string };
	"dream.saved": Record<string, never>;
	"dream.save-state-changed": Record<string, never>;
	"error.reported": ErrorRecord;
}

export type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
