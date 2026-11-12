import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TextAnchorRepository } from "../../src/main/anchors/TextAnchorRepository.js";
import { TextAnchorService } from "../../src/main/anchors/TextAnchorService.js";
import { WorkStoragePaths } from "../../src/main/storage/WorkStoragePaths.js";
import { LibraryService } from "../../src/main/library/LibraryService.js";
import type { LibraryTextSummary } from "../../src/shared/library/LibraryTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

const Version = `sha256:${"0".repeat(64)}`;
const NewVersion = `sha256:${"1".repeat(64)}`;
const FirstText = "(Κατέβην), χθὲς";
const roots: string[] = [];
const summary: LibraryTextSummary = {
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: "Πολιτεία",
	author: "Plato",
	language: "grc",
	editor: null
};

function CreateDocument(textVersion = Version, firstText = FirstText): TextDocument
{
	return new TextDocument({
		id: "republic",
		textVersion,
		urn: null,
		title: "Republic",
		titleGreek: "Πολιτεία",
		author: "Plato",
		language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "republic.xml", license: "test" },
		segments: [
			{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: firstText },
			{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: " εἰς Πειραιᾶ" }
		]
	});
}

function CreateLibrary(document: TextDocument): LibraryService
{
	return new LibraryService({
		ListAsync: async function ListAsync(): Promise<LibraryTextSummary[]> { return [summary]; },
		GetAsync: async function GetAsync(): Promise<TextDocument> { return document; }
	});
}

afterEach(async function RemoveTemporaryRootsAsync(): Promise<void>
{
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Text anchors", function TextAnchorTests()
{
	it("normalizes one Greek word and reuses its stable identity", async function ReusesWordAnchorAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-anchor-"));
		roots.push(root);
		const document = CreateDocument();
		const paths = new WorkStoragePaths(root, [summary]);
		const repository = new TextAnchorRepository(paths);
		const service = new TextAnchorService(repository, CreateLibrary(document));
		const selection = document.CreateSelection({ stephanus: "s1", offset: 0 }, { stephanus: "s1", offset: "(Κατέβην),".length });

		const first = await service.CreateAsync({ kind: "word", selection });
		const second = await service.CreateAsync({ kind: "word", selection });

		expect(first).toEqual(second);
		expect(first.selectedText).toBe("Κατέβην");
		expect(first.selection.start.offset).toBe(1);
		expect(first.id).toMatch(/^anchor:sha256:[0-9a-f]{64}$/u);
		const files = await readdir(path.join(root, "The Republic", "Anchors"));
		expect(files).toHaveLength(1);
	});

	it("persists and reconstructs an exact cross-section passage after restart", async function ReconstructsAfterRestartAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-anchor-"));
		roots.push(root);
		const document = CreateDocument();
		const paths = new WorkStoragePaths(root, [summary]);
		const selection = document.CreateSelection({ stephanus: "s1", offset: FirstText.indexOf("χ") }, { stephanus: "s2", offset: 12 });
		const created = await new TextAnchorService(new TextAnchorRepository(paths), CreateLibrary(document))
			.CreateAsync({ kind: "passage", selection });
		const restarted = new TextAnchorService(new TextAnchorRepository(paths), CreateLibrary(document));

		const validated = await restarted.ValidateAsync(created.id);

		expect(validated.selectedText).toBe("χθὲς\n εἰς Πειραιᾶ");
		expect(await restarted.ListAsync("republic")).toEqual([created]);
	});

	it("reports an explicit text-version conflict instead of returning an invalid reference", async function RejectsStaleVersionAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-anchor-"));
		roots.push(root);
		const original = CreateDocument();
		const paths = new WorkStoragePaths(root, [summary]);
		const selection = original.CreateSelection({ stephanus: "s1", offset: 1 }, { stephanus: "s1", offset: 8 });
		const created = await new TextAnchorService(new TextAnchorRepository(paths), CreateLibrary(original))
			.CreateAsync({ kind: "word", selection });
		const restarted = new TextAnchorService(new TextAnchorRepository(paths), CreateLibrary(CreateDocument(NewVersion)));

		await expect(restarted.ValidateAsync(created.id)).rejects.toMatchObject({
			failure: { kind: "conflict", code: "ANCHOR_TEXT_VERSION_MISMATCH" }
		});
	});

	it("rejects a word anchor that contains more than one Greek word", async function RejectsMultipleWordsAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-anchor-"));
		roots.push(root);
		const document = CreateDocument();
		const paths = new WorkStoragePaths(root, [summary]);
		const service = new TextAnchorService(new TextAnchorRepository(paths), CreateLibrary(document));
		const selection = document.CreateSelection({ stephanus: "s1", offset: 1 }, { stephanus: "s1", offset: FirstText.length });

		await expect(service.CreateAsync({ kind: "word", selection })).rejects.toMatchObject({
			failure: { kind: "validation", code: "ANCHOR_WORD_INVALID" }
		});
	});
});
