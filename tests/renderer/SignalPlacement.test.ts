// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { IdeaRecord } from "../../src/shared/ideas/IdeaTypes.js";
import type { TextDocument } from "../../src/shared/library/LibraryTypes.js";
import type { TextSelection } from "../../src/shared/text/TextSelection.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { IdeaController } from "../../src/renderer/ideas/IdeaController.js";
import { IdeaGateway } from "../../src/renderer/ideas/IdeaGateway.js";
import { IdeaStore } from "../../src/renderer/ideas/IdeaStore.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { SignalController } from "../../src/renderer/signals/SignalController.js";
import { SignalGateway } from "../../src/renderer/signals/SignalGateway.js";
import { SignalPlacementController } from "../../src/renderer/signals/SignalPlacementController.js";
import { SignalPlacementPanel } from "../../src/renderer/signals/SignalPlacementPanel.js";
import { SignalStore } from "../../src/renderer/signals/SignalStore.js";

const text: TextDocument = {
	id: "republic", title: "Republic", urn: null, titleGreek: null, author: "Plato", language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
	segments: [
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" },
		{ key: "s2", citation: { system: "stephanus", value: "327b" }, text: "ghijkl" }
	]
};

const selection: TextSelection = {
	documentId: text.id,
	start: { segmentKey: "s1", offset: 1 },
	end: { segmentKey: "s1", offset: 4 },
	selectedText: "bcd",
	locatorStart: { scheme: "Stephanus", value: "327a" },
	locatorEnd: { scheme: "Stephanus", value: "327a" }
};

function CreateSignal(): SignalRecord
{
	return {
		id: "signal-1",
		workId: text.id,
		sourceRef: "s1",
		selection,
		text: selection.selectedText,
		description: "A signal",
		createdAt: "2026-09-08",
		updatedAt: "2026-09-08"
	};
}

function CreateDream(signal: SignalRecord | null = null): DreamView
{
	return {
		id: "dream-1",
		workId: text.id,
		dialogue: text.title,
		title: "Descent",
		source: {
			...selection,
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 6 },
			selectedText: "abcdef",
			sourceRefs: ["s1"],
			startSourceRef: "s1",
			endSourceRef: "s1"
		},
		signals: signal === null ? [] : [signal],
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-09-08",
		updatedAt: "2026-09-08"
	};
}

function CreateIdea(): IdeaRecord
{
	return {
		id: "idea-1",
		workId: text.id,
		title: "Returning",
		content: "",
		originSignal: { signalId: "signal-1" },
		relatedSignals: [],
		createdAt: "2026-09-08",
		updatedAt: "2026-09-08"
	};
}

