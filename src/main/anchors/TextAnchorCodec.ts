import type { TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";
import { TextAnchor } from "./TextAnchor.js";

export class TextAnchorCodec
{
	public Encode(anchor: TextAnchorSnapshot): string
	{
		TextAnchor.AssertSnapshot(anchor);
		return `${JSON.stringify(anchor, null, "\t")}\n`;
	}

	public Decode(source: string): TextAnchorSnapshot
	{
		const value = JSON.parse(source) as Partial<TextAnchorSnapshot>;
		const anchor: TextAnchorSnapshot = {
			id: String(value.id ?? ""),
			workId: String(value.workId ?? ""),
			kind: value.kind as TextAnchorSnapshot["kind"],
			selection: DecodeTextSelection(value.selection),
			selectedText: String(value.selectedText ?? ""),
			createdAt: String(value.createdAt ?? "")
		};
		TextAnchor.AssertSnapshot(anchor);
		return anchor;
	}
}
