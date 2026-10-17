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
			workId: "republic",
			sourceRef: "327a",
			selection: {
				documentId: "republic",
				start: { segmentKey: "327a", offset: 0 },
				end: { segmentKey: "327a", offset: 8 }
			},
			text: "κατέβην",
			description: "A movement downward.",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-02"
		};

		const parsed = codec.Parse(codec.Serialize(signal));

		expect(parsed).toEqual({
			...signal,
			text: ""
		});
	});
});
