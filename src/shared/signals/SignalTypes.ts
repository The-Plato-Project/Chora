import type { TextSelection } from "../text/TextSelection.js";

// Represents one work-owned reader observation anchored to ordered exact text selections.
export interface SignalRecord
{
	readonly id: string;
	readonly workId: string;
	readonly sourceRef: string;
	readonly title?: string;
	readonly selections: readonly TextSelection[];
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
	readonly title?: string;
	readonly selections: readonly TextSelection[];
	readonly description: string;
}

// Identifies one work-owned Signal for complete deletion.
export interface DeleteSignalCommand
{
	readonly signalId: string;
	readonly workId: string;
}
