// Identifies one exact UTF-16 boundary inside a PlatoSI Stephanus section.
export interface TextPosition
{
	readonly stephanus: string;
	readonly offset: number;
}

// Identifies one exact range in a versioned PlatoSI dialogue.
export interface TextSelection
{
	readonly dialogue: string;
	readonly text_version: string;
	readonly start: TextPosition;
	readonly end: TextPosition;
}

// Identifies the reader action selected from a text-selection context menu.
export type SelectionAction = "copy" | "explore-word" | "create-dream" | "add-to-dream" | "add-signal" | "add-to-selected-signal" | "copy-dream-source" | "add-dream-source-signal" | null;

// Decodes a persisted selection into the canonical exact-range shape.
export function DecodeTextSelection(value: unknown): TextSelection
{
	if (!IsSelectionRecord(value))
	{
		throw new Error("Text selection is invalid");
	}

	const selection: TextSelection = {
		dialogue: value.dialogue,
		text_version: value.text_version,
		start: DecodePosition(value.start, "start"),
		end: DecodePosition(value.end, "end")
	};

	return selection;
}

// Determines whether a persistence value contains the required selection members.
function IsSelectionRecord(value: unknown): value is Record<string, unknown> & { dialogue: string; text_version: string }
{
	const record = value as Record<string, unknown> | null;
	const isRecord = record !== null
		&& typeof record === "object"
		&& Object.keys(record).sort().join(",") === "dialogue,end,start,text_version"
		&& typeof record.dialogue === "string"
		&& typeof record.text_version === "string"
		&& /^sha256:[0-9a-f]{64}$/u.test(record.text_version);

	return isRecord;
}

// Decodes one persisted selection boundary.
function DecodePosition(value: unknown, label: string): TextPosition
{
	const record = value as Record<string, unknown> | null;
	const isValid = record !== null
		&& typeof record === "object"
		&& Object.keys(record).sort().join(",") === "offset,stephanus"
		&& typeof record.stephanus === "string"
		&& Number.isSafeInteger(record.offset)
		&& typeof record.offset === "number"
		&& record.offset >= 0;

	if (!isValid)
	{
		throw new Error(`Text selection ${label} position is invalid`);
	}

	const position: TextPosition = {
		stephanus: record.stephanus as string,
		offset: record.offset as number
	};

	return position;
}
