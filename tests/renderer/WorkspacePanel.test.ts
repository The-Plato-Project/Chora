// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { WorkspacePanel } from "../../src/renderer/workspace/WorkspacePanel.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { IdeaRecord } from "../../src/shared/ideas/IdeaTypes.js";
import type { TextDocument, LibraryTextSummary } from "../../src/shared/library/LibraryTypes.js";

const text: TextDocument = {
	id: "republic", urn: null, title: "Republic", titleGreek: "Πολιτεία", author: "Plato", language: "grc",
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
	segments: [
		{ key: "s0", citation: { system: "stephanus", value: "326a" }, division: { type: "book", label: "1" }, text: "earlier" },
		{ key: "s1", citation: { system: "stephanus", value: "327a" }, division: { type: "book", label: "1" }, text: "abcdef" }
	]
};

const works: LibraryTextSummary[] = [
	{ id: "republic", urn: null, title: "Republic", titleGreek: "Πολιτεία", author: "Plato", language: "grc", editor: null, fileName: "republic.json" },
	{ id: "phaedo", urn: null, title: "Phaedo", titleGreek: "Φαίδων", author: "Plato", language: "grc", editor: null, fileName: "phaedo.json" }
];

function CreateDream(id: string, title: string): DreamView
{
	return {
		id, workId: "republic", dialogue: "Republic", title,
		source: {
			documentId: "republic", start: { segmentKey: "s1", offset: 0 }, end: { segmentKey: "s1", offset: 6 }
		},
		signals: [], reflection: "", synopticView: "", linkedDreamIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01"
	};
}

function SetDreamLocator(dream: DreamView, locator: string): DreamView
{
	const segmentKey = locator === "326a" ? "s0" : "s1";
	const endOffset = locator === "326a" ? 7 : 6;
	dream.source = {
		documentId: "republic",
		start: { segmentKey, offset: 0 },
		end: { segmentKey, offset: endOffset }
	};
	return dream;
}

function CreateIdea(): IdeaRecord
{
	return {
		id: "idea-1", workId: "republic", title: "Justice", content: "Justice across the dialogue",
		originSignal: { signalId: "signal-1" }, relatedSignals: [],
		createdAt: "2026-01-01", updatedAt: "2026-01-01"
	};
}

// Dispatches one native-style Chora Signal drop.
function DropSignal(target: HTMLElement, signalId: string): void
{
	const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
	const dataTransfer = {
		types: ["application/x-chora-signal"],
		dropEffect: "none",
		effectAllowed: "copy",
		getData: function GetData(type: string): string
		{
			const value = type === "application/x-chora-signal" ? signalId : "";

			return value;
		},
		setData: function SetData(): void
		{
		}
	};
	Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
	target.dispatchEvent(event);
}

