import matter from "gray-matter";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Serializes and hydrates work-owned Signal Markdown.
export class SignalMarkdownCodec
{
	// Hydrates one persisted Signal.
	public Parse(content: string): SignalRecord
	{
		const parsed = matter(content);
		const data = parsed.data as Partial<SignalRecord>;

		if (data.id === undefined || data.workId === undefined || data.selection === undefined)
		{
			throw new Error("Signal Markdown is missing required metadata");
		}

		const record: SignalRecord = {
			id: data.id,
			workId: data.workId,
			sourceRef: data.sourceRef ?? data.selection.start.segmentKey,
			selection: DecodeTextSelection(data.selection),
			text: typeof data.text === "string" ? data.text : "",
			description: parsed.content.trim(),
			createdAt: data.createdAt ?? new Date().toISOString(),
			updatedAt: data.updatedAt ?? new Date().toISOString()
		};

		return record;
	}

	// Serializes one Signal without duplicating its description in metadata.
	public Serialize(signal: SignalRecord): string
	{
		const frontMatter = {
			id: signal.id,
			workId: signal.workId,
			sourceRef: signal.sourceRef,
			selection: signal.selection,
			createdAt: signal.createdAt,
			updatedAt: signal.updatedAt
		};
		const markdown = matter.stringify(`${signal.description}\n`, frontMatter);

		return markdown;
	}
}
