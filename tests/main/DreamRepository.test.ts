import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DreamTrashRepository } from "../../src/main/dreams/DreamTrashRepository.js";
import { Dream } from "../../src/main/dreams/Dream.js";
import { DreamLibrary } from "../../src/main/dreams/DreamLibrary.js";
import { ParseDreamMarkdown, SerializeDreamMarkdown } from "../../src/main/dreams/DreamMarkdownCodec.js";
import { DreamRepository } from "../../src/main/dreams/DreamRepository.js";
import { SignalMarkdownCodec } from "../../src/main/signals/SignalMarkdownCodec.js";
import { SignalRepository } from "../../src/main/signals/SignalRepository.js";
import type { DreamSnapshot } from "../../src/shared/dreams/DreamTypes.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Temporary roots removed after each test.
const roots: string[] = [];

// Canonical document used for Dream and Signal validation.
const document = new TextDocument({
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: null,
	author: "Plato",
	language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
	]
});

// Creates one complete Dream snapshot for codec and aggregate tests.
function CreateDream(id = "dream-1", title = "Descent"): DreamSnapshot
{
	return {
		id,
		workId: "republic",
		dialogue: "Republic",
		title,
		source: {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s2", offset: 6 }
		},
		signals: [],
		reflection: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z"
	};
}

// Creates a temporary aggregate library with real Markdown repositories.
async function CreateLibraryAsync(): Promise<{ library: DreamLibrary; root: string; dreams: DreamRepository; signals: SignalRepository }>
{
	const root = await mkdtemp(path.join(os.tmpdir(), "chora-dream-"));
	roots.push(root);
	const dreamRoot = path.join(root, "Dreams");
	const dreams = new DreamRepository(dreamRoot);
	const signals = new SignalRepository(root, new SignalMarkdownCodec());
	const documents = {
		GetAsync: async function GetAsync(): Promise<TextDocument>
		{
			return document;
		}
	};
	const library = new DreamLibrary(dreamRoot, dreams, signals, documents as never);

	return { library, root, dreams, signals };
}

