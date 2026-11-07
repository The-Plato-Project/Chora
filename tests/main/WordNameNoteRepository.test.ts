import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WordNameNoteRepository } from "../../src/main/library/WordNameNoteRepository.js";

const directories: string[] = [];

afterEach(async function CleanupAsync(): Promise<void>
{
	await Promise.all(directories.splice(0).map(
		(directory) => rm(directory, { recursive: true, force: true })));
});

describe("WordNameNoteRepository", function NameNoteRepositoryTests()
{
	it("stores one note per dialogue and lemma and removes empty notes", async function PersistsNotesAsync(): Promise<void>
	{
		const directory = await mkdtemp(path.join(tmpdir(), "chora-name-notes-"));
		directories.push(directory);
		const repository = new WordNameNoteRepository(directory);
		await repository.SaveAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς",
			text: "The port frames the opening descent."
		});
		await repository.SaveAsync({
			dialogue: "laws",
			lemma: "Πειραιεύς",
			text: "A separate note."
		});

		const reloaded = new WordNameNoteRepository(directory);
		expect((await reloaded.GetAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς"
		})).text).toBe("The port frames the opening descent.");
		expect((await reloaded.GetAsync({
			dialogue: "laws",
			lemma: "Πειραιεύς"
		})).text).toBe("A separate note.");

		await reloaded.SaveAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς",
			text: ""
		});
		expect((await reloaded.GetAsync({
			dialogue: "republic",
			lemma: "Πειραιεύς"
		})).text).toBe("");
	});
});
