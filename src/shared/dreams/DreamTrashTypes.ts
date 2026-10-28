// Renderer-safe description of one recoverable Dream and its owned Signals.
export interface DreamTrashSnapshot
{
	// Stable trash identity supplied back for restore or permanent removal.
	readonly id: string;
	// Stable identity of the deleted Dream.
	readonly dreamId: string;
	// Work containing the original Dream.
	readonly workId: string;
	// Reader-authored title, possibly empty.
	readonly title: string;
	// Time the reader moved the Dream to trash.
	readonly deletedAt: string;
	// Number of child Signals retained with the Dream.
	readonly signalCount: number;
	// Indicates an interrupted restore that must finish before permanent removal.
	readonly restoring: boolean;
}
