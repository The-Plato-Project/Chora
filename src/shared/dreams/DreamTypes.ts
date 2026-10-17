import type { TextSelection } from "../text/TextSelection.js";

// Serialized Dream state at IPC, session, and persistence boundaries.
export interface DreamSnapshot
{
	readonly id: string;
	readonly workId: string;
	readonly dialogue: string | null;
	readonly title: string;
	readonly source: TextSelection;
	readonly signalIds: readonly string[];
	readonly reflection: string;
	readonly synopticView: string;
	readonly linkedDreamIds: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface DreamSynopticViewRequest
{
	dreamId: string;
	readingDocument: string;
}
