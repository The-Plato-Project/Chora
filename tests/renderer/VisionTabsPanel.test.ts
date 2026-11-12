// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import type { VisionController } from "../../src/renderer/visions/VisionController.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import { VisionTabsPanel } from "../../src/renderer/workspace/VisionTabsPanel.js";

function CreateVision(id: string, title: string): VisionSnapshot
{
	return {
		id,
		workId: "republic",
		folderPath: "",
		title,
		markdown: "",
		createdAt: "2026-09-08T00:00:00.000Z",
		updatedAt: "2026-09-08T00:00:00.000Z"
	};
}

describe("VisionTabsPanel", function VisionTabsPanelTests()
{
	let root: HTMLElement;
	let events: ChoraEventBus<ChoraEvents>;
	let store: VisionStore;
	let panel: VisionTabsPanel;
	let controller: {
		ActivateTab: ReturnType<typeof vi.fn>;
		CloseTabAsync: ReturnType<typeof vi.fn>;
		SaveAsync: ReturnType<typeof vi.fn>;
		CopyAsMarkdownAsync: ReturnType<typeof vi.fn>;
		DeleteAsync: ReturnType<typeof vi.fn>;
		Open: ReturnType<typeof vi.fn>;
	};

	beforeEach(function Setup(): void
	{
		window.sessionStorage.clear();
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		store = new VisionStore();
		store.SetCatalogue({
			visions: [
				CreateVision("123e4567-e89b-42d3-a456-426614174000", "Descent"),
				CreateVision("123e4567-e89b-42d3-a456-426614174001", "Justice")
			],
			folders: []
		});
		store.Open("123e4567-e89b-42d3-a456-426614174000");
		store.Open("123e4567-e89b-42d3-a456-426614174001");
		controller = {
			ActivateTab: vi.fn(),
			CloseTabAsync: vi.fn(async () => undefined),
			SaveAsync: vi.fn(async () => undefined),
			CopyAsMarkdownAsync: vi.fn(async () => undefined),
			DeleteAsync: vi.fn(async () => undefined),
			Open: vi.fn()
		};
		panel = new VisionTabsPanel(root, events, store, controller as unknown as VisionController);
	});

	afterEach(function Cleanup(): void
	{
		panel.Dispose();
		document.body.replaceChildren();
		window.sessionStorage.clear();
	});

	it("renders open tabs and patches one dirty indicator", async function PatchesDirtyTabAsync(): Promise<void>
	{
		expect(root.querySelectorAll("[data-workspace-vision-tab]")).toHaveLength(2);
		expect(root.querySelector(".document-tab.selected [data-document-title]")?.textContent).toBe("Justice");

		store.Update("123e4567-e89b-42d3-a456-426614174000", { markdown: "Changed" });
		await events.PublishAsync("vision.dirty-changed", {
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			workId: "republic",
			isDirty: true
		});

		const tab = root.querySelector('[data-workspace-vision-tab="123e4567-e89b-42d3-a456-426614174000"]')?.parentElement;
		expect(tab?.querySelector(".document-tab-dirty")).not.toBeNull();
		expect(root.querySelectorAll("[data-workspace-vision-tab]")).toHaveLength(2);
	});

	it("routes tab activation and closing to the Vision controller", function RoutesTabActions(): void
	{
		root.querySelector<HTMLButtonElement>('[data-workspace-vision-tab="123e4567-e89b-42d3-a456-426614174000"]')?.click();
		root.querySelector<HTMLButtonElement>('[data-close-workspace-vision-tab="123e4567-e89b-42d3-a456-426614174001"]')?.click();

		expect(controller.ActivateTab).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174000");
		expect(controller.CloseTabAsync).toHaveBeenCalledWith("123e4567-e89b-42d3-a456-426614174001");
	});

	it("offers save and copy actions from the Vision context menu", async function UsesContextMenuAsync(): Promise<void>
	{
		const tab = root.querySelector<HTMLElement>('[data-workspace-vision-tab="123e4567-e89b-42d3-a456-426614174001"]')!;
		tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 30 }));
		await vi.waitFor(() =>
		{
			expect(root.querySelector<HTMLElement>("[data-vision-document-menu]")?.hidden).toBe(false);
		});

		root.querySelector<HTMLButtonElement>("[data-workspace-save-vision]")?.click();
		expect(controller.SaveAsync).toHaveBeenCalled();

		tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		root.querySelector<HTMLButtonElement>("[data-workspace-copy-vision]")?.click();
		expect(controller.CopyAsMarkdownAsync).toHaveBeenCalled();
	});
});
