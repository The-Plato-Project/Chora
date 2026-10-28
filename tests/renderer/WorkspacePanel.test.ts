import { DreamSaveCoordinator } from "../../src/renderer/dreams/DreamSaveCoordinator.js";
import { DreamCatalogueController } from "../../src/renderer/dreams/DreamCatalogueController.js";
import { DreamClarityCheckController } from "../../src/renderer/dreams/DreamClarityCheckController.js";
import { DreamExportController } from "../../src/renderer/dreams/DreamExportController.js";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DreamTrashPanel } from "../../src/renderer/dreams/DreamTrashPanel.js";
import { DreamTrashController } from "../../src/renderer/dreams/DreamTrashController.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { LibraryGateway } from "../../src/renderer/library/LibraryGateway.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { WorkspacePanel } from "../../src/renderer/workspace/WorkspacePanel.js";
import { DreamExplorerController } from "../../src/renderer/workspace/DreamExplorerController.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { TextDocument, LibraryTextSummary } from "../../src/shared/library/LibraryTypes.js";

const summary: LibraryTextSummary = {
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: "Πολιτεία",
	author: "Plato",
	language: "grc",
	editor: null,
	fileName: "republic.xml"
};

const text: TextDocument = {
	id: summary.id,
	urn: summary.urn,
	title: summary.title,
	titleGreek: summary.titleGreek,
	author: summary.author,
	language: summary.language,
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: summary.fileName, license: "test" },
	segments: [{
		key: "s1",
		citation: { system: "stephanus", value: "327a" },
		division: { type: "book", label: "1" },
		text: "abcdef"
	}]
};

function CreateDream(id = "dream-1", title = "Descent"): DreamView
{
	return {
		id,
		workId: text.id,
		dialogue: text.title,
		title,
		source: {
			documentId: text.id,
			start: { segmentKey: "s1", offset: 0 },
			end: { segmentKey: "s1", offset: 3 },
			selectedText: "abc",
			locatorStart: { scheme: "Stephanus", value: "327a" },
			locatorEnd: { scheme: "Stephanus", value: "327a" }
		},
		signals: [],
		reflection: "",
		synopticView: "",
		linkedDreamIds: [],
		createdAt: "2026-09-08",
		updatedAt: "2026-09-08"
	};
}

