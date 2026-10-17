import matter from "gray-matter";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";

// Frontmatter shape parsed from a Dream Markdown file.
type LegacyDreamData = Partial<DreamSnapshot> & { exploration?: string; signals?: SignalRecord[] };

// Parsed persistence state, including embedded Signals accepted only for one-way migration.
export interface ParsedDreamSnapshot
{
	readonly snapshot: DreamSnapshot;
	readonly legacySignals: readonly SignalRecord[];
}

// Builds a Dream snapshot from parsed Markdown data, or null when required fields are missing.
function BuildDreamSnapshot(record: LegacyDreamData): ParsedDreamSnapshot | null
{
	const source = record.source;
	let parsed: ParsedDreamSnapshot | null = null;

	if (source !== undefined && record.id !== undefined && record.workId !== undefined)
	{
		const legacySignals = (record.signals ?? []).map(function NormalizeLegacySignal(signal): SignalRecord
		{
			return { ...signal, description: signal.description ?? "" };
		});
		const signalIds = record.signalIds ?? legacySignals.map(function GetSignalId(signal): string
		{
			return signal.id;
		});
		const snapshot: DreamSnapshot = {
			id: record.id,
			workId: record.workId,
			dialogue: record.dialogue ?? null,
			title: record.title?.trim() ?? "",
			source: DecodeTextSelection(source),
			signalIds,
			reflection: record.reflection ?? "",
			synopticView: record.synopticView ?? record.exploration ?? "",
			linkedDreamIds: Array.from(new Set(record.linkedDreamIds ?? [])),
			createdAt: record.createdAt ?? new Date().toISOString(),
			updatedAt: record.updatedAt ?? new Date().toISOString()
		};
		parsed = { snapshot, legacySignals };
	}

	return parsed;
}

function ReadSections(content: string): { title: string; reflections: string }
{
	const current = /^#\s+(.+?)\s*\r?\n\r?\n## (?:Exegesis|Reflections)\r?\n\r?\n([\s\S]*?)\s*$/u.exec(content);
	const titleless = /^## (?:Exegesis|Reflections)\r?\n\r?\n([\s\S]*?)\s*$/u.exec(content);
	let sections = { title: "", reflections: content.trim() };

	if (current !== null) sections = { title: current[1] ?? "", reflections: current[2] ?? "" };
	else if (titleless !== null) sections = { title: "", reflections: titleless[1] ?? "" };

	return sections;
}

// Parses persistence data and exposes legacy embedded Signals only to the repository migration boundary.
export function ParseDreamMarkdownWithLegacy(content: string): ParsedDreamSnapshot | null
{
	const parsed = matter(content);
	const data = parsed.data as LegacyDreamData;
	const sections = ReadSections(parsed.content);
	const parsedDream = BuildDreamSnapshot({ ...data, title: sections.title || data.title || "", reflection: sections.reflections });
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
		signalIds: dream.signalIds ?? [],
		synopticView: dream.synopticView,
		linkedDreamIds: dream.linkedDreamIds,
		createdAt: dream.createdAt,
		updatedAt: dream.updatedAt
	};
	const markdown = matter.stringify(body, frontMatter);
	return markdown;
}
