import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { WordEvidenceResult } from "../../../shared/library/WordExplorationTypes.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../../core/events/ChoraEventBus.js";
import { ErrorManager } from "../../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../LibraryStore.js";
import { WordExplorationGateway } from "./WordExplorationGateway.js";
import { WordExplorationStore, type WordTabState, type WordWorkspaceState } from "./WordExplorationStore.js";

export interface WordReaderApi
{
	RevealSelectionAsync(selection: TextSelection, highlight: "word"): Promise<void>;
}

export class WordExplorationController
{
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly generations = new Map<string, number>();
	private disposed = false;
	// Monotonic identities prevent a work switch from reviving an older asynchronous response.
	private nextGeneration = 0;
	private searchGeneration = 0;

	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly library: LibraryStore,
		private readonly reader: WordReaderApi,
		private readonly store: WordExplorationStore,
		private readonly gateway: WordExplorationGateway)
	{
		const explore = this.ExploreAsync.bind(this);
		const textOpened = this.ResetAsync.bind(this);
		const exploreSubscription = events.Subscribe("word.exploration-requested", explore);
		const textSubscription = events.Subscribe("library.text-opened", textOpened);
		this.subscriptions.push(exploreSubscription);
		this.subscriptions.push(textSubscription);
		this.subscriptions.push(events.Subscribe("word.lemma-open-requested", this.OpenLemmaAsync.bind(this)));
	}

	// Invalidates older searches as soon as the reader edits the query.
	public SetLexicalQuery(query: string): void
	{
		this.searchGeneration += 1;
		this.store.SetLexicalSearch({ query, result: null, loading: false, error: "" });
		void this.events.PublishAsync("word.lexical-search-changed", {});
	}

	// Search responses are bounded and never choose a lemma on the reader's behalf.
	public async SearchLexiconAsync(): Promise<void>
	{
		const query = this.store.GetLexicalSearch().query.trim().normalize("NFC");
		this.searchGeneration += 1;
		const generation = this.searchGeneration;
		if (query.length > 0)
		{
			this.store.SetLexicalSearch({ query, result: null, loading: true, error: "" });
			await this.events.PublishAsync("word.lexical-search-changed", {});
			try
			{
				const result = await this.gateway.SearchLexiconAsync(query);
				if (!this.disposed && generation === this.searchGeneration)
				{
					this.store.SetLexicalSearch({ query, result, loading: false, error: "" });
				}
			}
			catch (error)
			{
				this.errors.Capture("WordSearch", error);
				if (!this.disposed && generation === this.searchGeneration)
				{
					this.store.SetLexicalSearch({ query, result: null, loading: false,
						error: "Could not search. Check that you entered one Greek word, then try again." });
				}
			}
			if (!this.disposed && generation === this.searchGeneration) await this.events.PublishAsync("word.lexical-search-changed", {});
		}
	}

	private async OpenLemmaAsync(event: ChoraEvents["word.lemma-open-requested"]): Promise<void>
	{
		const lemma = event.lemma.normalize("NFC");
		const id = this.store.OpenLemma(lemma);
		await this.LoadLexicalEvidenceAsync(lemma, id);
	}

	// Reuses the existing evidence owner and highlight events for lexical tabs.
	private async LoadLexicalEvidenceAsync(lemma: string, id: string): Promise<void>
	{
		const generation = this.IncrementGeneration(id);
		const workId = this.library.GetText()?.id ?? null;
		this.store.SetLoadingEvidence(true, id);
		await this.ChangedAsync();
		try
		{
			const evidence = await this.gateway.GetLexicalEvidenceAsync(lemma, workId);
			if (this.IsCurrent(id, generation))
			{
				this.store.SetEvidence(evidence, id);
				if (id === this.store.GetActiveId()) await this.PublishHighlightsAsync();
			}
		}
		catch (error)
		{
			if (this.IsCurrent(id, generation)) this.errors.Report("WordExploration", error, "Could not open this dictionary entry.");
		}
		finally
		{
			if (this.IsCurrent(id, generation))
			{
				this.store.SetLoadingEvidence(false, id);
				await this.ChangedAsync();
			}
		}
	}

	public Dispose(): void
	{
		this.disposed = true;
		this.generations.clear();
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
	}

	public async SearchAsync(form: string): Promise<void>
	{
		const sessionId = this.store.GetActiveId();
		if (sessionId === null) return;
		const snapshot = this.store.GetSnapshot(sessionId);
		const selection = snapshot.selection;
		if (selection !== null)
		{
			const generation = this.IncrementGeneration(sessionId);
			this.store.SetSearching(true, sessionId);
			await this.ChangedAsync();
			try
			{
				const result = await this.gateway.SearchAsync(selection.dialogue, form);
				if (this.IsCurrent(sessionId, generation))
				{
					this.store.SetResult(result, sessionId);
				}
			}
			catch (error)
			{
				if (this.IsCurrent(sessionId, generation))
				{
					this.store.SetResult(null, sessionId);
					this.errors.Report("WordExploration", error, "Could not search this word.");
				}
				else
				{
					this.errors.Debug("WordExploration", "A superseded word search failed.", error);
				}
			}
			finally
			{
				if (this.IsCurrent(sessionId, generation))
				{
					this.store.SetSearching(false, sessionId);
					await this.ChangedAsync();
				}
			}
		}
	}

	public async LoadEvidenceAsync(selection: TextSelection, sessionId = this.store.GetActiveId(), requestGeneration?: number, preferredLemma: string | null = null): Promise<void>
	{
		if (sessionId === null) return;
		const generation = requestGeneration ?? this.IncrementGeneration(sessionId);
		this.store.SetLoadingEvidence(true, sessionId);
		this.store.SetEvidence(null, sessionId);
		await this.ChangedAsync();
		try
		{
			const evidence = await this.gateway.GetEvidenceAsync(selection);
			if (this.IsCurrent(sessionId, generation))
			{
				this.store.SetEvidence(evidence, sessionId);
				const savedPossibility = evidence.possibilities.find(function MatchesSavedLemma(possibility)
				{
					return possibility.lemma === preferredLemma;
				});
				this.store.SelectLemma(null, sessionId);
				if (savedPossibility !== undefined || evidence.possibilities.length === 1)
				{
					const possibility = savedPossibility ?? evidence.possibilities[0];
					if (possibility !== undefined)
					{
						this.store.SelectLemma(possibility.lemma, sessionId);
						if (sessionId === this.store.GetActiveId()) await this.PublishHighlightsAsync();
						void this.LoadPersonResearchAsync(selection, possibility.lemma, sessionId, generation);
					}
				}
			}
		}
		catch (error)
		{
			if (this.IsCurrent(sessionId, generation))
			{
				this.errors.Report("WordExploration", error, "Could not load the word lookup.");
			}
			else
			{
				this.errors.Debug("WordExploration", "A superseded word lookup request failed.", error);
			}
		}
		finally
		{
			if (this.IsCurrent(sessionId, generation))
			{
				this.store.SetLoadingEvidence(false, sessionId);
				await this.ChangedAsync();
			}
		}
	}

	// Restores only exact, still-valid selections; each tab fetches current evidence.
	public async RestoreWorkspaceAsync(state: WordWorkspaceState): Promise<void>
	{
		const document = this.library.GetText();
		const pending: Array<{ id: string; tab: WordTabState }> = [];
		let activeId: string | null = null;
		if (!this.disposed)
		{
			for (const [index, tab] of state.tabs.entries())
			{
				try
				{
					if (tab.selection !== null)
					{
						if (document === null) throw new Error("The saved word's work is unavailable.");
						document.ValidateSelection(tab.selection);
					}
					else if (tab.lexicalLemma === undefined) throw new Error("The saved lookup has no origin.");
					let occurrence: TextSelection | null = null;
					if (tab.occurrence !== null)
					{
						try
						{
							if (document === null) throw new Error("The saved occurrence's work is unavailable.");
							document.ValidateSelection(tab.occurrence);
							occurrence = tab.occurrence;
						}
						catch
						{
							// A stale detail does not invalidate the invoking tab.
						}
					}
					const form = tab.selection !== null && document !== null ? document.ReconstructText(tab.selection) : tab.lexicalLemma!;
					const id = this.store.RestoreTab({ ...tab, occurrence }, form);
					pending.push({ id, tab });
					if (index === state.activeIndex) activeId = id;
				}
				catch (error)
				{
					this.errors.Debug("WordExploration", "Skipped a stale saved word selection.", error);
				}
			}
			if (activeId !== null) this.store.SelectTab(activeId);
			this.store.SetVisible(state.visible);
			await this.PublishHighlightsAsync();
			await this.ChangedAsync();
			// Bound simultaneous IPC requests when a workspace contains many tabs.
			for (let index = 0; index < pending.length && !this.disposed && this.library.GetText() === document; index += 4)
			{
				const requests: Promise<void>[] = [];
				for (const tab of pending.slice(index, index + 4))
				{
					if (tab.tab.selection !== null) requests.push(this.LoadEvidenceAsync(tab.tab.selection, tab.id, undefined, tab.tab.lemma));
					else if (tab.tab.lexicalLemma !== undefined) requests.push(this.LoadLexicalEvidenceAsync(tab.tab.lexicalLemma, tab.id));
				}
				await Promise.all(requests);
			}
		}
	}

	// Records a detail choice without rerendering the entire lookup surface.
	public SelectOccurrence(selection: TextSelection): void
	{
		this.store.SetSelectedOccurrence(selection);
		void this.events.PublishAsync("word.occurrence-selected", {});
	}

	public async GetOccurrenceEvidenceAsync(selection: TextSelection): Promise<WordEvidenceResult | null>
	{
		try
		{
			return await this.gateway.GetEvidenceAsync(selection);
		}
		catch (error)
		{
			this.errors.Report("WordExploration", error, "Could not load morphology for this occurrence.");
			return null;
		}
	}

	/** Selects one returned lemma possibility without adjudicating it. */
	public async SelectLemmaAsync(lemma: string): Promise<void>
	{
		const sessionId = this.store.GetActiveId();
		if (sessionId === null) return;
		const snapshot = this.store.GetSnapshot(sessionId);
		const available = snapshot.evidence?.possibilities.some(function MatchesPossibility(possibility)
		{
			return possibility.lemma === lemma;
		}) ?? false;
		if (available)
		{
			this.store.SelectLemma(lemma, sessionId);
			await this.PublishHighlightsAsync();
			await this.ChangedAsync();
			if (snapshot.selection !== null)
			{
				void this.LoadPersonResearchAsync(snapshot.selection, lemma, sessionId, this.GetGeneration(sessionId));
			}
		}
	}

	public async OpenExternalSourceAsync(url: string): Promise<void>
	{
		try
		{
			await this.gateway.OpenExternalSourceAsync(url);
		}
		catch (error)
		{
			this.errors.Report("WordExploration", error, "Could not open this research source.");
		}
	}

	public async SaveNameNoteAsync(text: string): Promise<void>
	{
		const sessionId = this.store.GetActiveId();
		if (sessionId === null) return;
		const snapshot = this.store.GetSnapshot(sessionId);
		if (snapshot.selection === null || snapshot.selectedLemma === null) return;
		this.store.SetNameNote(text, sessionId);
		try
		{
			await this.gateway.SaveNameNoteAsync({
				dialogue: snapshot.selection.dialogue,
				lemma: snapshot.selectedLemma,
				text
			});
		}
		catch (error)
		{
			this.errors.Report("WordExploration", error, "Could not save this name note.");
		}
	}

	public async JumpAsync(selection: TextSelection): Promise<void>
	{
		await this.reader.RevealSelectionAsync(selection, "word");
	}

	public async SelectTabAsync(id: string): Promise<void>
	{
		if (this.store.SelectTab(id))
		{
			await this.PublishHighlightsAsync();
			await this.ChangedAsync();
		}
	}

	public async CloseTabAsync(id: string): Promise<void>
	{
		if (this.store.CloseTab(id))
		{
			this.generations.delete(id);
			await this.PublishHighlightsAsync();
			await this.ChangedAsync();
		}
	}

	private async ExploreAsync(event: ChoraEvents["word.exploration-requested"]): Promise<void>
	{
		const document = this.library.GetText();
		if (document !== null && document.id === event.selection.dialogue)
		{
			const form = document.ReconstructText(event.selection);
			const sessionId = this.store.Select(event.selection, form);
			const existing = this.store.GetSnapshot(sessionId).evidence !== null;
			await this.PublishHighlightsAsync();
			await this.ChangedAsync();
			if (!existing)
			{
				const generation = this.IncrementGeneration(sessionId);
				await this.LoadEvidenceAsync(event.selection, sessionId, generation);
			}
		}
		else
		{
			const error = new Error("The selected word belongs to a different work.");
			this.errors.Report("WordExploration", error, "Open the selected word's text and try again.");
		}
	}

	private async LoadPersonResearchAsync(selection: TextSelection, lemma: string, sessionId: string, generation: number): Promise<void>
	{
		const snapshot = this.store.GetSnapshot(sessionId);
		const possibility = snapshot.evidence?.possibilities.find((item) => item.lemma === lemma);
		const isProperCandidate = possibility?.candidates.some((candidate) => candidate.proper) ?? false;
		if (!isProperCandidate)
		{
			this.store.SetPersonResearch(null, sessionId);
			this.store.SetNameNote("", sessionId);
			this.store.SetLoadingPersonResearch(false, sessionId);
			this.store.SetLoadingNameNote(false, sessionId);
			await this.ChangedAsync();
			return;
		}
		void this.LoadNameNoteAsync(selection, lemma, sessionId, generation);
		this.store.SetPersonResearch(null, sessionId);
		this.store.SetLoadingPersonResearch(true, sessionId);
		await this.ChangedAsync();
		try
		{
			const result = await this.gateway.GetPersonResearchAsync(selection, lemma);
			const current = this.store.GetSnapshot(sessionId);
			if (this.IsCurrent(sessionId, generation) && current.selectedLemma === lemma)
			{
				this.store.SetPersonResearch(result, sessionId);
			}
		}
		catch (error)
		{
			if (this.IsCurrent(sessionId, generation))
			{
				this.errors.Report("WordExploration", error, "Could not research this proper-name candidate.");
			}
			else
			{
				this.errors.Debug("WordExploration", "A superseded person lookup failed.", error);
			}
		}
		finally
		{
			const current = this.store.GetSnapshot(sessionId);
			if (this.IsCurrent(sessionId, generation) && current.selectedLemma === lemma)
			{
				this.store.SetLoadingPersonResearch(false, sessionId);
				await this.ChangedAsync();
			}
		}
	}

	private async LoadNameNoteAsync(selection: TextSelection, lemma: string, sessionId: string, generation: number): Promise<void>
	{
		this.store.SetNameNote("", sessionId);
		this.store.SetLoadingNameNote(true, sessionId);
		await this.ChangedAsync();
		try
		{
			const note = await this.gateway.GetNameNoteAsync({
				dialogue: selection.dialogue,
				lemma
			});
			const current = this.store.GetSnapshot(sessionId);
			if (this.IsCurrent(sessionId, generation) && current.selectedLemma === lemma)
			{
				this.store.SetNameNote(note.text, sessionId);
			}
		}
		catch (error)
		{
			if (this.IsCurrent(sessionId, generation))
			{
				this.errors.Report("WordExploration", error, "Could not load this name note.");
			}
		}
		finally
		{
			const current = this.store.GetSnapshot(sessionId);
			if (this.IsCurrent(sessionId, generation) && current.selectedLemma === lemma)
			{
				this.store.SetLoadingNameNote(false, sessionId);
				await this.ChangedAsync();
			}
		}
	}

	private async ResetAsync(): Promise<void>
	{
		this.generations.clear();
		this.store.ResetForWork();
		await this.PublishHighlightsAsync();
		await this.ChangedAsync();
		const requests: Promise<void>[] = [];
		for (const tab of this.store.GetTabs())
		{
			const lemma = this.store.GetSnapshot(tab.id).lexicalLemma;
			if (lemma !== null) requests.push(this.LoadLexicalEvidenceAsync(lemma, tab.id));
		}
		await Promise.all(requests);
	}

	// Publishes the original word and every mapped occurrence of the reader-selected lemma.
	private async PublishHighlightsAsync(): Promise<void>
	{
		const snapshot = this.store.GetSnapshot();
		const selections = new Map<string, TextSelection>();
		if (snapshot.selection !== null)
		{
			const key = this.GetSelectionKey(snapshot.selection);
			selections.set(key, snapshot.selection);
		}
		const lemma = snapshot.evidence?.lemmas.find(function MatchesLemma(candidate): boolean
		{
			return candidate.lemma === snapshot.selectedLemma;
		});
		for (const form of lemma?.forms ?? [])
		{
			for (const occurrence of form.occurrences)
			{
				const key = this.GetSelectionKey(occurrence.selection);
				selections.set(key, occurrence.selection);
			}
		}
		const highlights = Array.from(selections.values());
		await this.events.PublishAsync("word.highlights-changed", { selections: highlights });
	}

	// Returns the stable canonical identity used to remove duplicate occurrence ranges.
	private GetSelectionKey(selection: TextSelection): string
	{
		const start = selection.start;
		const end = selection.end;
		const key = `${selection.dialogue}:${selection.text_version}:${start.stephanus}:${start.offset}:${end.stephanus}:${end.offset}`;

		return key;
	}

	private async ChangedAsync(): Promise<void>
	{
		await this.events.PublishAsync("word.exploration-changed", {});
	}

	private IncrementGeneration(sessionId: string): number
	{
		this.nextGeneration += 1;
		const generation = this.nextGeneration;
		this.generations.set(sessionId, generation);
		return generation;
	}

	private GetGeneration(sessionId: string): number
	{
		return this.generations.get(sessionId) ?? 0;
	}

	private IsCurrent(sessionId: string, generation: number): boolean
	{
		return !this.disposed && this.store.GetTabs().some((tab) => tab.id === sessionId)
			&& this.GetGeneration(sessionId) === generation;
	}
}
