// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";
import { SerializeVisionReference } from "../../src/shared/visions/VisionReferenceMarkdown.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { VisionController } from "../../src/renderer/visions/VisionController.js";
import type { VisionGateway } from "../../src/renderer/visions/VisionGateway.js";
import { VisionPanel } from "../../src/renderer/visions/VisionPanel.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import type { VisionReferencePlacement } from "../../src/shared/visions/VisionReferenceTypes.js";

function CreateVision(id: string, title: string): VisionSnapshot
{
	return {
		id,
		workId: "republic",
		folderPath: "",
		title,
		markdown: `# ${title}`,
		createdAt: "2026-09-08T00:00:00.000Z",
		updatedAt: "2026-09-08T00:00:00.000Z"
	};
}

afterEach(function Cleanup(): void
{
	document.body.replaceChildren();
	window.sessionStorage.clear();
});

describe("VisionPanel", function VisionPanelTests()
{
	it("remembers Write, Markdown, and Preview mode independently inside each Vision tab", async function RemembersModePerVisionAsync(): Promise<void>
	{
		const root = document.createElement("div");
		document.body.append(root);
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new VisionStore();
		const first = {
			...CreateVision("123e4567-e89b-42d3-a456-426614174000", "Money"),
			markdown: "Measurement of the Logos\\\n\\\nThe following prose.\n---"
		};
		const second = CreateVision("123e4567-e89b-42d3-a456-426614174001", "Seeing");
		store.SetCatalogue({ visions: [first, second], folders: [] });
		const update = vi.fn().mockRejectedValue(new Error("file locked"));
		const controller = new VisionController(events, errors, store, { UpdateAsync: update } as unknown as VisionGateway);
		const panel = new VisionPanel(root, events, errors, store, controller);

		store.Open(first.id);
		await events.PublishAsync("vision.opened", {});
		expect(root.querySelector("[data-vision-title]")).toBeNull();
		await vi.waitFor(function EditorReady(): void
		{
			expect(root.querySelector<HTMLSelectElement>("[data-markdown-heading]")?.disabled).toBe(false);
		});
		const writing = root.querySelector<HTMLElement>("[contenteditable=true]")!;
		expect(writing.querySelector("h2")?.textContent).toBe("Measurement of the Logos");
		expect(writing.querySelector("p")?.textContent).toBe("The following prose.");
		root.querySelector<HTMLButtonElement>('[data-tab-id="markdown"]')?.click();
		expect(store.GetActive()?.markdown.trim()).toBe("## Measurement of the Logos\n\nThe following prose.");
		expect(root.querySelector('[data-tab-id="markdown"]')?.getAttribute("aria-selected")).toBe("true");
		expect(root.querySelector(".vision-markdown-source")?.textContent).toContain("## Measurement of the Logos");

		store.Open(second.id);
		await events.PublishAsync("vision.opened", {});
		expect(root.querySelector('[data-tab-id="write"]')?.getAttribute("aria-selected")).toBe("true");

		store.Activate(first.id);
		await events.PublishAsync("vision.opened", {});
		expect(root.querySelector('[data-tab-id="markdown"]')?.getAttribute("aria-selected")).toBe("true");

		await events.PublishAsync("vision.rename-requested", {});
		expect(document.querySelector<HTMLInputElement>('[data-vision-rename-title]')?.value).toBe("Money");
		document.querySelector<HTMLButtonElement>("[data-dialog-cancel]")?.click();
		const notifications = vi.fn();
		events.Subscribe("error.reported", notifications);
		const source = root.querySelector(".vision-markdown-source");
		controller.UpdateMarkdown("Changed writing");
		await controller.SaveAsync(first.id);
		expect(store.IsDirty(first.id)).toBe(true);
		expect(root.querySelector<HTMLElement>(".vision-save-notice")?.hidden).toBe(false);
		expect(root.querySelector(".vision-save-notice")?.textContent).toContain("Unsaved changes");
		expect(notifications).not.toHaveBeenCalled();
		expect(root.querySelector(".vision-markdown-source")).toBe(source);
		update.mockResolvedValue({ ...first, markdown: "Changed writing" });
		root.querySelector<HTMLButtonElement>("[data-vision-retry-save]")?.click();
		await vi.waitFor(function SavedWithoutRemounting(): void
		{
			expect(store.IsDirty(first.id)).toBe(false);
			expect(root.querySelector<HTMLElement>(".vision-save-notice")?.hidden).toBe(true);
			expect(root.querySelector(".vision-markdown-source")).toBe(source);
		});

		panel.Dispose();
		controller.Dispose();
	});

	it("inserts a created word reference into the active Vision writing cursor", async function InsertsReferenceAsync(): Promise<void>
	{
		const root = document.createElement("div");
		document.body.append(root);
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new VisionStore();
		const vision = CreateVision("123e4567-e89b-42d3-a456-426614174000", "Money");
		store.SetCatalogue({ visions: [vision], folders: [] });
		store.Open(vision.id);
		const controller = new VisionController(events, errors, store, {} as VisionGateway);
		const panel = new VisionPanel(root, events, errors, store, controller);
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: vision.id,
			anchorId: `anchor:sha256:${"b".repeat(64)}`,
			presentation: "inline-word",
			label: "λόγος"
		};
		await events.PublishAsync("vision.opened", {});

		await events.PublishAsync("vision.reference-created", { placement });

		const reference = root.querySelector<HTMLElement>("[data-vision-reference]");
		expect(reference?.textContent).toBe("λόγος");
		expect(reference?.dataset.anchorId).toBe(placement.anchorId);
		expect(store.GetActive()?.markdown).toContain(placement.id);
		await events.PublishAsync("vision.reference-open-requested", {
			visionId: vision.id,
			placementId: placement.id
		});
		expect(root.querySelector("[data-vision-reference]")?.classList.contains("ProseMirror-selectednode")).toBe(true);

		panel.Dispose();
		controller.Dispose();
	});

	it("conceals Vision reference identities in Markdown mode and copied Markdown", async function ConcealsReferenceMetadataAsync(): Promise<void>
	{
		const root = document.createElement("div");
		document.body.append(root);
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const store = new VisionStore();
		const vision = CreateVision("123e4567-e89b-42d3-a456-426614174000", "Money");
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: vision.id,
			anchorId: `anchor:sha256:${"b".repeat(64)}`,
			presentation: "inline-word",
			label: "κατέβην"
		};
		const directive = SerializeVisionReference(placement);
		const markdown = `Before ${directive} after`;
		store.SetCatalogue({ visions: [{ ...vision, markdown }], folders: [] });
		store.Open(vision.id);
		const CopyMarkdownAsync = vi.fn(async () => undefined);
		const controller = new VisionController(events, errors, store, { CopyMarkdownAsync } as unknown as VisionGateway);
		const panel = new VisionPanel(root, events, errors, store, controller);
		await events.PublishAsync("vision.opened", {});

		root.querySelector<HTMLButtonElement>('[data-tab-id="markdown"]')?.click();

		const token = root.querySelector<HTMLElement>(".vision-markdown-word-reference");
		expect(token?.textContent).toBe("[[κατέβην]]");
		expect(token?.getAttribute("aria-label")).toBe("Greek word reference: κατέβην");
		expect(root.textContent).not.toContain(placement.anchorId);
		expect(root.textContent).not.toContain(placement.id);
		expect(store.GetActive()?.markdown).toBe(markdown);

		await controller.CopyAsMarkdownAsync();
		expect(CopyMarkdownAsync).toHaveBeenCalledWith("Before [[κατέβην]] after");
		expect(store.GetActive()?.markdown).toBe(markdown);

		root.querySelector<HTMLButtonElement>('[data-tab-id="write"]')?.click();
		await vi.waitFor(() =>
		{
			expect(root.querySelector("[data-vision-reference]")?.textContent).toBe("κατέβην");
		});

		panel.Dispose();
		controller.Dispose();
	});

});
