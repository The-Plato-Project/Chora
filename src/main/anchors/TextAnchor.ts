import { createHash } from "node:crypto";
import type { TextAnchorKind, TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";
import { DecodeTextSelection, type TextSelection } from "../../shared/text/TextSelection.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";

const AnchorKinds: readonly TextAnchorKind[] = ["word", "phrase", "passage", "range"];

export class TextAnchor
{
	public static Create(document: TextDocument, kind: TextAnchorKind, requested: TextSelection, now = new Date()): TextAnchorSnapshot
	{
		if (!AnchorKinds.includes(kind)) throw ApplicationError.Expected("validation", "ANCHOR_KIND_INVALID", "Choose a supported reference kind.");
		const selection = TextAnchor.NormalizeSelection(document, kind, requested);
		const selectedText = TextAnchor.Reconstruct(document, selection);
		if (selectedText.length === 0) throw ApplicationError.Expected("validation", "ANCHOR_EMPTY", "The selected text is empty.");
		const identity = JSON.stringify({
			kind,
			workId: document.id,
			textVersion: selection.text_version,
			start: selection.start,
			end: selection.end
		});
		const digest = createHash("sha256").update(identity, "utf8").digest("hex");
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${digest}`,
			workId: document.id,
			kind,
			selection,
			selectedText,
			createdAt: now.toISOString()
		};
		TextAnchor.AssertSnapshot(anchor);

		return anchor;
	}

	public static Validate(document: TextDocument, anchor: TextAnchorSnapshot): void
	{
		TextAnchor.AssertSnapshot(anchor);
		if (anchor.workId !== document.id || anchor.selection.dialogue !== document.id || anchor.selection.text_version !== document.textVersion)
		{
			throw ApplicationError.Expected("conflict", "ANCHOR_TEXT_VERSION_MISMATCH", "This reference belongs to a different version of the text and cannot be reconstructed.");
		}
		const selectedText = TextAnchor.Reconstruct(document, anchor.selection);
		if (selectedText !== anchor.selectedText)
		{
			throw ApplicationError.Expected("conflict", "ANCHOR_TEXT_MISMATCH", "The referenced Greek no longer matches the stored canonical text.");
		}
		const expected = TextAnchor.Create(document, anchor.kind, anchor.selection, new Date(anchor.createdAt));
		if (expected.id !== anchor.id)
		{
			throw ApplicationError.Expected("validation", "ANCHOR_IDENTITY_INVALID", "The reference identity does not match its canonical location.");
		}
	}

	public static AssertSnapshot(anchor: TextAnchorSnapshot): void
	{
		if (!/^anchor:sha256:[0-9a-f]{64}$/u.test(anchor.id)
			|| !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(anchor.workId)
			|| !AnchorKinds.includes(anchor.kind)
			|| anchor.selectedText.length === 0
			|| !Number.isFinite(Date.parse(anchor.createdAt))
			|| new Date(anchor.createdAt).toISOString() !== anchor.createdAt)
		{
			throw new Error("The text anchor is invalid.");
		}
		const selection = DecodeTextSelection(anchor.selection);
		if (selection.dialogue !== anchor.workId) throw new Error("The text anchor is stored beneath the wrong work.");
	}

	private static NormalizeSelection(document: TextDocument, kind: TextAnchorKind, requested: TextSelection): TextSelection
	{
		if (requested.dialogue !== document.id || requested.text_version !== document.textVersion)
		{
			throw ApplicationError.Expected("conflict", "ANCHOR_TEXT_VERSION_MISMATCH", "This selection belongs to a different version of the text and cannot be saved.");
		}
		try
		{
			document.ValidateSelection(requested);
		}
		catch (error)
		{
			throw new ApplicationError({
				kind: "validation",
				code: "ANCHOR_LOCATION_INVALID",
				message: "The selected location is not valid in the canonical text.",
				recovery: "correct-input",
				outcome: "not-completed",
				diagnosticId: "",
				operation: ""
			}, error);
		}
		let selection = structuredClone(requested);
		if (kind === "word")
		{
			const word = document.GetSingleGreekWordSelection(requested);
			if (word === null) throw ApplicationError.Expected("validation", "ANCHOR_WORD_INVALID", "Select one Greek word to create a word reference.");
			selection = word;
		}

		return selection;
	}

	private static Reconstruct(document: TextDocument, selection: TextSelection): string
	{
		try
		{
			return document.ReconstructText(selection);
		}
		catch (error)
		{
			throw new ApplicationError({
				kind: "validation",
				code: "ANCHOR_LOCATION_INVALID",
				message: "The selected location cannot be reconstructed from the canonical text.",
				recovery: "correct-input",
				outcome: "not-completed",
				diagnosticId: "",
				operation: ""
			}, error);
		}
	}
}
