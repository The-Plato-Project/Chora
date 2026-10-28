// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { SignalController } from "../../src/renderer/signals/SignalController.js";
import { SignalGateway } from "../../src/renderer/signals/SignalGateway.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Canonical source selection used by the active Dream.
const source = {
	documentId: "republic",
	start: { segmentKey: "s1", offset: 0 },
	end: { segmentKey: "s1", offset: 16 }
};

// Creates one Dream-owned Signal fixture.
function CreateSignal(id = "signal-1"): SignalRecord
{
	return {
		id,
		dreamId: "dream-1",
		workId: "republic",
		sourceRef: "327a",
		selections: [{ documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 5 } }],
		text: "alpha",
		description: "Initial observation",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};
}

// Creates the active Dream aggregate.
function CreateDream(signals: SignalRecord[] = []): DreamView
{
	return {
		id: "dream-1",
		workId: "republic",
		dialogue: "Republic",
		title: "Attention",
		source,
		signals,
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};
}

describe("SignalController", function SignalControllerTests()
{
	let events: ChoraEventBus<ChoraEvents>;
	let dreams: DreamStore;
	let library: LibraryStore;
	let controller: SignalController;

	beforeEach(function Setup(): void
	{
		window.sessionStorage.clear();
		events = new ChoraEventBus<ChoraEvents>();
		dreams = new DreamStore(new SessionStore());
		library = new LibraryStore();
		library.Open({
			id: "republic",
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
			segments: [{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "alpha beta gamma" }]
		}, null);
		dreams.Open(CreateDream(), false);
		vi.stubGlobal("window", {
			...window,
			sessionStorage: window.sessionStorage,
			chora: {
				CreateSignal: vi.fn(),
				UpdateSignal: vi.fn(),
				DeleteSignal: vi.fn()
			}
		});
		controller = new SignalController(new ErrorManager(events), dreams, library, new SignalGateway(), events);
	});

	afterEach(function Cleanup(): void
	{
		dreams.Dispose();
		vi.unstubAllGlobals();
	});

	it("creates and selects Signals through one Dream-owned API without scrolling", async function CreatesOwnedSignalAsync(): Promise<void>
	{
		const saved = CreateSignal();
		vi.mocked(window.chora.CreateSignal).mockResolvedValue({ ok: true, value: saved });
		let jumps = 0;
		events.Subscribe("library.jump-requested", function CountJump(): void
		{
			jumps += 1;
		});

		const created = await controller.CreateAsync(saved.selections[0]!);

		expect(window.chora.CreateSignal).toHaveBeenCalledExactlyOnceWith({
			dreamId: "dream-1",
			selection: saved.selections[0]
		});
		expect(created).toEqual(saved);
		expect(dreams.GetActiveDream()?.signals).toEqual([saved]);
		expect(dreams.GetSelectedSignal("dream-1")).toBe(saved.id);
		expect(jumps).toBe(0);
	});

	it("routes the shared creation request from either text surface to the same API", async function RoutesSharedCreationAsync(): Promise<void>
	{
		const saved = CreateSignal();
		vi.mocked(window.chora.CreateSignal).mockResolvedValue({ ok: true, value: saved });

		await events.PublishAsync("dream.signal-add-requested", { selection: saved.selections[0]! });

		expect(window.chora.CreateSignal).toHaveBeenCalledOnce();
		expect(dreams.GetActiveDream()?.signals).toEqual([saved]);
	});

	it("updates titles and passages without automatic navigation", async function UpdatesSignalAsync(): Promise<void>
	{
		const existing = CreateSignal();
		dreams.SetOwnedSignals("dream-1", [existing]);
		const added = { documentId: "republic", start: { segmentKey: "s1", offset: 11 }, end: { segmentKey: "s1", offset: 16 } };
		const saved = { ...existing, title: "Descent", selections: [...existing.selections, added], text: "alpha … gamma" };
		vi.mocked(window.chora.UpdateSignal).mockResolvedValueOnce({ ok: true, value: { ...existing, title: "Descent" } }).mockResolvedValueOnce({ ok: true, value: saved });
		let jumps = 0;
		events.Subscribe("library.jump-requested", function CountJump(): void
		{
			jumps += 1;
		});

		await controller.UpdateTitleAsync(existing.id, "  Descent  ");
		await controller.AddSelectionAsync(existing.id, added);

		expect(window.chora.UpdateSignal).toHaveBeenNthCalledWith(1, expect.objectContaining({
			dreamId: "dream-1",
			signalId: existing.id,
			title: "Descent"
		}));
		expect(window.chora.UpdateSignal).toHaveBeenNthCalledWith(2, expect.objectContaining({
			dreamId: "dream-1",
			selections: [...existing.selections, added]
		}));
		expect(dreams.GetActiveDream()?.signals[0]?.selections).toHaveLength(2);
		expect(jumps).toBe(0);
	});

	it("deletes a Signal only through its owning Dream", async function DeletesOwnedSignalAsync(): Promise<void>
	{
		const existing = CreateSignal();
		dreams.SetOwnedSignals("dream-1", [existing]);
		vi.mocked(window.chora.DeleteSignal).mockResolvedValue({ ok: true, value: undefined });

		const deleted = await controller.DeleteAsync(existing.id);

		expect(deleted).toBe(true);
		expect(window.chora.DeleteSignal).toHaveBeenCalledExactlyOnceWith({
			dreamId: "dream-1",
			signalId: existing.id
		});
		expect(dreams.GetActiveDream()?.signals).toEqual([]);
	});

	it("rejects creation outside the active Dream source before IPC", async function RejectsOutsideSelectionAsync(): Promise<void>
	{
		const outside = { documentId: "republic", start: { segmentKey: "s1", offset: 16 }, end: { segmentKey: "s1", offset: 16 } };

		const created = await controller.CreateAsync(outside);

		expect(created).toBeNull();
		expect(window.chora.CreateSignal).not.toHaveBeenCalled();
	});
});
