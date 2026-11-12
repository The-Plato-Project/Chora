// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { StudyStore } from "../../src/renderer/study/StudyStore.js";
import { StudyGateway } from "../../src/renderer/study/StudyGateway.js";
import { StudyController } from "../../src/renderer/study/StudyController.js";
import { StudyPanel } from "../../src/renderer/study/StudyPanel.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";
import type { StudyConversation, StudySendCommand, StudyUpdate } from "../../src/shared/study/StudyTypes.js";

// Disposable canonical documents exercise real work navigation.
function CreateWork(id: string): TextDocument
{
	const document = TextDocument.FromSnapshot({ id, textVersion: "sha256:" + "0".repeat(64), urn: null, title: id, titleGreek: null, author: "Plato", language: "grc",
		edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
		provenance: { repository: "fixture", commit: "fixture", sourceFile: "fixture", license: "fixture" }, segments: [{ key: "327a", citation: null, text: "κατέβην" }] });
	return document;
}

// Disposable host boundary preserves per-work history without invoking a model.
class FixtureGateway extends StudyGateway
{
	// Retains the same removable streaming capability as production.
	public Callback: ((update: StudyUpdate) => void) | null = null;
	// Holds one response so navigation and Stop can interrupt it.
	public Reject: ((error: Error) => void) | null = null;
	// Captures the exact work and optional attachment submitted by the UI.
	public Command: StudySendCommand | null = null;
	// Passive history remains separate for each work.
	public readonly History = new Map<string, StudyConversation>();

	// Starting is implicit in Send; no dedicated launch API exists.
	public override SendAsync(command: StudySendCommand): Promise<StudyConversation>
	{
		this.Command = command;
		const fixture = this;
		function Pending(_resolve: (value: StudyConversation) => void, reject: (error: Error) => void): void
		{
			fixture.Reject = reject;
		}
		const result = new Promise<StudyConversation>(Pending);
		return result;
	}

	// Cancellation records partial output under its captured work.
	public override async StopAsync(workId: string): Promise<void>
	{
		if (this.Command?.workId === workId)
		{
			this.History.set(workId, { id: "fixture", scope: { workId }, model: "fixture",
				messages: [{ role: "reader", text: this.Command.text, status: "complete" }, { role: "interlocutor", text: "A possibility, still open", status: "partial" }], sources: [] });
			this.Reject?.(new Error("Cancelled fixture"));
			this.Command = null;
		}
	}

	// Loading a work never starts execution.
	public override async LoadAsync(workId: string): Promise<StudyConversation | null>
	{
		const result = this.History.get(workId) ?? null;
		return result;
	}

	// Makes subscription disposal observable.
	public override Subscribe(callback: (update: StudyUpdate) => void): () => void
	{
		this.Callback = callback;
		const fixture = this;
		function Unsubscribe(): void
		{
			fixture.Callback = null;
		}
		return Unsubscribe;
	}
}

describe("Interlocutor surface", function StudyPanelTests()
{
	it("sends ordinary chat in the current work, keeps optional context and drafts, and restores separate work histories", async function StreamsAsync()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const report = vi.spyOn(errors, "Report");
		const store = new StudyStore();
		const gateway = new FixtureGateway();
		const library = new LibraryStore();
		const visions = new VisionStore();
		visions.SetCatalogue({ visions: [{ id: "vision", workId: "republic", title: "A question", folderPath: "", markdown: "My question", createdAt: "2026-01-01", updatedAt: "2026-01-01" }], folders: [] });
		visions.Open("vision");
		library.Open(CreateWork("republic"), null);
		const controller = new StudyController(events, errors, store, gateway, library);
		const root = document.createElement("section");
		document.body.append(root);
		const panel = new StudyPanel(root, events, errors, store, controller);
		try
		{
			await vi.waitFor(function Loaded() { expect(store.GetSnapshot()?.busy).toBe(false); });
			expect(gateway.Command).toBeNull();
			expect(root.querySelector("fieldset, select, [data-study-action=start], [data-study-action=context]")).toBeNull();
			expect(root.querySelector("[data-study-action=attach]")).toBeNull();
			const input = root.querySelector("textarea")!;
			input.value = "A question";
			input.dispatchEvent(new Event("input"));
			root.querySelector<HTMLButtonElement>("[data-study-action=send]")!.click();
			await vi.waitFor(function Sent() { expect(gateway.Command).toMatchObject({ workId: "republic", text: "A question" }); });
			input.value = "Unsent thinking";
			input.dispatchEvent(new Event("input"));
			gateway.Callback?.({ workId: "absent", conversationId: "stale", kind: "text", text: "wrong" });
			gateway.Callback?.({ workId: "republic", conversationId: "fixture", kind: "text", text: "A possibility" });
			await events.PublishAsync("study.changed", {});
			const response = root.querySelector("article:last-child p");
			expect(response?.textContent).toBe("A possibility");
			gateway.Callback?.({ workId: "republic", conversationId: "fixture", kind: "replace", text: "Verified possibility" });
			await events.PublishAsync("study.changed", {});
			expect(response?.textContent).toBe("Verified possibility");
			expect(gateway.Command).not.toHaveProperty("visionDraft");
			expect(gateway.Command).not.toHaveProperty("visionId");
			gateway.Callback?.({ workId: "republic", conversationId: "fixture", kind: "text", text: ", still open" });
			await events.PublishAsync("study.changed", {});
			expect(root.querySelector("article:last-child p")).toBe(response);
			expect(root.querySelector("textarea")).toBe(input);
			expect(input.value).toBe("Unsent thinking");
			await controller.StopAsync();
			expect(store.GetSnapshot()).toMatchObject({ busy: false, status: "Stopped." });
			expect(report).not.toHaveBeenCalled();
			expect(response?.textContent).toContain("Incomplete response");
			library.Open(CreateWork("timaeus"), null);
			await events.PublishAsync("library.text-opened", {});
			expect(store.GetSnapshot()).toMatchObject({ workId: "timaeus", conversation: null, draft: "" });
			library.Open(CreateWork("republic"), null);
			await events.PublishAsync("library.text-opened", {});
			expect(store.GetSnapshot()?.conversation?.messages[1]?.text).toBe("A possibility, still open");
			expect(input.value).toBe("Unsent thinking");
		}
		finally
		{
			panel.Dispose();
			controller.Dispose();
			root.remove();
			vi.restoreAllMocks();
		}
		expect(gateway.Callback).toBeNull();
	});
});
