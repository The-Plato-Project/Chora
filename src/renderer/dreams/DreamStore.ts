import type { DreamView } from "./DreamView.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { SessionStore } from "../core/session/SessionStore.js";
import { TextDocument } from "../../shared/library/LibraryTypes.js";
import { GetCoveredPassageKeys } from "../library/PassageCoverage.js";

// Identifies the source passage restricting the DreamView catalogue.
export interface DreamPassageFilter
{
	// Owning document, preventing collisions between works.
	readonly workId: string;
	// First segment of the displayed passage.
	readonly segmentKey: string;
	// Work and locator label presented to the reader.
	readonly label: string;
}

// Lifecycle of the active DreamView's most recent save attempt.
export type DreamSaveState = "idle" | "saving" | "error";

// Session-persisted snapshot of the active DreamView editing session.
interface DreamSessionSnapshot
{
	// The active DreamView at the time of the snapshot.
	dream: DreamView;
	// Whether the active DreamView had unsaved changes at the time of the snapshot.
	isDirty: boolean;
	revision?: number;
	saveState?: DreamSaveState;
	selectedSignalId?: string | null;
	editorTabId?: string;
}

// Persisted collection of open DreamView tabs and their active identity.
interface DreamTabsSnapshot
{
	readonly tabs: DreamSessionSnapshot[];
	readonly activeDreamId: string | null;
}

// Readonly DreamView tab descriptor exposed to the editor strip.
export interface DreamTab
{
	readonly dreamId: string;
	readonly title: string;
	readonly isDirty: boolean;
}

// Result of a named mutation to the active DreamView.
export interface DreamChange
{
	// Immutable snapshot after the mutation.
	readonly dream: DreamView;
	// Whether the mutation changed the dirty-state transition.
	readonly becameDirty: boolean;
}

// Sole renderer-side owner of DreamView catalogue and active-DreamView editing state.
export class DreamStore
{
	// Session storage key for the active DreamView editing session.
	private static readonly SessionKey = "chora:dream-session";
	// Delay before an uncommitted mutation is persisted to session storage.
	private static readonly PersistenceDelayMilliseconds = 400;
	// All Dreams visible to the reader.
	private catalogue: DreamView[] = [];
	// The DreamView currently open for editing, or null when none is open.
	private activeDream: DreamView | null = null;
	// Whether the active DreamView has unsaved changes.
	private isDirty = false;
	// Increments on every mutation so a stale save result can be detected.
	private revision = 0;
	// Lifecycle of the active DreamView's most recent save attempt.
	private saveState: DreamSaveState = "idle";
	// Ordered per-DreamView editing sessions represented by the editor tab strip.
	private openTabs: DreamSessionSnapshot[] = [];
	// Signal selected in the active DreamView session.
	private selectedSignalId: string | null = null;
	// Inner editor tab selected in the active DreamView session.
	private editorTabId = "signals";
	// Pending session-persistence timer, or null when nothing is scheduled.
	private persistenceTimer: ReturnType<typeof setTimeout> | null = null;
	// Catalogue search query entered by the reader.
	private searchText = "";
	// Optional source-passage restriction, independent of keyword search.
	private passageFilter: DreamPassageFilter | null = null;
	// Returns a snapshot of the active source restriction.
	public GetPassageFilter(): DreamPassageFilter | null
	{
		const filter = structuredClone(this.passageFilter);
		return filter;
	}

	// Changes the source restriction without changing the active editor.
	public SetPassageFilter(filter: DreamPassageFilter | null): void
	{
		this.passageFilter = structuredClone(filter);
	}

	// Restores the active DreamView editing session from a prior application run.
	public constructor(private readonly sessions: SessionStore)
	{
		const snapshot = this.sessions.Load<DreamSessionSnapshot | DreamTabsSnapshot>(DreamStore.SessionKey);

		if (snapshot !== null)
		{
			if ("tabs" in snapshot)
			{
				this.openTabs = structuredClone(snapshot.tabs);
				const active = this.openTabs.find(function FindActive(tab): boolean { return tab.dream.id === snapshot.activeDreamId; }) ?? this.openTabs[0] ?? null;
				if (active !== null) this.RestoreTab(active);
			}
			else
			{
				this.openTabs = [structuredClone(snapshot)];
				this.RestoreTab(snapshot);
			}
		}
	}

