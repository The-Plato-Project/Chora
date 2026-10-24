import type { TextSelection } from "../text/TextSelection.js";
import type { SignalRecord } from "./SignalTypes.js";

// Returns whether a selection contains text that can become a Signal.
export function IsValidSignalSelection(selection: TextSelection): boolean
{
	const startsAndEndsTogether = selection.start.segmentKey === selection.end.segmentKey
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

// Determines whether a Signal contains one exact component selection.
export function HasSignalSelection(signal: SignalRecord, selection: TextSelection): boolean
{
	const hasSelection = signal.selections.some(function Matches(candidate): boolean
	{
		return AreTextSelectionsEqual(candidate, selection);
	});

	return hasSelection;
}

// Determines whether two exact ranges identify the same source text.
export function AreTextSelectionsEqual(first: TextSelection, second: TextSelection): boolean
{
	const isEqual = first.documentId === second.documentId
		&& first.start.segmentKey === second.start.segmentKey
		&& first.start.offset === second.start.offset
		&& first.end.segmentKey === second.end.segmentKey
		&& first.end.offset === second.end.offset;

	return isEqual;
}
