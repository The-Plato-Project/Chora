import { describe, expect, it } from "vitest";
import { OrderSignalsByText } from "../../src/shared/signals/SignalOrder.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Creates one Signal anchored to the requested document segment.
function CreateSignal(id: string, stephanus: string): SignalRecord
{
	const signal: SignalRecord = {
		id,
		workId: "republic",
		sourceRef: stephanus,
		selections: [{
			dialogue: "republic", text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus, offset: 0 },
			end: { stephanus, offset: 3 }
		}],
		text: id,
		description: "",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

// Adds a later passage without changing the Signal's original main passage.
function AddPassage(signal: SignalRecord, stephanus: string): SignalRecord
{
	const updated: SignalRecord = {
		...signal,
		selections: [
			...signal.selections,
			{
				dialogue: "republic", text_version: `sha256:${"0".repeat(64)}`,
				start: { stephanus, offset: 0 },
				end: { stephanus, offset: 3 }
			}
		]
	};

	return updated;
}

// Creates a text whose segment sequence defines canonical Signal order.
function CreateDocument(): TextDocument
{
	const document = new TextDocument({
		id: "republic",
		textVersion: `sha256:${"0".repeat(64)}`,
		urn: null,
		title: "Republic",
		titleGreek: null,
		author: "Plato",
		language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
		segments: [
			{ key: "327a", citation: null, text: "one" },
			{ key: "327b", citation: null, text: "two" },
			{ key: "327c", citation: null, text: "three" }
		]
	});

	return document;
}

describe("Signal order", function SignalOrderTests()
{
	it("orders Signals by their positions in the text instead of association order", function OrdersByText(): void
	{
		const signals = [
			CreateSignal("third-signal", "327c"),
			CreateSignal("first-signal", "327a"),
			CreateSignal("second-signal", "327b")
		];
		const ordered = OrderSignalsByText(CreateDocument(), signals);
		const identities = ordered.map(function SelectIdentity(signal): string
		{
			return signal.id;
		});

		expect(identities).toEqual(["first-signal", "second-signal", "third-signal"]);
	});

	it("does not reorder a Signal by a passage added after its main passage", function PreservesMainPassageOrder(): void
	{
		const signals = [
			AddPassage(CreateSignal("third-signal", "327c"), "327a"),
			CreateSignal("second-signal", "327b")
		];
		const ordered = OrderSignalsByText(CreateDocument(), signals);
		const identities = ordered.map(function SelectIdentity(signal): string
		{
			return signal.id;
		});

		expect(identities).toEqual(["second-signal", "third-signal"]);
	});
});
