import matter from "gray-matter";
import type { IdeaRecord, IdeaSignalReference } from "../../shared/ideas/IdeaTypes.js";

// Serializes and hydrates the Markdown representation owned by Idea persistence.
export class IdeaMarkdownCodec
{
	// Hydrates one persisted Idea record and rejects unsupported legacy evidence.
	public Parse(content: string): IdeaRecord
	{
		const parsed = matter(content);
		const data = parsed.data as Record<string, unknown>;
		const id = this.RequireString(data.id, "Idea identifier");
		const workId = this.RequireString(data.workId, "Idea work identifier");
		const evidence = this.ParseEvidence(data);
		const createdAt = this.RequireString(data.createdAt, "Idea creation timestamp");
		const updatedAt = this.RequireString(data.updatedAt, "Idea update timestamp");
		const heading = /^#\s+(.+?)\s*(?:\r?\n|$)/u.exec(parsed.content);
		const title = this.ParseTitle(heading, data.title);
		let body = parsed.content.trim();

		if (heading !== null)
		{
			const contentWithoutHeading = parsed.content.slice(heading[0].length);
			body = contentWithoutHeading.trim();
		}

		const record: IdeaRecord = {
			id,
			workId,
			title,
			content: body,
			originSignal: evidence.originSignal,
			relatedSignals: evidence.relatedSignals,
			createdAt,
			updatedAt
		};

		return record;
	}

	// Serializes one durable Idea as readable Markdown with authoritative metadata.
	public Serialize(idea: IdeaRecord): string
	{
		const title = idea.title.trim();
		const heading = title.length > 0
			? `# ${title}\n\n`
			: "";
		const frontMatter = {
			id: idea.id,
			workId: idea.workId,
			originSignal: idea.originSignal,
			relatedSignals: idea.relatedSignals,
			createdAt: idea.createdAt,
			updatedAt: idea.updatedAt
		};
		const body = `${heading}${idea.content}\n`;
		const markdown = matter.stringify(body, frontMatter);

		return markdown;
	}

	// Parses current origin-first evidence or migrates the previous ordered reference list.
	private ParseEvidence(data: Record<string, unknown>): {
		originSignal: IdeaSignalReference | null;
		relatedSignals: IdeaSignalReference[];
	}
	{
		let originSignal: IdeaSignalReference | null;
		let relatedSignals: IdeaSignalReference[];

		if (data.originSignal !== undefined)
		{
			originSignal = data.originSignal === null ? null : this.ParseReference(data.originSignal);
			relatedSignals = this.ParseReferences(data.relatedSignals);
		}
		else
		{
			const references = this.ParseReferences(data.references);
			const firstReference = references[0];

			originSignal = firstReference ?? null;
			relatedSignals = references.slice(1);
		}

		return { originSignal, relatedSignals };
	}

	// Parses a title from the Markdown heading or legacy front matter.
	private ParseTitle(heading: RegExpExecArray | null, value: unknown): string
	{
		let title = "";

		if (heading !== null)
		{
			const headingText = heading[1] ?? "";
			title = headingText.trim();
		}
		else if (typeof value === "string")
		{
			title = value.trim();
		}

		return title;
	}

	// Parses Signal-only evidence from persisted front matter.
	private ParseReferences(value: unknown): IdeaSignalReference[]
	{
		if (!Array.isArray(value))
		{
			throw new Error("Idea Markdown is missing Signal references");
		}

		const references: IdeaSignalReference[] = [];

		for (const candidate of value)
		{
			const reference = this.ParseReference(candidate);
			references.push(reference);
		}

		return references;
	}

	// Parses one persisted Signal reference and rejects legacy Dream or passage evidence.
	private ParseReference(value: unknown): IdeaSignalReference
	{
		let reference: IdeaSignalReference | null = null;

		if (typeof value === "object" && value !== null)
		{
			const candidate = value as Record<string, unknown>;
			const isSignal = candidate.kind === undefined || candidate.kind === "signal";
			const hasSignalId = typeof candidate.signalId === "string";

			if (isSignal && hasSignalId)
			{
				const rationale = this.ParseRationale(candidate.rationale);
				const signalId = candidate.signalId as string;
				reference = rationale === null
					? { signalId }
					: { signalId, rationale };
			}
		}

		if (reference === null)
		{
			throw new Error("Idea Markdown contains unsupported references; Ideas must reference Signals");
		}

		return reference;
	}

	// Parses optional Idea-owned relationship context while preserving older rationale-free files.
	private ParseRationale(value: unknown): string | null
	{
		let rationale: string | null = null;

		if (typeof value === "string")
		{
			const trimmed = value.trim();
			rationale = trimmed.length > 0 ? trimmed : null;
		}
		else if (value !== undefined && value !== null)
		{
			throw new Error("Idea Markdown contains an invalid Signal rationale");
		}

		return rationale;
	}

	// Requires a string front-matter field and reports malformed persistence explicitly.
	private RequireString(value: unknown, label: string): string
	{
		if (typeof value !== "string")
		{
			throw new Error(`${label} is missing from Idea Markdown`);
		}

		return value;
	}
}
