import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LibraryManifest, LibraryTextSummary } from "../../src/shared/library/LibraryTypes.js";
import { TextDocument, type TextDocumentSnapshot, type TextSegmentSnapshot } from "../../src/shared/text/TextDocument";
import { ParseTeiWork } from "./TeiParser";

interface PerseusLock
{
	repository: string;
	commit: string;
	text_group: string;
	retrieved_at: string;
	license: string;
}

interface WorkEntry
{
	id: string;
	tlg: string;
	edition: string;
	title: string;
	titleGreek: string;
}

interface WorksConfig
{
	textGroup: string;
	works: WorkEntry[];
}

interface CorpusReport
{
	repository: string;
	commit: string;
	text_group: string;
	importedWorks: string[];
	omittedWorks: string[];
	notes: string[];
}

const LockPath = path.join("corpus", "perseus-lock.json");
const WorksConfigPath = path.join("corpus", "plato-works.json");
const ManifestPath = path.join("corpus", "generated", "manifest.json");
const WorksDirectory = path.join("corpus", "generated", "works");
const ReportPath = path.join("corpus", "reports", "corpus-build-report.json");
const ChecksumPath = path.join("corpus", "checksums.json");

function CreateSourceFileName(config: WorksConfig, work: WorkEntry): string
{
	const fileName = `${config.textGroup}.${work.tlg}.${work.edition}.xml`;
	return fileName;
}

function CreateSourcePath(config: WorksConfig, work: WorkEntry): string
{
	const fileName = CreateSourceFileName(config, work);
	const sourcePath = path.join("corpus", "source", "data", config.textGroup, work.tlg, fileName);
	return sourcePath;
}

// Gives book-less dialogues a single synthetic chapter so every work has a consistent division.
function ApplyChapterFallback(segments: TextSegmentSnapshot[]): TextSegmentSnapshot[]
{
	const hasBook = segments.some((segment) => segment.division?.type === "book");
	let result = segments;

	if (!hasBook)
	{
		result = segments.map((segment) => ({ ...segment, division: { type: "chapter", label: "1" } }));
	}

	return result;
}

function CreateWork(entry: WorkEntry, config: WorksConfig, parsedWork: ReturnType<typeof ParseTeiWork>, lock: PerseusLock): TextDocument
{
	const segments = ApplyChapterFallback(parsedWork.segments);
	const snapshot: TextDocumentSnapshot = {
		id: entry.id,
		urn: `urn:cts:greekLit:${config.textGroup}.${entry.tlg}.${entry.edition}`,
		title: entry.title,
		titleGreek: entry.titleGreek,
		author: "Plato",
		language: parsedWork.language,
		edition: {
			editor: parsedWork.editor ?? "John Burnet",
			title: "Platonis Opera",
			volume: null,
			publisher: "Oxford University Press",
			publicationPlace: "Oxford",
			publicationDate: null
		},
		provenance: {
			sourceKind: "bundled",
			repository: lock.repository,
			commit: lock.commit,
			sourceFile: CreateSourceFileName(config, entry),
			license: lock.license
		},
		segments
	};
	const work = new TextDocument(snapshot);
	return work;
}

function CreateSummary(work: TextDocument): LibraryTextSummary
{
	const summary: LibraryTextSummary = {
		id: work.id,
		urn: work.urn,
		title: work.title,
		titleGreek: work.titleGreek,
		author: work.author,
		language: work.language,
		editor: work.edition.editor,
		fileName: `${work.id}.json`
	};
	return summary;
}

function CreateManifest(summaries: LibraryTextSummary[], lock: PerseusLock): LibraryManifest
{
	const manifest: LibraryManifest = {
		id: "plato",
		title: "Plato Corpus",
		author: "Plato",
		language: "grc",
		sourceRepository: lock.repository,
		sourceCommit: lock.commit,
		license: lock.license,
		works: summaries
	};
	return manifest;
}

