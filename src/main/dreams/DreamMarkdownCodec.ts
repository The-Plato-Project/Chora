import matter from "gray-matter";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Frontmatter shape parsed from a Dream Markdown file.
type DreamData = Partial<DreamSnapshot>;
type ParsedDreamData = DreamData & Pick<DreamSnapshot, "title" | "reflection">;

// Builds a Dream snapshot from parsed Markdown data, or null when required fields are missing.
function BuildDreamSnapshot(record: ParsedDreamData): DreamSnapshot | null
{
	const source = record.source;
	const hasRequiredFields = source !== undefined
		&& record.id !== undefined
		&& record.workId !== undefined
		&& record.dialogue !== undefined
		&& Array.isArray(record.linkedDreamIds)
		&& typeof record.createdAt === "string"
		&& typeof record.updatedAt === "string";
	let parsed: DreamSnapshot | null = null;

	if (hasRequiredFields)
	{
		parsed = {
			id: record.id,
			workId: record.workId,
			dialogue: record.dialogue,
			title: record.title?.trim() ?? "",
			source: DecodeTextSelection(source),
			signals: [],
			reflection: record.reflection,
			linkedDreamIds: Array.from(new Set(record.linkedDreamIds)),
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	return parsed;
}

function ReadSections(content: string): { title: string; reflections: string } | null
{
	const current = /^#\s+(.+?)\s*\r?\n\r?\n## Reflections\r?\n\r?\n([\s\S]*?)\s*$/u.exec(content);
	const titleless = /^## Reflections\r?\n\r?\n([\s\S]*?)\s*$/u.exec(content);
	let sections: { title: string; reflections: string } | null = null;

	if (current !== null) sections = { title: current[1] ?? "", reflections: current[2] ?? "" };
	else if (titleless !== null) sections = { title: "", reflections: titleless[1] ?? "" };

	return sections;
}

// Parses the current Dream persistence format.
export function ParseDreamMarkdown(content: string): DreamSnapshot | null
{
	const parsed = matter(content);
	const data = parsed.data as DreamData;
	const sections = ReadSections(parsed.content);
	const parsedDream = sections === null
		? null
		: BuildDreamSnapshot({ ...data, title: sections.title, reflection: sections.reflections });
	return parsedDream;
}

export function SerializeDreamMarkdown(dream: DreamSnapshot): string
{
	const title = dream.title.trim();
	const heading = title.length === 0 ? "" : `# ${title}\n\n`;
	const body = `${heading}## Reflections\n\n${dream.reflection}\n`;
	const frontMatter = {
		id: dream.id,
		workId: dream.workId,
		dialogue: dream.dialogue,
		source: dream.source,
		linkedDreamIds: dream.linkedDreamIds,
		createdAt: dream.createdAt,
		updatedAt: dream.updatedAt
	};
	const markdown = matter.stringify(body, frontMatter);
	return markdown;
}