afterEach(async function RemoveTemporaryRootsAsync(): Promise<void>
{
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("DreamLibrary", function DreamLibraryTests()
{
	it("retains an entire Dream indefinitely and restores its original folder and Signals", async function RestoresAggregateAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		await context.library.CreateFolderAsync({ workId: "republic", parentPath: "", name: "Inquiry" });
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "Inquiry" });
		const signal = await context.library.CreateSignalAsync({ dreamId: owner.id, selection: owner.source });
		await context.library.UpdateSignalAsync({ dreamId: owner.id, signalId: signal.id, selections: signal.selections, description: "Keep this observation" });
		const before = await context.library.ListAsync();
		await context.library.DeleteAsync(owner.id);
		expect((await context.library.ListAsync()).dreams).toEqual([]);
		expect(await context.signals.LoadAsync()).toEqual([]);
		const retained = await context.library.ListTrashAsync();
		expect(retained).toHaveLength(1);
		expect(retained[0]?.signalCount).toBe(1);
		expect(Number.isFinite(Date.parse(retained[0]!.deletedAt))).toBe(true);
		await context.library.DeleteFolderAsync({ workId: "republic", folderPath: "Inquiry" });
		await context.library.RestoreTrashAsync(retained[0]!.id);
		const after = await context.library.ListAsync();
		expect(after.dreams).toEqual(before.dreams);
		expect(after.locations[0]?.folderPath).toBe("Inquiry");
		expect(after.folders[0]?.path).toBe("Inquiry");
		expect(await context.library.ListTrashAsync()).toEqual([]);
	});

	it("keeps the live aggregate if committing the trash payload fails", async function RejectsUncommittedDeletionAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" });
		const stage = vi.spyOn(DreamTrashRepository.prototype, "StageAsync").mockRejectedValueOnce(new Error("disk full"));
		try
		{
			await expect(context.library.DeleteAsync(owner.id)).rejects.toThrow("disk full");
			expect((await context.library.ListAsync()).dreams[0]?.id).toBe(owner.id);
			expect(await context.dreams.LoadAsync()).toHaveLength(1);
		}
		finally
		{
			stage.mockRestore();
		}
	});

	it("replays interrupted deletion before startup and keeps all Signals recoverable", async function RecoversDeletionAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" });
		await context.library.CreateSignalAsync({ dreamId: owner.id, selection: owner.source });
		vi.spyOn(context.signals, "DeleteAsync").mockRejectedValueOnce(new Error("file locked"));
		await context.library.DeleteAsync(owner.id);
		expect((await context.library.ListAsync()).dreams).toEqual([]);
		const restarted = new DreamLibrary(path.join(context.root, "Dreams"), context.dreams, context.signals, {} as never);
		expect((await restarted.ListAsync()).dreams).toEqual([]);
		expect(await context.signals.LoadAsync()).toEqual([]);
		const retained = await restarted.ListTrashAsync();
		expect(retained[0]?.signalCount).toBe(1);
		await restarted.RestoreTrashAsync(retained[0]!.id);
		expect((await restarted.ListAsync()).dreams[0]?.signals).toHaveLength(1);
	});

	it("resumes a failed restore at startup without losing the retained aggregate", async function RecoversRestoreAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" });
		await context.library.CreateSignalAsync({ dreamId: owner.id, selection: owner.source });
		await context.library.DeleteAsync(owner.id);
		const retained = await context.library.ListTrashAsync();
		vi.spyOn(context.dreams, "SaveAsync").mockRejectedValueOnce(new Error("disk unavailable"));
		await expect(context.library.RestoreTrashAsync(retained[0]!.id)).rejects.toThrow("disk unavailable");
		await expect(context.library.PurgeTrashAsync(retained[0]!.id)).rejects.toThrow("being restored");
		await expect(context.library.EmptyTrashAsync()).rejects.toThrow("Finish restoring");
		const restarted = new DreamLibrary(path.join(context.root, "Dreams"), context.dreams, context.signals, {} as never);
		const catalogue = await restarted.ListAsync();
		expect(catalogue.dreams[0]?.id).toBe(owner.id);
		expect(catalogue.dreams[0]?.signals).toHaveLength(1);
		expect(await restarted.ListTrashAsync()).toEqual([]);
	});

	it("permanently removes selected payloads and empties the remainder without touching live Dreams", async function PurgesTrashAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const command = { workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" };
		const first = await context.library.CreateAsync(command);
		const second = await context.library.CreateAsync(command);
		const live = await context.library.CreateAsync(command);
		await context.library.DeleteAsync(first.id);
		await context.library.DeleteAsync(second.id);
		const retained = await context.library.ListTrashAsync();
		await context.library.PurgeTrashAsync(retained[0]!.id);
		expect(await context.library.ListTrashAsync()).toHaveLength(1);
		await context.library.EmptyTrashAsync();
		expect(await context.library.ListTrashAsync()).toEqual([]);
		expect((await context.library.ListAsync()).dreams[0]?.id).toBe(live.id);
		await expect(context.library.PurgeTrashAsync("../escape")).rejects.toThrow("identifier");
	});

	it("removes uncommitted temporary trash payloads left by a process interruption", async function CleansUncommittedPayloadAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" });
		await context.library.DeleteAsync(owner.id);
		const retained = await context.library.ListTrashAsync();
		const directory = path.join(context.root, "Trash", "DreamBundles");
		const fileName = `${retained[0]!.id}.json`;
		const content = await readFile(path.join(directory, fileName), "utf8");
		await writeFile(path.join(directory, `${fileName}.01234567-0123-4123-8123-012345678901.tmp`), content, "utf8");
		const restarted = new DreamLibrary(path.join(context.root, "Dreams"), context.dreams, context.signals, {} as never);
		await restarted.ListAsync();
		expect(await readdir(directory)).toEqual([fileName]);
	});

	it("preserves overlapping Dream and Signal changes while another Dream remains writable", async function SerializesOwnedChangesAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const command = { workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" };
		const owner = await context.library.CreateAsync(command);
		const other = await context.library.CreateAsync(command);
		let release!: () => void;
		let started!: () => void;
		const blocked = new Promise<void>(function CaptureRelease(resolve): void { release = resolve; });
		const entered = new Promise<void>(function CaptureStarted(resolve): void { started = resolve; });
		const save = context.dreams.SaveAsync.bind(context.dreams);
		vi.spyOn(context.dreams, "SaveAsync").mockImplementationOnce(async function DelaySaveAsync(record, previous): Promise<void>
		{
			started();
			await blocked;
			await save(record, previous);
		});
		const update = context.library.UpdateAsync({ dreamId: owner.id, title: "", source: owner.source, reflection: "New reflection", linkedDreamIds: [] });
		await entered;
		const signal = context.library.CreateSignalAsync({ dreamId: owner.id, selection: owner.source });
		try
		{
			await context.library.UpdateAsync({ dreamId: other.id, title: "Independent", source: other.source, reflection: "", linkedDreamIds: [] });
		}
		finally
		{
			release();
		}
		await update;
		const createdSignal = await signal;
		const catalogue = await context.library.ListAsync();
		const savedOwner = catalogue.dreams.find(function FindOwner(dream): boolean { return dream.id === owner.id; });
		expect(savedOwner?.reflection).toBe("New reflection");
		expect(savedOwner?.signals).toEqual([createdSignal]);
	});

	it("continues queued changes after a failed save", async function ReleasesFailedMutationAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({ workId: "republic", dialogue: "Republic", source: CreateDream().source, folderPath: "" });
		const failure = new Error("Disk unavailable");
		vi.spyOn(context.dreams, "SaveAsync").mockRejectedValueOnce(failure);
		const command = { dreamId: owner.id, title: "", source: owner.source, reflection: "", linkedDreamIds: [] };
		const failed = context.library.UpdateAsync({ ...command, reflection: "Failed" });
		const next = context.library.UpdateAsync({ ...command, reflection: "Recovered" });
		const results = await Promise.allSettled([failed, next]);
		expect(results[0]).toEqual({ status: "rejected", reason: failure });
		expect(results[1].status).toBe("fulfilled");
		const catalogue = await context.library.ListAsync();
		expect(catalogue.dreams[0]?.reflection).toBe("Recovered");
	});

	it("creates Dreams through one main-process API", async function CreatesDreamAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const created = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const files = await readdir(path.join(context.root, "Dreams", "republic"));

		expect(created.id).not.toBe("");
		expect(created.signals).toEqual([]);
		expect(files).toEqual([`dream--${created.id}.md`]);
	});

	it("updates Dream fields without accepting renderer changes to owned Signals", async function PreservesSignalsAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const created = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const signal = await context.library.CreateSignalAsync({
			dreamId: created.id,
			selection: { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } }
		});
		const updated = await context.library.UpdateAsync({
			dreamId: created.id,
			title: "Attention",
			source: created.source,
			reflection: created.reflection,
			linkedDreamIds: created.linkedDreamIds
		});

		expect(updated.title).toBe("Attention");
		expect(updated.signals).toEqual([signal]);
	});

	it("creates, updates, and deletes Signals only through their owning Dream", async function ManagesOwnedSignalsAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const other = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const signal = await context.library.CreateSignalAsync({
			dreamId: owner.id,
			selection: { documentId: "republic", start: { segmentKey: "s1", offset: 1 }, end: { segmentKey: "s1", offset: 4 } }
		});

		await expect(context.library.UpdateSignalAsync({
			dreamId: other.id,
			signalId: signal.id,
			selections: signal.selections,
			description: "Invalid move"
		})).rejects.toThrow("does not belong");

		await context.library.DeleteSignalAsync({ dreamId: owner.id, signalId: signal.id });
		const catalogue = await context.library.ListAsync();
		expect(catalogue.dreams.find(function FindOwner(dream): boolean { return dream.id === owner.id; })?.signals).toEqual([]);
	});

	it("rejects Signal creation outside the owning Dream source", async function RejectsOutsideSignalAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const owner = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } },
			folderPath: ""
		});

		await expect(context.library.CreateSignalAsync({
			dreamId: owner.id,
			selection: { documentId: "republic", start: { segmentKey: "s2", offset: 0 }, end: { segmentKey: "s2", offset: 3 } }
		})).rejects.toThrow("inside its owning Dream source");
	});

	it("shares one catalogue load across concurrent refresh requests", async function SharesConcurrentLoadAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const dream = CreateDream();
		const dreamPath = path.join(context.root, "Dreams", "republic", "descent--dream-1.md");
		const signalPath = path.join(context.root, "republic", "Signals", "signal-1.md");
		const signal: SignalRecord = {
			id: "signal-1",
			dreamId: "dream-1",
			workId: "republic",
			sourceRef: "327a",
			selections: [{ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } }],
			text: "abc",
			description: "Concurrent observation",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		await mkdir(path.dirname(dreamPath), { recursive: true });
		await mkdir(path.dirname(signalPath), { recursive: true });
		await writeFile(dreamPath, SerializeDreamMarkdown(dream), "utf8");
		await writeFile(signalPath, new SignalMarkdownCodec().Serialize(signal), "utf8");

		const loads = await Promise.all([
			context.library.ListAsync(),
			context.library.ListAsync(),
			context.library.ListAsync()
		]);

		expect(loads).toHaveLength(3);
		expect(loads.every(function HasOneSignal(catalogue): boolean
		{
			return catalogue.dreams[0]?.signals.length === 1;
		})).toBe(true);
	});

	it("deletes a Dream and every Signal it owns", async function DeletesAggregateAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const dream = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const signal = await context.library.CreateSignalAsync({
			dreamId: dream.id,
			selection: { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } }
		});

		await context.library.DeleteAsync(dream.id);

		await expect(readFile(path.join(context.root, "republic", "Signals", `${signal.id}.md`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect((await context.library.ListAsync()).dreams).toEqual([]);
	});

	it("creates nested folders, moves Dreams, and blocks deletion until folders are empty", async function OrganizesDreamsAsync(): Promise<void>
	{
		const context = await CreateLibraryAsync();
		const dream = await context.library.CreateAsync({
			workId: "republic",
			dialogue: "Republic",
			source: CreateDream().source,
			folderPath: ""
		});
		const themes = await context.library.CreateFolderAsync({
			workId: "republic",
			parentPath: "",
			name: "Themes"
		});
		const justice = await context.library.CreateFolderAsync({
			workId: "republic",
			parentPath: themes.path,
			name: "Justice"
		});

		const moved = await context.library.MoveDreamAsync({
			dreamId: dream.id,
			folderPath: justice.path
		});
		const catalogue = await context.library.ListAsync();

		expect(moved.folderPath).toBe("Themes/Justice");
		expect(catalogue.folders).toEqual([themes, justice]);
		expect(catalogue.locations).toContainEqual(moved);
		await expect(readFile(path.join(context.root, "Dreams", "republic", "Themes", "Justice", `dream--${dream.id}.md`), "utf8")).resolves.toContain(dream.id);
		await expect(context.library.DeleteFolderAsync({ workId: "republic", folderPath: justice.path })).rejects.toThrow("must be empty");
		await expect(context.library.DeleteFolderAsync({ workId: "republic", folderPath: themes.path })).rejects.toThrow("must be empty");

		await context.library.MoveDreamAsync({ dreamId: dream.id, folderPath: "" });
		await context.library.DeleteFolderAsync({ workId: "republic", folderPath: justice.path });
		await context.library.DeleteFolderAsync({ workId: "republic", folderPath: themes.path });
		await expect(readdir(path.join(context.root, "Dreams", "republic", "Themes"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("Dream Markdown", function DreamMarkdownTests()
{
	it("round trips Dream fields without persisting hydrated child records", function RoundTripsDream(): void
	{
		const dream = CreateDream("greek", "Πρόσοψις");
		const parsed = ParseDreamMarkdown(SerializeDreamMarkdown(dream));

		expect(parsed).toEqual(dream);
	});

	it("validates child Signal ownership", function ValidatesOwnership(): void
	{
		const signal: SignalRecord = {
			id: "signal-1",
			dreamId: "other",
			workId: "republic",
			sourceRef: "327a",
			selections: [{ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 3 } }],
			text: "abc",
			description: "",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};

		expect(function CreateInvalidDream(): Dream
		{
			return new Dream({ ...CreateDream(), signals: [signal] });
		}).toThrow("does not belong");
	});
});
