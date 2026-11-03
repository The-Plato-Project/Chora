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
}

export interface WordPersonResearch
{
	readonly contract: "platosi.person-research.v1";
	readonly status: string;
	readonly lemma: string;
	readonly classification: {
		readonly properNameCandidate: boolean;
		readonly basis: string;
	};
	readonly roots: readonly string[];
	readonly summary: {
		readonly person: string;
		readonly nameMeaning: string;
		readonly relationships: readonly string[];
	} | null;
	readonly sources: readonly WordPersonSource[];
	readonly model: Readonly<Record<string, WordEvidenceValue>> | null;
	readonly warnings: readonly string[];
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

export interface WordEvidenceResult
{
	readonly contract: "platosi.dialogue-lexicon.v1";
	readonly selection: TextSelection;
	readonly form: string;
	readonly context: readonly { readonly stephanus: string; readonly text: string }[];
	readonly possibilities: readonly WordLemmaPossibility[];
	readonly lemmas: readonly WordDialogueLemma[];
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
