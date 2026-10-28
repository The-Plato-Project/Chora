import { describe, expect, it } from "vitest";
import { Signal } from "../../src/main/signals/Signal.js";
import type { CreateSignalCommand, UpdateSignalCommand } from "../../src/shared/signals/SignalTypes.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

// Creates the canonical document that owns a test Signal.
function CreateDocument(text: string): TextDocument
{
	return new TextDocument({
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
}

// Creates one Dream-owned Signal command.
function CreateCommand(endOffset: number): CreateSignalCommand
{
	return {
		dreamId: "dream-1",
		selection: {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: endOffset }
		}
	};
}

describe("Signal", function SignalTests()
{
	it("creates a Signal inside one immutable Dream", function CreatesOwnedSignal(): void
	{
		const text = "one two three four five six seven eight nine ten";
		const signal = Signal.Create(CreateCommand(text.length), "signal-1", "2026-10-11", CreateDocument(text)).ToRecord();

		expect(signal.dreamId).toBe("dream-1");
		expect(signal.text).toBe(text);
	});

	it("rejects empty selections", function RejectsEmptySignal(): void
	{
		expect(function CreateEmptySignal(): Signal
		{
			return Signal.Create(CreateCommand(3), "signal-1", "2026-10-11", CreateDocument("   "));
		}).toThrow("must not be empty");
	});

	it("does not permit a Signal to move between Dreams", function RejectsDreamMove(): void
	{
		const document = CreateDocument("alpha beta");
		const signal = Signal.Create(CreateCommand(5), "signal-1", "2026-10-11", document);
		const command: UpdateSignalCommand = {
			dreamId: "dream-2",
			signalId: "signal-1",
			selections: signal.ToRecord().selections,
			description: ""
		};

		expect(function MoveSignal(): Signal
		{
			return signal.Update(command, "2026-10-12", document);
		}).toThrow("cannot move between Dreams");
	});

	it("keeps the first-created passage as the main passage", function PreservesMainPassage(): void
	{
		const document = CreateDocument("alpha beta gamma");
		const main = { documentId: "republic", start: { segmentKey: "s1", offset: 11 }, end: { segmentKey: "s1", offset: 16 } };
		const earlier = { documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 5 } };
		const original = Signal.Create({ dreamId: "dream-1", selection: main }, "signal-1", "2026-10-11", document);
		const updated = original.Update({
			dreamId: "dream-1",
			signalId: "signal-1",
			selections: [earlier, main],
			description: ""
		}, "2026-10-12", document).ToRecord();

		expect(updated.title).toBe("gamma");
		expect(updated.text).toBe("gamma … alpha");
		expect(updated.selections.map(function SelectOffset(selection): number { return selection.start.offset; })).toEqual([11, 0]);
	});

	it("merges overlapping later passages without replacing the main passage", function MergesComponents(): void
	{
		const document = CreateDocument("alpha beta gamma");
		const original = Signal.Create(CreateCommand(5), "signal-1", "2026-10-11", document);
		const updated = original.Update({
			dreamId: "dream-1",
			signalId: "signal-1",
			selections: [
				original.ToRecord().selections[0]!,
				{ documentId: "republic", start: { segmentKey: "s1", offset: 6 }, end: { segmentKey: "s1", offset: 10 } },
				{ documentId: "republic", start: { segmentKey: "s1", offset: 9 }, end: { segmentKey: "s1", offset: 16 } }
			],
			description: ""
		}, "2026-10-12", document).ToRecord();

		expect(updated.selections).toHaveLength(2);
		expect(updated.text).toBe("alpha … beta gamma");
	});
});
