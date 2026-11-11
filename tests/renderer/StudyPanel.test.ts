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
import type { StudyConversation, StudyStartCommand, StudyUpdate } from "../../src/shared/study/StudyTypes.js";

// Disposable execution boundary exercises UI state without launching a model.
class FixtureGateway extends StudyGateway
{
	// Streaming callback has the same owned lifetime as the production gateway.
	public Callback: ((update: StudyUpdate) => void) | null = null;
	public Reject: ((error: Error) => void) | null = null;
	public Starts = 0;
	public readonly Conversation: StudyConversation = { id: "fixture", scope: { workId: "republic", visionIds: [], selection: null }, model: "fixture", messages: [], sources: [] };
	// Records explicit launch, without performing network or filesystem work.
	public override async StartAsync(_command: StudyStartCommand): Promise<StudyConversation>
	{
		this.Starts += 1;
		return this.Conversation;
	}
	// Holds one response so tests can stop it while rendering streamed text.
	public override SendAsync(_id: string, _text: string): Promise<StudyConversation>
	{
		const fixture = this;
		function Pending(_resolve: (value: StudyConversation) => void, reject: (error: Error) => void): void { fixture.Reject = reject; }
		return new Promise<StudyConversation>(Pending);
	}
	// Simulates a transport rejection that arrives after the reader stops.
	public override async StopAsync(): Promise<void>
	{
		this.Reject?.(new Error("Cancelled fixture"));
	}
	// Makes subscription disposal observable.
	public override Subscribe(callback: (update: StudyUpdate) => void): () => void
	{
		this.Callback = callback;
		const fixture = this;
		function Unsubscribe(): void { fixture.Callback = null; }
		return Unsubscribe;
	}
}

describe("Interlocutor surface", function StudyPanelTests()
{
	it("starts disabled, retains input and message nodes during streaming, and ignores late cancellation", async function StreamsAsync()
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const report = vi.spyOn(errors, "Report");
		const store = new StudyStore();
		const gateway = new FixtureGateway();
		const controller = new StudyController(events, errors, store, gateway, new LibraryStore(), new VisionStore());
		const root = document.createElement("section");
		document.body.append(root);
		const panel = new StudyPanel(root, events, errors, store, controller);
		try
		{
			expect(gateway.Starts).toBe(0);
			expect(gateway.Callback).toBeNull();
			const input = root.querySelector("textarea")!;
			input.value = "Unsent thinking";
			await controller.StartAsync(gateway.Conversation.scope, "qwen3.5:9b");
			const turn = controller.SendAsync("A question");
			gateway.Callback?.({ conversationId: "stale", kind: "text", text: "wrong" });
			gateway.Callback?.({ conversationId: "fixture", kind: "text", text: "A possibility" });
			await events.PublishAsync("study.changed", {});
			const response = root.querySelector("article:last-child p");
			expect(response?.textContent).toBe("A possibility");
			gateway.Callback?.({ conversationId: "fixture", kind: "text", text: ", still open" });
			await events.PublishAsync("study.changed", {});
			expect(root.querySelector("article:last-child p")).toBe(response);
			expect(root.querySelector("textarea")).toBe(input);
			expect(input.value).toBe("Unsent thinking");
			await controller.StopAsync();
			await turn;
			expect(store.GetSnapshot()).toMatchObject({ busy: false, connected: false });
			expect(report).not.toHaveBeenCalled();
			expect(gateway.Callback).toBeNull();
			expect(response?.textContent).toContain("Incomplete response");
		}
		finally
		{
			panel.Dispose();
			controller.Dispose();
			root.remove();
			vi.restoreAllMocks();
		}
	});
});
