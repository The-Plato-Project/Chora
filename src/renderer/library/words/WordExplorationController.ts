import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../../core/events/ChoraEventBus.js";
import { ErrorManager } from "../../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../LibraryStore.js";
import { WordExplorationGateway } from "./WordExplorationGateway.js";
import { WordExplorationStore } from "./WordExplorationStore.js";

export interface WordReaderApi
{
	RevealSelectionAsync(selection: TextSelection, highlight: "word"): Promise<void>;
}

export class WordExplorationController
{
	private readonly subscriptions: Unsubscribe[] = [];
	private generation = 0;
	private selectionVersion = 0;

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
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
	}

	public async SearchAsync(form: string): Promise<void>
	{
		const snapshot = this.store.GetSnapshot();
		const selection = snapshot.selection;
		if (selection !== null)
		{
			this.generation += 1;
			const generation = this.generation;
			this.store.SetSearching(true);
			await this.ChangedAsync();
			try
			{
				const result = await this.gateway.SearchAsync(selection.dialogue, form);
				if (generation === this.generation)
				{
					this.store.SetResult(result);
				}
			}
			catch (error)
			{
				if (generation === this.generation)
				{
					this.store.SetResult(null);
					this.errors.Report("WordExploration", error, "Could not search this word.");
				}
				else
				{
					this.errors.Debug("WordExploration", "A superseded word search failed.", error);
				}
			}
			finally
			{
				if (generation === this.generation)
				{
					this.store.SetSearching(false);
					await this.ChangedAsync();
				}
			}
		}
	}

	public async LoadEvidenceAsync(selection: TextSelection): Promise<void>
	{
		const generation = this.generation;
		this.store.SetLoadingEvidence(true);
		this.store.SetEvidence(null);
		await this.ChangedAsync();
		try
		{
			const evidence = await this.gateway.GetEvidenceAsync(selection);
			if (generation === this.generation)
			{
				this.store.SetEvidence(evidence);
				if (evidence.possibilities.length >= 1)
				{
					const possibility = evidence.possibilities[0];
					if (possibility !== undefined)
					{
						this.store.SelectLemma(possibility.lemma);
						void this.LoadPersonResearchAsync(selection, possibility.lemma);
						await this.LoadObservationAsync(selection, possibility.lemma);
					}
				}
			}
		}
		catch (error)
		{
			if (generation === this.generation)
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
			if (generation === this.generation)
			{
				this.store.SetLoadingEvidence(false);
				await this.ChangedAsync();
			}
		}
	}

	/** Selects one returned lemma possibility without adjudicating it. */
	public async SelectLemmaAsync(lemma: string): Promise<void>
	{
		const snapshot = this.store.GetSnapshot();
		const available = snapshot.evidence?.possibilities.some(function MatchesPossibility(possibility)
		{
			return possibility.lemma === lemma;
		}) ?? false;
		if (available)
		{
			this.store.SelectLemma(lemma);
			await this.ChangedAsync();
			if (snapshot.selection !== null)
			{
				void this.LoadPersonResearchAsync(snapshot.selection, lemma);
				await this.LoadObservationAsync(snapshot.selection, lemma);
			}
		}
	}

	public async SaveObservationAsync(text: string): Promise<void>
	{
		const snapshot = this.store.GetSnapshot();
		if (snapshot.selection === null || snapshot.selectedLemma === null) return;
		this.store.SetObservation(text);
		const observation = {
			dialogue: snapshot.selection.dialogue,
			textVersion: snapshot.selection.text_version,
			lemma: snapshot.selectedLemma,
			text
		};
		try
		{
			await this.gateway.SaveObservationAsync(observation);
		}
		catch (error)
		{
			this.errors.Report("WordExploration", error, "Could not save this word observation.");
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

	public async JumpAsync(selection: TextSelection): Promise<void>
	{
		await this.reader.RevealSelectionAsync(selection, "word");
	}

	private async ExploreAsync(event: ChoraEvents["word.exploration-requested"]): Promise<void>
	{
		this.generation += 1;
		this.selectionVersion += 1;
		const version = this.selectionVersion;
		if (version === this.selectionVersion)
		{
			const document = this.library.GetText();
			if (document !== null && document.id === event.selection.dialogue)
			{
				const form = document.ReconstructText(event.selection);
				this.store.Select(event.selection, form);
				if (version === this.selectionVersion)
				{
					await this.LoadEvidenceAsync(event.selection);
				}

			}
			else
			{
				const error = new Error("The selected word belongs to a different work.");
				this.errors.Report("WordExploration", error, "Open the selected word's text and try again.");
			}
		}
	}

	private async LoadObservationAsync(selection: TextSelection, lemma: string): Promise<void>
	{
		const generation = this.generation;
		this.store.SetLoadingObservation(true);
		await this.ChangedAsync();
		try
		{
			const observation = await this.gateway.GetObservationAsync({
				dialogue: selection.dialogue,
				textVersion: selection.text_version,
				lemma
			});
			const snapshot = this.store.GetSnapshot();
			if (generation === this.generation && snapshot.selectedLemma === lemma)
			{
				this.store.SetObservation(observation.text);
			}
		}
		catch (error)
		{
			if (generation === this.generation)
			{
				this.errors.Report("WordExploration", error, "Could not load this word observation.");
			}
		}
		finally
		{
			if (generation === this.generation)
			{
				this.store.SetLoadingObservation(false);
				await this.ChangedAsync();
			}
		}
	}

	private async LoadPersonResearchAsync(selection: TextSelection, lemma: string): Promise<void>
	{
		const snapshot = this.store.GetSnapshot();
		const possibility = snapshot.evidence?.possibilities.find((item) => item.lemma === lemma);
		const isProperCandidate = possibility?.candidates.some((candidate) => candidate.proper) ?? false;
		if (!isProperCandidate)
		{
			this.store.SetPersonResearch(null);
			this.store.SetLoadingPersonResearch(false);
			await this.ChangedAsync();
			return;
		}
		const generation = this.generation;
		this.store.SetPersonResearch(null);
		this.store.SetLoadingPersonResearch(true);
		await this.ChangedAsync();
		try
		{
			const result = await this.gateway.GetPersonResearchAsync(selection, lemma);
			const current = this.store.GetSnapshot();
			if (generation === this.generation && current.selectedLemma === lemma)
			{
				this.store.SetPersonResearch(result);
			}
		}
		catch (error)
		{
			if (generation === this.generation)
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
			const current = this.store.GetSnapshot();
			if (generation === this.generation && current.selectedLemma === lemma)
			{
				this.store.SetLoadingPersonResearch(false);
				await this.ChangedAsync();
			}
		}
	}

	private async ResetAsync(): Promise<void>
	{
		this.generation += 1;
		this.selectionVersion += 1;
		this.store.Clear();
		await this.ChangedAsync();
	}

	private async ChangedAsync(): Promise<void>
	{
		await this.events.PublishAsync("word.exploration-changed", {});
	}
}
