import type { TextSelection } from "../text/TextSelection.js";

export interface WordOccurrence
{
	readonly selection: TextSelection;
	readonly citation: string | null;
	readonly division: { readonly type: string; readonly label: string } | null;
	readonly passage: string;
}

export interface WordObservationKey
{
	readonly dialogue: string;
	readonly textVersion: string;
	readonly lemma: string;
}

export interface WordObservation extends WordObservationKey
{
	readonly text: string;
}

export interface WordSearchResult
{
	readonly form: string;
	readonly occurrences: readonly WordOccurrence[];
	readonly total: number;
}

export type WordEvidenceValue = null | boolean | number | string | readonly WordEvidenceValue[] | { readonly [key: string]: WordEvidenceValue };

export interface WordEvidenceSource
{
	readonly attribution: string | null;
	readonly revision: string | null;
	readonly repository: string | null;
}

export interface WordEvidenceCandidate
{
	readonly provider: string;
	readonly providerVersion: string;
	readonly method: string | null;
	readonly classification: string | null;
	readonly language: string | null;
	readonly proper: boolean | null;
	readonly rank: number | null;
	readonly via: string | null;
	readonly citation: string | null;
	readonly tag: string | null;
	/** Original provider headword, including any homograph suffix. */
	readonly headword?: string | null;
	/** Provider's identifier distinguishing identically spelled headwords. */
	readonly homograph?: string | null;
	/** Grammatical features supplied by the analysis provider. */
	readonly features?: Readonly<Record<string, string>> | null;
	readonly settings: Readonly<Record<string, WordEvidenceValue>>;
	readonly source: WordEvidenceSource;
}

export interface WordLemmaPossibility
{
	readonly lemma: string;
	readonly candidates: readonly WordEvidenceCandidate[];
}

export interface WordDictionaryEntry
{
	readonly provider: string;
	readonly providerVersion: string;
	readonly headword: string;
	readonly matchedTerm: string;
	readonly entryId: string | null;
	readonly plainText: string;
	readonly entryXml: string;
	readonly source: WordEvidenceSource;
	readonly license: Readonly<Record<string, WordEvidenceValue>>;
}

export interface WordPersonSource
{
	readonly id: string;
	readonly kind: string;
	readonly title: string;
	readonly url: string;
	readonly excerpt: string;
	readonly provider: string;
	readonly cached: boolean;
	readonly relevance: "plato_dialogue" | "other";
}

export interface WordPersonResearch
{
	readonly contract: "platosi.person-research.v3";
	readonly status: string;
	readonly lemma: string;
	readonly classification: {
		readonly properNameCandidate: boolean;
		readonly basis: string;
	};
	/** Consolidated, source-cited research about the selected proper name. */
	readonly overview: string;
	/** Unique references cited in the overview, or retrieved references after a failure. */
	readonly sources: readonly WordPersonSource[];
	readonly candidates: readonly {
		readonly id: string;
		readonly label: string;
		readonly sources: readonly WordPersonSource[];
	}[];
	readonly model: Readonly<Record<string, WordEvidenceValue>> | null;
	readonly warnings: readonly string[];
}

export interface WordNameNoteKey
{
	readonly dialogue: string;
	readonly lemma: string;
}

export interface WordNameNote extends WordNameNoteKey
{
	readonly text: string;
}

export interface WordCitation
{
	readonly workId: string;
	readonly author: string | null;
	readonly title: string | null;
	readonly source: string;
	readonly century: number | null;
	readonly locus: string | null;
	readonly locusScheme: string | null;
	readonly count: number;
}

export interface WordAttestation
{
	readonly form: string | null;
	readonly attested: boolean | null;
	readonly total: number | null;
	readonly works: number | null;
	readonly sourceCounts: Readonly<Record<string, number>>;
	readonly byGenre: Readonly<Record<string, number>>;
	readonly byCentury: Readonly<Record<string, number>>;
	readonly byDialect: Readonly<Record<string, number>>;
	readonly dominantPartOfSpeech: string | null;
	readonly citations: readonly WordCitation[];
}

export interface WordParadigmForm
{
	readonly slot: string;
	readonly form: string;
	readonly source: string;
}

/** One provider-mapped lemma form that occurs in PlatoSI's canonical dialogue. */
export interface WordDialogueForm
{
	readonly form: string;
	readonly occurrences: readonly WordOccurrence[];
	readonly total: number;
	readonly evidence: readonly Readonly<Record<string, WordEvidenceValue>>[];
}

