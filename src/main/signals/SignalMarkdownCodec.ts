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

		if (data.id === undefined
			|| data.workId === undefined
			|| data.sourceRef === undefined
			|| !Array.isArray(data.selections)
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
			workId: data.workId,
			sourceRef: data.sourceRef,
			...title,
			selections,
			text: typeof data.text === "string" ? data.text : "",
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
			workId: signal.workId,
			sourceRef: signal.sourceRef,
			...title,
			selections: signal.selections,
			createdAt: signal.createdAt,
			updatedAt: signal.updatedAt
		};
		const markdown = matter.stringify(`${signal.description}\n`, frontMatter);

		return markdown;
	}
}
