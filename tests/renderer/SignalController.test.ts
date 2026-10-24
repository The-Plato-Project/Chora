// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SignalController } from "../../src/renderer/signals/SignalController.js";
import { SignalGateway } from "../../src/renderer/signals/SignalGateway.js";
import { SignalStore } from "../../src/renderer/signals/SignalStore.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Creates one canonical Signal fixture.
function CreateSignal(): SignalRecord
{
	const signal: SignalRecord = {
		id: "signal-1",
		workId: "republic",
		sourceRef: "327a",
		selections: [{
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 7 },
			selectedText: "κατέβην",
			locatorStart: { scheme: "Stephanus", value: "327a" },
			locatorEnd: { scheme: "Stephanus", value: "327a" }
		}],
		text: "κατέβην",
		description: "Initial observation",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

describe("SignalController", function SignalControllerTests()
{
	afterEach(function Cleanup(): void
	{
		vi.unstubAllGlobals();
	});

	it("publishes canonical edits so Dream and Idea projections can refresh", async function PublishesSignalChangesAsync()
	{
		const signal = CreateSignal();
		const preceding: SignalRecord = {
			...signal,
			id: "signal-before",
			selections: [{
				...signal.selections[0],
				start: { segmentKey: "s1", offset: 0 },
				end: { segmentKey: "s1", offset: 3 }
			}],
			text: "κατ"
		};
		const following: SignalRecord = {
			...signal,
			id: "signal-after",
			selections: [{
				...signal.selections[0],
				start: { segmentKey: "s1", offset: 10 },
				end: { segmentKey: "s1", offset: 17 }
			}],
			text: "Πειραιᾶ"
		};
		const saved: SignalRecord = {
			...signal,
			description: "Updated from the Idea",
			updatedAt: "2026-01-02"
		};
		vi.stubGlobal("window", {
			chora: {
				SaveSignal: vi.fn(async function SaveSignal(): Promise<SignalRecord>
				{
					return structuredClone(saved);
				})
			}
		});
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new SignalStore();
		store.SetWork("republic", [preceding, signal, following]);
		const controller = new SignalController(errors, store, new SignalGateway(), events);
		let changed: SignalRecord | null = null;

		// Captures the authoritative Signal-change notification.
		async function CaptureChange(event: ChoraEvents["signal.changed"]): Promise<void>
		{
			changed = event.signal;
			await Promise.resolve();
		}

		events.Subscribe("signal.changed", CaptureChange);

		await controller.UpdateDescriptionAsync(signal.id, saved.description);

		expect(store.GetSignal(signal.id)?.description).toBe(saved.description);
		expect(store.GetSignals().map(function SelectId(record): string { return record.id; })).toEqual([
			preceding.id,
			signal.id,
			following.id
		]);
		expect(changed?.description).toBe(saved.description);
	});

	it("creates Signals from selections longer than five words", async function CreatesLongSelectionsAsync()
	{
		const selectedText = "one two three four five six seven eight nine ten";
		const saved: SignalRecord = {
			...CreateSignal(),
			selections: [{
				...CreateSignal().selections[0],
				end: { segmentKey: "s1", offset: selectedText.length },
				selectedText
			}],
			text: selectedText
		};
		const saveSignal = vi.fn(async function SaveSignal(): Promise<SignalRecord>
		{
			return structuredClone(saved);
		});
		vi.stubGlobal("window", { chora: { SaveSignal: saveSignal } });
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new SignalStore();
		const controller = new SignalController(errors, store, new SignalGateway(), events);

		const signal = await controller.CreateAsync(saved.selections[0]!);

		expect(signal?.text).toBe(selectedText);
		expect(saveSignal).toHaveBeenCalledOnce();
	});

	it("creates a Signal when Greek function words surround focused content", async function CreatesGreekPhraseAsync()
	{
		const selectedText = "ἀλλὰ τοῖσδέ τε τοῖς νεανίσκοις σύνισθι";
		const saved: SignalRecord = {
			...CreateSignal(),
			selections: [{
				...CreateSignal().selections[0],
				end: { segmentKey: "s1", offset: selectedText.length },
				selectedText
			}],
			text: selectedText
		};
		const saveSignal = vi.fn(async function SaveSignal(): Promise<SignalRecord>
		{
			return structuredClone(saved);
		});
		vi.stubGlobal("window", { chora: { SaveSignal: saveSignal } });
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new SignalStore();
		const controller = new SignalController(errors, store, new SignalGateway(), events);

		const signal = await controller.CreateAsync(saved.selections[0]!);

		expect(signal?.text).toBe(selectedText);
		expect(saveSignal).toHaveBeenCalledWith(expect.objectContaining({
			selections: [expect.objectContaining({ selectedText })]
		}));
	});

	it("adds another component to an existing Signal", async function AddsSelectionAsync(): Promise<void>
	{
		const existing = CreateSignal();
		const added = {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 10 },
			end: { segmentKey: "s1", offset: 17 }
		};
		const saved: SignalRecord = {
			...existing,
			selections: [...existing.selections, added],
			text: "κατέβην … Πειραιᾶ"
		};
		const saveSignal = vi.fn(async function SaveSignal(): Promise<SignalRecord>
		{
			return structuredClone(saved);
		});
		vi.stubGlobal("window", { chora: { SaveSignal: saveSignal } });
		const events = new ChoraEventBus<ChoraEvents>();
		const store = new SignalStore();
		store.SetWork("republic", [existing]);
		const controller = new SignalController(new ErrorManager(events), store, new SignalGateway(), events);

		await controller.AddSelectionAsync(existing.id, added);

		expect(saveSignal).toHaveBeenCalledWith(expect.objectContaining({
			signalId: existing.id,
			selections: [existing.selections[0], added]
		}));
		expect(store.GetSignal(existing.id)?.selections).toHaveLength(2);
	});

	it("renames a Signal without changing its passages", async function RenamesSignalAsync(): Promise<void>
	{
		const existing = CreateSignal();
		const saved = { ...existing, title: "Descent" };
		const saveSignal = vi.fn(async function SaveSignal(): Promise<SignalRecord> { return saved; });
		vi.stubGlobal("window", { chora: { SaveSignal: saveSignal } });
		const events = new ChoraEventBus<ChoraEvents>();
		const store = new SignalStore();
		store.SetWork("republic", [existing]);
		const controller = new SignalController(new ErrorManager(events), store, new SignalGateway(), events);

		await controller.UpdateTitleAsync(existing.id, "  Descent  ");

		expect(saveSignal).toHaveBeenCalledWith(expect.objectContaining({
			title: "Descent",
			selections: existing.selections
		}));
		expect(store.GetSignal(existing.id)?.title).toBe("Descent");
	});

	it("removes one passage but preserves the final passage", async function RemovesPassageAsync(): Promise<void>
	{
		const existing = CreateSignal();
		const second = { documentId: "republic", start: { segmentKey: "s1", offset: 10 }, end: { segmentKey: "s1", offset: 17 } };
		const multipart = { ...existing, title: "Descent", selections: [...existing.selections, second] };
		const saved = { ...multipart, selections: [second], text: "Πειραιᾶ" };
		const saveSignal = vi.fn(async function SaveSignal(): Promise<SignalRecord> { return saved; });
		vi.stubGlobal("window", { chora: { SaveSignal: saveSignal } });
		const events = new ChoraEventBus<ChoraEvents>();
		const store = new SignalStore();
		store.SetWork("republic", [multipart]);
		const controller = new SignalController(new ErrorManager(events), store, new SignalGateway(), events);
		let highlightedSelections: readonly TextSelection[] = [];
		events.Subscribe("library.jump-requested", function CaptureHighlight(event): void
		{
			if (event.target === "signal") highlightedSelections = event.selections ?? [];
		});

		await controller.RemoveSelectionAsync(existing.id, 0);
		await controller.RemoveSelectionAsync(existing.id, 0);

		expect(saveSignal).toHaveBeenCalledOnce();
		expect(saveSignal).toHaveBeenCalledWith(expect.objectContaining({
			title: "Descent",
			selections: [second]
		}));
		expect(highlightedSelections).toEqual([second]);
	});
});