async function LoadJsonAsync<T>(filePath: string): Promise<T>
{
	const jsonText = await fs.readFile(filePath, "utf8");
	const value = JSON.parse(jsonText) as T;
	return value;
}

async function WriteJsonAsync(filePath: string, value: unknown): Promise<void>
{
	const jsonText = JSON.stringify(value, null, "\t");
	const outputText = `${jsonText}\n`;
	const directoryPath = path.dirname(filePath);
	await fs.mkdir(directoryPath, { recursive: true });
	await fs.writeFile(filePath, outputText, "utf8");
}

async function HashFileAsync(filePath: string): Promise<string>
{
	const contents = await fs.readFile(filePath);
	const hash = crypto.createHash("sha256");
	hash.update(contents);
	const digest = hash.digest("hex");
	return digest;
}

async function WriteChecksumsAsync(workFilePaths: string[]): Promise<void>
{
	const generatedFiles = [ManifestPath, ...workFilePaths, ReportPath];
	const checksums: Record<string, string> = {};

	for (const filePath of generatedFiles)
	{
		const hash = await HashFileAsync(filePath);
		const checksumKey = filePath.replaceAll("\\", "/");
		checksums[checksumKey] = hash;
	}

	await WriteJsonAsync(ChecksumPath, checksums);
}

async function BuildWorkAsync(entry: WorkEntry, config: WorksConfig, lock: PerseusLock): Promise<{ summary: LibraryTextSummary; filePath: string; segmentCount: number }>
{
	const sourcePath = CreateSourcePath(config, entry);
	const sourceText = await fs.readFile(sourcePath, "utf8");
	const parsedWork = ParseTeiWork(sourceText, CreateSourceFileName(config, entry));
	const work = CreateWork(entry, config, parsedWork, lock);

	if (work.segments.length === 0) throw new Error(`Parsed ${entry.id} contains no segments.`);

	const summary = CreateSummary(work);
	const filePath = path.join(WorksDirectory, `${entry.id}.json`);
	await WriteJsonAsync(filePath, work);
	return { summary, filePath, segmentCount: work.segments.length };
}

async function BuildCorpusAsync(): Promise<void>
{
	const lock = await LoadJsonAsync<PerseusLock>(LockPath);
	const config = await LoadJsonAsync<WorksConfig>(WorksConfigPath);
	const summaries: LibraryTextSummary[] = [];
	const workFilePaths: string[] = [];
	const importedWorks: string[] = [];
	const omittedWorks: string[] = [];
	let totalSegments = 0;

	for (const entry of config.works)
	{
		try
		{
			const built = await BuildWorkAsync(entry, config, lock);
			summaries.push(built.summary);
			workFilePaths.push(built.filePath);
			importedWorks.push(entry.id);
			totalSegments += built.segmentCount;
			console.log(`Built ${entry.title} (${built.segmentCount} segments).`);
		}
		catch (error)
		{
			const message = error instanceof Error ? error.message : "unknown error";
			omittedWorks.push(entry.id);
			console.warn(`Skipped ${entry.title}: ${message}`);
		}
	}

	const manifest = CreateManifest(summaries, lock);
	const report: CorpusReport = {
		repository: lock.repository,
		commit: lock.commit,
		text_group: lock.text_group,
		importedWorks,
		omittedWorks,
		notes: ["Imported from the pinned Perseus XML sources.", "Book-less dialogues use a single synthetic chapter."]
	};
	await WriteJsonAsync(ManifestPath, manifest);
	await WriteJsonAsync(ReportPath, report);
	await WriteChecksumsAsync(workFilePaths);
	console.log(`Generated ${importedWorks.length} works and ${totalSegments} segments (${omittedWorks.length} omitted).`);
}

BuildCorpusAsync().catch((error: unknown) =>
{
	const message = error instanceof Error ? error.message : "Corpus build failed.";
	console.error(message);
	process.exitCode = 1;
});
