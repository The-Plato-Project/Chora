import type { DreamSnapshot } from "./DreamTypes.js";
import type { SignalRecord } from "../signals/SignalTypes.js";

// Serializes one complete Signal for clipboard export.
export class SignalMarkdownDocument
{
	public static SerializeSection(dream: DreamSnapshot, signal: SignalRecord, headingDepth: number): string
	{
		const heading = "#".repeat(headingDepth);
		const sectionHeading = "#".repeat(headingDepth + 1);
		const blocks = [
			`${heading} Signal`,
			this.Quote(signal.text),
			`Source: ${dream.dialogue ?? dream.workId} · ${signal.sourceRef}`,
			`${sectionHeading} Observation`,
			signal.description.trim() || "_No observation._"
		];

		const markdown = blocks.join("\n\n");
		return markdown;
	}

	public static Quote(text: string): string
	{
		const lines = text.split(/\r?\n/u);
		const quoted: string[] = [];
		for (const line of lines) quoted.push(`> ${line}`);
		const markdown = quoted.join("\n");
		return markdown;
	}
}
