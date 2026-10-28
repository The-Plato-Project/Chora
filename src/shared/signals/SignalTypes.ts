import type { TextSelection } from "../text/TextSelection.js";

// Represents one Dream-owned reader observation anchored to ordered exact text selections.
export interface SignalRecord
{
	readonly id: string;
	readonly dreamId: string;
	readonly workId: string;
	readonly sourceRef: string;
	readonly title?: string;
	readonly selections: readonly TextSelection[];
	readonly text: string;
	readonly description: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

// Creates one Signal inside exactly one owning Dream.
export interface CreateSignalCommand
{
	readonly dreamId: string;
	readonly selection: TextSelection;
}

// Carries reader-editable Signal data without authoritative ownership or timestamps.
export interface UpdateSignalCommand
{
	readonly dreamId: string;
	readonly signalId: string;
	readonly title?: string;
	readonly selections: readonly TextSelection[];
	readonly description: string;
}

// Identifies one Dream-owned Signal for complete deletion.
export interface DeleteSignalCommand
{
	readonly signalId: string;
	readonly dreamId: string;
}
