import type { DreamSnapshot } from "./DreamTypes.js";
import type { TextDocument } from "../text/TextDocument.js";
import { SignalMarkdownDocument } from "./SignalMarkdownDocument.js";

// Serializes a complete Dream for human-readable clipboard export.
export class DreamMarkdownExport
{
	public static Serialize(dream: DreamSnapshot, document: TextDocument): string
	{
		const start = document.ResolveCitation(dream.source.start)?.value ?? dream.source.start.stephanus;
		const end = document.ResolveCitation(dream.source.end)?.value ?? dream.source.end.stephanus;
		const location = start === end ? start : `${start}–${end}`;
		const blocks = [
			`# ${dream.title || "Untitled Dream"}`,
			"## Source Passage",
			SignalMarkdownDocument.Quote(document.ReconstructText(dream.source)),
			`Source: ${dream.dialogue ?? dream.workId} · ${location}`,
			"## Signals"
		];

		if (dream.signals.length === 0)
		{
			blocks.push("_No Signals._");
		}
		else
		{
			for (const signal of dream.signals) blocks.push(SignalMarkdownDocument.SerializeSection(dream, signal, 3));
		}
		blocks.push("## Reflections", dream.reflection.trim() || "_No reflections._");
		const markdown = `${blocks.join("\n\n")}\n`;
		return markdown;
	}
}