export interface WordRelatedLemma
{
	readonly lemma: string;
	readonly relationType: string;
	readonly direction: string;
	readonly presentInDialogue: boolean;
	readonly total: number;
	readonly forms: readonly WordDialogueForm[];
	readonly evidence: readonly Readonly<Record<string, WordEvidenceValue>>[];
	/** Dictionary evidence for the related headword, separate from the relationship evidence. */
	readonly dictionary?: {
		readonly status: string;
		readonly entries: readonly WordDictionaryEntry[];
		readonly possiblyTruncated: boolean;
	} | null;
}

export interface WordDialogueLemma
{
	readonly lemma: string;
	readonly candidates: readonly WordEvidenceCandidate[];
	readonly forms: readonly WordDialogueForm[];
	readonly relatedLemmas: readonly WordRelatedLemma[];
}

export interface WordLemmaEvidence
{
	readonly lemma: string;
	readonly attestation: WordAttestation | null;
	readonly paradigm: {
		readonly partOfSpeech: string;
		readonly forms: readonly WordParadigmForm[];
	} | null;
}

/** Sources consulted for analysis and for the separate dialogue form inventories. */
export interface WordEvidenceCoverage
{
	/** Providers returning analyses for the selected word. */
	readonly analysisProviders: readonly string[];
	/** Providers supplying reverse lemma-form inventories. */
	readonly formInventoryProviders: readonly string[];
	/** Analysis providers that have not supplied an occurrence inventory. */
	readonly analysisOnlyProviders: readonly string[];
	/** Providers whose analyses are stored in PlatoSI's permanent dialogue index. */
	readonly morphologyIndexProviders?: readonly string[];
	/** Permanent dialogue morphology coverage, separate from contextual interpretation. */
	readonly morphologyIndexes?: readonly {
		readonly provider: string;
		readonly state: string;
		readonly checkedForms: number;
		readonly totalForms: number;
		readonly analyzedForms: number;
		readonly unresolvedForms: number;
		readonly failedForms: number;
		readonly pendingForms: number;
		readonly wholeDialogueComplete: boolean;
		readonly contextReviewed: boolean;
	}[];
	/** Providers contributing current cached source headword mappings. */
	readonly cachedAnalysisProviders?: readonly string[];
	/** Dialogue-wide cache coverage, separate from contextual interpretation. */
	readonly cachedFormCoverage?: readonly {
		readonly provider: string;
		readonly checkedForms: number;
		readonly totalForms: number;
		readonly checkedTokens: number;
		readonly totalTokens: number;
		readonly wholeDialogueComplete: boolean;
		readonly contextReviewed: boolean;
	}[];
}

export interface WordEvidenceResult
{
	readonly contract: "platosi.dialogue-lexicon.v1" | "platosi.lexical-evidence.v1";
	readonly selection: TextSelection | null;
	// Work used for occurrences, independent of the lookup's lexical or passage origin.
	readonly work: WordWorkScope | null;
	readonly occurrencesStatus: "indexed" | "unavailable";
	readonly form: string;
	readonly context: readonly { readonly stephanus: string; readonly text: string }[];
	readonly possibilities: readonly WordLemmaPossibility[];
	readonly lemmas: readonly WordDialogueLemma[];
	/** Absent in responses that do not report inventory coverage. */
	readonly coverage?: WordEvidenceCoverage | null;
	readonly dictionary: {
		readonly status: string;
		readonly entries: readonly WordDictionaryEntry[];
		readonly possiblyTruncated: boolean;
	};
	readonly morphology: {
		readonly status: string;
		readonly provider: WordEvidenceSource | null;
		readonly normalization: Readonly<Record<string, WordEvidenceValue>> | null;
		readonly spellingSuggestions: WordEvidenceValue;
		readonly formAttestation: WordAttestation | null;
		readonly lemmas: readonly WordLemmaEvidence[];
		readonly artifacts: Readonly<Record<string, WordEvidenceValue>> | null;
	};
	readonly warnings: readonly string[];
	readonly limitations: string;
}

// Canonical occurrence scope without inventing a passage selection.
export interface WordWorkScope
{
	readonly dialogue: string;
	readonly text_version: string;
}

// Bounded headword matches and possible lemmas for a reader-entered Greek word.
export interface WordLexicalSearchResult
{
	readonly query: string;
	readonly items: readonly { readonly lemma: string }[];
	readonly possiblyTruncated: boolean;
	readonly warnings: readonly string[];
}
