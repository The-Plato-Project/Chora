import { DecodeTextSelection, type TextSelection } from "../../shared/text/TextSelection.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { LibraryController } from "../library/LibraryController.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { WordExplorationController } from "../library/words/WordExplorationController.js";
import type { WordExplorationStore, WordTabState, WordWorkspaceState } from "../library/words/WordExplorationStore.js";
import type { VisionController } from "../visions/VisionController.js";
import type { VisionStore, VisionTabsSnapshot } from "../visions/VisionStore.js";

// Versioned resume metadata. Authoritative documents and linguistic evidence stay with their owners.
interface ApplicationSnapshot
{
	readonly version: 1;
	readonly workId: string | null;
	readonly selection: TextSelection | null;
	readonly focus: TextSelection | null;
	readonly visions: VisionTabsSnapshot;
	readonly words: WordWorkspaceState;
}

// Coordinates durable workspace checkpoints and ordered restoration across feature boundaries.
export class ApplicationState
{
	private static readonly StorageKey = "chora:application-state";
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly flush = this.Save.bind(this);
	private readonly visibilityChanged = this.HandleVisibilityChanged.bind(this);
	private snapshot: ApplicationSnapshot;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private restoring = true;
	private disposed = false;
	private visionsReady = false;
	private readerReady = false;
	private wordsReady = false;

