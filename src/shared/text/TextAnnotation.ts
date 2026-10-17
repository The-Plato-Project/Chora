import type { TextSelection } from "./TextSelection.js";

// Serialized common state for a reader annotation at persistence and IPC boundaries.
export interface TextAnnotationSnapshot
{
	readonly id: string;
	readonly workId: string;
	readonly selection: TextSelection;
}

// The single base domain concept for reader-created objects anchored to one exact selection in their owning work.
export abstract class TextAnnotation
{
	public readonly id: string;
	public readonly workId: string;
	public readonly selection: TextSelection;

	protected constructor(snapshot: TextAnnotationSnapshot)
	{
		// An annotation never spans documents: its selection and owning work must remain identical.
		if (snapshot.selection.documentId !== snapshot.workId)
		{
			throw new Error("Text annotation selection belongs to another document");
		}

		this.id = snapshot.id;
		this.workId = snapshot.workId;
		this.selection = {
			documentId: snapshot.selection.documentId,
			start: { ...snapshot.selection.start },
			end: { ...snapshot.selection.end }
		};
	}
}
