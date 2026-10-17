import type { TextSelection } from "../text/TextSelection.js";

// Represents one work-owned reader observation anchored to an exact text selection.
export interface SignalRecord
{
	readonly id: string;
	readonly workId: string;
	readonly sourceRef: string;
	readonly selection: TextSelection;
	readonly text: string;
	readonly description: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

// Carries reader-editable Signal data without authoritative timestamps.
export interface SaveSignalCommand
{
	readonly signalId: string | null;
	readonly workId: string;
	readonly selection: TextSelection;
	readonly description: string;
}
