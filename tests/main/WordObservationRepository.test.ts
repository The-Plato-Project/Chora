import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WordObservationRepository } from "../../src/main/library/WordObservationRepository.js";

const directories: string[] = [];

afterEach(async function CleanupAsync(): Promise<void>
{
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("WordObservationRepository", function WordObservationRepositoryTests()
{
	it("persists notes by dialogue version and lemma", async function PersistsScopedObservationAsync(): Promise<void>
	{
		const directory = await mkdtemp(path.join(tmpdir(), "chora-word-observations-"));
		directories.push(directory);
		const version = `sha256:${"0".repeat(64)}`;
		const republic = { dialogue: "republic", textVersion: version, lemma: "καταβαίνω" };
		const laws = { dialogue: "laws", textVersion: version, lemma: "καταβαίνω" };
		const repository = new WordObservationRepository(directory);

		expect(await repository.GetAsync(republic)).toEqual({ ...republic, text: "" });
		await Promise.all([
			repository.SaveAsync({ ...republic, text: "A descent in the Republic." }),
			repository.SaveAsync({ ...laws, text: "A separate observation in the Laws." })
		]);

		const reloaded = new WordObservationRepository(directory);
		expect((await reloaded.GetAsync(republic)).text).toBe("A descent in the Republic.");
		expect((await reloaded.GetAsync(laws)).text).toBe("A separate observation in the Laws.");

		await reloaded.SaveAsync({ ...republic, text: "" });
		expect((await new WordObservationRepository(directory).GetAsync(republic)).text).toBe("");
		expect((await new WordObservationRepository(directory).GetAsync(laws)).text)
			.toBe("A separate observation in the Laws.");
	});
});