	// Depends on existing owners; it neither duplicates live state nor reaches into panel DOM.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly libraryStore: LibraryStore,
		private readonly library: LibraryController,
		private readonly visionStore: VisionStore,
		private readonly visions: VisionController,
		private readonly wordStore: WordExplorationStore,
		private readonly words: WordExplorationController)
	{
		this.snapshot = this.Load();
		const changed = this.ScheduleSave.bind(this);
		this.subscriptions.push(events.Subscribe("vision.catalogue-changed", this.HandleCatalogueChanged.bind(this)));
		this.subscriptions.push(events.Subscribe("library.text-opened", this.HandleTextOpened.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.opened", changed));
		this.subscriptions.push(events.Subscribe("vision.closed", changed));
		this.subscriptions.push(events.Subscribe("vision.view-changed", changed));
		this.subscriptions.push(events.Subscribe("library.selection-changed", changed));
		this.subscriptions.push(events.Subscribe("library.focus-changed", changed));
		this.subscriptions.push(events.Subscribe("word.exploration-changed", changed));
		this.subscriptions.push(events.Subscribe("word.occurrence-selected", changed));
		this.subscriptions.push(events.Subscribe("word.exploration-visibility-changed", changed));
		this.subscriptions.push(events.Subscribe("workspace.blurred", this.flush));
		window.addEventListener("pagehide", this.flush);
		window.addEventListener("beforeunload", this.flush);
		document.addEventListener("visibilitychange", this.visibilityChanged);
	}

	// Loads catalogues first, then reconciles saved identities and exact versioned selections.
	public async RestoreAsync(): Promise<void>
	{
		await this.events.PublishAsync("application.restoring", {});
		try
		{
			await this.visions.StartAsync();
			if (!this.disposed && this.visionsReady)
			{
				this.visionStore.RestoreTabs(this.snapshot.visions);
				if (this.visionStore.GetActive() !== null) await this.events.PublishAsync("vision.opened", {});
			}
			if (!this.disposed) await this.library.StartAsync(this.snapshot.workId);
			if (!this.disposed)
			{
				// Restore reading before slow evidence requests so the source is immediately usable.
				if (this.readerReady) await this.RestoreReadingAsync();
				await this.words.RestoreWorkspaceAsync(this.snapshot.words);
				this.wordsReady = this.readerReady || this.snapshot.words.tabs.every(function IsLexical(tab): boolean
				{
					return tab.selection === null;
				});
			}
		}
		finally
		{
			this.restoring = false;
			if (!this.disposed)
			{
				await this.events.PublishAsync("application.restored", {});
				this.Save();
			}
		}
	}

	// Flushes synchronously before teardown, then releases all application-lifetime listeners.
	public Dispose(): void
	{
		if (!this.disposed)
		{
			this.Save();
			this.disposed = true;
			for (const unsubscribe of this.subscriptions) unsubscribe();
			this.subscriptions.length = 0;
			window.removeEventListener("pagehide", this.flush);
			window.removeEventListener("beforeunload", this.flush);
			document.removeEventListener("visibilitychange", this.visibilityChanged);
		}
	}

	// Writes only small metadata after explicit state changes; typing does not trigger this path.
	public Save(): void
	{
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		if (!this.disposed && !this.restoring)
		{
			const reader = this.libraryStore.GetSnapshot();
			this.snapshot = {
				version: 1,
				workId: this.readerReady ? reader.text?.id ?? null : this.snapshot.workId,
				selection: this.readerReady ? reader.selection : this.snapshot.selection,
				focus: this.readerReady ? reader.focus : this.snapshot.focus,
				visions: this.visionsReady ? this.visionStore.GetTabsState() : this.snapshot.visions,
				words: this.wordsReady ? this.wordStore.GetWorkspaceState() : this.snapshot.words
			};
			try
			{
				window.localStorage.setItem(ApplicationState.StorageKey, JSON.stringify(this.snapshot));
				window.localStorage.removeItem("chora:last-work");
				window.sessionStorage.removeItem("chora:vision-session");
			}
			catch (error)
			{
				this.errors.Debug("ApplicationState", "Could not save workspace resume metadata.", error);
			}
		}
	}

	// Keeps startup failures from replacing last-good document membership with an empty store.
	private HandleCatalogueChanged(event: ChoraEvents["vision.catalogue-changed"]): void
	{
		if (event.kind === "reset") this.visionsReady = true;
		this.ScheduleSave();
	}

	// A later successful text open also recovers from an unavailable Library at startup.
	private HandleTextOpened(): void
	{
		this.readerReady = true;
		if (!this.restoring) this.wordsReady = true;
		this.ScheduleSave();
	}

	// Coalesces frequent reading-focus updates without blocking the input path.
	private ScheduleSave(): void
	{
		if (!this.restoring && !this.disposed)
		{
			if (this.timer !== null) clearTimeout(this.timer);
			this.timer = setTimeout(this.flush, 250);
		}
	}

	private HandleVisibilityChanged(): void
	{
		if (document.visibilityState === "hidden") this.Save();
	}

	// Rejects stale text versions rather than moving old offsets into a different source edition.
	private async RestoreReadingAsync(): Promise<void>
	{
		const text = this.libraryStore.GetText();
		if (text !== null && text.id === this.snapshot.workId)
		{
			const focus = this.ValidateSelection(this.snapshot.focus);
			const selection = this.ValidateSelection(this.snapshot.selection);
			if (focus !== null) this.library.SetFocusSegment(focus.start.stephanus);
			this.library.SetSelection(selection);
			if (selection !== null) await this.library.RevealSelectionAsync(selection, "source");
			else if (focus !== null) await this.events.PublishAsync("library.position-restored", { segmentKey: focus.start.stephanus });
		}
	}

	private ValidateSelection(selection: TextSelection | null): TextSelection | null
	{
		let valid: TextSelection | null = null;
		try
		{
			const text = this.libraryStore.GetText();
			if (selection !== null && text !== null)
			{
				text.ValidateSelection(selection);
				valid = selection;
			}
		}
		catch (error)
		{
			this.errors.Debug("ApplicationState", "Skipped a stale saved reading location.", error);
		}
		return valid;
	}

	// Reads current state or migrates the two previous scattered resume keys once.
	private Load(): ApplicationSnapshot
	{
		let snapshot: ApplicationSnapshot = { version: 1, workId: null, selection: null, focus: null,
			visions: { openVisionIds: [], activeVisionId: null }, words: { tabs: [], activeIndex: -1, visible: true } };
		try
		{
			const raw = window.localStorage.getItem(ApplicationState.StorageKey);
			if (raw !== null)
			{
				const value = this.Record(JSON.parse(raw));
				if (value.version === 1)
				{
					const words = this.Record(value.words);
					const tabs: WordTabState[] = [];
					let activeIndex = -1;
					if (Array.isArray(words.tabs))
					{
						for (const [index, item] of words.tabs.entries())
						{
							const tab = this.Record(item);
							const selection = this.DecodeSelection(tab.selection);
							const lexicalLemma = typeof tab.lexicalLemma === "string" && tab.lexicalLemma.length > 0
								&& tab.lexicalLemma.length <= 200 ? tab.lexicalLemma : null;
							if (selection !== null || lexicalLemma !== null)
							{
								if (index === words.activeIndex) activeIndex = tabs.length;
								tabs.push({ selection, lemma: typeof tab.lemma === "string" ? tab.lemma : null,
									...(selection === null && lexicalLemma !== null ? { lexicalLemma } : {}),
									occurrence: this.DecodeSelection(tab.occurrence) });
							}
						}
					}
					snapshot = { version: 1, workId: typeof value.workId === "string" ? value.workId : null,
						selection: this.DecodeSelection(value.selection), focus: this.DecodeSelection(value.focus),
						visions: this.DecodeVisionTabs(value.visions), words: { tabs, activeIndex, visible: words.visible !== false } };
				}
			}
			else
			{
				snapshot = { ...snapshot, workId: window.localStorage.getItem("chora:last-work") };
				const visions = window.sessionStorage.getItem("chora:vision-session");
				if (visions !== null) snapshot = { ...snapshot, visions: this.DecodeVisionTabs(JSON.parse(visions)) };
			}
		}
		catch (error)
		{
			this.errors.Debug("ApplicationState", "Could not read saved workspace metadata.", error);
		}
		return snapshot;
	}

	private DecodeVisionTabs(value: unknown): VisionTabsSnapshot
	{
		const record = this.Record(value);
		const openVisionIds: string[] = [];
		const modes: Record<string, "write" | "markdown" | "preview"> = {};
		const savedModes = this.Record(record.modes);
		if (Array.isArray(record.openVisionIds))
		{
			for (const id of record.openVisionIds)
			{
				if (typeof id === "string" && !openVisionIds.includes(id))
				{
					openVisionIds.push(id);
					const mode = savedModes[id];
					if (mode === "write" || mode === "markdown" || mode === "preview") modes[id] = mode;
				}
			}
		}
		return { openVisionIds, activeVisionId: typeof record.activeVisionId === "string" ? record.activeVisionId : null, modes };
	}

	private DecodeSelection(value: unknown): TextSelection | null
	{
		let selection: TextSelection | null = null;
		try
		{
			if (value !== null && value !== undefined) selection = DecodeTextSelection(value);
		}
		catch
		{
			// Retain the rest of a workspace when one persisted range is malformed.
		}
		return selection;
	}

	private Record(value: unknown): Record<string, unknown>
	{
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
	}
}
