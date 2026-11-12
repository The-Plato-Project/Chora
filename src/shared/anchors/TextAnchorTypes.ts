import type { TextSelection } from "../text/TextSelection.js";

export type TextAnchorKind = "word" | "phrase" | "passage" | "range";

export interface TextAnchorSnapshot
{
	readonly id: string;
	readonly workId: string;
	readonly kind: TextAnchorKind;
	readonly selection: TextSelection;
	readonly selectedText: string;
	readonly createdAt: string;
}

export interface CreateTextAnchorCommand
{
	readonly kind: TextAnchorKind;
	readonly selection: TextSelection;
}
