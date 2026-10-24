import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Dream } from "../../src/main/dreams/Dream.js";
import { DreamLibrary } from "../../src/main/dreams/DreamLibrary.js";
import { ParseDreamMarkdown, SerializeDreamMarkdown } from "../../src/main/dreams/DreamMarkdownCodec.js";
import { DreamRepository, type DreamPersistenceRecord } from "../../src/main/dreams/DreamRepository.js";
import type { DreamSnapshot } from "../../src/shared/dreams/DreamTypes.js";

const directories: string[] = [];

function CreateDream(id: string, title: string): DreamSnapshot
{
	return {
		id,
		workId: "republic",
		dialogue: "Republic",
		title,
		source: {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s2", offset: 9 }
		},
		signalIds: [],
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z"
	};
}

async function CreateLibraryAsync(): Promise<DreamLibrary>
{
	const directory = await mkdtemp(path.join(os.tmpdir(), "chora-dream-"));
	directories.push(directory);
	const repository = new DreamRepository(directory, path.join(directory, "Trash", "Dreams"));
	const signals = {
		DeleteIfOrphanedAsync: async function DeleteSignalAsync(): Promise<void>
		{
			await Promise.resolve();
		}
	};
	const library = new DreamLibrary(directory, repository, signals as never);

	return library;
}

