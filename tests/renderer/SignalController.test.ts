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
		selection: {
			documentId: "republic",
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 7 },
			selectedText: "κατέβην",
			locatorStart: { scheme: "Stephanus", value: "327a" },
			locatorEnd: { scheme: "Stephanus", value: "327a" }
		},
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
		store.SetWork("republic", [signal]);
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
		expect(changed?.description).toBe(saved.description);
	});

	it("creates Signals from selections longer than five words", async function CreatesLongSelectionsAsync()
	{
		const selectedText = "one two three four five six seven eight nine ten";
		const saved: SignalRecord = {
			...CreateSignal(),
			selection: {
				...CreateSignal().selection,
				end: { segmentKey: "s1", offset: selectedText.length },
				selectedText
			},
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

		const signal = await controller.CreateAsync(saved.selection);

		expect(signal?.text).toBe(selectedText);
		expect(saveSignal).toHaveBeenCalledOnce();
	});

	it("creates a Signal when Greek function words surround focused content", async function CreatesGreekPhraseAsync()
	{
		const selectedText = "ἀλλὰ τοῖσδέ τε τοῖς νεανίσκοις σύνισθι";
		const saved: SignalRecord = {
			...CreateSignal(),
			selection: {
				...CreateSignal().selection,
				end: { segmentKey: "s1", offset: selectedText.length },
				selectedText
			},
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

		const signal = await controller.CreateAsync(saved.selection);

		expect(signal?.text).toBe(selectedText);
		expect(saveSignal).toHaveBeenCalledWith(expect.objectContaining({
			selection: expect.objectContaining({ selectedText })
		}));
	});
});
