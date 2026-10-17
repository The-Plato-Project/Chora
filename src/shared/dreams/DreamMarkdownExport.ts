import type { DreamSnapshot } from "./DreamTypes.js";
import type { TextDocument } from "../text/TextDocument.js";
import type { SignalRecord } from "../signals/SignalTypes.js";
import { SignalMarkdownDocument } from "./SignalMarkdownDocument.js";

// Serializes a complete Dream for human-readable clipboard export.
export class DreamMarkdownExport
{
	public static Serialize(dream: DreamSnapshot, signals: readonly SignalRecord[], document: TextDocument): string
	{
		return this.SerializeCore(dream, signals, document, true);
	}

	public static SerializeForSynopticView(dream: DreamSnapshot, signals: readonly SignalRecord[], document: TextDocument): string
	{
		return this.SerializeCore(dream, signals, document, false);
	}

	private static SerializeCore(dream: DreamSnapshot, signals: readonly SignalRecord[], document: TextDocument, includeSynopticView: boolean): string
	{
		const start = document.ResolveCitation(dream.source.start)?.value ?? dream.source.start.segmentKey;
		const end = document.ResolveCitation(dream.source.end)?.value ?? dream.source.end.segmentKey;
		const location = start === end ? start : `${start}–${end}`;
		const blocks = [
			`# ${dream.title || "Untitled Dream"}`,
			"## Source Passage",
			SignalMarkdownDocument.Quote(document.ReconstructText(dream.source)),
			`Source: ${dream.dialogue ?? dream.workId} · ${location}`,
			"## Signals"
		];

		if (signals.length === 0)
		{
			blocks.push("_No Signals._");
		}
		else
		{
			for (const signal of signals) blocks.push(SignalMarkdownDocument.SerializeSection(dream, signal, 3));
		}

		blocks.push("## Reflections", dream.reflection.trim() || "_No reflections._");
		if (includeSynopticView && dream.synopticView.trim().length > 0) blocks.push("## Clarity Check", dream.synopticView.trim());
		const markdown = `${blocks.join("\n\n")}\n`;
		return markdown;
	}
}