afterEach(function Cleanup(): void
{
	document.body.replaceChildren();
	window.sessionStorage.clear();
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("WorkspacePanel", function WorkspacePanelTests()
{
	it("opens a new Idea created from the Signal picker", async function OpensCreatedIdeaAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const dreamStore = new DreamStore(new SessionStore());
		const dream = CreateDream("dream-1", "Descent");
		dreamStore.SetCatalogue([dream]);
		dreamStore.Open(dream, false);
		const dreamController = new DreamController(events, errors, library, dreamStore, new DreamGateway());
		const ideaStore = new IdeaStore();
		ideaStore.SetWork("republic", []);
		const ideaGateway = new IdeaGateway();
		const saveIdea = vi.spyOn(ideaGateway, "SaveAsync").mockImplementation(async function SaveCreatedIdea(command): Promise<IdeaRecord>
		{
			return {
				id: "saved-idea",
				workId: command.workId,
				title: command.title,
				content: command.content,
				originSignal: structuredClone(command.originSignal),
				relatedSignals: structuredClone(command.relatedSignals),
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01"
			};
		});
		const ideaController = new IdeaController(events, errors, ideaStore, ideaGateway);
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);
		let selectedKind: string | null = null;
		events.Subscribe("workspace.document-selected", function CaptureSelection(event): void
		{
			selectedKind = event.kind;
		});

		ideaController.BeginAddToIdea({ signalId: "signal-1" });
		await vi.waitFor(function PickerOpened(): void
		{
			expect(document.querySelector<HTMLElement>("[data-picker-new-idea]")?.closest<HTMLElement>(".popup-overlay")?.hidden).toBe(false);
		});
		document.querySelector<HTMLButtonElement>("[data-picker-new-idea]")?.click();

		await vi.waitFor(function IdeaOpened(): void
		{
			expect(ideaStore.GetDraft()?.originSignal).toEqual({ signalId: "signal-1" });
			expect(ideaStore.GetDraft()?.ideaId).toBe("saved-idea");
			expect(ideaStore.GetIdeas().map(function SelectId(idea): string { return idea.id; })).toContain("saved-idea");
			expect(explorer.querySelector("[data-workspace-idea='saved-idea']")).not.toBeNull();
			expect(tabs.querySelector("[data-workspace-tab='saved-idea']")).not.toBeNull();
			expect(tabs.querySelector("[data-workspace-tab-kind='idea']")?.getAttribute("aria-selected")).toBe("true");
			expect(selectedKind).toBe("idea");
		});
		expect(saveIdea).toHaveBeenCalledWith(expect.objectContaining({
			ideaId: null,
			originSignal: { signalId: "signal-1" }
		}));

		panel.Dispose();
		dreamStore.Dispose();
	});

	it("prompts to save a populated new Idea before closing it", async function SavesNewIdeaOnCloseAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const dreamStore = new DreamStore(new SessionStore());
		const dreamController = new DreamController(events, errors, library, dreamStore, new DreamGateway());
		const ideaStore = new IdeaStore();
		ideaStore.SetWork("republic", []);
		const gateway = new IdeaGateway();
		const save = vi.spyOn(gateway, "SaveAsync");
		save.mockRejectedValueOnce(new Error("Disk unavailable"));
		save.mockImplementation(async function SaveIdea(command): Promise<IdeaRecord>
		{
			return {
				id: "saved-idea",
				workId: command.workId,
				title: command.title,
				content: command.content,
				originSignal: structuredClone(command.originSignal),
				relatedSignals: structuredClone(command.relatedSignals),
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01"
			};
		});
		const ideaController = new IdeaController(events, errors, ideaStore, gateway);
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);
		await ideaController.CreateAsync();
		ideaController.Update("The Good", "A question that should be preserved.");
		await vi.waitFor(function NewIdeaTabShown(): void
		{
			expect(tabs.querySelector("[data-close-workspace-tab='new']")).not.toBeNull();
		});

		tabs.querySelector<HTMLButtonElement>("[data-close-workspace-tab='new']")?.click();

		const prompt = document.querySelector<HTMLElement>("[data-unsaved-idea-save]")?.closest<HTMLElement>(".popup-overlay");
		expect(prompt?.hidden).toBe(false);
		expect(prompt?.textContent).toContain("This Idea has not been saved.");
		prompt?.querySelector<HTMLButtonElement>("[data-unsaved-idea-save]")?.click();

		await vi.waitFor(function FailedSavePreservesDraft(): void
		{
			expect(prompt?.querySelector<HTMLElement>("[data-unsaved-idea-error]")?.hidden).toBe(false);
			expect(ideaStore.GetDraft()?.title).toBe("The Good");
		});

		prompt?.querySelector<HTMLButtonElement>("[data-unsaved-idea-save]")?.click();

		await vi.waitFor(function SavedIdeaClosed(): void
		{
			expect(save).toHaveBeenCalledTimes(2);
			expect(ideaStore.GetIdea("saved-idea")?.content).toBe("A question that should be preserved.");
			expect(ideaStore.GetDraft()).toBeNull();
			expect(prompt?.hidden).toBe(true);
		});

		panel.Dispose();
		dreamStore.Dispose();
	});

	it("associates dropped Signals with existing or new Ideas", async function DropsSignalsAsync()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const sessions = new SessionStore();
		const dreamStore = new DreamStore(sessions);
		const dreamController = new DreamController(events, errors, library, dreamStore, new DreamGateway());
		const existing = CreateIdea();
		const ideaStore = new IdeaStore(sessions);
		ideaStore.SetWork("republic", [existing]);
		const gateway = new IdeaGateway();
		vi.spyOn(gateway, "SaveAsync").mockImplementation(async function SaveIdea(command): Promise<IdeaRecord>
		{
			return {
				...existing,
				originSignal: structuredClone(command.originSignal),
				relatedSignals: structuredClone(command.relatedSignals)
			};
		});
		const ideaController = new IdeaController(events, errors, ideaStore, gateway);
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);
		const existingTarget = explorer.querySelector<HTMLElement>("[data-workspace-idea='idea-1']");

		if (existingTarget !== null) DropSignal(existingTarget, "signal-2");

		await vi.waitFor(function ExistingIdeaUpdated(): void
		{
			expect(ideaStore.GetDraft()?.relatedSignals).toContainEqual({ signalId: "signal-2" });
		});

		const heading = explorer.querySelector<HTMLElement>('[data-workspace-toggle="ideas"]');
		if (heading !== null) DropSignal(heading, "signal-3");

		await vi.waitFor(function NewIdeaCreated(): void
		{
			expect(ideaStore.GetDraft()?.ideaId).toBeNull();
			expect(ideaStore.GetDraft()?.originSignal).toEqual({ signalId: "signal-3" });
		});

		panel.Dispose();
		dreamStore.Dispose();
	});

	it("renders one Plato Explorer and mixed Idea/Dream document tabs", async function RendersUnifiedWorkspaceAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const sessions = new SessionStore();
		const dreamStore = new DreamStore(sessions);
		const first = CreateDream("dream-1", "Descent");
		const second = SetDreamLocator(CreateDream("dream-2", "Return"), "326a");
		dreamStore.SetCatalogue([first, second]);
		dreamStore.Open(first, false);
		const dreamGateway = new DreamGateway();
		vi.spyOn(dreamGateway, "ListAsync").mockResolvedValue([first, second]);
		const save = vi.spyOn(dreamGateway, "SaveAsync").mockImplementation(async (dream) => structuredClone(dream));
		const copy = vi.spyOn(dreamGateway, "CopyAsync").mockResolvedValue(undefined);
		const deleteDream = vi.spyOn(dreamGateway, "DeleteAsync").mockResolvedValue();
		const dreamController = new DreamController(events, errors, library, dreamStore, dreamGateway);
		const ideaStore = new IdeaStore(sessions);
		ideaStore.SetWork("republic", [CreateIdea()]);
		const ideaGateway = new IdeaGateway();
		const deleteIdea = vi.spyOn(ideaGateway, "DeleteAsync").mockResolvedValue();
		const ideaController = new IdeaController(events, errors, ideaStore, ideaGateway);
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);

		ideaController.BeginAddToIdea({ signalId: "signal-2" });
		await vi.waitFor(function IdeaPickerOpened(): void
		{
			const create = document.querySelector<HTMLButtonElement>("[data-picker-new-idea]");
			const picker = create?.closest<HTMLElement>(".popup-overlay");
			expect(picker?.hidden).toBe(false);
			expect(picker?.textContent).toContain("Justice");
			expect(picker?.textContent).toContain("Create new Idea");
			expect(create?.classList.contains("idea-picker-new")).toBe(true);
			expect(create?.querySelector("svg")).not.toBeNull();
			const rows = picker?.querySelectorAll<HTMLButtonElement>(".idea-picker-list > .idea-picker-item");
			expect(rows).toHaveLength(1);
			expect(rows?.[0]?.textContent).toBe("Justice");
			expect(rows?.[0]?.querySelector("svg")).not.toBeNull();
		});
		document.querySelector<HTMLElement>("[data-picker-new-idea]")?.closest<HTMLElement>(".popup-overlay")?.querySelector<HTMLButtonElement>(".popup-close")?.click();
		expect(ideaStore.GetPendingAddReference()).toBeNull();

		expect(explorer.textContent).toContain("Plato");
		expect(explorer.textContent).toContain("Republic");
		expect(explorer.querySelector("[data-workspace-search]")?.getAttribute("placeholder")).toBe("Filter Ideas and Dreams…");
		expect(explorer.textContent).toContain("Add work…");
		expect(explorer.textContent).toContain("Ideas");
		expect(explorer.textContent).toContain("Dreams");
		const ideasFolder = explorer.querySelector<HTMLButtonElement>('[data-workspace-toggle="ideas"]')!;
		ideasFolder.click();
		expect(explorer.querySelector('[data-workspace-toggle="ideas"]')?.getAttribute("aria-expanded")).toBe("false");
		panel.FocusExplorerSection("idea");
		expect(explorer.querySelector('[data-workspace-toggle="ideas"]')?.getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(explorer.querySelector('[data-workspace-toggle="ideas"]'));
		const dreamsFolder = explorer.querySelector<HTMLButtonElement>('[data-workspace-toggle="dreams"]')!;
		dreamsFolder.click();
		expect(explorer.querySelector('[data-workspace-toggle="dreams"]')?.getAttribute("aria-expanded")).toBe("false");
		panel.FocusExplorerSection("dream");
		expect(explorer.querySelector('[data-workspace-toggle="dreams"]')?.getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(explorer.querySelector('[data-workspace-toggle="dreams"]'));
		expect(explorer.textContent).toContain("Book I");
		expect(explorer.textContent).toContain("Descent (327a)");
		const dreamRows = Array.from(explorer.querySelectorAll<HTMLElement>("[data-workspace-dream]"));
		expect(dreamRows.map(function GetDreamTitle(row): string
		{
			return row.textContent?.trim() ?? "";
		})).toEqual(["Return (326a)", "Descent (327a)"]);
		expect(explorer.textContent).not.toContain("Chat");
		expect(explorer.querySelectorAll("[data-rename-workspace-dream]")).toHaveLength(1);
		expect(explorer.querySelector("[data-rename-workspace-dream]")?.getAttribute("data-rename-workspace-dream")).toBe("dream-1");
		const newDream = explorer.querySelector<HTMLButtonElement>("[data-new-workspace-dream]")!;
		expect(newDream.disabled).toBe(true);
		expect(newDream.parentElement?.title).toBe("Select a passage to create a Dream");

		explorer.querySelector<HTMLButtonElement>("[data-rename-workspace-dream]")!.click();
		const renameInput = document.querySelector<HTMLInputElement>("[data-workspace-dream-title]")!;
		expect(renameInput.value).toBe("Descent");
		renameInput.value = "The Descent";
		renameInput.form!.requestSubmit();
		await vi.waitFor(function DreamRenamed(): void
		{
			expect(dreamStore.GetActiveDream()?.title).toBe("The Descent");
			expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "The Descent" }));
			expect(document.querySelector<HTMLElement>("[data-workspace-dream-title]")?.closest<HTMLElement>(".popup-overlay")?.hidden).toBe(true);
		});

		library.SetSelection(first.source);
		await events.PublishAsync("library.selection-changed", {});
		expect(explorer.querySelector<HTMLButtonElement>("[data-new-workspace-dream]")?.disabled).toBe(false);

		expect(tabs.querySelectorAll("[data-workspace-tab]")).toHaveLength(1);
		expect(tabs.querySelector("[data-workspace-tab-kind='dream']")?.textContent).toContain("Descent");
		const actions = Array.from(tabs.querySelectorAll<HTMLButtonElement>(".action-menu-items > button"), (button) => button.textContent?.trim());
		expect(actions).toEqual(["Save", "Close", "Delete", "Copy as Markdown"]);
		tabs.querySelector<HTMLButtonElement>("[data-workspace-copy-dream]")?.click();
		await vi.waitFor(function Copied(): void { expect(copy).toHaveBeenCalledOnce(); });
		tabs.querySelector<HTMLButtonElement>("[data-workspace-delete-dream]")?.click();
		const deletePrompt = document.querySelector<HTMLElement>("[data-dream-delete-confirm]")?.closest<HTMLElement>(".popup-overlay");
		expect(deletePrompt?.hidden).toBe(false);
		expect(deletePrompt?.textContent).toContain("The Descent");
		expect(document.activeElement).toBe(deletePrompt?.querySelector("[data-dream-delete-cancel]"));
		deletePrompt?.querySelector<HTMLButtonElement>("[data-dream-delete-cancel]")?.click();
		expect(deleteDream).not.toHaveBeenCalled();

		explorer.querySelector<HTMLButtonElement>("[data-workspace-idea='idea-1']")?.click();
		await vi.waitFor(function IdeaOpened(): void
		{
			expect(tabs.querySelectorAll("[data-workspace-tab]")).toHaveLength(2);
		});
		expect(tabs.querySelector("[data-workspace-tab-kind='idea']")?.getAttribute("aria-selected")).toBe("true");
		const ideaActions = Array.from(tabs.querySelectorAll<HTMLButtonElement>(".action-menu-items > button"), (button) => button.textContent?.trim());
		expect(ideaActions).toEqual(["Save", "Close", "Delete"]);
		tabs.querySelector<HTMLButtonElement>("[data-workspace-delete-idea]")?.click();
		const ideaDeletePrompt = document.querySelector<HTMLElement>("[data-idea-delete-confirm]")?.closest<HTMLElement>(".popup-overlay");
		expect(ideaDeletePrompt?.hidden).toBe(false);
		expect(ideaDeletePrompt?.textContent).toContain("Justice");
		expect(document.activeElement).toBe(ideaDeletePrompt?.querySelector("[data-idea-delete-cancel]"));
		ideaDeletePrompt?.querySelector<HTMLButtonElement>("[data-idea-delete-cancel]")?.click();
		expect(deleteIdea).not.toHaveBeenCalled();

		explorer.querySelector<HTMLButtonElement>("[data-workspace-dream='dream-2']")?.click();
		await vi.waitFor(function SecondDreamOpened(): void
		{
			expect(tabs.querySelectorAll("[data-workspace-tab]")).toHaveLength(3);
		});
		expect(tabs.querySelector("[data-workspace-tab='dream-2']")?.getAttribute("aria-selected")).toBe("true");
		expect(explorer.querySelectorAll("[data-rename-workspace-dream]")).toHaveLength(1);
		expect(explorer.querySelector("[data-rename-workspace-dream]")?.getAttribute("data-rename-workspace-dream")).toBe("dream-2");

		let returnCount = 0;
		events.Subscribe("idea.return-requested", function CountReturn(): void { returnCount += 1; });
		panel.SetIdeaReturnAvailable(true);
		tabs.querySelector<HTMLButtonElement>("[data-return-to-idea]")?.click();
		await Promise.resolve();
		expect(returnCount).toBe(1);

		const search = explorer.querySelector<HTMLInputElement>("[data-workspace-search]")!;
		search.value = "justice";
		search.dispatchEvent(new Event("input", { bubbles: true }));
		expect(explorer.textContent).toContain("Justice");
		expect(explorer.textContent).not.toContain("Descent (327a)");

		let requestedWorkId = "";
		events.Subscribe("library.text-open-requested", function CaptureRequestedWork(event): void { requestedWorkId = event.textId; });
		explorer.querySelector<HTMLButtonElement>("[data-add-work]")?.click();
		const workFilter = document.querySelector<HTMLElement>(".work-picker-search")!;
		expect(workFilter.classList.contains("application-find")).toBe(true);
		expect(workFilter.classList.contains("dream-search")).toBe(false);
		const addPhaedo = document.querySelector<HTMLButtonElement>("[data-add-library-work='phaedo']")!;
		expect(addPhaedo.textContent).toContain("Phaedo");
		addPhaedo.click();
		await Promise.resolve();
		expect(requestedWorkId).toBe("phaedo");
		expect(window.localStorage.getItem("chora:workspace-works")).toContain("phaedo");
		expect(explorer.textContent).toContain("Phaedo");

		panel.Dispose();
		dreamStore.Dispose();
	});

	it("opens an existing Idea when a Signal membership requests it", async function OpensSignalIdeaAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const dreamStore = new DreamStore(new SessionStore());
		const dreamController = new DreamController(events, errors, library, dreamStore, new DreamGateway());
		const ideaStore = new IdeaStore();
		ideaStore.SetWork("republic", [CreateIdea()]);
		const ideaController = new IdeaController(events, errors, ideaStore, new IdeaGateway());
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);
		let selectedKind: string | null = null;
		events.Subscribe("workspace.document-selected", (event) => { selectedKind = event.kind; });

		await events.PublishAsync("idea.open-requested", { ideaId: "idea-1" });

		expect(ideaStore.GetDraft()?.ideaId).toBe("idea-1");
		expect(tabs.querySelector("[data-workspace-tab-kind='idea']")?.getAttribute("aria-selected")).toBe("true");
		expect(selectedKind).toBe("idea");
		panel.Dispose();
		dreamStore.Dispose();
	});

	it("reveals and focuses the existing Ideas chooser when adding a Signal", async function RevealsAddToIdeaAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const library = new LibraryStore();
		library.SetLibrary(works);
		library.Open(text, null);
		const dreamStore = new DreamStore(new SessionStore());
		const dreamController = new DreamController(events, errors, library, dreamStore, new DreamGateway());
		const ideaStore = new IdeaStore();
		ideaStore.SetWork("republic", [CreateIdea()]);
		const ideaController = new IdeaController(events, errors, ideaStore, new IdeaGateway());
		const explorer = document.createElement("div");
		const tabs = document.createElement("div");
		document.body.append(explorer, tabs);
		const panel = new WorkspacePanel(explorer, tabs, events, dreamStore, dreamController, ideaStore, ideaController, library);
		const search = explorer.querySelector<HTMLInputElement>("[data-workspace-search]")!;
		search.value = "nothing";
		search.dispatchEvent(new Event("input", { bubbles: true }));
		explorer.querySelector<HTMLButtonElement>('[data-workspace-toggle="ideas"]')!.click();
		explorer.querySelector<HTMLButtonElement>('[data-workspace-toggle="work:republic"]')!.click();

		ideaController.BeginAddToIdea({ signalId: "signal-2" });

		await vi.waitFor(function ChooserRevealed(): void
		{
			expect(explorer.querySelector<HTMLInputElement>("[data-workspace-search]")?.value).toBe("");
			expect(explorer.querySelector('[data-workspace-toggle="ideas"]')?.getAttribute("aria-expanded")).toBe("true");
			expect(explorer.querySelector('[data-workspace-toggle="work:republic"]')?.getAttribute("aria-expanded")).toBe("true");
			const pickerIdea = document.querySelector<HTMLButtonElement>('[data-picker-idea="idea-1"]');
			expect(pickerIdea?.closest<HTMLElement>(".popup-overlay")?.hidden).toBe(false);
			expect(document.activeElement).toBe(pickerIdea);
		});

		ideaController.CancelAddToIdea();
		await vi.waitFor(function AdditionCancelled(): void
		{
			expect(ideaStore.GetPendingAddReference()).toBeNull();
		});
		ideaController.BeginAddToIdea({ signalId: "signal-1" });

		await vi.waitFor(function ConnectedIdeaExcluded(): void
		{
			expect(document.querySelector<HTMLButtonElement>('[data-picker-idea="idea-1"]')?.disabled).toBe(true);
			expect(document.activeElement).toBe(document.querySelector("[data-picker-new-idea]"));
		});

		panel.Dispose();
		dreamStore.Dispose();
	});

	it("restores open Idea tabs from the session", function RestoresIdeaTabs(): void
	{
		const sessions = new SessionStore();
		const store = new IdeaStore(sessions);
		store.SetWork("republic", [CreateIdea()]);
		store.SetDraft(store.CreateDraft(CreateIdea()));
		store.UpdateDraft("Revised Justice", "Draft content");

		const restored = new IdeaStore(sessions);
		restored.SetWork("republic", [CreateIdea()]);
		expect(restored.GetOpenTabs()).toEqual([{ key: "idea-1", ideaId: "idea-1", title: "Revised Justice" }]);
		expect(restored.GetDraft()?.content).toBe("Draft content");
	});
});
