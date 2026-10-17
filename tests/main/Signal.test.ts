import { describe, expect, it } from "vitest";
import { Signal } from "../../src/main/signals/Signal.js";
import type { SaveSignalCommand } from "../../src/shared/signals/SignalTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Creates one new-Signal command with the requested selected text.
function CreateCommand(selectedText: string): SaveSignalCommand
{
	const command: SaveSignalCommand = {
		signalId: null,
		workId: "republic",
		selection: {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: selectedText.length }
		},
		description: ""
	};

	return command;
}

// Creates the canonical document that owns a test Signal.
function CreateDocument(text: string): TextDocument
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
		segments: [{ key: "s1", citation: { system: "stephanus", value: "327a" }, text }]
	});

	return document;
}

describe("Signal", function SignalTests()
{
	it("creates Signals from selections of any length", function CreatesLongSignal(): void
	{
		const text = "one two three four five six seven eight nine ten";
		const signal = Signal.Create(CreateCommand(text), "signal-1", "2026-10-11", CreateDocument(text));

		expect(signal.ToRecord().text).toBe(text);
	});

	it("rejects empty selections", function RejectsEmptySignal(): void
	{
		expect(function CreateEmptySignal(): Signal
		{
			return Signal.Create(CreateCommand("   "), "signal-1", "2026-10-11", CreateDocument("   "));
		}).toThrow("must not be empty");
	});

	it("creates long Greek Signals without lexical filtering", function CreatesLongGreekSignal(): void
	{
		const text = "λόγος ἄνθρωπος πόλις ψυχή θεός νόμος ἀλλὰ τοῖσδέ τε τοῖς νεανίσκοις σύνισθι";
		const signal = Signal.Create(CreateCommand(text), "signal-1", "2026-10-11", CreateDocument(text));

		expect(signal.ToRecord().text).toBe(text);
	});
});
