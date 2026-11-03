import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DreamStorageMigration } from "../../src/main/dreams/DreamStorageMigration.js";
import { SerializeDreamMarkdown } from "../../src/main/dreams/DreamMarkdownCodec.js";
import { WorkStoragePaths } from "../../src/main/dreams/WorkStoragePaths.js";
import { SignalMarkdownCodec } from "../../src/main/signals/SignalMarkdownCodec.js";
import type { DreamSnapshot } from "../../src/shared/dreams/DreamTypes.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

const temporaryRoots: string[] = [];
const selection = {
	dialogue: "republic", text_version: `sha256:${"0".repeat(64)}`,
	start: { stephanus: "s1", offset: 0 },
	end: { stephanus: "s1", offset: 3 }
};
const signal: SignalRecord = {
	id: "signal-1",
	dreamId: "dream-1",
	workId: "republic",
	sourceRef: "327a",
	selections: [selection],
	text: "abc",
	description: "Observation",
	createdAt: "2026-01-01",
	updatedAt: "2026-01-01"
};
const dream: DreamSnapshot = {
	id: "dream-1",
	workId: "republic",
	dialogue: "Republic",
	title: "Descent",
	source: selection,
	signals: [],
	reflection: "Reader reflection",
	linkedDreamIds: [],
	createdAt: "2026-01-01",
	updatedAt: "2026-01-01"
};

async function CreateContextAsync(): Promise<{ root: string; internal: string; works: WorkStoragePaths }>
{
	const parent = await mkdtemp(path.join(os.tmpdir(), "chora-migration-"));
	temporaryRoots.push(parent);
	const root = path.join(parent, "Chora");
	const internal = path.join(parent, "app-data");
	const works = new WorkStoragePaths(root, [{ id: "republic", title: "Republic" }, { id: "crito", title: "Crito" }]);
	return { root, internal, works };
}

async function PutAsync(file: string, content: string): Promise<void>
{
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content, "utf8");
}

afterEach(async function CleanAsync(): Promise<void>
{
	for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Dream storage migration", function MigrationTests()
{
	it("moves Dreams and Signals by work while retaining exact backups", async function MigratesAsync(): Promise<void>
	{
		const context = await CreateContextAsync();
		const dreamContent = SerializeDreamMarkdown(dream);
		const signalContent = new SignalMarkdownCodec().Serialize(signal);
		await PutAsync(path.join(context.root, "Dreams", "republic", "Inquiry", "dream.md"), dreamContent);
		await PutAsync(path.join(context.root, "Signals", "signal-1.md"), signalContent);
		await mkdir(path.join(context.root, "Dreams", "republic", "Empty"), { recursive: true });
		await PutAsync(path.join(context.root, "Conversations", "old.json"), "conversation");
		await new DreamStorageMigration(context.root, context.internal, context.works).RunAsync();

		expect(await readFile(path.join(context.root, "The Republic", "Dreams", "Inquiry", "dream.md"), "utf8")).toBe(dreamContent);
		expect(await readFile(path.join(context.root, "The Republic", "Signals", "signal-1.md"), "utf8")).toBe(signalContent);
		expect(await readFile(path.join(context.internal, "StorageMigrationBackup", "Signals", "signal-1.md"), "utf8")).toBe(signalContent);
		expect(await readFile(path.join(context.internal, "Conversations", "old.json"), "utf8")).toBe("conversation");
		expect(await readdir(path.join(context.root, "The Republic", "Dreams", "Empty"))).toEqual([]);
		await new DreamStorageMigration(context.root, context.internal, context.works).RunAsync();
		expect(await readFile(path.join(context.root, "The Republic", "Signals", "signal-1.md"), "utf8")).toBe(signalContent);
	});

	it("refuses conflicting destinations before moving sources", async function RejectsConflictAsync(): Promise<void>
	{
		const context = await CreateContextAsync();
		const content = new SignalMarkdownCodec().Serialize(signal);
		const source = path.join(context.root, "Signals", "signal-1.md");
		await PutAsync(source, content);
		await PutAsync(path.join(context.root, "The Republic", "Signals", "signal-1.md"), "different");
		await expect(new DreamStorageMigration(context.root, context.internal, context.works).RunAsync()).rejects.toThrow("conflicts");
		expect(await readFile(source, "utf8")).toBe(content);
	});

	it("resumes a copied source without overwriting the destination", async function ResumesAsync(): Promise<void>
	{
		const context = await CreateContextAsync();
		const content = new SignalMarkdownCodec().Serialize(signal);
		await PutAsync(path.join(context.root, "Signals", "signal-1.md"), content);
		await PutAsync(path.join(context.root, "The Republic", "Signals", "signal-1.md"), content);
		await PutAsync(path.join(context.internal, "StorageMigrationBackup", "Signals", "signal-1.md"), content);
		await new DreamStorageMigration(context.root, context.internal, context.works).RunAsync();
		await expect(readFile(path.join(context.root, "Signals", "signal-1.md"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("remaps retained Trash paths and preserves operation state", async function MigratesTrashAsync(): Promise<void>
	{
		const context = await CreateContextAsync();
		const id = "00000000-0000-0000-0000-000000000001";
		const record = { id, dream: { ...dream, signals: [signal] }, relativePath: path.join("republic", "Folder", "dream.md"), deletedAt: "2026-01-01", state: "restoring" };
		const source = path.join(context.root, "Trash", "DreamBundles", `${id}.json`);
		await PutAsync(source, JSON.stringify(record));
		await new DreamStorageMigration(context.root, context.internal, context.works).RunAsync();
		const content = await readFile(path.join(context.internal, "Trash", "DreamBundles", `${id}.json`), "utf8");
		const restored = JSON.parse(content) as typeof record;
		expect(restored.relativePath).toBe(path.join("The Republic", "Dreams", "Folder", "dream.md"));
		expect(restored.state).toBe("restoring");
		expect(restored.dream.signals).toEqual([signal]);
	});

	it("rejects unsafe and colliding work names", function RejectsUnsafeNames(): void
	{
		expect(function CreateCollision(): void
		{
			new WorkStoragePaths("root", [{ id: "first", title: "Same" }, { id: "second", title: "same" }]);
		}).toThrow("duplicate");
		expect(function CreateUnsafe(): void
		{
			new WorkStoragePaths("root", [{ id: "first", title: "../bad" }]);
		}).toThrow("unsafe");
	});
});
