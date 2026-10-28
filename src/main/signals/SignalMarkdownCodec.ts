import matter from "gray-matter";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Serializes and hydrates Dream-owned Signal Markdown.
export class SignalMarkdownCodec
{
	// Hydrates one persisted Signal.
	public Parse(content: string): SignalRecord
	{
		const parsed = matter(content);
		const data = parsed.data as Partial<SignalRecord>;

		if (data.id === undefined
			|| data.dreamId === undefined
			|| data.workId === undefined
			|| typeof data.sourceRef !== "string"
			|| !Array.isArray(data.selections)
			|| typeof data.text !== "string"
			|| data.createdAt === undefined
			|| data.updatedAt === undefined)
		{
			throw new Error("Signal Markdown is missing required metadata");
		}

		const selections = data.selections.map(DecodeTextSelection);
		const firstSelection = selections[0];

		if (firstSelection === undefined)
		{
			throw new Error("Signal Markdown is missing required selection metadata");
		}

		const title = typeof data.title === "string" ? { title: data.title } : {};
		const record: SignalRecord = {
			id: data.id,
			dreamId: data.dreamId,
			workId: data.workId,
			sourceRef: data.sourceRef,
			...title,
			selections,
			text: data.text,
			description: parsed.content.trim(),
			createdAt: data.createdAt,
			updatedAt: data.updatedAt
		};

		return record;
	}

	// Serializes one Signal without duplicating its description in metadata.
	public Serialize(signal: SignalRecord): string
	{
		const title = signal.title === undefined ? {} : { title: signal.title };
		const frontMatter = {
			id: signal.id,
			dreamId: signal.dreamId,
			workId: signal.workId,
			sourceRef: signal.sourceRef,
			...title,
			selections: signal.selections,
			text: signal.text,
			createdAt: signal.createdAt,
			updatedAt: signal.updatedAt
		};
		const markdown = matter.stringify(`${signal.description}\n`, frontMatter);

		return markdown;
	}
}
