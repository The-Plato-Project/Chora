import { describe, expect, it } from "vitest";
import { IdeaMarkdownCodec } from "../../src/main/ideas/IdeaMarkdownCodec.js";

describe("IdeaMarkdownCodec", function IdeaMarkdownCodecTests()
{
	it("loads current origin and related Signal references", function LoadsSignalReferences()
	{
		const codec = new IdeaMarkdownCodec();
		const markdown = `---
id: idea-1
workId: republic
originSignal:
  signalId: origin
relatedSignals:
  - signalId: related-1
  - signalId: related-2
createdAt: "2026-01-01T00:00:00.000Z"
updatedAt: "2026-01-01T00:00:00.000Z"
---
# Idea

An interpretation.
`;
		const record = codec.Parse(markdown);

		expect(record.originSignal).toEqual({ signalId: "origin" });
		expect(record.relatedSignals).toEqual([
			{ signalId: "related-1" },
			{ signalId: "related-2" }
		]);
	});

	it("rejects invalid Signal references explicitly", function RejectsInvalidReferences()
	{
		const codec = new IdeaMarkdownCodec();
		const markdown = `---
id: idea-1
workId: republic
originSignal:
  dreamId: dream-1
relatedSignals: []
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
---
# Invalid Idea
`;

		function ParseInvalidIdea(): void
		{
			codec.Parse(markdown);
		}

		expect(ParseInvalidIdea).toThrow("Idea Markdown contains an invalid Signal reference");
	});

	it("round-trips Idea-owned Signal rationales without changing the shared Signal", function PersistsRationale()
	{
		const codec = new IdeaMarkdownCodec();
		const markdown = codec.Serialize({
			id: "idea-1",
			workId: "republic",
			title: "Exchange",
			content: "Meaning moves between sources.",
			originSignal: {
				signalId: "signal-1",
				rationale: "The observation treats exchange as movement between speakers."
			},
			relatedSignals: [{ signalId: "signal-2" }],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z"
		});
		const record = codec.Parse(markdown);

		expect(record.originSignal).toEqual({
			signalId: "signal-1",
			rationale: "The observation treats exchange as movement between speakers."
		});
		expect(record.relatedSignals).toEqual([{ signalId: "signal-2" }]);
		expect(markdown).toContain("rationale: The observation treats exchange as movement between speakers.");
	});
});
