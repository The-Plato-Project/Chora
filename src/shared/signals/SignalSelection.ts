import type { TextSelection } from "../text/TextSelection.js";

// Returns whether a selection contains text that can become a Signal.
export function IsValidSignalSelection(selection: TextSelection): boolean
{
	const startsAndEndsTogether = selection.start.segmentKey === selection.end.segmentKey
		&& selection.start.offset === selection.end.offset;
	const isValid = !startsAndEndsTogether;

	return isValid;
}