describe("Signal placement", function SignalPlacementTests()
{
	let events: ChoraEventBus<ChoraEvents>;
	let dreamStore: DreamStore;
	let ideaStore: IdeaStore;
	let signalStore: SignalStore;
	let dreams: DreamController;
	let ideas: IdeaController;
	let signals: SignalController;
	let controller: SignalPlacementController;

	beforeEach(function Setup(): void
	{
		events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.Open(text, null);
		dreamStore = new DreamStore(new SessionStore());
		ideaStore = new IdeaStore(new SessionStore());
		signalStore = new SignalStore();
		dreams = new DreamController(events, errors, library, dreamStore, new DreamGateway(), signalStore);
		ideas = new IdeaController(events, errors, ideaStore, new IdeaGateway());
		signals = new SignalController(errors, signalStore, new SignalGateway(), events);
		controller = new SignalPlacementController(events, library, dreamStore, dreams, ideaStore, ideas, signalStore, signals);
	});

	afterEach(function Cleanup(): void
	{
		dreamStore.Dispose();
		document.body.innerHTML = "";
		window.sessionStorage.clear();
	});

	it("finds Dreams by source coverage and Ideas by exact Signal relationship", function FindsDestinations(): void
	{
		const signal = CreateSignal();
		dreamStore.SetCatalogue([CreateDream(signal)]);
		ideaStore.SetWork(text.id, [CreateIdea()]);
		signalStore.SetWork(text.id, [signal]);

		expect(controller.GetDestinations(selection)).toEqual([
			{ kind: "dream", id: "dream-1", title: "Descent", signalId: "signal-1" },
			{ kind: "idea", id: "idea-1", title: "Returning", signalId: "signal-1" }
		]);
	});

	it("opens the only destination immediately without showing a popup", async function OpensSingleDestinationAsync(): Promise<void>
	{
		dreamStore.SetCatalogue([CreateDream()]);
		ideaStore.SetWork(text.id, []);
		signalStore.SetWork(text.id, []);
		const place = vi.spyOn(controller, "PlaceAsync").mockResolvedValue();
		const panel = new SignalPlacementPanel(events, controller);

		try
		{
			await events.PublishAsync("signal.add-requested", { selection });
			expect(place).toHaveBeenCalledWith(selection, {
				kind: "dream",
				id: "dream-1",
				title: "Descent",
				signalId: null
			});
			expect(document.querySelector(".popup-overlay")).toBeNull();
		}
		finally
		{
			panel.Dispose();
		}
	});

	it("opens and focuses an existing Dream Signal without duplicating it", async function FocusesDreamSignalAsync(): Promise<void>
	{
		const signal = CreateSignal();
		dreamStore.SetCatalogue([CreateDream(signal)]);
		ideaStore.SetWork(text.id, []);
		signalStore.SetWork(text.id, [signal]);
		const open = vi.spyOn(dreams, "OpenSignalAsync").mockResolvedValue();
		const associate = vi.spyOn(dreams, "AssociateSignalAsync").mockResolvedValue();

		await controller.PlaceAsync(selection, {
			kind: "dream",
			id: "dream-1",
			title: "Descent",
			signalId: signal.id
		});

		expect(open).toHaveBeenCalledWith("dream-1", signal.id);
		expect(associate).not.toHaveBeenCalled();
	});

	it("activates an Idea and focuses its exact existing Signal", async function FocusesIdeaSignalAsync(): Promise<void>
	{
		const signal = CreateSignal();
		dreamStore.SetCatalogue([]);
		ideaStore.SetWork(text.id, [CreateIdea()]);
		signalStore.SetWork(text.id, [signal]);
		const selected = vi.fn();
		const focused = vi.fn();
		events.Subscribe("workspace.document-selected", selected);
		events.Subscribe("idea.signal-focus-requested", focused);

		await controller.PlaceAsync(selection, {
			kind: "idea",
			id: "idea-1",
			title: "Returning",
			signalId: signal.id
		});

		expect(ideaStore.GetDraft()?.ideaId).toBe("idea-1");
		expect(selected).toHaveBeenCalledWith({ kind: "idea" });
		expect(focused).toHaveBeenCalledWith({ ideaId: "idea-1", signalId: signal.id });
	});

	it("asks which Dream or Idea should receive a Signal when several qualify", async function ChoosesDestinationAsync(): Promise<void>
	{
		const signal = CreateSignal();
		dreamStore.SetCatalogue([CreateDream(signal)]);
		ideaStore.SetWork(text.id, [CreateIdea()]);
		signalStore.SetWork(text.id, [signal]);
		const place = vi.spyOn(controller, "PlaceAsync").mockResolvedValue();
		const panel = new SignalPlacementPanel(events, controller);

		try
		{
			await events.PublishAsync("signal.add-requested", { selection });
			expect(document.querySelectorAll("[data-signal-destination-id]")).toHaveLength(2);
			document.querySelector<HTMLButtonElement>('[data-signal-destination-kind="idea"]')?.click();
			await vi.waitFor(function DestinationChosen(): void
			{
				expect(place).toHaveBeenCalledWith(selection, {
					kind: "idea",
					id: "idea-1",
					title: "Returning",
					signalId: "signal-1"
				});
			});
			expect(document.querySelector(".popup-overlay")).toBeNull();
		}
		finally
		{
			panel.Dispose();
		}
	});

	it("prompts for a new Dream or Idea when the passage has no destination", async function CreatesDestinationAsync(): Promise<void>
	{
		dreamStore.SetCatalogue([]);
		ideaStore.SetWork(text.id, []);
		signalStore.SetWork(text.id, []);
		const createIdea = vi.spyOn(controller, "CreateIdeaAsync").mockResolvedValue();
		const panel = new SignalPlacementPanel(events, controller);

		try
		{
			await events.PublishAsync("signal.add-requested", { selection });
			expect(document.querySelector(".popup-header")?.textContent).toContain("Create a Dream or Idea");
			document.querySelector<HTMLButtonElement>("[data-create-signal-idea]")?.click();
			await vi.waitFor(function IdeaCreated(): void
			{
				expect(createIdea).toHaveBeenCalledWith(selection);
			});
			expect(document.querySelector(".popup-overlay")).toBeNull();
		}
		finally
		{
			panel.Dispose();
		}
	});
});