describe("Dream library", function DreamLibraryTests()
{
	afterEach(async () =>
	{
		for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
	});

	it("saves a titleless Dream containing only reflections", async () =>
	{
		const library = await CreateLibraryAsync();
		const dream = CreateDream("one", "   ");
		dream.reflection = "A descent toward another way of seeing.";
		await library.SaveAsync(dream);
		const records = await library.ListAsync();
		const directory = directories[0];
		if (directory === undefined) throw new Error("Test directory was not created.");
		const files = await readdir(path.join(directory, "republic"));

		expect(files[0]).toBe("dream--one.md");
		expect(records[0]?.title).toBe("");
		expect(records[0]?.signalIds).toEqual([]);
		expect(records[0]?.reflection).toBe(dream.reflection);
		expect(records[0]?.source).toEqual(dream.source);
	});

	it("round trips Greek polytonic text without changing code points", () =>
	{
		const dream = CreateDream("greek", "Πρόσοψις");
		const associated = { ...dream, signalIds: ["signal"] };
		const parsed = ParseDreamMarkdown(SerializeDreamMarkdown(associated));

		expect(parsed).toEqual({
			...associated
		});
	});

	it("rejects identifiers that could escape the primary Dream library", async () =>
	{
		const library = await CreateLibraryAsync();
		const unsafeIdDream = CreateDream("../outside", "Unsafe identifier");
		const unsafeWorkDream = CreateDream("safe", "Unsafe work");
		unsafeWorkDream.workId = "../outside";

		await expect(library.SaveAsync(unsafeIdDream)).rejects.toThrow("Dream identifier is invalid");
		await expect(library.SaveAsync(unsafeWorkDream)).rejects.toThrow("Dream work identifier is invalid");
	});

	it("writes readable Markdown in the work folder", async () =>
	{
		const library = await CreateLibraryAsync();
		await library.SaveAsync(CreateDream("one", "Descent"));
		const directory = directories[0];
		if (directory === undefined) throw new Error("Test directory was not created.");
		const content = await readFile(path.join(directory, "republic", "descent--one.md"), "utf8");

		expect(content).toContain("workId: republic");
		expect(content).toContain("# Descent");
		expect(content).toContain("segmentKey: s1");
		expect(content).toContain("segmentKey: s2");
	});

	it("renames the persisted file whenever the normalized title slug changes", async function RenamesPersistedFileAsync()
	{
		const library = await CreateLibraryAsync();
		const dream = CreateDream("one", "Original");
		await library.SaveAsync(dream);
		const directory = directories[0];
		if (directory === undefined)
		{
			throw new Error("Test directory was not created.");
		}

		const workPath = path.join(directory, "republic");

		dream.title = "Replacement";
		await library.SaveAsync(dream);
		const replacementFiles = await readdir(workPath);
		expect(replacementFiles).toEqual(["replacement--one.md"]);
		const replacementPath = path.join(workPath, "replacement--one.md");
		const replacementContent = await readFile(replacementPath, "utf8");
		expect(replacementContent).toContain("# Replacement");

		dream.title = "Replacement!";
		await library.SaveAsync(dream);
		const unchangedFiles = await readdir(workPath);
		expect(unchangedFiles).toEqual(["replacement--one.md"]);

		dream.title = "   ";
		await library.SaveAsync(dream);
		const untitledFiles = await readdir(workPath);
		expect(untitledFiles).toEqual(["dream--one.md"]);
	});

	it("preserves the existing file when writing the renamed file fails", async function PreservesExistingFileAsync()
	{
		const directory = await mkdtemp(path.join(os.tmpdir(), "chora-dream-rename-failure-"));
		directories.push(directory);
		const repository = new DreamRepository(directory);
		const original = CreateDream("one", "Original");
		const originalPath = path.join(directory, "republic", "original--one.md");
		await repository.SaveAsync({ dream: original, filePath: originalPath });
		const blockerPath = path.join(directory, "blocker");
		await writeFile(blockerPath, "not a directory", "utf8");
		const replacement = { ...original, title: "Replacement" };
		const replacementPath = path.join(blockerPath, "replacement--one.md");

		const failedSave = repository.SaveAsync({ dream: replacement, filePath: replacementPath }, originalPath);
		await expect(failedSave).rejects.toThrow();

		const originalContent = await readFile(originalPath, "utf8");
		expect(originalContent).toContain("# Original");
	});

	it("deletes only the Dream with the requested identifier", async () =>
	{
		const library = await CreateLibraryAsync();
		await library.SaveAsync(CreateDream("one", "First"));
		await library.SaveAsync(CreateDream("two", "Second"));

		await library.DeleteAsync("one");

		const remaining = await library.ListAsync();
		expect(remaining.map((dream) => dream.id)).toEqual(["two"]);
		const directory = directories[0];
		if (directory === undefined) throw new Error("Test directory was not created.");
		const deletedFiles = await readdir(path.join(directory, "Trash", "Dreams", "republic"));
		expect(deletedFiles).toHaveLength(1);
		expect(deletedFiles[0]).toMatch(/^first--one--deleted-[0-9a-f-]+\.md$/u);
		const deletedContent = await readFile(path.join(directory, "Trash", "Dreams", "republic", deletedFiles[0] ?? ""), "utf8");
		expect(deletedContent).toContain("# First");
	});

	it("removes a Signal association without deleting or rewriting unrelated Dreams", async function RemovesSignalAssociationAsync()
	{
		const library = await CreateLibraryAsync();
		const first = CreateDream("one", "First");
		first.signalIds = ["deleted-signal", "retained-signal"];
		const second = CreateDream("two", "Second");
		second.signalIds = ["retained-signal"];
		const third = CreateDream("three", "Third");
		await library.SaveAsync(first);
		await library.SaveAsync(second);
		await library.SaveAsync(third);
		const directory = directories[0];
		if (directory === undefined)
		{
			throw new Error("Test directory was not created.");
		}
		const workPath = path.join(directory, "republic");
		const secondPath = path.join(workPath, "second--two.md");
		const thirdPath = path.join(workPath, "third--three.md");
		const secondBefore = await readFile(secondPath, "utf8");
		const thirdBefore = await readFile(thirdPath, "utf8");

		await library.RemoveSignalEverywhereAsync("deleted-signal");

		const records = await library.ListAsync();
		expect(records.map(function SelectId(dream): string
		{
			return dream.id;
		})).toEqual(["one", "two", "three"]);
		expect(records.find(function FindFirst(dream): boolean
		{
			return dream.id === "one";
		})?.signalIds).toEqual(["retained-signal"]);
		expect(await readdir(workPath)).toEqual(["first--one.md", "second--two.md", "third--three.md"]);
		expect(await readFile(secondPath, "utf8")).toBe(secondBefore);
		expect(await readFile(thirdPath, "utf8")).toBe(thirdBefore);
	});

	it("reloads persisted records on repeated loads", async function ReloadsRepositoryRecords()
	{
		const directory = await mkdtemp(path.join(os.tmpdir(), "chora-dream-reload-"));
		directories.push(directory);
		const repository = new DreamRepository(directory);
		const original = CreateDream("indexed", "Original");
		const filePath = path.join(directory, "republic", "original--indexed.md");
		const record: DreamPersistenceRecord = { dream: original, filePath };

		await repository.SaveAsync(record);
		const initial = await repository.LoadAsync();
		const replacement = { ...original, title: "Replacement" };
		const replacementContent = SerializeDreamMarkdown(replacement);
		await writeFile(filePath, replacementContent, "utf8");
		const reloaded = await repository.LoadAsync();

		expect(initial[0]?.dream.title).toBe("Original");
		expect(reloaded[0]?.dream.title).toBe("Replacement");
	});

	it("normalizes linked and Signal identities", () =>
	{
		const record = {
			...CreateDream("one", "  Descent  "),
			linkedDreamIds: ["one", "two", "two", "  three  "],
			signalIds: ["signal", "signal"]
		};
		const dream = new Dream(record);
		const normalized = dream.ToSnapshot();

		expect(normalized.title).toBe("Descent");
		expect(normalized.linkedDreamIds).toEqual(["two", "three"]);
		expect(normalized.signalIds).toEqual(["signal"]);
	});
});
