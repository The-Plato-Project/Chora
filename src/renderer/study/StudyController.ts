import type { StudySource, StudyUpdate } from "../../shared/study/StudyTypes.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { VisionStore } from "../visions/VisionStore.js";
import type { StudyGateway } from "./StudyGateway.js";
import type { StudyStore } from "./StudyStore.js";
import { StudySettingsStore } from "./StudySettingsStore.js";

// Coordinates chat within the open work; configuration and context setup never enter the composer.
export class StudyController
{
	// Library navigation is the only automatic context change.
	private readonly librarySubscription: Unsubscribe;
	// Streaming is subscribed only after an explicit message.
	private streamSubscription: (() => void) | null = null;
	// Invalidates completions after navigation, Stop or disposal.
	private generation = 0;
	// Identifies the backend being stopped during rapid work changes.
	private runtimeWorkId: string | null = null;
	// Prevents late asynchronous work from reviving the feature.
	private disposed = false;

	// Shares existing state owners rather than introducing another work catalogue.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager,
		private readonly store: StudyStore, private readonly gateway: StudyGateway, private readonly library: LibraryStore,
		private readonly visions: VisionStore, private readonly settings = new StudySettingsStore())
	{
		this.librarySubscription = events.Subscribe("library.text-opened", this.WorkChangedAsync.bind(this));
		void this.WorkChangedAsync();
	}

	// Moves chat to the open work and restores its own history without model execution.
	private async WorkChangedAsync(): Promise<void>
	{
		const work = this.library.GetText();
		if (work !== null && work.id !== this.store.GetSnapshot()?.workId && !this.disposed)
		{
			const generation = ++this.generation;
			const previous = this.runtimeWorkId;
			this.store.Select(work.id, work.title);
			this.store.SetStatus(work.id, "", true);
			this.Changed();
			try
			{
				if (previous !== null)
				{
					await this.gateway.StopAsync(previous);
					const old = await this.gateway.LoadAsync(previous);
					this.store.SetConversation(previous, old);
					this.store.SetStatus(previous, "", false);
					if (this.runtimeWorkId === previous) this.runtimeWorkId = null;
				}
				if (!this.disposed && generation === this.generation)
				{
					const conversation = await this.gateway.LoadAsync(work.id);
					if (!this.disposed && generation === this.generation)
					{
						this.store.SetConversation(work.id, conversation);
						this.store.SetStatus(work.id, "", false);
					}
				}
			}
			catch (error)
			{
				if (!this.disposed && generation === this.generation) this.Failed(work.id, error);
			}
			this.Changed();
		}
	}

	// Retains drafts locally without triggering renderer-wide updates while typing.
	public SetDraft(text: string): void
	{
		const state = this.store.GetSnapshot();
		if (state !== null) this.store.SetDraft(state.workId, text);
	}

	// One normal Send action lazily starts execution and performs exactly the reader's request.
	public async SendAsync(text: string): Promise<void>
	{
		const state = this.store.GetSnapshot();
		if (state !== null && !state.busy && text.trim().length > 0 && !this.disposed)
		{
			const workId = state.workId;
			const active = this.visions.GetActive();
			const vision = active?.workId === workId ? active : null;
			const visionId = vision?.id ?? null;
			const context = vision === null ? {} : { visionDraft: vision.markdown };
			const generation = this.generation;
			const model = this.settings.GetModel();
			this.streamSubscription ??= this.gateway.Subscribe(this.HandleUpdate.bind(this));
			this.runtimeWorkId = workId;
			this.store.BeginTurn(workId, text, model, visionId);
			this.Changed();
			try
			{
				const conversation = await this.gateway.SendAsync({ workId, text, visionId, model, ...context });
				if (!this.disposed && generation === this.generation)
				{
					this.store.SetConversation(workId, conversation);
					this.store.SetStatus(workId, "", false);
				}
			}
			catch (error)
			{
				if (!this.disposed && generation === this.generation)
				{
					if (this.store.GetWork(workId).draft.length === 0) this.store.SetDraft(workId, text);
					this.Failed(workId, error);
				}
			}
			this.Changed();
		}
	}

	// Stop ends the current response; the next ordinary message can continue the saved conversation.
	public async StopAsync(): Promise<void>
	{
		const state = this.store.GetSnapshot();
		if (state !== null)
		{
			const generation = ++this.generation;
			this.store.SetStatus(state.workId, "Stopping…", true);
			this.Changed();
			try
			{
				await this.gateway.StopAsync(state.workId);
				const conversation = await this.gateway.LoadAsync(state.workId);
				if (!this.disposed && generation === this.generation)
				{
					this.store.SetConversation(state.workId, conversation);
					this.store.SetStatus(state.workId, "Stopped.", false);
				}
			}
			catch (error)
			{
				if (!this.disposed && generation === this.generation) this.Failed(state.workId, error);
			}
			if (this.runtimeWorkId === state.workId) this.runtimeWorkId = null;
			this.Changed();
		}
	}

	// Source navigation remains owned by the existing Library and Vision workflows.
	public async OpenSourceAsync(source: StudySource): Promise<void>
	{
		if (source.selection !== null)
		{
			if (this.library.GetText()?.id !== source.selection.dialogue) await this.events.PublishAsync("library.text-open-requested", { textId: source.selection.dialogue });
			await this.events.PublishAsync("library.jump-requested", { selection: source.selection });
		}
		if (source.visionId !== null) await this.events.PublishAsync("vision.document-open-requested", { visionId: source.visionId });
	}

	// Releases feature subscriptions; main revokes execution when the window closes.
	public Dispose(): void
	{
		this.disposed = true;
		this.generation += 1;
		this.librarySubscription();
		this.streamSubscription?.();
		this.streamSubscription = null;
	}

	// Work-tagged updates cannot be redirected by the currently visible reader.
	private HandleUpdate(update: StudyUpdate): void
	{
		this.store.Apply(update);
		this.Changed();
	}

	// Preserves the transcript and draft while reporting through the application diagnostics owner.
	private Failed(workId: string, error: unknown): void
	{
		this.store.SetStatus(workId, error instanceof Error ? error.message : "The Agentian Stranger is unavailable.", false);
		this.errors.Report("Interlocutor", error, "The Agentian Stranger could not complete the request.");
	}

	// Only the chat feature reacts to conversation changes.
	private Changed(): void
	{
		if (!this.disposed) void this.events.PublishAsync("study.changed", {});
	}
}
