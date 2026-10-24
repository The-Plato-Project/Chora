// Identifies one exact character boundary inside a stored text segment.
export interface TextPosition
{
	readonly segmentKey: string;
	readonly offset: number;
}

// Identifies one exact range in a TextDocument without duplicating derived text or citations.
export interface TextSelection
{
	readonly documentId: string;
	readonly start: TextPosition;
	readonly end: TextPosition;
}

// Identifies the reader action selected from a text-selection context menu.
export type SelectionAction = "copy" | "lookup" | "create-dream" | "add-to-dream" | "add-signal" | "add-to-selected-signal" | "copy-dream-source" | "add-dream-source-signal" | null;

// Decodes a persisted selection into the canonical exact-range shape.
export function DecodeTextSelection(value: unknown): TextSelection
{
	if (!IsSelectionRecord(value))
	{
		throw new Error("Text selection is invalid");
	}

	const selection: TextSelection = {
		documentId: value.documentId,
		start: DecodePosition(value.start, "start"),
		end: DecodePosition(value.end, "end")
	};

	return selection;
}

// Determines whether a persistence value contains the required selection members.
function IsSelectionRecord(value: unknown): value is Record<string, unknown> & { documentId: string }
{
	const record = value as Record<string, unknown> | null;
	const isRecord = record !== null
		&& typeof record === "object"
		&& typeof record.documentId === "string";

	return isRecord;
}

// Decodes one persisted selection boundary.
function DecodePosition(value: unknown, label: string): TextPosition
{
	const record = value as Record<string, unknown> | null;
	const isValid = record !== null
		&& typeof record === "object"
		&& typeof record.segmentKey === "string"
		&& typeof record.offset === "number";

	if (!isValid)
	{
		throw new Error(`Text selection ${label} position is invalid`);
	}

	const position: TextPosition = {
		segmentKey: record.segmentKey as string,
		offset: record.offset as number
	};

	return position;
}
