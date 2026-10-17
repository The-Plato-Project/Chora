import { TextDocument } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";

interface PassageIndex
{
	readonly positions: ReadonlyMap<string, number>;
	readonly passageKeys: readonly string[];
}

// Resolves document segments to the first segment key for each displayed locator.
function BuildPassageIndex(document: TextDocument): PassageIndex
{
	const positions = new Map<string, number>();
	const passageKeys: string[] = [];
	let previousLocator = "";
	let passageKey = "";

	for (const [index, segment] of document.segments.entries())
	{
		positions.set(segment.key, index);
		const locator = segment.citation;
		const identity = locator === null ? "" : `${locator.system}:${locator.value}`;
		if (identity !== previousLocator)
		{
			passageKey = identity.length === 0 ? "" : segment.key;
			previousLocator = identity;
		}
		passageKeys.push(passageKey);
	}

	return { positions, passageKeys };
}

// Returns each displayed passage with nonempty overlap from one persisted selection.
export function GetCoveredPassageKeys(document: TextDocument, selection: TextSelection): ReadonlySet<string>
{
	document = TextDocument.FromSnapshot(document);
	const { positions, passageKeys } = BuildPassageIndex(document);
	const covered = new Set<string>();
	const startIndex = positions.get(selection.start.segmentKey);
	const endIndex = positions.get(selection.end.segmentKey);

	if (startIndex !== undefined && endIndex !== undefined && startIndex <= endIndex)
	{
		for (let index = startIndex; index <= endIndex; index += 1)
		{
			const segment = document.segments[index];
			const key = passageKeys[index];
			if (segment !== undefined && key !== undefined && key.length > 0)
			{
				const from = index === startIndex ? selection.start.offset : 0;
				const to = index === endIndex ? selection.end.offset : segment.text.length;
				if (from < to && from >= 0 && to <= segment.text.length) covered.add(key);
			}
		}
	}

	return covered;
}
