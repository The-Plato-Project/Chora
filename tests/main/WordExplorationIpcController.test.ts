import { describe, expect, it } from "vitest";

import { ParseResearchSourceUrl } from "../../src/main/library/WordExplorationIpcController.js";

describe("WordExplorationIpcController", function WordExplorationIpcControllerTests()
{
	it("allows the configured scholarly research sources", function AllowsResearchSources(): void
	{
		const urls = [
			"https://humanisticadigitalia.eu/GreekTexts/Plato/#p-polemarchus",
			"https://athnames.org/r4.php?id=69789",
			"https://www.perseus.tufts.edu/hopper/text?doc=sample"
		];
		for (const value of urls)
		{
			expect(ParseResearchSourceUrl(value).toString()).toBe(value);
		}
	});

	it("rejects removed or unsafe sources", function RejectsUnsafeSources(): void
	{
		expect(() => ParseResearchSourceUrl("https://en.wikipedia.org/wiki/Polemarchus"))
			.toThrow("not allowed");
		expect(() => ParseResearchSourceUrl("http://athnames.org/r4.php?id=69789"))
			.toThrow("not allowed");
		expect(() => ParseResearchSourceUrl("https://athnames.org.example.com/"))
			.toThrow("not allowed");
	});
});