	// Returns ordered descriptors for every open DreamView editor tab.
	public GetOpenTabs(): readonly DreamTab[]
	{
		this.CaptureActiveTab();
		const tabs = this.openTabs.map(function CreateDescriptor(tab): DreamTab
		{
			return { dreamId: tab.dream.id, title: tab.dream.title || "Untitled", isDirty: tab.isDirty };
		});

		return structuredClone(tabs);
	}

	// Remembers the selected Signal for one open DreamView tab.
	public SetSelectedSignal(dreamId: string, signalId: string | null): void
	{
		if (this.activeDream?.id === dreamId) this.selectedSignalId = signalId;
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined) tab.selectedSignalId = signalId;
		this.Persist();
	}

	// Returns the selected Signal remembered for one open DreamView tab.
	public GetSelectedSignal(dreamId: string): string | null
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		const signalId = this.activeDream?.id === dreamId ? this.selectedSignalId : tab?.selectedSignalId ?? null;

		return signalId;
	}

	// Remembers the selected inner editor tab for one open DreamView.
	public SetEditorTab(dreamId: string, tabId: string): void
	{
		if (this.activeDream?.id === dreamId) this.editorTabId = tabId;
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined) tab.editorTabId = tabId;
		this.Persist();
	}

	// Returns the selected inner editor tab for one open DreamView.
	public GetEditorTab(dreamId: string): string
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		const tabId = this.activeDream?.id === dreamId ? this.editorTabId : tab?.editorTabId ?? "signals";

		return tabId;
	}

	// Returns the current catalogue search query.
	public GetSearchText(): string
	{
		return this.searchText;
	}

	// Records the catalogue search query entered by the reader.
	public SetSearchText(value: string): void
	{
		this.searchText = value;
	}

	// Returns an immutable snapshot of every DreamView visible to the reader.
	public GetCatalogue(): readonly DreamView[]
	{
		const catalogue = structuredClone(this.catalogue);

		return catalogue;
	}

	// Returns Dreams matching the given search query, ordered by their position in the source text.
	public GetVisibleCatalogue(searchText: string, document: TextDocument | null = null): DreamView[]
	{
		if (document !== null)
		{
			document = TextDocument.FromSnapshot(document);
		}
		const query = searchText.trim().toLocaleLowerCase();
		const matches: DreamView[] = [];
		let candidates: readonly DreamView[] = this.catalogue;

		if (this.passageFilter !== null)
		{
			candidates = [];
			if (document !== null && document.id === this.passageFilter.workId)
			{
				const passages = this.BuildPassageCatalogue(document);
				candidates = passages.get(this.passageFilter.segmentKey) ?? [];
			}
		}

		for (const dream of candidates)
		{
			const matchesWork = document === null || dream.workId === document.id;
			if (matchesWork && this.MatchesSearch(dream, query, document)) matches.push(structuredClone(dream));
		}

		matches.sort(this.CompareBySource.bind(this, document));

		return matches;
	}

	// Counts each DreamView once per passage, independently of the active search or filter.
	public GetPassageCounts(document: TextDocument): ReadonlyMap<string, number>
	{
		const passages = this.BuildPassageCatalogue(document);
		const counts = new Map<string, number>();
		for (const [key, dreams] of passages)
		{
			counts.set(key, dreams.length);
		}
		return counts;
	}

	// Lists DreamView titles associated with each passage in canonical source order.
	public GetPassageDreamTitles(document: TextDocument): ReadonlyMap<string, readonly string[]>
	{
		const passages = this.BuildPassageCatalogue(document);
		const titles = new Map<string, readonly string[]>();

		for (const [key, dreams] of passages)
		{
			const ordered = [...dreams];
			ordered.sort(this.CompareBySource.bind(this, document));
			titles.set(key, ordered.map(function GetDreamTitle(dream): string
			{
				return dream.title.trim() || "Untitled";
			}));
		}

		return titles;
	}

	// Resolves persisted source anchors in document order and groups their nonempty overlap by passage.
	private BuildPassageCatalogue(document: TextDocument): Map<string, DreamView[]>
	{
		const passages = new Map<string, DreamView[]>();

		for (const dream of this.catalogue)
		{
			const source = dream.source;
			if (dream.workId === document.id && source.documentId === document.id)
			{
				const covered = GetCoveredPassageKeys(document, source);
				for (const key of covered)
				{
					const dreams = passages.get(key) ?? [];
					dreams.push(dream);
					passages.set(key, dreams);
				}
			}
		}
		return passages;
	}

	// Returns an immutable snapshot of the active DreamView, or null when none is open.
	public GetActiveDream(): DreamView | null
	{
		const dream = this.activeDream === null ? null : structuredClone(this.activeDream);

		return dream;
	}

	// Returns whether the active DreamView has unsaved changes.
	public GetIsDirty(): boolean
	{
		const dirty = this.isDirty;
		return dirty;
	}

	// Returns the lifecycle of the active DreamView's most recent save attempt.
	public GetSaveState(): DreamSaveState
	{
		return this.saveState;
	}

	// Returns the current mutation revision of the active DreamView.
	public GetRevision(): number
	{
		return this.revision;
	}

	// Replaces the visible DreamView catalogue with a freshly loaded snapshot.
	public SetCatalogue(catalogue: DreamView[]): void
	{
		this.catalogue = catalogue.map(this.NormalizeDream);
	}

	// Refreshes canonical Signal fields in every DreamView projection without marking Dreams dirty.
	public ApplySignal(signal: SignalRecord): string | null
	{
		for (const dream of this.catalogue) this.ApplySignalToDream(dream, signal);
		for (const tab of this.openTabs) this.ApplySignalToDream(tab.dream, signal);
		const changedActive = this.activeDream === null
			? false
			: this.ApplySignalToDream(this.activeDream, signal);
		const activeDreamId = changedActive ? this.activeDream?.id ?? null : null;

		if (changedActive)
		{
			this.CaptureActiveTab();
			this.Persist();
		}

		return activeDreamId;
	}

	// Opens a DreamView for editing and records whether it starts with unsaved changes.
	public Open(dream: DreamView, isDirty: boolean): void
	{
		this.CancelPersistence();
		this.CaptureActiveTab();
		const existing = this.openTabs.find(function FindTab(tab): boolean { return tab.dream.id === dream.id; });
		if (existing !== undefined)
		{
			this.RestoreTab(existing);
		}
		else
		{
			const snapshot: DreamSessionSnapshot = { dream: structuredClone(dream), isDirty, revision: 0, saveState: "idle", selectedSignalId: null, editorTabId: "signals" };
			this.openTabs.push(snapshot);
			this.RestoreTab(snapshot);
		}
		this.Persist();
	}

	// Activates an already open DreamView tab without replacing its editing session.
	public ActivateTab(dreamId: string): DreamView | null
	{
		this.CancelPersistence();
		this.CaptureActiveTab();
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined)
		{
			this.RestoreTab(tab);
			this.Persist();
		}
		const dream = tab === undefined ? null : structuredClone(tab.dream);

		return dream;
	}

	// Closes the active DreamView editing session.
	public Close(): void
	{
		this.CancelPersistence();
		const activeId = this.activeDream?.id;
		const activeIndex = this.openTabs.findIndex(function FindActive(tab): boolean { return tab.dream.id === activeId; });
		if (activeIndex >= 0) this.openTabs.splice(activeIndex, 1);
		const nextIndex = Math.min(activeIndex, this.openTabs.length - 1);
		const next = nextIndex >= 0 ? this.openTabs[nextIndex] ?? null : null;
		if (next === null)
		{
			this.ClearActiveTab();
			this.sessions.Remove(DreamStore.SessionKey);
		}
		else
		{
			this.RestoreTab(next);
			this.Persist();
		}
	}

	// Updates the active DreamView title and records one authoritative state change.
	public UpdateTitle(title: string): DreamChange | null
	{
		let change: DreamChange | null = null;

		if (this.activeDream !== null)
		{
			this.activeDream.title = title;
			change = this.RecordChange();
		}

		return change;
	}

	// Updates the active DreamView reflection and records one authoritative state change.
	public UpdateReflection(reflection: string): DreamChange | null
	{
		let change: DreamChange | null = null;

		if (this.activeDream !== null)
		{
			this.activeDream.reflection = reflection;
			change = this.RecordChange();
		}

		return change;
	}

	public UpdateSynopticView(synopticView: string): DreamChange | null
	{
		let change: DreamChange | null = null;

		if (this.activeDream !== null)
		{
			this.activeDream.synopticView = synopticView;
			change = this.RecordChange();
		}

		return change;
	}

	// Replaces the active DreamView signals after the controller has calculated source order.
	public ReplaceSignals(signals: SignalRecord[]): DreamChange | null
	{
		let change: DreamChange | null = null;

		if (this.activeDream !== null)
		{
			this.activeDream.signals = structuredClone(signals);
			this.activeDream.signalIds = signals.map(function GetSignalId(signal): string
			{
				return signal.id;
			});
			change = this.RecordChange();
		}

		return change;
	}

	// Updates one existing signal description and records the change when it exists.
	public UpdateSignalDescription(signalId: string, description: string): DreamChange | null
	{
		let change: DreamChange | null = null;
		let signalIndex = -1;

		for (let index = 0; index < (this.activeDream?.signals.length ?? 0); index += 1)
		{
			if (this.activeDream?.signals[index]?.id === signalId)
			{
				signalIndex = index;
				break;
			}
		}

		if (this.activeDream !== null && signalIndex >= 0)
		{
			const signal = this.activeDream.signals[signalIndex];

			if (signal !== undefined)
			{
				this.activeDream.signals[signalIndex] = { ...signal, description };
			}
			change = this.RecordChange();
		}

		return change;
	}

	// Replaces the source selection owned by the active DreamView.
	public ReplaceSource(source: TextSelection): DreamChange | null
	{
		let change: DreamChange | null = null;

		if (this.activeDream !== null)
		{
			this.activeDream.source = structuredClone(source);
			change = this.RecordChange();
		}

		return change;
	}

	// Commits a successful save when no further mutation has occurred since it began.
	public MarkSaved(dream: DreamView, savedRevision: number): void
	{
		if (savedRevision === this.revision && this.activeDream?.id === dream.id)
		{
			this.CancelPersistence();
			this.SetActiveDream(structuredClone(dream));
			this.isDirty = false;
			this.saveState = "idle";
			this.Persist();
		}
	}

	// Records the lifecycle of the active DreamView's most recent save attempt.
	public SetSaveState(saveState: DreamSaveState): void
	{
		this.saveState = saveState;
	}

	// Flushes any pending session persistence before the store is torn down.
	public Dispose(): void
	{
		this.FlushPersistence();
	}

	// Sole assignment point for the active DreamView, so every write path is traceable to one place.
	private SetActiveDream(dream: DreamView | null): void
	{
		this.activeDream = dream === null ? null : this.NormalizeDream(dream);
	}

	// Applies one canonical Signal snapshot to a DreamView projection.
	private ApplySignalToDream(dream: DreamView, signal: SignalRecord): boolean
	{
		let changed = false;

		for (let index = 0; index < dream.signals.length; index += 1)
		{
			const candidate = dream.signals[index];

			if (candidate !== undefined && candidate.id === signal.id)
			{
				dream.signals[index] = structuredClone(signal);
				changed = true;
			}
		}

		return changed;
	}

	// Captures the mutable active fields into their ordered tab snapshot.
	private CaptureActiveTab(): void
	{
		const dream = this.activeDream;
		if (dream !== null)
		{
			const snapshot: DreamSessionSnapshot = {
				dream: structuredClone(dream),
				isDirty: this.isDirty,
				revision: this.revision,
				saveState: this.saveState,
				selectedSignalId: this.selectedSignalId,
				editorTabId: this.editorTabId
			};
			const index = this.openTabs.findIndex(function FindTab(tab): boolean { return tab.dream.id === dream.id; });
			if (index >= 0) this.openTabs[index] = snapshot;
			else this.openTabs.push(snapshot);
		}
	}

	// Restores one tab snapshot into the active DreamView fields.
	private RestoreTab(snapshot: DreamSessionSnapshot): void
	{
		this.SetActiveDream(structuredClone(snapshot.dream));
		this.isDirty = snapshot.isDirty;
		this.revision = snapshot.revision ?? 0;
		this.saveState = snapshot.saveState ?? "idle";
		this.selectedSignalId = snapshot.selectedSignalId ?? null;
		this.editorTabId = snapshot.editorTabId === "exegesis" || snapshot.editorTabId === "reflections" ? "reflections" : snapshot.editorTabId === "explorations" || snapshot.editorTabId === "synoptic-view" ? "synoptic-view" : "signals";
	}

	// Clears every active field after the final DreamView tab closes.
	private ClearActiveTab(): void
	{
		this.SetActiveDream(null);
		this.isDirty = false;
		this.revision = 0;
		this.saveState = "idle";
		this.selectedSignalId = null;
		this.editorTabId = "signals";
	}

	private NormalizeDream(dream: DreamView): DreamView
	{
		const legacy = dream as DreamView & { exploration?: string };
		const normalized = structuredClone(legacy);
		const synopticView = normalized.synopticView ?? normalized.exploration ?? "";
		const signalIds = normalized.signalIds ?? normalized.signals.map(function GetSignalId(signal): string
		{
			return signal.id;
		});
		delete normalized.exploration;
		return { ...normalized, signalIds, synopticView };
	}

	// Returns whether the given DreamView matches the reader's normalized search query.
	private MatchesSearch(dream: DreamView, query: string, document: TextDocument | null): boolean
	{
		const sourceText = document?.id === dream.workId
			? document.ReconstructText(dream.source)
			: "";
		const searchable = `${dream.title} ${dream.dialogue ?? ""} ${sourceText}`.toLocaleLowerCase();
		const matches = query.length === 0 || searchable.includes(query);

		return matches;
	}

	// Orders Dreams by owning work, source locator, source position, then title.
	private CompareBySource(document: TextDocument | null, first: DreamView, second: DreamView): number
	{
		let comparison = first.workId.localeCompare(second.workId);

		if (comparison === 0 && document !== null && document.id === first.workId)
		{
			comparison = document.CompareSelections(first.source, second.source);
		}
		if (comparison === 0) comparison = first.source.start.segmentKey.localeCompare(second.source.start.segmentKey);
		if (comparison === 0) comparison = first.title.localeCompare(second.title);

		return comparison;
	}


	// Schedules a delayed session-persistence write, replacing any pending one.
	private SchedulePersistence(): void
	{
		this.CancelPersistence();
		this.persistenceTimer = setTimeout(this.HandlePersistenceTimer.bind(this), DreamStore.PersistenceDelayMilliseconds);
	}

	// Writes the session snapshot once a pending persistence timer elapses.
	private HandlePersistenceTimer(): void
	{
		this.persistenceTimer = null;
		this.Persist();
	}

	// Advances authoritative mutation metadata and returns an immutable result.
	private RecordChange(): DreamChange
	{
		const wasDirty = this.isDirty;
		this.isDirty = true;
		this.revision += 1;
		this.saveState = "idle";
		this.SchedulePersistence();
		const dream = structuredClone(this.activeDream as DreamView);
		const change: DreamChange = { dream, becameDirty: !wasDirty };

		return change;
	}

	// Writes any pending session-persistence snapshot immediately.
	private FlushPersistence(): void
	{
		if (this.persistenceTimer !== null)
		{
			this.CancelPersistence();
			this.Persist();
		}
	}

	// Cancels a pending session-persistence timer, if one is scheduled.
	private CancelPersistence(): void
	{
		if (this.persistenceTimer !== null)
		{
			clearTimeout(this.persistenceTimer);
			this.persistenceTimer = null;
		}
	}

	// Writes the active DreamView editing session to session storage.
	private Persist(): void
	{
		if (this.activeDream !== null)
		{
			this.CaptureActiveTab();
			const snapshot: DreamTabsSnapshot = { tabs: structuredClone(this.openTabs), activeDreamId: this.activeDream.id };
			this.sessions.Save(DreamStore.SessionKey, snapshot);
		}
	}
}
