import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IdeaLibrary, type IdeaSignalAccess } from "../../src/main/ideas/IdeaLibrary.js";
import { IdeaMarkdownCodec } from "../../src/main/ideas/IdeaMarkdownCodec.js";
import { IdeaRepository } from "../../src/main/ideas/IdeaRepository.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { IdeaSignalReference, SaveIdeaCommand } from "../../src/shared/ideas/IdeaTypes.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Tracks temporary Idea libraries created by this test suite.
const Directories: string[] = [];

// Creates one complete Signal fixture.
function CreateSignal(id: string): SignalRecord
{
	const signal: SignalRecord = {
		id,
		workId: "republic",
		sourceRef: `source-${id}`,
		selection: {
			documentId: "republic",
			start: { segmentKey: id, offset: 0 },
			end: { segmentKey: id, offset: 3 }
		},
		text: id,
		description: `Description ${id}`,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

// Creates one complete DreamView fixture with the requested Signals.
function CreateDream(id: string, workId: string, signalIds: readonly string[]): DreamView
{
	const source = CreateSignal("source").selection;
	const signals: SignalRecord[] = [];

	for (const signalId of signalIds)
	{
		const signal = CreateSignal(signalId);
		signals.push(signal);
	}

	const dream: DreamView = {
		id,
		workId,
		dialogue: "Republic",
		title: `Dream ${id}`,
		source: {
			...source,
			sourceRefs: ["source"],
			startSourceRef: "source",
			endSourceRef: "source"
		},
		signals,
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z"
	};

	return dream;
}

// Creates one Signal reference fixture.
function CreateReference(dreamId: string, signalId: string): IdeaSignalReference
{
	void dreamId;
	const reference: IdeaSignalReference = { signalId };

	return reference;
}

// Creates one narrow save command without authoritative metadata.
function CreateSaveCommand(
	originSignal: IdeaSignalReference,
	relatedSignals: readonly IdeaSignalReference[],
	ideaId: string | null = null): SaveIdeaCommand
{
	const command: SaveIdeaCommand = {
		ideaId,
		workId: "republic",
		title: "The Descent",
		content: "A durable interpretation.",
		originSignal,
		relatedSignals
	};

	return command;
}

// Provides deterministic Dreams to the Idea library.
class StubSignalAccess implements IdeaSignalAccess
{
	// Creates the DreamView fixture boundary.
	public constructor(private readonly dreams: readonly DreamView[])
	{
	}

	// Lists cloned DreamView fixtures.
	public async ListAsync(workId: string): Promise<SignalRecord[]>
	{
		const signals: SignalRecord[] = [];

		for (const dream of this.dreams)
		{
			if (dream.workId === workId)
			{
				for (const signal of dream.signals)
				{
					signals.push({
						...structuredClone(signal),
						workId: dream.workId,
						createdAt: dream.createdAt,
						updatedAt: dream.updatedAt
					});
				}
			}
		}

		return signals;
	}

	public async DeleteIfOrphanedAsync(): Promise<void>
	{
		await Promise.resolve();
	}
}

// Creates one temporary authoritative Idea library.
async function CreateLibraryAsync(dreams: readonly DreamView[]): Promise<IdeaLibrary>
{
	const temporaryRoot = path.join(os.tmpdir(), "chora-ideas-");
	const directory = await mkdtemp(temporaryRoot);
	Directories.push(directory);
	const codec = new IdeaMarkdownCodec();
	const repository = new IdeaRepository(directory, codec);
	const library = new IdeaLibrary(repository, new StubSignalAccess(dreams));

	return library;
}

// Removes all temporary Idea libraries.
async function RemoveDirectoriesAsync(): Promise<void>
{
	const directories = Directories.splice(0);

	for (const directory of directories)
	{
		await rm(directory, { recursive: true, force: true });
	}
}

describe("IdeaLibrary", function IdeaLibraryTests()
{
	afterEach(RemoveDirectoriesAsync);

	it("persists and reloads an Idea-owned Signal rationale", async function PersistsSingleSignalIdeaAsync()
	{
		const dreams = [CreateDream("dream-1", "republic", ["signal-1"])];
		const library = await CreateLibraryAsync(dreams);
		const origin: IdeaSignalReference = {
			...CreateReference("dream-1", "signal-1"),
			rationale: "The descent gives the Idea its governing movement."
		};
		const command = CreateSaveCommand(origin, []);
		const saved = await library.SaveAsync(command);
		const reloaded = await library.ListAsync("republic");
		expect(saved.originSignal).toEqual(origin);
		expect(saved.relatedSignals).toEqual([]);
		expect(saved.id.length).toBeGreaterThan(0);
		expect(saved.createdAt).toBe(saved.updatedAt);
		expect(reloaded[0]?.originSignal).toEqual(origin);
	});

	it("persists an Idea placeholder without Signals", async function PersistsPlaceholderIdeaAsync()
	{
		const library = await CreateLibraryAsync([]);
		const command: SaveIdeaCommand = {
			ideaId: null,
			workId: "republic",
			title: "Questions of justice",
			content: "",
			originSignal: null,
			relatedSignals: []
		};

		const saved = await library.SaveAsync(command);

		expect(saved.originSignal).toBeNull();
		expect(saved.relatedSignals).toEqual([]);
	});

	it("rejects unresolved and foreign-work Signals while allowing reordered associations", async function RejectsInvalidSignalsAsync()
	{
		const dreams = [
			CreateDream("dream-1", "republic", ["signal-1", "signal-2", "signal-3"]),
			CreateDream("dream-2", "symposium", ["foreign"])
		];
		const library = await CreateLibraryAsync(dreams);
		const deletedSignal = CreateSaveCommand(
			CreateReference("dream-1", "deleted"),
			[CreateReference("dream-1", "signal-2"), CreateReference("dream-1", "signal-3")]);
		const deletedResult = library.SaveAsync(deletedSignal);
		await expect(deletedResult).rejects.toThrow("unresolved");

		const foreignSignal = CreateSaveCommand(
			CreateReference("dream-1", "signal-1"),
			[CreateReference("dream-2", "foreign"), CreateReference("dream-1", "signal-3")]);
		const foreignResult = library.SaveAsync(foreignSignal);
		await expect(foreignResult).rejects.toThrow("is unresolved");

		const saved = await library.SaveAsync(CreateSaveCommand(
			CreateReference("dream-1", "signal-1"),
			[CreateReference("dream-1", "signal-2"), CreateReference("dream-1", "signal-3")]));
		const changedOrigin = CreateSaveCommand(
			CreateReference("dream-1", "signal-2"),
			[CreateReference("dream-1", "signal-1"), CreateReference("dream-1", "signal-3")],
			saved.id);
		const changedOriginResult = await library.SaveAsync(changedOrigin);
		expect(changedOriginResult.originSignal).toEqual(CreateReference("dream-1", "signal-2"));
	});

	it("writes origin-first Markdown and safely renames by title", async function RenamesMarkdownAsync()
	{
		const origin = CreateReference("dream-1", "signal-1");
		const related = [
			CreateReference("dream-1", "signal-2"),
			CreateReference("dream-1", "signal-3")
		];
		const dreams = [CreateDream("dream-1", "republic", ["signal-1", "signal-2", "signal-3"])];
		const library = await CreateLibraryAsync(dreams);
		const saved = await library.SaveAsync(CreateSaveCommand(origin, related));
		const directory = Directories[0];

		if (directory === undefined)
		{
			throw new Error("Missing test directory");
		}

		const ideasPath = path.join(directory, "republic", "Ideas");
		const firstFileName = `the-descent--${saved.id}.md`;
		const firstFiles = await readdir(ideasPath);
		expect(firstFiles).toEqual([firstFileName]);
		const firstPath = path.join(ideasPath, firstFileName);
		const markdown = await readFile(firstPath, "utf8");
		expect(markdown).toContain("# The Descent");
		expect(markdown).toContain("originSignal:");
		expect(markdown).toContain("relatedSignals:");

		const update = {
			...CreateSaveCommand(origin, related, saved.id),
			title: "Another Name"
		};
		await library.SaveAsync(update);
		const renamedFiles = await readdir(ideasPath);
		expect(renamedFiles).toEqual([`another-name--${saved.id}.md`]);
	});
});
