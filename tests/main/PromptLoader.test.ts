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

	it("loads the Clarity Check prompt from its packaged resource name", async function LoadsClarityCheckPromptAsync()
	{
		const loader = new PromptLoader(path.join(process.cwd(), "Prompts"));

		const prompt = await loader.LoadAsync("clarity-check");

		expect(prompt).toContain("Account for every Signal");
		expect(prompt).toContain("overarching logos");
		expect(prompt).toContain("Do not reinterpret, rewrite, improve, or correct");
		expect(prompt).toContain("identify that exact gap without inventing a connection");
	});
});
