// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TextDocument, LibraryTextSummary } from "../../src/shared/library/LibraryTypes.js";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import type { VisionController } from "../../src/renderer/visions/VisionController.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import { WorkspacePanel } from "../../src/renderer/workspace/WorkspacePanel.js";

const summary: LibraryTextSummary = {
	id: "republic",
	urn: null,
	title: "Republic",
	titleGreek: "Πολιτεία",
	author: "Plato",
	language: "grc",
	editor: null
};

const text: TextDocument = {
	...summary,
	textVersion: `sha256:${"0".repeat(64)}`,
	edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
	provenance: { repository: "test", commit: "test", sourceFile: "republic.xml", license: "test" },
	segments: [{ key: "s1", citation: null, text: "abcdef" }]
};

function CreateVision(id: string, title: string, folderPath = ""): VisionSnapshot
{
	return {
		id,
		workId: "republic",
		folderPath,
		title,
		markdown: "",
		createdAt: "2026-09-08T00:00:00.000Z",
		updatedAt: "2026-09-08T00:00:00.000Z"
	};
}

describe("WorkspacePanel", function WorkspacePanelTests()
{
	let root: HTMLElement;
	let events: ChoraEventBus<ChoraEvents>;
	let store: VisionStore;
	let panel: WorkspacePanel;
	let controller: {
		CreateAsync: ReturnType<typeof vi.fn>;
		CreateFolderAsync: ReturnType<typeof vi.fn>;
		DeleteFolderAsync: ReturnType<typeof vi.fn>;
		MoveAsync: ReturnType<typeof vi.fn>;
		Open: ReturnType<typeof vi.fn>;
	};

	beforeEach(function Setup(): void
	{
		window.localStorage.clear();
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		const library = new LibraryStore();
		library.SetLibrary([summary, { ...summary, id: "apology", title: "Apology" }]);
		library.Open(text, null);
		store = new VisionStore();
		store.SetCatalogue({
			visions: [
				CreateVision("123e4567-e89b-42d3-a456-426614174000", "At the root"),
				CreateVision("123e4567-e89b-42d3-a456-426614174001", "Descent", "Book 1/Questions")
			],
			folders: [
				{ workId: "republic", path: "Book 1", name: "Book 1", parentPath: "" },
				{ workId: "republic", path: "Book 1/Questions", name: "Questions", parentPath: "Book 1" }
			]
		});
		controller = {
			CreateAsync: vi.fn(async () => undefined),
			CreateFolderAsync: vi.fn(async () => true),
			DeleteFolderAsync: vi.fn(async () => true),
			MoveAsync: vi.fn(async () => undefined),
			Open: vi.fn()
		};
		panel = new WorkspacePanel(root, events, library, store, controller as unknown as VisionController);
	});

	afterEach(function Cleanup(): void
	{
		panel.Dispose();
		document.body.replaceChildren();
		window.localStorage.clear();
		vi.restoreAllMocks();
	});

	it("renders nested Vision folders from the Vision catalogue", function RendersVisionFolders(): void
	{
		expect(root.textContent).toContain("Visions");
		expect(root.textContent).toContain("Book 1");
		expect(root.textContent).toContain("Questions");
		expect(root.textContent).toContain("Descent");
		const rootFolder = root.querySelector<HTMLElement>('[data-tree-drop="folder:republic:Book 1"]')?.closest<HTMLElement>(".control-tree-node");
		const nestedFolder = root.querySelector<HTMLElement>('[data-tree-drop="folder:republic:Book 1/Questions"]')?.closest<HTMLElement>(".control-tree-node");
		const nestedVision = root.querySelector<HTMLElement>('[data-workspace-vision="123e4567-e89b-42d3-a456-426614174001"]');
		expect(rootFolder?.style.getPropertyValue("--tree-depth").trim()).toBe("2");
		expect(nestedFolder?.style.getPropertyValue("--tree-depth").trim()).toBe("3");
		expect(nestedVision?.closest<HTMLElement>(".control-tree-node")?.style.getPropertyValue("--tree-depth").trim()).toBe("4");
		expect(nestedVision?.getAttribute("aria-level")).toBe("5");
		expect(nestedVision?.textContent).toContain("Descent");
		const requests = vi.fn();
		events.Subscribe("library.text-open-requested", requests);
		root.querySelector<HTMLButtonElement>("[data-add-work]")?.click();
		const chooser = document.querySelector<HTMLDialogElement>("dialog[open]")!;
		chooser.querySelector<HTMLButtonElement>('[data-list-id="apology"]')?.click();
		expect(requests).not.toHaveBeenCalled();
		expect(chooser.querySelector<HTMLButtonElement>("[data-dialog-ok]")?.disabled).toBe(false);
		chooser.querySelector<HTMLButtonElement>("[data-dialog-cancel]")?.click();
		expect(requests).not.toHaveBeenCalled();
		expect(chooser.open).toBe(false);
	});

	it("creates a Vision in the selected folder", function CreatesVisionInFolder(): void
	{
		const folder = root.querySelector<HTMLButtonElement>('[data-tree-id="folder:republic:Book 1/Questions"]')!;
		folder.focus();
		folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
		expect(folder.getAttribute("aria-expanded")).toBe("false");
		folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
		expect(folder.getAttribute("aria-expanded")).toBe("true");
		expect(controller.CreateAsync).not.toHaveBeenCalled();
		root.querySelector<HTMLButtonElement>('[data-tree-drop="folder:republic:Book 1/Questions"] > .control-tree-row [data-tree-action="new-vision"]')?.click();
		expect(controller.CreateAsync).toHaveBeenCalledWith("republic", "Book 1/Questions");
	});

	it("creates a nested Vision folder", async function CreatesFolderAsync(): Promise<void>
	{
		root.querySelector<HTMLButtonElement>('[data-tree-drop="folder:republic:Book 1"] > .control-tree-row [data-tree-action="new-folder"]')?.click();
		const input = document.querySelector<HTMLInputElement>('dialog[open] [data-folder-name]')!;
		input.value = "Notes";
		input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await vi.waitFor(() =>
		{
			expect(controller.CreateFolderAsync).toHaveBeenCalledWith("republic", "Book 1", "Notes");
		});
	});

	it("keeps the folder form open when creation fails", async function KeepsFailedFolderFormAsync(): Promise<void>
	{
		controller.CreateFolderAsync.mockResolvedValueOnce(false);
		root.querySelector<HTMLButtonElement>('[data-tree-drop="folder:republic:Book 1"] > .control-tree-row [data-tree-action="new-folder"]')?.click();
		const input = document.querySelector<HTMLInputElement>('dialog[open] [data-folder-name]')!;
		input.value = "Notes";
		input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

		await vi.waitFor(() =>
		{
			expect(controller.CreateFolderAsync).toHaveBeenCalled();
		});
		expect(input.closest(".dialog-control")?.hasAttribute("hidden")).toBe(false);
		expect(input.value).toBe("Notes");
	});

	it("moves a Vision by dropping it into a folder", async function MovesVisionAsync(): Promise<void>
	{
		const row = root.querySelector<HTMLElement>('[data-workspace-vision="123e4567-e89b-42d3-a456-426614174000"]')!;
		const folder = root.querySelector<HTMLElement>('[data-tree-drop="folder:republic:Book 1"]')!;
		const transfer = new DataTransfer();
		const start = new DragEvent("dragstart", { bubbles: true });
		Object.defineProperty(start, "dataTransfer", { value: transfer });
		row.dispatchEvent(start);
		const drop = new DragEvent("drop", { bubbles: true });
		Object.defineProperty(drop, "dataTransfer", { value: transfer });
		folder.dispatchEvent(drop);

		await vi.waitFor(() =>
		{
			expect(controller.MoveAsync).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000", "Book 1");
		});
	});

	it("opens a Vision from its Explorer row", function OpensVision(): void
	{
		root.querySelector<HTMLButtonElement>('[data-workspace-vision="123e4567-e89b-42d3-a456-426614174001"]')?.click();
		expect(controller.Open).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174001");
	});
});
