import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { WordEvidenceResult, WordLexicalSearchResult, WordPersonResearch, WordSearchResult } from "../../../shared/library/WordExplorationTypes.js";

export interface WordExplorationSnapshot
{
	readonly selection: TextSelection | null;
	// A dictionary origin is independent of any text occurrence.
	readonly lexicalLemma: string | null;
	readonly selectedOccurrence: TextSelection | null;
	readonly selectedForm: string;
	readonly result: WordSearchResult | null;
	readonly evidence: WordEvidenceResult | null;
	readonly selectedLemma: string | null;
	readonly personResearch: WordPersonResearch | null;
	readonly nameNote: string;
	readonly loadingPersonResearch: boolean;
	readonly loadingNameNote: boolean;
	readonly searching: boolean;
	readonly loadingEvidence: boolean;
}

export interface WordExplorationTab
{
	readonly id: string;
	readonly title: string;
	readonly selected: boolean;
}

// Exact tab identity and reader choices; lookup responses are reloaded, never persisted here.
export interface WordTabState
{
	readonly selection: TextSelection | null;
	readonly lexicalLemma?: string;
	readonly lemma: string | null;
	readonly occurrence: TextSelection | null;
}

// Sidebar query state belongs to the existing word feature, not its DOM owner.
export interface WordLexicalSearchSnapshot
{
	readonly query: string;
	readonly result: WordLexicalSearchResult | null;
	readonly loading: boolean;
	readonly error: string;
}

// Ordered lookup membership and the active tab's position.
export interface WordWorkspaceState
{
	readonly tabs: readonly WordTabState[];
	readonly activeIndex: number;
	readonly visible: boolean;
}

export class WordExplorationStore
{
	private readonly sessions = new Map<string, WordExplorationSnapshot>();
	private activeId: string | null = null;
	private nextId = 0;
	private visible = true;
	private lexicalSearch: WordLexicalSearchSnapshot = { query: "", result: null, loading: false, error: "" };

	public GetLexicalSearch(): WordLexicalSearchSnapshot
	{
		const snapshot = structuredClone(this.lexicalSearch);
		return snapshot;
	}

	public SetLexicalSearch(state: WordLexicalSearchSnapshot): void
	{
		this.lexicalSearch = structuredClone(state);
	}

	// Selects an existing dictionary tab or creates one without a fabricated selection.
	public OpenLemma(lemma: string): string
	{
		let id: string | null = null;
		for (const [candidateId, snapshot] of this.sessions)
		{
			if (snapshot.lexicalLemma === lemma) id = candidateId;
		}
		if (id === null)
		{
			id = this.CreateSession(null, lemma, null);
			const snapshot = this.sessions.get(id)!;
			this.sessions.set(id, { ...snapshot, lexicalLemma: lemma, selectedLemma: lemma });
		}
		this.activeId = id;
		this.visible = true;
		return id;
	}

	// Passage tabs are work-scoped; dictionary tabs survive and refresh their occurrence scope.
	public ResetForWork(): void
	{
		for (const [id, snapshot] of this.sessions)
		{
			if (snapshot.lexicalLemma === null) this.sessions.delete(id);
			else this.sessions.set(id, { ...snapshot, evidence: null, selectedOccurrence: null });
		}
		if (this.activeId !== null && !this.sessions.has(this.activeId)) this.activeId = this.sessions.keys().next().value ?? null;
	}

	// Captures metadata directly without cloning dictionary and occurrence responses.
	public GetWorkspaceState(): WordWorkspaceState
	{
		const tabs: WordTabState[] = [];
		let activeIndex = -1;
		for (const [id, snapshot] of this.sessions)
		{
			if (snapshot.selection !== null || snapshot.lexicalLemma !== null)
			{
				if (id === this.activeId) activeIndex = tabs.length;
				tabs.push({ selection: structuredClone(snapshot.selection), lemma: snapshot.selectedLemma,
					...(snapshot.lexicalLemma === null ? {} : { lexicalLemma: snapshot.lexicalLemma }),
					occurrence: structuredClone(snapshot.selectedOccurrence) });
			}
		}
		return { tabs, activeIndex, visible: this.visible };
	}

	// Creates a distinct restored tab even when another tab invokes the same word.
	public RestoreTab(state: WordTabState, form: string): string
	{
		const id = this.CreateSession(state.selection, form, null);
		const snapshot = this.sessions.get(id)!;
		this.sessions.set(id, { ...snapshot, lexicalLemma: state.lexicalLemma ?? null,
			selectedLemma: state.lemma, selectedOccurrence: structuredClone(state.occurrence) });
		return id;
	}

	// Remembers the selected occurrence independently of transient DOM row indices.
	public SetSelectedOccurrence(selection: TextSelection): void
	{
		const snapshot = this.activeId === null ? undefined : this.sessions.get(this.activeId);
		if (snapshot !== undefined && this.activeId !== null)
		{
			this.sessions.set(this.activeId, { ...snapshot, selectedOccurrence: structuredClone(selection) });
		}
	}

