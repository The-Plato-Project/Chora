import type { TextSelection } from "../text/TextSelection.js";
import type { SignalRecord } from "./SignalTypes.js";

// Returns whether a selection contains text that can become a Signal.
export function IsValidSignalSelection(selection: TextSelection): boolean
{
	const startsAndEndsTogether = selection.start.stephanus === selection.end.stephanus
		&& selection.start.offset === selection.end.offset;
	const isValid = !startsAndEndsTogether;

	return isValid;
}

// Returns the first canonical component used for navigation, citation, and source ordering.
export function GetSignalAnchor(signal: SignalRecord): TextSelection
{
	const selection = signal.selections[0];

	if (selection === undefined)
	{
		throw new Error(`Signal has no selections: ${signal.id}`);
	}

	return selection;
}

// Determines whether two exact ranges identify the same source text.
export function AreTextSelectionsEqual(first: TextSelection, second: TextSelection): boolean
{
	const isEqual = first.dialogue === second.dialogue
		&& first.text_version === second.text_version
		&& first.start.stephanus === second.start.stephanus
		&& first.start.offset === second.start.offset
		&& first.end.stephanus === second.end.stephanus
		&& first.end.offset === second.end.offset;

	return isEqual;
}
