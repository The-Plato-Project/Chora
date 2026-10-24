import { describe, expect, it } from "vitest";
import { OrderSignalsByText } from "../../src/shared/signals/SignalOrder.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Creates one Signal anchored to the requested document segment.
function CreateSignal(id: string, segmentKey: string): SignalRecord
{
	const signal: SignalRecord = {
		id,
		workId: "republic",
		sourceRef: segmentKey,
		selections: [{
			documentId: "republic",
			start: { segmentKey, offset: 0 },
			end: { segmentKey, offset: 3 }
		}],
		text: id,
		description: "",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

// Creates a text whose segment sequence defines canonical Signal order.
function CreateDocument(): TextDocument
{
	const document = new TextDocument({
		id: "republic",
		urn: null,
		title: "Republic",
		titleGreek: null,
		author: "Plato",
		language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
		segments: [
			{ key: "first", citation: null, text: "one" },
			{ key: "second", citation: null, text: "two" },
			{ key: "third", citation: null, text: "three" }
		]
	});

	return document;
}

describe("Signal order", function SignalOrderTests()
{
	it("orders Signals by their positions in the text instead of association order", function OrdersByText(): void
	{
		const signals = [
			CreateSignal("third-signal", "third"),
			CreateSignal("first-signal", "first"),
			CreateSignal("second-signal", "second")
		];
		const ordered = OrderSignalsByText(CreateDocument(), signals);
		const identities = ordered.map(function SelectIdentity(signal): string
		{
			return signal.id;
		});

		expect(identities).toEqual(["first-signal", "second-signal", "third-signal"]);
	});
});