	// Visibility is workspace state, independent of the host's collapsed geometry.
	public SetVisible(visible: boolean): void
	{
		this.visible = visible;
	}

	public IsVisible(): boolean
	{
		return this.visible;
	}

	public GetSnapshot(id = this.activeId): WordExplorationSnapshot
	{
		const snapshot = id === null ? undefined : this.sessions.get(id);
		const copy = structuredClone(snapshot ?? this.CreateEmptySnapshot());
		return copy;
	}

	public GetTabs(): readonly WordExplorationTab[]
	{
		return Array.from(this.sessions, ([id, snapshot]) => ({
			id,
			title: snapshot.selectedLemma
				?? (snapshot.evidence !== null && snapshot.evidence.possibilities.length > 1 ? "Choose lemma" : snapshot.selectedForm),
			selected: id === this.activeId
		}));
	}

	public GetActiveId(): string | null
	{
		return this.activeId;
	}

	public Select(selection: TextSelection, form: string): string
	{
		const matches = Array.from(this.sessions).filter(([, snapshot]) =>
			snapshot.selection !== null && this.SelectionKey(snapshot.selection) === this.SelectionKey(selection));
		const chooser = matches.find(([, snapshot]) => snapshot.selectedLemma === null);
		if (chooser !== undefined)
		{
			this.activeId = chooser[0];
			return chooser[0];
		}
		const existing = matches[0];
		if (existing !== undefined)
		{
			const evidence = existing[1].evidence;
			if (evidence === null || evidence.possibilities.length <= 1)
			{
				this.activeId = existing[0];
				return existing[0];
			}
			return this.CreateSession(selection, form, evidence);
		}
		return this.CreateSession(selection, form, null);
	}

	private CreateSession(selection: TextSelection | null, form: string, evidence: WordEvidenceResult | null): string
	{
		this.nextId += 1;
		const id = `word-lookup-${this.nextId}`;
		this.sessions.set(id, {
			...this.CreateEmptySnapshot(),
			selection: structuredClone(selection),
			selectedForm: form,
			evidence: structuredClone(evidence)
		});
		this.activeId = id;
		return id;
	}

	public SelectTab(id: string): boolean
	{
		if (!this.sessions.has(id)) return false;
		const changed = this.activeId !== id;
		this.activeId = id;
		return changed;
	}

	public CloseTab(id: string): boolean
	{
		const ids = Array.from(this.sessions.keys());
		const index = ids.indexOf(id);
		if (index < 0) return false;
		this.sessions.delete(id);
		if (this.activeId === id)
		{
			this.activeId = ids[index + 1] ?? ids[index - 1] ?? null;
		}
		return true;
	}

	public Clear(): void
	{
		this.sessions.clear();
		this.activeId = null;
	}

	public SetResult(result: WordSearchResult | null, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, result: structuredClone(result) }));
	}

	public SetEvidence(evidence: WordEvidenceResult | null, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, evidence: structuredClone(evidence) }));
	}

	/** Selects one reader-chosen lemma possibility for current-work comparison. */
	public SelectLemma(lemma: string | null, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({
			...snapshot,
			selectedLemma: lemma,
			personResearch: null,
			nameNote: "",
			loadingNameNote: false
		}));
	}

	public SetPersonResearch(value: WordPersonResearch | null, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({
			...snapshot,
			personResearch: value === null ? null : structuredClone(value)
		}));
	}

	public SetNameNote(value: string, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, nameNote: value }));
	}

	public SetLoadingPersonResearch(value: boolean, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, loadingPersonResearch: value }));
	}

	public SetLoadingNameNote(value: boolean, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, loadingNameNote: value }));
	}

	public SetSearching(searching: boolean, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, searching }));
	}

	public SetLoadingEvidence(loading: boolean, id = this.activeId): void
	{
		this.Update(id, (snapshot) => ({ ...snapshot, loadingEvidence: loading }));
	}

	private Update(id: string | null, change: (snapshot: WordExplorationSnapshot) => WordExplorationSnapshot): void
	{
		if (id === null) return;
		const snapshot = this.sessions.get(id);
		if (snapshot !== undefined) this.sessions.set(id, change(snapshot));
	}

	private CreateEmptySnapshot(): WordExplorationSnapshot
	{
		return {
			selection: null,
			lexicalLemma: null,
			selectedOccurrence: null,
			selectedForm: "",
			result: null,
			evidence: null,
			selectedLemma: null,
			personResearch: null,
			nameNote: "",
			loadingPersonResearch: false,
			loadingNameNote: false,
			searching: false,
			loadingEvidence: false
		};
	}

	private SelectionKey(selection: TextSelection): string
	{
		return `${selection.dialogue}:${selection.text_version}:${selection.start.stephanus}:${selection.start.offset}:${selection.end.stephanus}:${selection.end.offset}`;
	}
}
