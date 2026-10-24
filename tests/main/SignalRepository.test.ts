import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SignalMarkdownCodec } from "../../src/main/signals/SignalMarkdownCodec.js";
import { SignalRepository } from "../../src/main/signals/SignalRepository.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Contains temporary repository roots removed after each test.
const temporaryRoots: string[] = [];

// Creates one canonical Signal record with a caller-selected description.
function CreateSignal(description: string): SignalRecord
{
	return {
		id: "signal-1",
		workId: "republic",
		sourceRef: "327a",
		selections: [{
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 3 }
		}],
		text: "abc",
		description,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};
}

afterEach(async function RemoveTemporaryRootsAsync(): Promise<void>
{
	for (const root of temporaryRoots) await rm(root, { recursive: true, force: true });
	temporaryRoots.length = 0;
});

describe("SignalRepository", function SignalRepositoryTests()
{
	it("uses independent temporary files for overlapping saves", async function SavesConcurrentlyAsync(): Promise<void>
	{
		const root = await mkdtemp(path.join(os.tmpdir(), "chora-signals-"));
		temporaryRoots.push(root);
		const codec = new SignalMarkdownCodec();
		const repository = new SignalRepository(root, codec);
		const descriptions = ["First", "Second", "Third", "Fourth"];
		const saves: Promise<void>[] = [];

		for (const description of descriptions)
		{
			saves.push(repository.SaveAsync(CreateSignal(description)));
		}

		await Promise.all(saves);
		const directory = path.join(root, "republic", "Signals");
		const entries = await readdir(directory);
		expect(entries).toEqual(["signal-1.md"]);
		const content = await readFile(path.join(directory, "signal-1.md"), "utf8");
		expect(descriptions).toContain(codec.Parse(content).description);
	});
});
