import type { DreamView } from "./DreamView.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { SessionStore } from "../core/session/SessionStore.js";
import { TextDocument } from "../../shared/library/LibraryTypes.js";
import { GetCoveredPassageKeys } from "../library/PassageCoverage.js";
import type { DreamFolderSnapshot, DreamLocationSnapshot } from "../../shared/dreams/DreamTypes.js";

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
	// Mutation revision used to reject stale save responses.
	revision: number;
	// Lifecycle of the tab's most recent save attempt.
	saveState: DreamSaveState;
	// Signal selected within this tab.
	selectedSignalId: string | null;
	// Inner editor tab selected within this Dream.
	editorTabId: string;
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
	// Filesystem-backed folders visible in the Dream Explorer.
	private folders: DreamFolderSnapshot[] = [];
	// Canonical work-relative placement of every Dream.
	private locations: DreamLocationSnapshot[] = [];
	// Ordered per-DreamView editing sessions represented by the editor tab strip.
	private openTabs: DreamSessionSnapshot[] = [];
	// Stable identity of the active editing session without duplicating its Dream state.
	private activeDreamId: string | null = null;
	// Pending session-persistence timer, or null when nothing is scheduled.
	private persistenceTimer: ReturnType<typeof setTimeout> | null = null;
	// Catalogue search query entered by the reader.
	private searchText = "";
	// Optional source-passage restriction, independent of keyword search.
	private passageFilter: DreamPassageFilter | null = null;
	// Work-scoped folder currently selected in the Explorer.
	private selectedFolder: { readonly workId: string; readonly path: string } | null = null;
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
		const snapshot = this.sessions.Load<DreamTabsSnapshot>(DreamStore.SessionKey);

		if (snapshot !== null)
		{
			this.openTabs = structuredClone(snapshot.tabs);
			const active = this.openTabs.find(function FindActive(tab): boolean { return tab.dream.id === snapshot.activeDreamId; }) ?? this.openTabs[0] ?? null;
			this.activeDreamId = active?.dream.id ?? null;
		}
	}

	// Returns ordered descriptors for every open DreamView editor tab.
	public GetOpenTabs(): readonly DreamTab[]
	{
		const tabs = this.openTabs.map(function CreateDescriptor(tab): DreamTab
		{
			return { dreamId: tab.dream.id, title: tab.dream.title || "Untitled", isDirty: tab.isDirty };
		});

		return structuredClone(tabs);
	}

	// Remembers the selected Signal for one open DreamView tab.
	public SetSelectedSignal(dreamId: string, signalId: string | null): void
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined) tab.selectedSignalId = signalId;
		this.Persist();
	}

	// Returns the selected Signal remembered for one open DreamView tab.
	public GetSelectedSignal(dreamId: string): string | null
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		const signalId = tab?.selectedSignalId ?? null;

		return signalId;
	}

	// Remembers the selected inner editor tab for one open DreamView.
	public SetEditorTab(dreamId: string, tabId: string): void
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined) tab.editorTabId = tabId;
		this.Persist();
	}

	// Returns the selected inner editor tab for one open DreamView.
	public GetEditorTab(dreamId: string): string
	{
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		const tabId = tab?.editorTabId ?? "signals";

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

	// Selects one Explorer folder, or clears folder selection.
	public SetSelectedFolder(workId: string, folderPath: string | null): void
	{
		this.selectedFolder = folderPath === null ? null : { workId, path: folderPath };
	}

	// Returns the selected folder for one work, using null when another work owns the selection.
	public GetSelectedFolder(workId: string): string | null
	{
		const folderPath = this.selectedFolder?.workId === workId
			? this.selectedFolder.path
			: null;

		return folderPath;
	}

	// Returns an immutable snapshot of every DreamView visible to the reader.
	public GetCatalogue(): readonly DreamView[]
	{
		const catalogue = structuredClone(this.catalogue);

		return catalogue;
	}

	// Returns all folders belonging to one work.
	public GetFolders(workId: string): readonly DreamFolderSnapshot[]
	{
		const folders = this.folders.filter(function MatchesWork(folder): boolean
		{
			return folder.workId === workId;
		});

		return structuredClone(folders);
	}

	// Returns the complete canonical folder and placement state for change detection.
	public GetFolderState(): { readonly folders: readonly DreamFolderSnapshot[]; readonly locations: readonly DreamLocationSnapshot[] }
	{
		const state = {
			folders: structuredClone(this.folders),
			locations: structuredClone(this.locations)
		};

		return state;
	}

	// Returns one Dream's relative folder path, using the work root when no placement exists.
	public GetDreamFolder(dreamId: string): string
	{
		const folderPath = this.locations.find(function MatchesDream(location): boolean
		{
			return location.dreamId === dreamId;
		})?.folderPath ?? "";

		return folderPath;
	}

	// Returns Dreams matching the given search query, ordered by their position in the source text.
	public GetVisibleCatalogue(searchText: string, document: TextDocument | null = null): DreamView[]
	{
		const matches = this.GetMatchingCatalogue(searchText, document, this.passageFilter);

		return matches;
	}

	// Returns the complete work catalogue for the Explorer without applying the Dream pane's passage filter.
	public GetWorkspaceCatalogue(searchText: string, document: TextDocument | null = null): DreamView[]
	{
		const matches = this.GetMatchingCatalogue(searchText, document, null);

		return matches;
	}

	// Applies work, text-search, ordering, and an optional source-passage restriction.
	private GetMatchingCatalogue(searchText: string, document: TextDocument | null, passageFilter: DreamPassageFilter | null): DreamView[]
	{
		if (document !== null)
		{
			document = TextDocument.FromSnapshot(document);
		}
		const query = searchText.trim().toLocaleLowerCase();
		const matches: DreamView[] = [];
		let candidates: readonly DreamView[] = this.catalogue;

		if (passageFilter !== null)
		{
			candidates = [];
			if (document !== null && document.id === passageFilter.workId)
			{
				const passages = this.BuildPassageCatalogue(document);
				candidates = passages.get(passageFilter.segmentKey) ?? [];
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
			if (dream.workId === document.id && source.dialogue === document.id)
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
		const tab = this.GetActiveTab();
		const dream = tab === null ? null : structuredClone(tab.dream);

		return dream;
	}

	// Returns whether the active DreamView has unsaved changes.
	public GetIsDirty(): boolean
	{
		const dirty = this.GetActiveTab()?.isDirty ?? false;
		return dirty;
	}

	// Reports unsaved drafts across all open tabs, including inactive editors.
	public HasUnsavedChanges(): boolean
	{
		const dirty = this.openTabs.some(function HasDraft(tab): boolean
		{
			return tab.isDirty || tab.saveState === "saving";
		});

		return dirty;
	}

	// Returns the lifecycle of the active DreamView's most recent save attempt.
	public GetSaveState(): DreamSaveState
	{
		const state = this.GetActiveTab()?.saveState ?? "idle";

		return state;
	}

	// Returns the current mutation revision of the active DreamView.
	public GetRevision(): number
	{
		const revision = this.GetActiveTab()?.revision ?? 0;

		return revision;
	}

	// Replaces the visible DreamView catalogue with a freshly loaded snapshot.
	public SetCatalogue(catalogue: DreamView[], folders: readonly DreamFolderSnapshot[], locations: readonly DreamLocationSnapshot[]): void
	{
		this.catalogue = structuredClone(catalogue);
		this.folders = structuredClone([...folders]);
		this.locations = structuredClone([...locations]);
		if (this.selectedFolder !== null)
		{
			const selected = this.selectedFolder;
			const exists = this.folders.some(function MatchesSelectedFolder(folder): boolean
			{
				return folder.workId === selected.workId && folder.path === selected.path;
			});
			if (!exists) this.selectedFolder = null;
		}

		for (const tab of this.openTabs)
		{
			const canonical = this.catalogue.find(function MatchesDream(dream): boolean
			{
				return dream.id === tab.dream.id;
			});

			if (canonical !== undefined)
			{
				if (tab.isDirty)
				{
					tab.dream.signals = structuredClone(canonical.signals);
				}
				else
				{
					tab.dream = structuredClone(canonical);
				}
			}
		}

		if (this.activeDreamId !== null) this.Persist();
	}

	// Reconciles clean editor tabs after an explicit disk reload, closing externally removed Dreams.
	public ApplyReload(catalogue: DreamView[], folders: readonly DreamFolderSnapshot[], locations: readonly DreamLocationSnapshot[]): void
	{
		if (this.HasUnsavedChanges()) throw new Error("Reload conflicts with unsaved Dream edits. Your drafts have been kept.");
		this.SetCatalogue(catalogue, folders, locations);
		this.openTabs = this.openTabs.filter(function StillExists(tab): boolean
		{
			const exists = catalogue.some(function Matches(dream): boolean { return dream.id === tab.dream.id; });
			return exists;
		});
		const activeId = this.activeDreamId;
		const hasActive = this.openTabs.some(function MatchesActive(tab): boolean { return tab.dream.id === activeId; });
		if (!hasActive) this.activeDreamId = this.openTabs[0]?.dream.id ?? null;
		this.PersistOrRemove();
	}

	// Inserts or replaces one canonical Dream in the visible catalogue.
	public UpsertCatalogueDream(dream: DreamView): void
	{
		const index = this.catalogue.findIndex(function MatchesDream(candidate): boolean
		{
			return candidate.id === dream.id;
		});
		const canonical = structuredClone(dream);

		if (index >= 0) this.catalogue[index] = canonical;
		else
		{
			this.catalogue.push(canonical);
			this.locations.push({ dreamId: dream.id, workId: dream.workId, folderPath: "" });
		}
	}

	// Adds one canonical folder returned by the main process.
	public AddFolder(folder: DreamFolderSnapshot): void
	{
		const exists = this.folders.some(function MatchesFolder(candidate): boolean
		{
			return candidate.workId === folder.workId && candidate.path === folder.path;
		});
		if (!exists) this.folders.push(structuredClone(folder));
	}

	// Removes one empty canonical folder.
	public RemoveFolder(workId: string, folderPath: string): void
	{
		this.folders = this.folders.filter(function KeepFolder(folder): boolean
		{
			return folder.workId !== workId || folder.path !== folderPath;
		});
		if (this.selectedFolder?.workId === workId && this.selectedFolder.path === folderPath)
		{
			this.selectedFolder = null;
		}
	}

	// Applies one canonical Dream placement returned by the main process.
	public SetDreamLocation(location: DreamLocationSnapshot): void
	{
		this.locations = this.locations.filter(function KeepOther(candidate): boolean
		{
			return candidate.dreamId !== location.dreamId;
		});
		this.locations.push(structuredClone(location));
	}

	// Removes one deleted Dream from both the catalogue and its editing sessions.
	public Remove(dreamId: string): void
	{
		this.catalogue = this.catalogue.filter(function KeepDream(dream): boolean
		{
			return dream.id !== dreamId;
		});
		this.locations = this.locations.filter(function KeepLocation(location): boolean
		{
			return location.dreamId !== dreamId;
		});
		const tabIndex = this.openTabs.findIndex(function MatchesTab(tab): boolean
		{
			return tab.dream.id === dreamId;
		});

		if (tabIndex >= 0)
		{
			this.openTabs.splice(tabIndex, 1);
		}

		if (this.activeDreamId === dreamId)
		{
			const nextIndex = Math.min(tabIndex, this.openTabs.length - 1);
			this.activeDreamId = nextIndex >= 0 ? this.openTabs[nextIndex]?.dream.id ?? null : null;
		}

		this.PersistOrRemove();
	}

	// Replaces the canonical Signal collection in every projection of one Dream.
	public SetOwnedSignals(dreamId: string, signals: readonly SignalRecord[]): void
	{
		for (const dream of this.catalogue)
		{
			if (dream.id === dreamId) dream.signals = structuredClone([...signals]);
		}
		for (const tab of this.openTabs)
		{
			if (tab.dream.id === dreamId) tab.dream.signals = structuredClone([...signals]);
		}
		if (this.activeDreamId === dreamId) this.Persist();
	}

	// Removes one deleted Signal only from its owning Dream projections.
	public RemoveOwnedSignal(dreamId: string, signalId: string): void
	{
		for (const dream of this.catalogue)
		{
			if (dream.id === dreamId) this.RemoveSignalFromDream(dream, signalId);
		}
		for (const tab of this.openTabs)
		{
			if (tab.dream.id === dreamId)
			{
				this.RemoveSignalFromDream(tab.dream, signalId);
				if (tab.selectedSignalId === signalId) tab.selectedSignalId = null;
			}
		}
		if (this.activeDreamId === dreamId) this.Persist();
	}

	// Opens a DreamView for editing and records whether it starts with unsaved changes.
	public Open(dream: DreamView, isDirty: boolean): void
	{
		this.CancelPersistence();
		const existing = this.openTabs.find(function FindTab(tab): boolean { return tab.dream.id === dream.id; });
		if (existing !== undefined)
		{
			this.activeDreamId = existing.dream.id;
		}
		else
		{
			const snapshot: DreamSessionSnapshot = { dream: structuredClone(dream), isDirty, revision: 0, saveState: "idle", selectedSignalId: null, editorTabId: "signals" };
			this.openTabs.push(snapshot);
			this.activeDreamId = snapshot.dream.id;
		}
		this.Persist();
	}

	// Activates an already open DreamView tab without replacing its editing session.
	public ActivateTab(dreamId: string): DreamView | null
	{
		this.CancelPersistence();
		const tab = this.openTabs.find(function FindTab(candidate): boolean { return candidate.dream.id === dreamId; });
		if (tab !== undefined)
		{
			this.activeDreamId = tab.dream.id;
			this.Persist();
		}
		const dream = tab === undefined ? null : structuredClone(tab.dream);

		return dream;
	}

	// Closes the active DreamView editing session.
	public Close(): void
	{
		this.CancelPersistence();
		const activeId = this.activeDreamId;
		const activeIndex = this.openTabs.findIndex(function FindActive(tab): boolean { return tab.dream.id === activeId; });
		if (activeIndex >= 0) this.openTabs.splice(activeIndex, 1);
		const nextIndex = Math.min(activeIndex, this.openTabs.length - 1);
		const next = nextIndex >= 0 ? this.openTabs[nextIndex] ?? null : null;
		if (next === null)
		{
			this.activeDreamId = null;
			this.sessions.Remove(DreamStore.SessionKey);
		}
		else
		{
			this.activeDreamId = next.dream.id;
			this.Persist();
		}
	}

	// Updates the active DreamView title and records one authoritative state change.
	public UpdateTitle(title: string): DreamChange | null
	{
		let change: DreamChange | null = null;
		const tab = this.GetActiveTab();

		if (tab !== null)
		{
			tab.dream.title = title;
			change = this.RecordChange();
		}

		return change;
	}

	// Updates the active DreamView reflection and records one authoritative state change.
	public UpdateReflection(reflection: string): DreamChange | null
	{
		let change: DreamChange | null = null;
		const tab = this.GetActiveTab();

		if (tab !== null)
		{
			tab.dream.reflection = reflection;
			change = this.RecordChange();
		}

		return change;
	}

	// Replaces the source selection owned by the active DreamView.
	public ReplaceSource(source: TextSelection): DreamChange | null
	{
		let change: DreamChange | null = null;
		const tab = this.GetActiveTab();

		if (tab !== null)
		{
			tab.dream.source = structuredClone(source);
			change = this.RecordChange();
		}

		return change;
	}

	// Commits a successful save when no further mutation has occurred since it began.
	public MarkSaved(dream: DreamView, savedRevision: number): void
	{
		const tab = this.openTabs.find(function MatchesDream(candidate): boolean
		{
			return candidate.dream.id === dream.id;
		});

		if (tab !== undefined && savedRevision === tab.revision)
		{
			this.CancelPersistence();
			tab.dream = structuredClone(dream);
			tab.isDirty = false;
			tab.saveState = "idle";
			this.UpsertCatalogueDream(dream);
			this.Persist();
		}
	}

	// Records save state for the Dream captured by the persistence owner, independently of active-tab changes.
	public SetSaveState(dreamId: string, saveState: DreamSaveState): void
	{
		const tab = this.openTabs.find(function MatchesDream(candidate): boolean
		{
			return candidate.dream.id === dreamId;
		});

		if (tab !== undefined)
		{
			tab.saveState = saveState;
		}
	}

	// Flushes any pending session persistence before the store is torn down.
	public Dispose(): void
	{
		this.FlushPersistence();
	}

	// Removes one Signal identity and resolved record from one Dream projection.
	private RemoveSignalFromDream(dream: DreamView, signalId: string): boolean
	{
		const signals = dream.signals.filter(function KeepSignal(candidate): boolean
		{
			return candidate.id !== signalId;
		});
		const changed = signals.length !== dream.signals.length;

		if (changed)
		{
			dream.signals = signals;
		}

		return changed;
	}

	// Returns the one tab that owns the active Dream editing state.
	private GetActiveTab(): DreamSessionSnapshot | null
	{
		const activeDreamId = this.activeDreamId;
		const tab = activeDreamId === null
			? null
			: this.openTabs.find(function FindActive(candidate): boolean
			{
				return candidate.dream.id === activeDreamId;
			}) ?? null;

		return tab;
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
		if (comparison === 0) comparison = first.source.start.stephanus.localeCompare(second.source.start.stephanus);
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
		const tab = this.GetActiveTab();

		if (tab === null)
		{
			throw new Error("No active Dream editing session");
		}

		const wasDirty = tab.isDirty;
		tab.isDirty = true;
		tab.revision += 1;
		tab.saveState = "idle";
		this.SchedulePersistence();
		const dream = structuredClone(tab.dream);
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
		if (this.activeDreamId !== null)
		{
			const snapshot: DreamTabsSnapshot = { tabs: structuredClone(this.openTabs), activeDreamId: this.activeDreamId };
			this.sessions.Save(DreamStore.SessionKey, snapshot);
		}
	}

	// Persists remaining tabs or removes the session after the final tab disappears.
	private PersistOrRemove(): void
	{
		if (this.activeDreamId === null) this.sessions.Remove(DreamStore.SessionKey);
		else this.Persist();
	}
}
