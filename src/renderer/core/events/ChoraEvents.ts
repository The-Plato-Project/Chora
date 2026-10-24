import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
import type { SignalRecord } from "../../../shared/signals/SignalTypes.js";

// Every application event name and its payload shape, published on the shared ChoraEventBus.
export interface ChoraEvents
{
	"lookup.changed": Record<string, never>;
	"library.text-opened": Record<string, never>;
	"library.text-open-requested": { textId: string };
	"library.focus-changed": { textId: string; segmentKey: string };
	"library.selection-changed": Record<string, never>;
	"library.jump-requested": { selection?: TextSelection; selections?: readonly TextSelection[]; target?: "source" | "signal" };
	"signal.add-requested": { selection: TextSelection };
	// Announces an authoritative change to one work-owned Signal.
	"signal.changed": { signal: SignalRecord };
	// Announces complete deletion of one work-owned Signal.
	"signal.deleted": { signalId: string; workId: string };
	"signal.active-changed": { signalId: string | null; selections: readonly TextSelection[] };
	"signal.selection-add-requested": { signalId: string; selection: TextSelection };
	// Requests focus on the Dreams Explorer without opening a Dream.
	"workspace.dreams-focus-requested": Record<string, never>;
	"workspace.document-selected": { kind: "dream" | "idea" | null };
	// Requests selection of a durable Idea for one existing Signal.
	"idea.add-signal-requested": { dreamId: string; signalId: string; ideaId?: string };
	// Requests that an existing Idea open in the shared workspace editor.
	"idea.open-requested": { ideaId: string };
	// Requests that one Signal be selected and revealed in the active Idea.
	"idea.signal-focus-requested": { ideaId: string | null; signalId: string };
	// Requests that an Idea-referenced Signal open in the established Dream editor.
	"idea.signal-view-requested": { signalId: string };
	// Requests a return from an Idea-referenced Signal preview to the active Idea.
	"idea.return-requested": Record<string, never>;
	// Announces a change to renderer-owned Idea state.
	"ideas.changed": Record<string, never>;
	// Announces draft text changes without forcing the editor to rebuild while typing.
	"idea.draft-changed": Record<string, never>;
	"dream.create-requested": { selection: TextSelection };
	"dream.signal-add-requested": { selection: TextSelection };
	"dream.source-extend-requested": { selection: TextSelection };
	"dream.signal-added": { dreamId: string; signalId: string };
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
