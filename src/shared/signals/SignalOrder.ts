import type { SignalRecord } from "./SignalTypes.js";
import type { TextDocument } from "../text/TextDocument.js";
import { GetSignalAnchor } from "./SignalSelection.js";

// Returns Signal snapshots ordered by their exact starting positions in one text.
export function OrderSignalsByText(document: TextDocument | null, signals: readonly SignalRecord[]): SignalRecord[]
{
	const ordered = Array.from(signals, function CloneSignal(signal): SignalRecord
	{
		return structuredClone(signal);
	});

	if (document !== null)
	{
		ordered.sort(function CompareSignals(first, second): number
		{
			let comparison = 0;
			const firstSelection = GetSignalAnchor(first);
			const secondSelection = GetSignalAnchor(second);
			const belongsToDocument = firstSelection.documentId === document.id
				&& secondSelection.documentId === document.id;

			if (belongsToDocument)
			{
				comparison = document.CompareSelections(firstSelection, secondSelection);
			}

			return comparison;
		});
	}

	return ordered;
}
