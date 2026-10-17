import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { IdeaController } from "../../src/renderer/ideas/IdeaController.js";
import { IdeaGateway } from "../../src/renderer/ideas/IdeaGateway.js";
import { IdeaStore } from "../../src/renderer/ideas/IdeaStore.js";
import type { IdeaRecord, IdeaSignalReference, SaveIdeaCommand } from "../../src/shared/ideas/IdeaTypes.js";

// Creates one Signal reference fixture.
function CreateReference(signalId: string): IdeaSignalReference
{
	const reference: IdeaSignalReference = {
		dreamId: "dream-1",
		signalId
	};

	return reference;
}

// Creates one authoritative Idea record fixture.
function CreateIdea(): IdeaRecord
{
	const idea: IdeaRecord = {
		id: "idea-1",
		workId: "republic",
		title: "Descent",
		content: "An Idea.",
		originSignal: CreateReference("signal-1"),
		relatedSignals: [
			CreateReference("signal-2"),
			CreateReference("signal-3")
		],
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return idea;
}

// Configures a deterministic isolated Idea API.
function ConfigureApi(ideas: readonly IdeaRecord[] = []): void
{
	// Lists configured authoritative Idea fixtures.
	async function ListIdeas(): Promise<IdeaRecord[]>
	{
		const records = structuredClone(ideas);

		return records;
	}

	// Returns one deterministic existing-Signal suggestion.
	async function DiscoverIdeaSignals(): Promise<Array<{ reference: IdeaSignalReference; rationale: string }>>
	{
		const suggestions = [{
			reference: CreateReference("signal-4"),
			rationale: "The observation develops the described Idea."
		}];

		return suggestions;
	}

	// Simulates main-owned identity and timestamp assignment.
	async function SaveIdea(command: SaveIdeaCommand): Promise<IdeaRecord>
	{
		const saved: IdeaRecord = {
			id: command.ideaId ?? "idea-created-by-main",
			workId: command.workId,
			title: command.title,
			content: command.content,
			originSignal: structuredClone(command.originSignal),
			relatedSignals: structuredClone(command.relatedSignals),
			createdAt: "2026-01-01",
			updatedAt: "2026-01-02"
		};

		return saved;
	}

	// Simulates successful durable Idea deletion.
	async function DeleteIdea(): Promise<void>
	{
		await Promise.resolve();
	}

	vi.stubGlobal("window", {
		chora: {
			ListIdeas: vi.fn(ListIdeas),
			DiscoverIdeaSignals: vi.fn(DiscoverIdeaSignals),
			SaveIdea: vi.fn(SaveIdea),
			DeleteIdea: vi.fn(DeleteIdea)
		}
	});
}

// Restores globals modified by one renderer test.
function RestoreGlobals(): void
{
	vi.unstubAllGlobals();
}

// Creates the renderer-side Idea workflow under test.
function CreateController(store: IdeaStore, events: ChoraEventBus<ChoraEvents> = new ChoraEventBus<ChoraEvents>()): IdeaController
{
	const errors = new ErrorManager(events);
	const controller = new IdeaController(events, errors, store, new IdeaGateway());

	return controller;
}

describe("IdeaController", function IdeaControllerTests()
{
	afterEach(RestoreGlobals);

	it("creates an empty draft and assigns the first added Signal as its origin", async function CreatesEmptyIdeaAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");

		await controller.CreateAsync();

		expect(store.GetDraft()?.originSignal).toBeNull();
		controller.AddSignal(CreateReference("signal-1"));
		controller.AddSignal(CreateReference("signal-2"));
		controller.AddSignal(CreateReference("signal-3"));

		expect(store.GetDraft()?.originSignal).toEqual(CreateReference("signal-1"));
		expect(store.GetDraft()?.relatedSignals).toEqual([
			CreateReference("signal-2"),
			CreateReference("signal-3")
		]);
	});

	it("saves after one Signal is connected", async function SavesSingleSignalIdeaAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		await controller.CreateAsync();
		controller.Update("Descent", "Descending imagery recurs.");
		controller.AddSignal(CreateReference("signal-1"));

		await controller.SaveAsync();

		expect(window.chora.SaveIdea).toHaveBeenCalledWith(expect.objectContaining({
			ideaId: null,
			originSignal: CreateReference("signal-1"),
			relatedSignals: []
		}));
	});

	it("removes any connected Signal and promotes the next association", async function RemovesSignals()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		await controller.CreateAsync();
		controller.AddSignal(CreateReference("signal-1"));
		controller.AddSignal(CreateReference("signal-2"));

		controller.RemoveSignal(CreateReference("signal-1"));

		expect(store.GetDraft()?.originSignal).toEqual(CreateReference("signal-2"));
		expect(store.GetDraft()?.relatedSignals).toEqual([]);

		controller.RemoveSignal(CreateReference("signal-2"));

		expect(store.GetDraft()?.originSignal).toBeNull();
		expect(store.GetDraft()?.relatedSignals).toEqual([]);
	});

	it("saves a Signal-free Idea placeholder", async function SavesPlaceholderIdeaAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		await controller.CreateAsync();
		controller.Update("Questions of justice", "");

		await controller.SaveAsync();

		expect(window.chora.SaveIdea).toHaveBeenCalledWith(expect.objectContaining({
			title: "Questions of justice",
			originSignal: null,
			relatedSignals: []
		}));
	});

	it("finds existing Signals with a rationale-bearing model request", async function FindsSignalsAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		await controller.CreateAsync();
		controller.Update("Exchange", "Meaning moves between sources.");

		await controller.FindSignalsAsync();

		expect(window.chora.DiscoverIdeaSignals).toHaveBeenCalledWith(expect.objectContaining({
			title: "Exchange",
			content: "Meaning moves between sources."
		}));
		expect(store.GetView()).toBe("suggestions");
		expect(store.GetSuggestions()).toEqual([{
			reference: CreateReference("signal-4"),
			rationale: "The observation develops the described Idea."
		}]);
	});

	it("creates and saves a new Idea with the pending Signal already connected", async function CreatesPendingIdeaAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		const reference = CreateReference("signal-4");
		controller.BeginAddToIdea(reference);

		const saved = await controller.CreateIdeaFromPendingSignalAsync();

		expect(saved).toBe(true);
		expect(store.GetPendingAddReference()).toBeNull();
		expect(store.GetDraft()?.ideaId).toBe("idea-created-by-main");
		expect(store.GetDraft()?.originSignal).toEqual(reference);
		expect(store.GetIdeas().map(function SelectId(idea): string { return idea.id; })).toContain("idea-created-by-main");
		expect(window.chora.SaveIdea).toHaveBeenCalledWith(expect.objectContaining({
			ideaId: null,
			originSignal: reference
		}));
	});

	it("adds a pending Signal to a selected saved Idea", async function AddsPendingSignalAsync()
	{
		const idea = CreateIdea();
		ConfigureApi([idea]);
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		controller.BeginAddToIdea(CreateReference("signal-4"));

		await controller.AddPendingSignalToIdeaAsync("idea-1");

		expect(window.chora.SaveIdea).toHaveBeenCalledWith(expect.objectContaining({
			ideaId: "idea-1",
			relatedSignals: [...idea.relatedSignals, CreateReference("signal-4")]
		}));
		expect(store.GetPendingAddReference()).toBeNull();
		expect(store.GetDraft()?.ideaId).toBe("idea-1");
	});

	it("adds an explicit Signal directly to a selected saved Idea", async function AddsExplicitSignalAsync()
	{
		const idea = CreateIdea();
		const reference = CreateReference("signal-4");
		ConfigureApi([idea]);
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");

		await controller.AddSignalToIdeaAsync("idea-1", reference);

		expect(window.chora.SaveIdea).toHaveBeenCalledWith(expect.objectContaining({
			ideaId: "idea-1",
			relatedSignals: [...idea.relatedSignals, reference]
		}));
		expect(store.GetPendingAddReference()).toBeNull();
		expect(store.GetDraft()?.ideaId).toBe("idea-1");
	});

	it("cancels Add to Idea without destroying the active draft", async function CancelsPendingSignalAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const controller = CreateController(store);
		await controller.LoadAsync("republic");
		await controller.CreateAsync();
		controller.Update("Unfinished", "Preserve this draft.");
		controller.BeginAddToIdea(CreateReference("signal-4"));

		controller.CancelAddToIdea();

		expect(store.GetPendingAddReference()).toBeNull();
		expect(store.GetDraft()?.title).toBe("Unfinished");
		expect(store.GetDraft()?.content).toBe("Preserve this draft.");
	});

	it("opens referenced Signals through the established Signal panel event", async function OpensSignalAsync()
	{
		ConfigureApi();
		const store = new IdeaStore();
		const events = new ChoraEventBus<ChoraEvents>();
		const viewed: IdeaSignalReference[] = [];

		// Records the typed Signal navigation request.
		function RecordSignal(reference: ChoraEvents["idea.signal-view-requested"]): void
		{
			viewed.push(structuredClone(reference));
		}

		events.Subscribe("idea.signal-view-requested", RecordSignal);
		const controller = CreateController(store, events);
		const reference = CreateReference("signal-1");

		await controller.ViewSignalAsync(reference);

		expect(viewed).toEqual([reference]);
	});
});
