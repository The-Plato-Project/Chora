import type { TextSelection } from "../../../shared/text/TextSelection.js";
import type { WordEvidenceResult, WordPersonResearch, WordSearchResult } from "../../../shared/library/WordExplorationTypes.js";

export interface WordExplorationSnapshot
{
	readonly selection: TextSelection | null;
	readonly selectedForm: string;
	readonly result: WordSearchResult | null;
	readonly evidence: WordEvidenceResult | null;
	readonly selectedLemma: string | null;
	readonly observation: string;
	readonly personResearch: WordPersonResearch | null;
	readonly loadingObservation: boolean;
	readonly loadingPersonResearch: boolean;
	readonly searching: boolean;
	readonly loadingEvidence: boolean;
}

export class WordExplorationStore
{
	private selection: TextSelection | null = null;
	private selectedForm = "";
	private result: WordSearchResult | null = null;
	private evidence: WordEvidenceResult | null = null;
	private selectedLemma: string | null = null;
	private observation = "";
	private personResearch: WordPersonResearch | null = null;
	private loadingObservation = false;
	private loadingPersonResearch = false;
	private searching = false;
	private loadingEvidence = false;

	public GetSnapshot(): WordExplorationSnapshot
	{
		const snapshot: WordExplorationSnapshot = {
			selection: this.selection,
			selectedForm: this.selectedForm,
			result: this.result,
			evidence: this.evidence,
			selectedLemma: this.selectedLemma,
			observation: this.observation,
			personResearch: this.personResearch,
			loadingObservation: this.loadingObservation,
			loadingPersonResearch: this.loadingPersonResearch,
			searching: this.searching,
			loadingEvidence: this.loadingEvidence
		};
		const copy = structuredClone(snapshot);
		return copy;
	}

	public Select(selection: TextSelection, form: string): void
	{
		this.selection = structuredClone(selection);
		this.selectedForm = form;
		this.result = null;
		this.evidence = null;
		this.selectedLemma = null;
		this.observation = "";
		this.personResearch = null;
		this.loadingObservation = false;
		this.loadingPersonResearch = false;
	}

	public Clear(): void
	{
		this.selection = null;
		this.selectedForm = "";
		this.result = null;
		this.evidence = null;
		this.selectedLemma = null;
		this.observation = "";
		this.personResearch = null;
		this.loadingObservation = false;
		this.loadingPersonResearch = false;
		this.searching = false;
		this.loadingEvidence = false;
	}

	public SetResult(result: WordSearchResult | null): void
	{
		this.result = structuredClone(result);
	}

	public SetEvidence(evidence: WordEvidenceResult | null): void
	{
		this.evidence = structuredClone(evidence);
	}

	/** Selects one reader-chosen lemma possibility for current-work comparison. */
	public SelectLemma(lemma: string): void
	{
		this.selectedLemma = lemma;
		this.observation = "";
		this.personResearch = null;
	}

	public SetObservation(value: string): void
	{
		this.observation = value;
	}

	public SetLoadingObservation(value: boolean): void
	{
		this.loadingObservation = value;
	}

	public SetPersonResearch(value: WordPersonResearch | null): void
	{
		this.personResearch = value === null ? null : structuredClone(value);
	}

	public SetLoadingPersonResearch(value: boolean): void
	{
		this.loadingPersonResearch = value;
	}

	public SetSearching(searching: boolean): void
	{
		this.searching = searching;
	}

	public SetLoadingEvidence(loading: boolean): void
	{
		this.loadingEvidence = loading;
	}

}
