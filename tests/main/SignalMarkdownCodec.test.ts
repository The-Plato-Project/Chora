import { describe, expect, it } from "vitest";
import { SignalMarkdownCodec } from "../../src/main/signals/SignalMarkdownCodec.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

describe("SignalMarkdownCodec", function SignalMarkdownCodecTests()
{
	it("round trips canonical Signal text and description", function RoundTripsSignal()
	{
		const codec = new SignalMarkdownCodec();
		const signal: SignalRecord = {
			id: "signal-1",
			dreamId: "dream-1",
			workId: "republic",
			sourceRef: "327a",
			title: "Descent",
			selections: [{
				dialogue: "republic",
				text_version: `sha256:${"0".repeat(64)}`,
				start: { stephanus: "327a", offset: 0 },
				end: { stephanus: "327a", offset: 8 }
			}],
			text: "κατέβην",
			description: "A movement downward.",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-02"
		};

		const markdown = codec.Serialize(signal);
		const parsed = codec.Parse(markdown);

		expect(parsed).toEqual(signal);
		expect(markdown).toContain("sourceRef: 327a");
		expect(markdown).toContain("text_version: 'sha256:");
		expect(markdown).toContain("text:");
	});

	it("rejects Signal metadata without canonical selections", function RejectsMissingSelections(): void
	{
		const codec = new SignalMarkdownCodec();
		const content = `---
id: signal-1
workId: republic
sourceRef: 327a
createdAt: 2026-01-01
updatedAt: 2026-01-02
---
Observation.
`;

		function ParseInvalidSignal(): void
		{
			codec.Parse(content);
		}

		expect(ParseInvalidSignal).toThrow("Signal Markdown is missing required metadata");
	});

	it("rejects Signal metadata without one explicit Dream owner", function RejectsMissingOwner(): void
	{
		const codec = new SignalMarkdownCodec();
		const content = `---
id: signal-1
workId: republic
selections:
  - documentId: republic
    start:
      stephanus: 327a
      offset: 0
    end:
      stephanus: 327a
      offset: 8
createdAt: 2026-01-01
updatedAt: 2026-01-02
---
Observation.
`;

		function ParseOwnerlessSignal(): void
		{
			codec.Parse(content);
		}

		expect(ParseOwnerlessSignal).toThrow("Signal Markdown is missing required metadata");
	});
});