describe("WorkspacePanel", function WorkspacePanelTests()
{
	let explorerRoot: HTMLElement;
	let tabsRoot: HTMLElement;
	let events: ChoraEventBus<ChoraEvents>;
	let dreamStore: DreamStore;
	let dreamController: DreamController;
	let saves: DreamSaveCoordinator;
	let clarity: DreamClarityCheckController;
	let catalogue: DreamCatalogueController;
	let explorer: DreamExplorerController;
	let library: LibraryStore;
	let panel: WorkspacePanel;
	// Trash feature composed alongside the Explorer under test.
	let trashPanel: DreamTrashPanel;

	beforeEach(function Setup(): void
	{
		window.localStorage.clear();
		window.sessionStorage.clear();
		explorerRoot = document.createElement("div");
		tabsRoot = document.createElement("div");
		document.body.append(explorerRoot, tabsRoot);
		events = new ChoraEventBus<ChoraEvents>();
		dreamStore = new DreamStore(new SessionStore());
		dreamStore.SetCatalogue([CreateDream()], [], [{ dreamId: "dream-1", workId: "republic", folderPath: "" }]);
		library = new LibraryStore();
		library.SetLibrary([summary]);
		library.Open(text, null);
		const errors = new ErrorManager(events);
		const gateway = new DreamGateway();
		const reader = new LibraryGateway();
		saves = new DreamSaveCoordinator(events, errors, dreamStore, gateway);
		clarity = new DreamClarityCheckController(events, errors, library, dreamStore, gateway, saves);
		catalogue = new DreamCatalogueController(events, errors, library, dreamStore, gateway, saves, clarity);
		dreamController = new DreamController(events, errors, library, dreamStore, gateway, reader, saves);
		explorer = new DreamExplorerController(dreamStore, library, gateway, events, errors, catalogue, { HasUncommittedChanges: function HasUncommittedChanges(): boolean { return false; } });
		const exporter = new DreamExportController(dreamStore, library, reader);
		const trashController = new DreamTrashController(gateway, catalogue, errors);
		trashPanel = new DreamTrashPanel(trashController);
		panel = new WorkspacePanel(explorerRoot, tabsRoot, events, dreamStore, dreamController, library, explorer, trashPanel, saves, exporter);
	});

	afterEach(function Cleanup(): void
	{
		panel.Dispose();
		trashPanel.Dispose();
		explorer.Dispose();
		catalogue.Dispose();
		clarity.Dispose();
		dreamController.Dispose();
		saves.Dispose();
		dreamStore.Dispose();
		document.body.replaceChildren();
		window.localStorage.clear();
		window.sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("opens Trash from the Explorer", function OpensTrash(): void
	{
		const open = vi.spyOn(trashPanel, "OpenAsync").mockResolvedValue();
		const trigger = explorerRoot.querySelector<HTMLButtonElement>("[data-open-dream-trash]");
		trigger?.click();
		expect(open).toHaveBeenCalledExactlyOnceWith(trigger);
	});

	it("renders a Dream-only Explorer", function RendersDreamOnlyExplorer(): void
	{
		expect(explorerRoot.textContent).toContain("Dreams");
		expect(explorerRoot.textContent).toContain("Descent");
	});

	it("opens a Dream from the Explorer and renders its tab", async function OpensDreamAsync(): Promise<void>
	{
		const open = vi.spyOn(dreamController, "Open");
		explorerRoot.querySelector<HTMLButtonElement>('[data-workspace-dream="dream-1"]')?.click();

		expect(open).toHaveBeenCalledWith("dream-1");
		await events.PublishAsync("dream.opened", {});
		expect(tabsRoot.querySelector('[data-workspace-tab="dream-1"]')?.textContent).toContain("Descent");
	});

	it("orders Dream actions as Save, Close, Delete", async function OrdersDreamActionsAsync(): Promise<void>
	{
		dreamController.Open("dream-1");
		await events.PublishAsync("dream.opened", {});
		const labels = Array.from(tabsRoot.querySelectorAll<HTMLButtonElement>(".action-menu-items button"), (button) => button.textContent?.trim());

		expect(labels.slice(0, 3)).toEqual(["Save", "Close", "Delete"]);
	});

	it("filters Dreams without changing the Library text", function FiltersDreams(): void
	{
		const input = explorerRoot.querySelector<HTMLInputElement>("[data-workspace-search]")!;
		input.value = "missing";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		expect(explorerRoot.textContent).toContain("No matching Dreams.");
		expect(library.GetText()?.id).toBe(text.id);
	});

	it("renders nested filesystem folders and Dreams in their assigned folder", async function RendersFoldersAsync(): Promise<void>
	{
		const dream = CreateDream();
		dreamStore.SetCatalogue(
			[dream],
			[
				{ workId: "republic", path: "Themes", name: "Themes", parentPath: "" },
				{ workId: "republic", path: "Themes/Justice", name: "Justice", parentPath: "Themes" }
			],
			[{ dreamId: dream.id, workId: dream.workId, folderPath: "Themes/Justice" }]);

		await events.PublishAsync("dream.catalogue-changed", { count: 1 });

		const justice = explorerRoot.querySelector<HTMLElement>('[data-dream-folder="Themes/Justice"]');
		expect(justice?.textContent).toContain("Justice");
		expect(justice?.parentElement?.querySelector('[data-workspace-dream="dream-1"]')).not.toBeNull();
		expect(justice?.querySelector<HTMLButtonElement>("[data-delete-dream-folder]")?.disabled).toBe(true);
	});

	it("selects a Shift-click range and moves the selected Dreams together", async function MovesSelectedDreamsByDropAsync(): Promise<void>
	{
		const first = CreateDream();
		const second = CreateDream("dream-2", "Justice");
		dreamStore.SetCatalogue(
			[first, second],
			[{ workId: "republic", path: "Themes", name: "Themes", parentPath: "" }],
			[
				{ dreamId: first.id, workId: first.workId, folderPath: "" },
				{ dreamId: second.id, workId: second.workId, folderPath: "" }
			]);
		await events.PublishAsync("dream.catalogue-changed", { count: 2 });
		const move = vi.spyOn(dreamController, "MoveDreamsAsync").mockResolvedValue(true);
		const transfer = new DataTransfer();
		const firstButton = explorerRoot.querySelector<HTMLElement>('[data-workspace-dream="dream-1"]');
		firstButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		const secondButton = explorerRoot.querySelector<HTMLElement>('[data-workspace-dream="dream-2"]');
		secondButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
		const item = explorerRoot.querySelector<HTMLElement>('[data-workspace-drag-dream="dream-2"]');
		const folder = explorerRoot.querySelector<HTMLElement>('[data-dream-folder="Themes"]');
		const dragStart = new DragEvent("dragstart", { bubbles: true });
		const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(dragStart, "dataTransfer", { value: transfer });
		Object.defineProperty(drop, "dataTransfer", { value: transfer });

		expect(explorerRoot.querySelector('[data-workspace-dream="dream-1"]')?.getAttribute("aria-selected")).toBe("true");
		expect(explorerRoot.querySelector('[data-workspace-dream="dream-2"]')?.getAttribute("aria-selected")).toBe("true");
		item?.dispatchEvent(dragStart);
		folder?.dispatchEvent(drop);

		await vi.waitFor(function DreamsMoved(): void
		{
			expect(move).toHaveBeenCalledWith(expect.arrayContaining(["dream-1", "dream-2"]), "Themes");
		});
	});
});
