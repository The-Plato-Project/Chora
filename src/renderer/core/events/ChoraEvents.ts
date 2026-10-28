import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";

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
	"lookup.changed": Record<string, never>;
	"library.text-opened": Record<string, never>;
	"library.text-open-requested": { textId: string };
	"library.focus-changed": { textId: string; segmentKey: string };
	"library.selection-changed": Record<string, never>;
	"library.jump-requested": { selection?: TextSelection; selections?: readonly TextSelection[]; target?: "source" | "signal" };
	"signal.selection-add-requested": { signalId: string; selection: TextSelection };
	// Requests focus on the Dreams Explorer without opening a Dream.
	"workspace.dreams-focus-requested": Record<string, never>;
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
	"dream.synoptic-view-state-changed": { dreamId: string };
	"error.reported": ErrorRecord;
}

export type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
