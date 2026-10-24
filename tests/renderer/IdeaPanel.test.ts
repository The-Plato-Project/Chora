// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import { IdeaController } from "../../src/renderer/ideas/IdeaController.js";
import { IdeaGateway } from "../../src/renderer/ideas/IdeaGateway.js";
import { IdeaPanel } from "../../src/renderer/ideas/IdeaPanel.js";
import { IdeaStore, type IdeaDraft } from "../../src/renderer/ideas/IdeaStore.js";
import { SignalStore } from "../../src/renderer/signals/SignalStore.js";
import type { IdeaRecord, IdeaSignalReference } from "../../src/shared/ideas/IdeaTypes.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Creates one complete Signal fixture for the Ideas panels.
function CreateSignal(id: string, text: string, description: string): SignalRecord
{
	const signal: SignalRecord = {
		id,
		workId: "republic",
		sourceRef: `source-${id}`,
		selections: [{
			documentId: "republic",
			start: { segmentKey: id, offset: 0 },
			end: { segmentKey: id, offset: text.length }
		}],
		text,
		description,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

// Creates one Dream fixture that owns displayed Signals.
function CreateDream(signals: readonly SignalRecord[]): DreamView
{
	const dream: DreamView = {
		id: "dream-1",
		workId: "republic",
		dialogue: "Republic",
		title: "Descent",
		source: signals[0]!.selections[0]!,
		signalIds: signals.map(function GetSignalId(signal): string
		{
			return signal.id;
		}),
		signals: [...signals],
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return dream;
}

// Creates one saved Idea fixture.
function CreateIdea(id: string, title: string, reference: IdeaSignalReference): IdeaRecord
{
	const idea: IdeaRecord = {
		id,
		workId: "republic",
		title,
		content: `${title} interpretation`,
		originSignal: reference,
		relatedSignals: [],
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return idea;
}

// Creates one empty unsaved Idea draft.
function CreateEmptyDraft(): IdeaDraft
{
	const draft: IdeaDraft = {
		ideaId: null,
		workId: "republic",
		title: "",
		content: "",
		originSignal: null,
		relatedSignals: []
	};

	return draft;
}

// Selects Idea Seeing content and activates its bold toolbar action.
function FormatSeeingBold(root: HTMLElement): void
{
	const content = root.querySelector<HTMLElement>("[contenteditable=true]")!;
	content.focus();
	const range = document.createRange();
	range.selectNodeContents(content);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
}

// Removes DOM and session state created by each panel test.
function ResetDocument(): void
{
	document.body.innerHTML = "";
	window.sessionStorage.clear();
}

// Creates shared renderer collaborators for one panel test.
function CreateFixture(signals: readonly SignalRecord[], ideas: readonly IdeaRecord[]): {
	readonly events: ChoraEventBus<ChoraEvents>;
	readonly dreamStore: DreamStore;
	readonly ideaStore: IdeaStore;
	readonly controller: IdeaController;
}
{
	const events = new ChoraEventBus<ChoraEvents>();
	const dreamStore = new DreamStore(new SessionStore());
	dreamStore.SetCatalogue([CreateDream(signals)]);
	const ideaStore = new IdeaStore();
	ideaStore.SetWork("republic", ideas);
	const errors = new ErrorManager(events);
	const controller = new IdeaController(events, errors, ideaStore, new IdeaGateway());
	const fixture = { events, dreamStore, ideaStore, controller };

	return fixture;
}

describe("IdeaPanel", function IdeaPanelTests()
{
	afterEach(ResetDocument);

	it("renders the Dreams catalogue pattern as one flat Ideas list", function RendersFlatCatalogue()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { dreamId: "dream-1", signalId: signal.id };
		const fixture = CreateFixture([signal], [
			CreateIdea("idea-1", "Descent", reference),
			CreateIdea("idea-2", "Return", reference)
		]);
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "catalogue");

		expect(root.querySelector("[data-idea-search]")).not.toBeNull();
		expect(root.querySelector("[data-new-idea]")).not.toBeNull();
		expect(root.querySelectorAll(".catalogue-item")).toHaveLength(2);
		expect(root.querySelector(".catalogue-group")).toBeNull();
		expect(root.textContent).toContain("1 Signal");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("filters Ideas in place by title, description, and connected Signal text", function FiltersCatalogue()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { dreamId: "dream-1", signalId: signal.id };
		const fixture = CreateFixture([signal], [
			CreateIdea("idea-1", "Descent", reference),
			CreateIdea("idea-2", "Return", reference)
		]);
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "catalogue");
		const search = root.querySelector<HTMLInputElement>("[data-idea-search]");

		if (search !== null)
		{
			search.value = "Return";
			search.dispatchEvent(new Event("input", { bubbles: true }));
		}

		expect(root.querySelectorAll(".catalogue-item")).toHaveLength(1);
		expect(root.textContent).toContain("Return");
		expect(root.textContent).not.toContain("Descent interpretation");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("opens an empty new Idea with one Signal search action", function RendersEmptyEditor()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const fixture = CreateFixture([signal], []);
		fixture.ideaStore.SetDraft(CreateEmptyDraft());
		fixture.ideaStore.UpdateDraft("Exchange", "Meaning moves between sources.");
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");

		expect(root.querySelector("[data-signal-view-add]")?.getAttribute("aria-label")).toBe("Add new Signal");
		expect(root.querySelector("[data-signal-view-add]")?.textContent).toBe("Add new");
		expect(root.querySelector("[data-signal-view-add] svg")).not.toBeNull();
		expect(root.querySelector("[data-find-signals]")).toBeNull();
		expect(root.querySelectorAll("[data-signal-view-add]")).toHaveLength(1);
		expect(root.querySelectorAll(".idea-signals-section .signal-item")).toHaveLength(0);
		expect(root.querySelector("[data-signal-view-search]")).not.toBeNull();
		expect(root.querySelector<HTMLInputElement>("[data-signal-view-search]")?.placeholder).toBe("Search");
		expect(root.querySelector('[role=tab][aria-selected="true"]')?.textContent).toBe("Signals");
		expect(root.querySelector("[data-signal-view-add]")?.parentElement?.classList.contains("tab-list")).toBe(true);
		expect(root.querySelector("[data-signal-view-search]")?.closest(".signal-list")).not.toBeNull();
		expect(root.querySelector(".signal-list")?.firstElementChild?.classList.contains("signal-view-search")).toBe(true);
		expect(root.querySelector(".signal-view-body")).not.toBeNull();
		expect(root.querySelector(".signal-view-empty-state strong")?.textContent).toBe("No Signals.");
		expect(root.querySelector(".signal-view-empty-state")?.textContent).toContain("Add signals to capture key readings");
		expect(root.querySelector("[data-cancel-idea]")).toBeNull();
		expect(root.querySelector(".idea-draft-status")).toBeNull();
		expect(root.querySelector("[data-idea-content]")).toBeNull();
		expect(Array.from(root.querySelectorAll("[role=tab]"), function GetTabLabel(tab): string | null
		{
			return tab.textContent;
		})).toEqual(["Signals", "Seeing"]);
		expect(root.querySelector("[data-save-idea]")?.getAttribute("aria-label")).toBe("Save Idea");
		expect(root.querySelector("[data-save-idea]")?.textContent).toBe("Save");
		expect(root.querySelector<HTMLButtonElement>("[data-save-idea]")?.disabled).toBe(false);
		expect(root.textContent).not.toContain("Missing Signal");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("offers optional AI after the reader describes a new Idea", async function EnablesSignalSearchAsync()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const fixture = CreateFixture([signal], []);
		fixture.ideaStore.SetDraft(CreateEmptyDraft());
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");
		const findSignals = root.querySelector<HTMLButtonElement>("[data-signal-view-add]");

		fixture.controller.UpdateSeeing("Downward motion marks the beginning of inquiry.");
		findSignals?.click();
		const useAi = root.querySelector<HTMLInputElement>("[data-toggle-ai]");
		const findWithAi = vi.spyOn(fixture.controller, "FindSignalsAsync").mockResolvedValue(undefined);

		expect(fixture.ideaStore.GetView()).toBe("signals");
		expect(useAi?.disabled).toBe(false);
		expect(useAi?.checked).toBe(false);
		expect(fixture.ideaStore.GetDraft()?.content).toBe("Downward motion marks the beginning of inquiry.");
		useAi?.click();
		await vi.waitFor(function AiDiscoveryRequested(): void
		{
			expect(findWithAi).toHaveBeenCalledOnce();
		});
		expect(useAi?.checked).toBe(true);

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("edits Idea content in a persistent full-height Seeing tab", async function EditsSeeingAsync()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { signalId: signal.id };
		const idea = CreateIdea("idea-1", "Descent", reference);
		const fixture = CreateFixture([signal], [idea]);
		fixture.ideaStore.SetDraft(fixture.ideaStore.CreateDraft(idea));
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");
		const tabs = root.querySelectorAll<HTMLButtonElement>("[role=tab]");

		tabs[1]!.click();
		await vi.waitFor(function SeeingReady(): void
		{
			expect(root.querySelector("[data-idea-seeing] [contenteditable=true]")?.textContent).toBe("Descent interpretation");
		});
		const seeing = root.querySelector<HTMLElement>("[data-idea-seeing]")!;
		FormatSeeingBold(seeing);
		tabs[0]!.click();
		tabs[1]!.click();

		expect(root.querySelector("[data-idea-seeing]")).toBe(seeing);
		expect(fixture.ideaStore.GetDraft()?.content).toContain("**Descent interpretation**");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("renders an Idea-only Signal from the canonical Signal store", function RendersIdeaOnlySignal()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal: SignalRecord = {
			...CreateSignal("327a", "κατέβην", "Socrates descends."),
			workId: "republic",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01"
		};
		const reference: IdeaSignalReference = { signalId: signal.id };
		const idea = CreateIdea("idea-1", "Descent", reference);
		const fixture = CreateFixture(
			[CreateSignal("328a", "δικαιοσύνη", "Justice remains under inquiry.")],
			[idea]);
		const signalStore = new SignalStore();
		signalStore.SetWork("republic", [signal]);
		fixture.ideaStore.SetDraft(fixture.ideaStore.CreateDraft(idea));
		const panel = new IdeaPanel(
			root,
			fixture.events,
			fixture.ideaStore,
			fixture.controller,
			fixture.dreamStore,
			"editor",
			signalStore);

		expect(root.textContent).toContain("κατέβην");
		expect(root.textContent).not.toContain("Missing Signal");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("confirms removing a Signal only from the current Idea", function RemovesSignalAssociation()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { signalId: signal.id };
		const idea = CreateIdea("idea-1", "Descent", reference);
		const fixture = CreateFixture([signal], [idea]);
		fixture.ideaStore.SetDraft(fixture.ideaStore.CreateDraft(idea));
		const panel = new IdeaPanel(
			root,
			fixture.events,
			fixture.ideaStore,
			fixture.controller,
			fixture.dreamStore,
			"editor");
		expect(root.querySelector("[data-delete-signal]")).toBeNull();
		expect(fixture.ideaStore.GetDraft()?.originSignal).toEqual(reference);
		expect(root.querySelectorAll(".idea-signals-section .signal-item")).toHaveLength(1);
		expect(root.querySelector("[data-delete-idea]")).toBeNull();
		const remove = root.querySelector<HTMLButtonElement>("[data-remove-signal-association]")!;
		const actions = remove.closest(".signal-editor-actions");
		expect(actions?.parentElement?.classList.contains("signal-identity")).toBe(true);
		expect(actions?.nextElementSibling).toBeNull();
		expect(remove.textContent).toBe("");
		expect(remove.title).toBe("Remove from Idea");
		expect(root.querySelector("[data-remove-signal-passage]")).toBeNull();
		remove.click();
		const prompt = document.querySelector<HTMLElement>("[data-signal-remove-confirm]")?.closest<HTMLElement>(".popup-overlay");
		const cancel = prompt?.querySelector<HTMLButtonElement>("[data-signal-remove-cancel]");
		expect(prompt?.hidden).toBe(false);
		expect(prompt?.textContent).toContain("κατέβην");
		expect(document.activeElement).toBe(cancel);
		cancel?.click();
		expect(fixture.ideaStore.GetDraft()?.originSignal).toEqual(reference);

		remove.click();
		prompt?.querySelector<HTMLButtonElement>("[data-signal-remove-confirm]")?.click();
		expect(fixture.ideaStore.GetDraft()?.originSignal).toBeNull();

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("uses the shared Signal view inside the Idea content tabs", async function UsesSharedSignalViewAsync()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { signalId: signal.id };
		const idea = CreateIdea("idea-1", "Descent", reference);
		const fixture = CreateFixture([signal], [idea]);
		fixture.ideaStore.SetDraft(fixture.ideaStore.CreateDraft(idea));
		let openedSignalId: string | null = null;

		// Captures Idea Signal navigation without coupling the panel to the reader.
		async function CaptureSignalView(event: ChoraEvents["idea.signal-view-requested"]): Promise<void>
		{
			openedSignalId = event.signalId;
			await Promise.resolve();
		}

		fixture.events.Subscribe("idea.signal-view-requested", CaptureSignalView);

		const panel = new IdeaPanel(
			root,
			fixture.events,
			fixture.ideaStore,
			fixture.controller,
			fixture.dreamStore,
			"editor");
		expect(root.querySelector(".idea-tabs-host .signal-view-panel")).not.toBeNull();
		expect(root.querySelector("[role=tablist]")).not.toBeNull();
		expect(Array.from(root.querySelectorAll("[role=tab]"), function GetTabLabel(tab): string | null
		{
			return tab.textContent;
		})).toEqual(["Signals", "Seeing"]);
		expect(root.querySelector(".signal-relationships-panel")).toBeNull();
		expect(root.querySelector('[data-signal-drag="327a"]')?.getAttribute("draggable")).toBe("true");
		const search = root.querySelector<HTMLInputElement>("[data-signal-view-search]")!;
		search.value = "unmatched";
		search.dispatchEvent(new Event("input", { bubbles: true }));
		expect(root.querySelector(".signal-view-empty-state strong")?.textContent).toBe("No matching Signals.");
		expect(root.querySelector<HTMLElement>('[data-signal-drag="327a"]')?.closest<HTMLElement>(".signal-header")?.hidden).toBe(true);
		search.value = "";
		search.dispatchEvent(new Event("input", { bubbles: true }));
		root.querySelector<HTMLButtonElement>('[data-signal-toggle="327a"]')?.click();
		await Promise.resolve();
		expect(openedSignalId).toBe(signal.id);

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("loads the newly selected Signal description before navigation refreshes the Idea", async function LoadsSelectedSignalDescriptionAsync()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const first = CreateSignal("327a", "κατέβην", "First Signal description.");
		const second = CreateSignal("327b", "Πειραιᾶ", "Second Signal description.");
		const firstReference: IdeaSignalReference = { signalId: first.id };
		const secondReference: IdeaSignalReference = { signalId: second.id };
		const idea: IdeaRecord = {
			...CreateIdea("idea-1", "Descent", firstReference),
			relatedSignals: [secondReference]
		};
		const fixture = CreateFixture([first, second], [idea]);
		fixture.ideaStore.SetDraft(fixture.ideaStore.CreateDraft(idea));

		// Simulates the workspace refresh that accompanies reader navigation.
		fixture.events.Subscribe("idea.signal-view-requested", async function RefreshIdea(): Promise<void>
		{
			await fixture.events.PublishAsync("ideas.changed", {});
		});
		const panel = new IdeaPanel(
			root,
			fixture.events,
			fixture.ideaStore,
			fixture.controller,
			fixture.dreamStore,
			"editor");

		root.querySelector<HTMLButtonElement>('[data-signal-toggle="327b"]')!.click();

		await vi.waitFor(function SelectedSignalLoaded(): void
		{
			expect(root.querySelector('[data-signal-toggle="327b"]')?.getAttribute("aria-current")).toBe("true");
			expect(root.querySelector<HTMLElement>('[data-signal-description="327b"] [contenteditable="true"]')?.textContent).toBe("Second Signal description.");
		});

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("keeps Idea deletion out of the editor surface", function HidesDeleteFromEditor()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { dreamId: "dream-1", signalId: signal.id };
		const idea = CreateIdea("idea-1", "Descent", reference);
		const fixture = CreateFixture([signal], [idea]);
		fixture.ideaStore.SetDraft({
			ideaId: idea.id,
			workId: idea.workId,
			title: idea.title,
			content: idea.content,
			originSignal: idea.originSignal,
			relatedSignals: idea.relatedSignals
		});
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");
		const actions = root.querySelectorAll<HTMLButtonElement>(".document-save-actions > button");

		expect(root.querySelector<HTMLButtonElement>("[data-save-idea]")?.disabled).toBe(false);
		expect(Array.from(actions, function GetAction(button: HTMLButtonElement): string
		{
			return button.getAttribute("aria-label") ?? button.textContent ?? "";
		})).toEqual(["Save Idea"]);

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("preserves a model suggestion rationale on the Idea-Signal relationship", async function RendersSuggestionsAsync()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "πομπή", "Exchange bears meaning between speakers.");
		const fixture = CreateFixture([signal], []);
		fixture.ideaStore.SetDraft(CreateEmptyDraft());
		fixture.ideaStore.UpdateDraft("Exchange", "Meaning moves between sources.");
		fixture.ideaStore.SetDiscoveryLoading();
		fixture.ideaStore.SetSuggestions([{
			reference: { dreamId: "dream-1", signalId: signal.id },
			rationale: "The observation describes meaning as something carried between sources."
		}]);
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");

		expect(root.querySelector(".idea-suggestion-rationale")?.textContent).toContain("carried between sources");
		expect(root.querySelector("[data-view-available]")).not.toBeNull();
		expect(root.querySelector("[data-add-available]")).not.toBeNull();
		expect(root.querySelector<HTMLInputElement>("[data-toggle-ai]")?.checked).toBe(true);
		root.querySelector<HTMLButtonElement>("[data-add-available]")?.click();
		await vi.waitFor(function RationaleAttached(): void
		{
			expect(fixture.ideaStore.GetDraft()?.originSignal).toEqual({
				signalId: signal.id,
				rationale: "The observation describes meaning as something carried between sources."
			});
		});
		root.querySelector<HTMLButtonElement>("[data-show-idea-editor]")?.click();
		await vi.waitFor(function RationaleDisplayed(): void
		{
			expect(root.querySelector(".idea-signal-rationale strong")?.textContent).toBe("Why this Signal connects");
			expect(root.querySelector(".idea-signal-rationale p")?.textContent).toContain("carried between sources");
		});

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("shows the shared progress bar while finding Signals", function ShowsDiscoveryProgress()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "πομπή", "Exchange bears meaning between speakers.");
		const fixture = CreateFixture([signal], []);
		fixture.ideaStore.SetDraft(CreateEmptyDraft());
		fixture.ideaStore.UpdateDraft("Exchange", "Meaning moves between sources.");
		fixture.ideaStore.SetDiscoveryLoading();
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");
		const progress = root.querySelector<HTMLElement>(".idea-discovery-loading .progress-bar");

		expect(root.textContent).toContain("Finding Signals...");
		expect(progress?.getAttribute("role")).toBe("progressbar");
		expect(progress?.getAttribute("aria-label")).toBe("Finding Signals");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("searches and connects several Signals without leaving the browser", function AddsSignals()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signals = [
			CreateSignal("327a", "κατέβην", "Socrates descends."),
			CreateSignal("327c", "βίᾳ", "Force structures the return.")
		];
		const fixture = CreateFixture(signals, []);
		fixture.ideaStore.SetDraft(CreateEmptyDraft());
		fixture.ideaStore.ShowSignalBrowser();
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "editor");
		const firstAdd = root.querySelector<HTMLElement>('[data-signal-id="327a"][data-add-available]');
		firstAdd?.click();
		const secondAdd = root.querySelector<HTMLElement>('[data-signal-id="327c"][data-add-available]');
		secondAdd?.click();

		expect(fixture.ideaStore.GetView()).toBe("signals");
		expect(fixture.ideaStore.GetDraft()?.originSignal?.signalId).toBe("327a");
		expect(fixture.ideaStore.GetDraft()?.relatedSignals[0]?.signalId).toBe("327c");
		expect(root.querySelectorAll<HTMLButtonElement>("[data-add-available][disabled]")).toHaveLength(2);

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});

	it("uses the normal catalogue to attach a pending Signal", function RendersPendingCatalogue()
	{
		const root = document.createElement("div");
		document.body.append(root);
		const signal = CreateSignal("327a", "κατέβην", "Socrates descends.");
		const reference: IdeaSignalReference = { dreamId: "dream-1", signalId: signal.id };
		const fixture = CreateFixture([signal], [CreateIdea("idea-1", "Descent", reference)]);
		fixture.ideaStore.BeginAddToIdea(reference);
		const panel = new IdeaPanel(root, fixture.events, fixture.ideaStore, fixture.controller, fixture.dreamStore, "catalogue");

		expect(root.querySelector("[data-cancel-add-to-idea]")).not.toBeNull();
		expect(root.querySelector<HTMLButtonElement>("[data-idea-id]")?.disabled).toBe(true);
		expect(root.textContent).toContain("Connected");

		panel.Dispose();
		fixture.dreamStore.Dispose();
	});
});
