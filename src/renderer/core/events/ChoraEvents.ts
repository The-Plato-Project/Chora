import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { TextAnchorKind } from "../../../shared/anchors/TextAnchorTypes.js";
import type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
import type { VisionReferencePlacement } from "../../../shared/visions/VisionReferenceTypes.js";
import type { VisionSaveState } from "../../visions/VisionStore.js";
import type { ApplicationMenuCommand } from "../../../shared/contracts/ChoraApi.js";

export type ReaderHighlightKind = "source" | "word";

// Every application event name and its payload shape, published on the shared ChoraEventBus.
export interface ChoraEvents
{
	// Startup barrier preserves saved host geometry while features restore availability.
	"application.restoring": Record<string, never>;
	"application.restored": Record<string, never>;
	// Native activation translated by the shell's DOM owner.
	"workspace.focused": Record<string, never>;
	// Native deactivation with modal permission to save pending edits.
	"workspace.blurred": { canSave: boolean };
	// Explicit keyboard request for persistence of the active editor.
	"workspace.save-requested": Record<string, never>;
	"workspace.settings-open-requested": Record<string, never>;
	// A menu or application shortcut requests an explicit application command.
	"workspace.menu-command-requested": { command: ApplicationMenuCommand };
	// Requests that the sidebar be made visible without changing its selected extension.
	"workspace.sidebar-open-requested": Record<string, never>;
	"workspace.sidebar-select-requested": { id: string };
	"word.exploration-requested": { selection: TextSelection };
	// A reader-selected headword opens independently of the current passage.
	"word.lemma-open-requested": { lemma: string };
	"word.lexical-search-changed": Record<string, never>;
	"word.exploration-changed": Record<string, never>;
	"word.occurrence-selected": Record<string, never>;
	// Content availability only; the workspace independently owns hosting and geometry.
	"word.exploration-visibility-changed": { visible: boolean };
	// Identifies changed exact-occurrence lists; null also announces work availability changes.
	"word.vision-references-changed": { workId: string; selectionKeys: readonly string[] | null };
	// Announces the exact canonical ranges belonging to the active Word Lookup lemma.
	"word.highlights-changed": { selections: readonly TextSelection[] };
	"lookup.changed": Record<string, never>;
	"library.text-opened": Record<string, never>;
	"library.text-open-requested": { textId: string };
	"library.focus-changed": { textId: string; segmentKey: string };
	// Session restoration scrolls quietly and does not create a passage highlight or history entry.
	"library.position-restored": { segmentKey: string };
	"library.selection-changed": Record<string, never>;
	"library.jump-requested": { selection?: TextSelection; selections?: readonly TextSelection[]; target?: ReaderHighlightKind };
	"vision.opened": Record<string, never>;
	"vision.view-changed": Record<string, never>;
	"vision.rename-requested": Record<string, never>;
	"vision.closed": Record<string, never>;
	// Announces an actual transition of one document's unsaved indicator.
	"vision.dirty-changed": { visionId: string; workId: string; isDirty: boolean };
	// Identifies title and ordering changes without invalidating document content.
	"vision.metadata-changed": { visionId: string; workId: string; titleChanged: boolean; updatedAtChanged: boolean };
	// Announces a change in exact placement membership, including undo and deletion.
	"vision.references-changed": { visionId: string; workId: string; revision: number; anchorIds: readonly string[] };
	// Local prose context can change while exact placement membership stays the same.
	"vision.reference-context-changed": { visionId: string; workId: string; anchorIds: readonly string[] };
	// Catalogue notifications are reserved for membership changes and explicit replacement.
	"vision.catalogue-changed":
		| { kind: "reset" }
		| { kind: "created" | "deleted" | "moved"; visionId: string; workId: string }
		| { kind: "folder-created" | "folder-deleted"; workId: string; folderPath: string };
	// Carries the captured document identity rather than relying on the active tab.
	"vision.save-state-changed": { visionId: string; state: VisionSaveState };
	"vision.selection-reference-requested": { selection: TextSelection; anchorKind: TextAnchorKind; requestId?: string };
	"vision.reference-created": { placement: VisionReferencePlacement; requestId?: string };
	"vision.reference-action-requested": {
		anchorId: string;
		action: "navigate" | "explore-word";
		relativeSelection?: { readonly start: number; readonly end: number };
	};
	"vision.reference-open-requested": { visionId: string; placementId: string };
	"vision.reference-focus-requested": { visionId: string; placementId: string };
	"error.reported": ErrorRecord;
}

export type { ErrorRecord } from "../../../shared/diagnostics/DiagnosticManager.js";
