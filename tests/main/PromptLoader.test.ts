import { describe, expect, it } from "vitest";
import path from "node:path";
import { PromptLoader } from "../../src/main/prompts/PromptLoader.js";

describe("prompt loading", function PromptLoaderTests()
{
	it("rejects unsafe prompt names", async function RejectsUnsafeNames()
	{
		const loader = new PromptLoader(path.join(process.cwd(), "Prompts"));

		await expect(loader.LoadAsync("../secret")).rejects.toThrow("Prompt names may contain only");
	});

	it("loads the Dream discussion prompt from its packaged resource name", async function LoadsDreamDiscussionPromptAsync()
	{
		const loader = new PromptLoader(path.join(process.cwd(), "Prompts"));

		const prompt = await loader.LoadAsync("dream-discussion");

		expect(prompt.length).toBeGreaterThan(0);
	});
});
