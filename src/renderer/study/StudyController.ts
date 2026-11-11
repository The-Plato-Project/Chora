import type { StudyScope, StudySource, StudyUpdate } from "../../shared/study/StudyTypes.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { VisionStore } from "../visions/VisionStore.js";
import type { StudyGateway } from "./StudyGateway.js";
import type { StudyStore } from "./StudyStore.js";

// Coordinates explicit context capture, runtime commands and source navigation.
export class StudyController
{
	// Streaming is activated only after an explicit reader launch, not while editing.
	private unsubscribe: (() => void) | null = null;
	// Prevents late completions from reviving a disposed feature.
	private disposed = false;
	// Invalidates asynchronous completions after Stop or renderer teardown.
	private generation = 0;
	// Collaborators expose state/use cases without coupling panels together.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager,
		private readonly store: StudyStore, private readonly gateway: StudyGateway, private readonly library: LibraryStore,
		private readonly visions: VisionStore)
	{
	}

	// Captures options only when the reader asks; editor typing is never monitored.
	public CaptureContext(): { scope: StudyScope; title: string; visions: readonly { id: string; title: string }[] }
	{
		const document = this.library.GetText();
		if (document === null) throw new Error("Open a work before choosing conversation context.");
		const catalogue = this.visions.GetCatalogue(document.id);
		const visions = catalogue.map(function Project(vision): { id: string; title: string }
		{
			const result = { id: vision.id, title: vision.title };
			return result;
		});
		const scope = { workId: document.id, visionIds: [], selection: this.library.GetSelection() };
		const result = { scope, title: document.title, visions };
		return result;
	}

	// Launches an optional local runtime with the scope selected in the surface.
	public async StartAsync(scope: StudyScope, model: "qwen3.5:9b" | "qwen3.5:4b"): Promise<void>
	{
		if (!this.store.GetSnapshot().busy)
		{
			const generation = ++this.generation;
			this.store.SetStatus("Starting the local interlocutor…", true);
			this.Changed();
			try
			{
				this.unsubscribe?.();
				this.unsubscribe = this.gateway.Subscribe(this.HandleUpdate.bind(this));
				const conversation = await this.gateway.StartAsync({ scope, model });
				if (!this.disposed && generation === this.generation)
				{
					this.store.SetConversation(conversation, true);
					this.store.SetStatus("Ready. Context stays fixed until you start a new conversation.", false);
				}
			}
			catch (error)
			{
				if (!this.disposed && generation === this.generation) this.Failed(error);
			}
			this.Changed();
		}
	}

	// Sends one reader turn and retains partial output on failure.
	public async SendAsync(text: string): Promise<void>
	{
		const state = this.store.GetSnapshot();
		if (state.connected && !state.busy && state.conversation !== null && text.trim().length > 0)
		{
			const generation = this.generation;
			this.store.BeginTurn(text);
			this.store.SetStatus("The Athenian Stranger is responding…", true);
			this.Changed();
			try
			{
				const conversation = await this.gateway.SendAsync(state.conversation.id, text);
				if (!this.disposed && generation === this.generation)
				{
					this.store.SetConversation(conversation, true);
					this.store.SetStatus("Ready.", false);
				}
			}
			catch (error)
			{
				if (!this.disposed && generation === this.generation) this.Failed(error);
			}
			this.Changed();
		}
	}

	// Stop disables further submissions until a fresh scope is explicitly approved.
	public async StopAsync(): Promise<void>
	{
		this.generation += 1;
		this.store.SetStatus("Stopping the local interlocutor…", true);
		this.Changed();
		try
		{
			await this.gateway.StopAsync();
		}
		catch (error)
		{
			this.errors.Report("Interlocutor.Stop", error, "The local interlocutor could not confirm shutdown.");
		}
		const state = this.store.GetSnapshot();
		this.store.SetConversation(state.conversation, false);
		this.store.SetStatus("Stopped. Start a new conversation to continue.", false);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.Changed();
	}

	// Loads history for inspection only, without submitting it to a model.
	public async LoadAsync(): Promise<void>
	{
		if (!this.store.GetSnapshot().connected && !this.store.GetSnapshot().busy)
		{
			try
			{
				const conversation = await this.gateway.LoadAsync();
				this.store.SetConversation(conversation, false);
				this.store.SetStatus(conversation === null ? "No saved conversation yet." : "Saved conversation. Start a new conversation to speak with the interlocutor.", false);
			}
			catch (error)
			{
				this.Failed(error);
			}
			this.Changed();
		}
	}

	// Navigates host-produced source cards; model prose has no command authority.
	public async OpenSourceAsync(source: StudySource): Promise<void>
	{
		if (source.selection !== null)
		{
			if (this.library.GetText()?.id !== source.selection.dialogue) await this.events.PublishAsync("library.text-open-requested", { textId: source.selection.dialogue });
			await this.events.PublishAsync("library.jump-requested", { selection: source.selection });
		}
		if (source.visionId !== null) await this.events.PublishAsync("vision.document-open-requested", { visionId: source.visionId });
	}

	// Renderer teardown unsubscribes; main also revokes the process on window loss.
	public Dispose(): void
	{
		this.disposed = true;
		this.generation += 1;
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	// Applies streaming facts exclusively to the interlocutor store.
	private HandleUpdate(update: StudyUpdate): void
	{
		this.store.Apply(update);
		this.Changed();
	}

	// Reports through the existing diagnostics owner and preserves visible partial history.
	private Failed(error: unknown): void
	{
		const state = this.store.GetSnapshot();
		this.store.SetConversation(state.conversation, false);
		this.store.SetStatus(error instanceof Error ? error.message : "The local interlocutor is unavailable.", false);
		this.errors.Report("Interlocutor", error, "The local interlocutor is unavailable. Reading and writing remain available.");
	}

	// A feature-local fact never invalidates the Library, Word Lookup or editors.
	private Changed(): void
	{
		if (!this.disposed) void this.events.PublishAsync("study.changed", {});
	}
}
