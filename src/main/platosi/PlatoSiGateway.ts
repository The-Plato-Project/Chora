import type { TextAnnotationSnapshot } from "../../shared/text/TextDocument.js";
import { DecodeTextSelection, type TextSelection } from "../../shared/text/TextSelection.js";
import type {
	WordAttestation,
	WordCitation,
	WordDialogueForm,
	WordDialogueLemma,
	WordDictionaryEntry,
	WordEvidenceCandidate,
	WordEvidenceCoverage,
	WordEvidenceResult,
	WordLexicalSearchResult,
	WordWorkScope,
	WordEvidenceSource,
	WordEvidenceValue,
	WordLemmaEvidence,
	WordLemmaPossibility,
	WordParadigmForm,
	WordPersonResearch,
	WordPersonSource,
	WordRelatedLemma
} from "../../shared/library/WordExplorationTypes.js";
import type { PlatoSiClient } from "./PlatoSiClient.js";

export interface CanonicalEntry
{
	readonly dialogue: string;
	readonly title: string;
	readonly titleGreek: string | null;
	readonly author: string;
	readonly language: string;
	readonly textVersion: string;
}

export interface CanonicalSource
{
	readonly repository: string;
	readonly revision: string;
	readonly sourceFile: string;
	readonly textId: string | null;
	readonly license: string;
}

export interface CanonicalSegment
{
	readonly text: string;
	readonly annotations: readonly TextAnnotationSnapshot[];
}

export interface CanonicalSection
{
	readonly stephanus: string;
	readonly division: { readonly type: string; readonly label: string } | null;
	readonly segments: readonly CanonicalSegment[];
}

export interface CanonicalWork
{
	readonly source: CanonicalSource;
	readonly sections: readonly CanonicalSection[];
}

export interface PlatoSiApi
{
	GetCanonicalCatalogueAsync(): Promise<readonly CanonicalEntry[]>;
	GetCanonicalWorkAsync(dialogue: string, textVersion: string): Promise<CanonicalWork>;
	GetDialogueLexiconAsync(location: TextSelection): Promise<WordEvidenceResult>;
	SearchLexiconAsync(query: string): Promise<WordLexicalSearchResult>;
	GetLexicalEvidenceAsync(lemma: string, scope: WordWorkScope | null): Promise<WordEvidenceResult>;
	GetPersonResearchAsync(location: TextSelection, lemma: string): Promise<WordPersonResearch>;
}

// Owns PlatoSI operation names and validates every response before it enters Chora.
export class PlatoSiGateway implements PlatoSiApi
{
	public constructor(private readonly client: PlatoSiClient)
	{
	}

	public async GetCanonicalCatalogueAsync(): Promise<readonly CanonicalEntry[]>
	{
		const response = await this.client.RequestAsync("canonical.catalog", {});
		return DecodeCatalogue(response);
	}

	public async GetCanonicalWorkAsync(dialogue: string, textVersion: string): Promise<CanonicalWork>
	{
		const response = await this.client.RequestAsync("canonical.work", {
			dialogue,
			text_version: textVersion
		});
		return DecodeWork(response, dialogue, textVersion);
	}

	public async GetDialogueLexiconAsync(location: TextSelection): Promise<WordEvidenceResult>
	{
		const response = await this.client.RequestAsync("linguistics.dialogue-lexicon", { location });
		return DecodeDialogueLexicon(response, location);
	}

	// Validates bounded lexical results before they cross into renderer state.
	public async SearchLexiconAsync(query: string): Promise<WordLexicalSearchResult>
	{
		const response = await this.client.RequestAsync("word.search", { query });
		if (!IsRecord(response) || response.contract !== "platosi.word-search.v1" || response.query !== query
			|| !Array.isArray(response.items) || response.items.length > 50 || !Array.isArray(response.warnings)
			|| typeof response.possibly_truncated !== "boolean")
		{
			throw new Error("PlatoSI returned invalid word search results.");
		}
		const items: Array<{ lemma: string }> = [];
		const seen = new Set<string>();
		for (const item of response.items)
		{
			if (!IsRecord(item) || typeof item.lemma !== "string" || item.lemma.length === 0 || item.lemma.length > 200)
			{
				throw new Error("PlatoSI returned an invalid headword.");
			}
			if (!seen.has(item.lemma)) items.push({ lemma: item.lemma });
			seen.add(item.lemma);
		}
		const warnings = DecodeStrings(response.warnings, "word search warning");
		const result: WordLexicalSearchResult = { query, items, possiblyTruncated: response.possibly_truncated, warnings };
		return result;
	}

	// Dictionary-only origin shares evidence decoding with exact-occurrence lookup.
	public async GetLexicalEvidenceAsync(lemma: string, scope: WordWorkScope | null): Promise<WordEvidenceResult>
	{
		const response = await this.client.RequestAsync("word.lookup", { lemma, scope });
		const result = DecodeDialogueLexicon(response, null, scope);
		if (result.form !== lemma) throw new Error("PlatoSI returned a different lexical headword.");
		return result;
	}

	public async GetPersonResearchAsync(location: TextSelection, lemma: string): Promise<WordPersonResearch>
	{
		const response = await this.client.RequestAsync("linguistics.person-research", { location, lemma });
		return DecodePersonResearch(response, location, lemma);
	}

}

/** Validates consolidated name research and the stable identities used by reader notes. */
function DecodePersonResearch(
	value: unknown,
	requested: TextSelection,
	lemma: string): WordPersonResearch
{
	if (!IsRecord(value) || value.contract !== "platosi.person-research.v3"
		|| typeof value.status !== "string" || value.lemma !== lemma
		|| !IsRecord(value.target) || !IsRecord(value.classification)
		|| typeof value.classification.proper_name_candidate !== "boolean"
		|| typeof value.classification.basis !== "string"
		|| typeof value.overview !== "string" || !Array.isArray(value.sources)
		|| !Array.isArray(value.candidates) || !Array.isArray(value.warnings)
		|| (value.model !== null && !IsRecord(value.model)))
	{
		throw new Error("PlatoSI returned invalid name research.");
	}
	const selection = DecodeTextSelection(value.target.location);
	const actualLocation = JSON.stringify(selection);
	const expectedLocation = JSON.stringify(requested);
	if (actualLocation !== expectedLocation)
	{
		throw new Error("PlatoSI returned name research for a different selection.");
	}
	/** Validates source text and the external link exposed to the reader. */
	function DecodePersonSource(source: unknown): WordPersonSource
	{
		const relevance = IsRecord(source) ? source.relevance : undefined;
		if (!IsRecord(source) || typeof source.id !== "string" || typeof source.kind !== "string"
			|| typeof source.title !== "string" || typeof source.url !== "string"
			|| typeof source.excerpt !== "string" || typeof source.provider !== "string"
			|| typeof source.cached !== "boolean"
			|| (relevance !== "plato_dialogue" && relevance !== "other"))
		{
			throw new Error("PlatoSI returned an invalid name source.");
		}
		const url = new URL(source.url);
		if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0)
		{
			throw new Error("PlatoSI returned an unsafe name source URL.");
		}
		const normalizedUrl = url.toString();
		const result: WordPersonSource = {
			id: source.id,
			kind: source.kind,
			title: source.title,
			url: normalizedUrl,
			excerpt: source.excerpt,
			provider: source.provider,
			cached: source.cached,
			relevance
		};
		return result;
	}
	/** Decodes note targets without treating them as separate research answers. */
	function DecodeCandidate(candidate: unknown): WordPersonResearch["candidates"][number]
	{
		if (!IsRecord(candidate) || typeof candidate.id !== "string"
			|| typeof candidate.label !== "string" || !Array.isArray(candidate.sources))
		{
			throw new Error("PlatoSI returned an invalid research identity.");
		}
		const sources = candidate.sources.map(DecodePersonSource);
		const result = { id: candidate.id, label: candidate.label, sources };
		return result;
	}
	const candidates = value.candidates.map(DecodeCandidate);
	const sources = value.sources.map(DecodePersonSource);
	const warnings = DecodeStrings(value.warnings, "name research warning");
	const model = value.model === null ? null : DecodeJsonObject(value.model);
	const result: WordPersonResearch = {
		contract: "platosi.person-research.v3",
		status: value.status,
		lemma,
		classification: {
			properNameCandidate: value.classification.proper_name_candidate,
			basis: value.classification.basis
		},
		overview: value.overview,
		sources,
		candidates,
		model,
		warnings
	};
	return result;
}
function DecodeCatalogue(value: unknown): readonly CanonicalEntry[]
{
	if (!IsRecord(value) || value.contract !== "platosi.location.v1" || !Array.isArray(value.works))
	{
		throw new Error("PlatoSI returned an invalid canonical catalogue.");
	}
	const entries: CanonicalEntry[] = [];
	const identifiers = new Set<string>();
	for (const item of value.works)
	{
		if (!IsRecord(item) || typeof item.dialogue !== "string" || typeof item.title !== "string"
			|| (item.title_greek !== null && typeof item.title_greek !== "string")
			|| typeof item.author !== "string" || typeof item.language !== "string"
			|| typeof item.text_version !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(item.text_version)
			|| identifiers.has(item.dialogue))
		{
			throw new Error("PlatoSI returned an invalid canonical dialogue.");
		}
		identifiers.add(item.dialogue);
		entries.push({
			dialogue: item.dialogue,
			title: item.title,
			titleGreek: item.title_greek,
			author: item.author,
			language: item.language,
			textVersion: item.text_version
		});
	}
	return entries;
}

function DecodeWork(value: unknown, dialogue: string, textVersion: string): CanonicalWork
{
	if (!IsRecord(value) || value.contract !== "platosi.location.v1" || value.dialogue !== dialogue
		|| value.text_version !== textVersion || !Array.isArray(value.sections) || !IsRecord(value.source))
	{
		throw new Error("PlatoSI returned a mismatched canonical work.");
	}
	const source = DecodeSource(value.source);
	const sections: CanonicalSection[] = [];
	const references = new Set<string>();
	for (const item of value.sections)
	{
		if (!IsRecord(item) || typeof item.stephanus !== "string" || item.stephanus.length === 0
			|| references.has(item.stephanus) || !Array.isArray(item.segments) || item.segments.length === 0)
		{
			throw new Error("PlatoSI returned an invalid canonical section.");
		}
		references.add(item.stephanus);
		sections.push({
			stephanus: item.stephanus,
			division: DecodeDivision(item.division),
			segments: item.segments.map(DecodeSegment)
		});
	}
	if (sections.length === 0)
	{
		throw new Error("PlatoSI returned an empty canonical work.");
	}
	return { source, sections };
}

function DecodeSource(value: Record<string, unknown>): CanonicalSource
{
	if (typeof value.repository !== "string" || typeof value.revision !== "string"
		|| typeof value.source_file !== "string" || (value.text_id !== null && typeof value.text_id !== "string")
		|| typeof value.license !== "string")
	{
		throw new Error("PlatoSI returned invalid source metadata.");
	}
	return {
		repository: value.repository,
		revision: value.revision,
		sourceFile: value.source_file,
		textId: value.text_id,
		license: value.license
	};
}

function DecodeDivision(value: unknown): CanonicalSection["division"]
{
	if (value === null)
	{
		return null;
	}
	if (!IsRecord(value) || typeof value.type !== "string" || typeof value.label !== "string")
	{
		throw new Error("PlatoSI returned an invalid canonical division.");
	}
	return { type: value.type, label: value.label };
}

function DecodeSegment(value: unknown): CanonicalSegment
{
	if (!IsRecord(value) || typeof value.text !== "string" || value.text.length === 0 || !Array.isArray(value.annotations))
	{
		throw new Error("PlatoSI returned an invalid canonical segment.");
	}
	const annotations: TextAnnotationSnapshot[] = [];
	for (const item of value.annotations)
	{
		if (!IsRecord(item) || (item.kind !== "quotation" && item.kind !== "citation")
			|| !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)
			|| typeof item.start !== "number" || typeof item.end !== "number"
			|| item.start < 0 || item.start >= item.end || item.end > value.text.length)
		{
			throw new Error("PlatoSI returned an invalid canonical annotation.");
		}
		annotations.push({ kind: item.kind, start: item.start, end: item.end });
	}
	return { text: value.text, annotations };
}

function DecodeDialogueLexicon(value: unknown, requested: TextSelection | null, scope: WordWorkScope | null = null): WordEvidenceResult
{
	const contract = requested === null ? "platosi.lexical-evidence.v1" : "platosi.dialogue-lexicon.v1";
	if (!IsRecord(value) || value.contract !== contract
		|| !IsRecord(value.target) || !Array.isArray(value.lemmas)
		|| !IsRecord(value.dictionary) || !IsRecord(value.morphology)
		|| !Array.isArray(value.warnings) || typeof value.limitations !== "string")
	{
		throw new Error("PlatoSI returned an invalid dialogue lexicon.");
	}
	const selection = value.target.location === null ? null : DecodeTextSelection(value.target.location);
	if (JSON.stringify(selection) !== JSON.stringify(requested)
		|| typeof value.target.text !== "string" || !Array.isArray(value.target.context))
	{
		throw new Error("PlatoSI returned linguistic evidence for a different selection.");
	}
	if (requested === null && (JSON.stringify(value.scope) !== JSON.stringify(scope)
		|| !["indexed", "unavailable"].includes(String(value.occurrences_status))))
	{
		throw new Error("PlatoSI returned lexical evidence for a different work.");
	}
	const work = selection === null ? scope : { dialogue: selection.dialogue, text_version: selection.text_version };
	const context = value.target.context.map(function DecodeContext(item): { stephanus: string; text: string }
	{
		if (!IsRecord(item) || typeof item.stephanus !== "string" || typeof item.text !== "string")
		{
			throw new Error("PlatoSI returned invalid linguistic context.");
		}
		return { stephanus: item.stephanus, text: item.text };
	});
	if (!Array.isArray(value.dictionary.entries) || !Array.isArray(value.dictionary.warnings)
		|| typeof value.dictionary.status !== "string"
		|| typeof value.dictionary.possibly_truncated !== "boolean")
	{
		throw new Error("PlatoSI returned invalid dictionary evidence.");
	}
	const coverage = DecodeCoverage(value.coverage);
	const result: WordEvidenceResult = {
		contract,
		selection,
		work,
		occurrencesStatus: requested === null && value.occurrences_status === "unavailable" ? "unavailable" : "indexed",
		form: value.target.text,
		context,
		possibilities: value.lemmas.map(DecodePossibility),
		lemmas: value.lemmas.map((lemma) => DecodeDialogueLemma(lemma, work)),
		coverage,
		dictionary: {
			status: value.dictionary.status,
			entries: value.dictionary.entries.map(DecodeDictionaryEntry),
			possiblyTruncated: value.dictionary.possibly_truncated
		},
		morphology: DecodeMorphology(value.morphology),
		warnings: DecodeStrings(value.warnings, "dialogue lexicon warning"),
		limitations: value.limitations
	};
	return result;
}

/** Validates optional provider coverage without treating missing coverage as verification. */
function DecodeCoverage(value: unknown): WordEvidenceCoverage | null
{
	let result: WordEvidenceCoverage | null = null;
	if (value !== undefined && value !== null)
	{
		if (!IsRecord(value) || !Array.isArray(value.analysis_providers)
			|| !Array.isArray(value.form_inventory_providers) || !Array.isArray(value.analysis_only_providers))
		{
			throw new Error("PlatoSI returned invalid analysis coverage.");
		}
		const analysisProviders = DecodeStrings(value.analysis_providers, "analysis provider");
		const formInventoryProviders = DecodeStrings(value.form_inventory_providers, "form inventory provider");
		const analysisOnlyProviders = DecodeStrings(value.analysis_only_providers, "analysis-only provider");
		const morphologyProviders = value.morphology_index_providers ?? [];
		if (!Array.isArray(morphologyProviders))
		{
			throw new Error("PlatoSI returned invalid morphology index providers.");
		}
		const morphologyIndexProviders = DecodeStrings(morphologyProviders, "morphology index provider");
		const morphologyIndexes = DecodeMorphologyIndexes(value.morphology_indexes ?? []);
		for (const coverage of morphologyIndexes)
		{
			if (!morphologyIndexProviders.includes(coverage.provider))
			{
				throw new Error("PlatoSI returned inconsistent morphology index coverage.");
			}
		}
		const cachedProviders = value.cached_analysis_providers ?? [];
		if (!Array.isArray(cachedProviders))
		{
			throw new Error("PlatoSI returned invalid cached analysis providers.");
		}
		const cachedAnalysisProviders = DecodeStrings(cachedProviders, "cached analysis provider");
		const cachedFormCoverage = DecodeCachedFormCoverage(value.cached_form_coverage ?? []);
		for (const coverage of cachedFormCoverage)
		{
			if (!cachedAnalysisProviders.includes(coverage.provider))
			{
				throw new Error("PlatoSI returned inconsistent cached morphology coverage.");
			}
		}
		for (const provider of analysisOnlyProviders)
		{
			if (!analysisProviders.includes(provider) || formInventoryProviders.includes(provider)
				|| morphologyIndexProviders.includes(provider) || cachedAnalysisProviders.includes(provider))
			{
				throw new Error("PlatoSI returned inconsistent analysis coverage.");
			}
		}
		result = { analysisProviders, formInventoryProviders, analysisOnlyProviders,
			morphologyIndexProviders, morphologyIndexes, cachedAnalysisProviders, cachedFormCoverage };
	}
	return result;
}

/** Decodes finite canonical form and token totals. */
function DecodeCoverageCount(value: unknown): number
{
	let result = 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
	{
		throw new Error("PlatoSI returned invalid morphology totals.");
	}
	else
	{
		result = value;
	}
	return result;
}

/** Validates permanent dialogue morphology coverage. */
function DecodeMorphologyIndexes(value: unknown): NonNullable<WordEvidenceCoverage["morphologyIndexes"]>
{
	const result: NonNullable<WordEvidenceCoverage["morphologyIndexes"]>[number][] = [];
	if (!Array.isArray(value))
	{
		throw new Error("PlatoSI returned invalid morphology index coverage.");
	}
	for (const item of value)
	{
		if (!IsRecord(item) || typeof item.provider !== "string" || item.provider.length === 0
			|| typeof item.state !== "string" || typeof item.whole_dialogue_complete !== "boolean"
			|| typeof item.context_reviewed !== "boolean")
		{
			throw new Error("PlatoSI returned invalid morphology index coverage.");
		}
		const checkedForms = DecodeCoverageCount(item.checked_forms);
		const totalForms = DecodeCoverageCount(item.total_forms);
		const analyzedForms = DecodeCoverageCount(item.analyzed_forms);
		const unresolvedForms = DecodeCoverageCount(item.unresolved_forms);
		const failedForms = DecodeCoverageCount(item.failed_forms);
		const pendingForms = DecodeCoverageCount(item.pending_forms);
		if (checkedForms !== analyzedForms + unresolvedForms
			|| checkedForms + failedForms + pendingForms !== totalForms
			|| item.whole_dialogue_complete !== (item.state === "ready" && checkedForms === totalForms))
		{
			throw new Error("PlatoSI returned inconsistent morphology index totals.");
		}
		result.push({ provider: item.provider, state: item.state, checkedForms, totalForms,
			analyzedForms, unresolvedForms, failedForms, pendingForms,
			wholeDialogueComplete: item.whole_dialogue_complete, contextReviewed: item.context_reviewed });
	}
	return result;
}

/** Validates cache coverage without treating missing forms as absent lemmas. */
function DecodeCachedFormCoverage(value: unknown): NonNullable<WordEvidenceCoverage["cachedFormCoverage"]>
{
	const result: NonNullable<WordEvidenceCoverage["cachedFormCoverage"]>[number][] = [];
	if (!Array.isArray(value))
	{
		throw new Error("PlatoSI returned invalid cached morphology coverage.");
	}
	for (const item of value)
	{
		if (!IsRecord(item) || typeof item.provider !== "string" || item.provider.length === 0
			|| typeof item.whole_dialogue_complete !== "boolean" || typeof item.context_reviewed !== "boolean")
		{
			throw new Error("PlatoSI returned invalid cached morphology coverage.");
		}
		const checkedForms = DecodeCoverageCount(item.checked_forms);
		const totalForms = DecodeCoverageCount(item.total_forms);
		const checkedTokens = DecodeCoverageCount(item.checked_tokens);
		const totalTokens = DecodeCoverageCount(item.total_tokens);
		if (checkedForms > totalForms || checkedTokens > totalTokens
			|| item.whole_dialogue_complete !== (checkedForms === totalForms))
		{
			throw new Error("PlatoSI returned inconsistent cached morphology totals.");
		}
		result.push({ provider: item.provider, checkedForms, totalForms, checkedTokens, totalTokens,
			wholeDialogueComplete: item.whole_dialogue_complete, contextReviewed: item.context_reviewed });
	}
	return result;
}

/** Validates the provider's named grammatical features before renderer transport. */
function DecodeFeatures(value: unknown): Readonly<Record<string, string>> | null
{
	let result: Record<string, string> | null = null;
	if (value !== undefined && value !== null)
	{
		if (!IsRecord(value))
		{
			throw new Error("PlatoSI returned invalid grammatical features.");
		}
		result = {};
		for (const [name, feature] of Object.entries(value))
		{
			if (typeof feature !== "string")
			{
				throw new Error("PlatoSI returned an invalid grammatical feature.");
			}
			result[name] = feature;
		}
	}
	return result;
}

function DecodeDialogueLemma(value: unknown, requested: WordWorkScope | null): WordDialogueLemma
{
	if (!IsRecord(value) || typeof value.lemma !== "string" || !Array.isArray(value.candidates)
		|| !Array.isArray(value.forms) || !Array.isArray(value.related_lemmas))
	{
		throw new Error("PlatoSI returned an invalid dialogue lemma.");
	}
	return {
		lemma: value.lemma,
		candidates: value.candidates.map(DecodeCandidate),
		forms: value.forms.map((form) => DecodeDialogueForm(form, requested)),
		relatedLemmas: value.related_lemmas.map((lemma) => DecodeRelatedLemma(lemma, requested))
	};
}

function DecodeDialogueForm(value: unknown, requested: WordWorkScope | null): WordDialogueForm
{
	if (!IsRecord(value) || typeof value.form !== "string"
		|| !Number.isSafeInteger(value.count) || typeof value.count !== "number" || value.count < 0
		|| !Array.isArray(value.evidence) || !Array.isArray(value.occurrences))
	{
		throw new Error("PlatoSI returned an invalid dialogue form.");
	}
	const occurrences = value.occurrences.map(function DecodeOccurrence(item): WordDialogueForm["occurrences"][number]
	{
		if (!IsRecord(item) || typeof item.passage !== "string")
		{
			throw new Error("PlatoSI returned an invalid dialogue occurrence.");
		}
		const selection = DecodeTextSelection(item.location);
		if (requested === null || selection.dialogue !== requested.dialogue || selection.text_version !== requested.text_version)
		{
			throw new Error("PlatoSI returned a dialogue occurrence for a different work.");
		}
		return {
			selection,
			citation: selection.start.stephanus,
			division: item.division === null ? null : DecodeDivision(item.division),
			passage: item.passage
		};
	});
	if (occurrences.length !== value.count)
	{
		throw new Error("PlatoSI returned a dialogue form with a mismatched count.");
	}
	return {
		form: value.form,
		total: value.count,
		occurrences,
		evidence: value.evidence.map(DecodeEvidenceRecord)
	};
}

function DecodeRelatedLemma(value: unknown, requested: WordWorkScope | null): WordRelatedLemma
{
	if (!IsRecord(value) || typeof value.lemma !== "string"
		|| typeof value.relation_type !== "string" || typeof value.direction !== "string"
		|| typeof value.present_in_dialogue !== "boolean"
		|| !Number.isSafeInteger(value.count) || typeof value.count !== "number" || value.count < 0
		|| !Array.isArray(value.forms) || !Array.isArray(value.evidence))
	{
		throw new Error("PlatoSI returned an invalid related lemma.");
	}
	const forms = value.forms.map((form) => DecodeDialogueForm(form, requested));
	if (forms.reduce((total, form) => total + form.total, 0) !== value.count
		|| value.present_in_dialogue !== (value.count > 0))
	{
		throw new Error("PlatoSI returned inconsistent related-lemma dialogue counts.");
	}
	let dictionary: WordRelatedLemma["dictionary"] = null;
	if (value.dictionary !== undefined && value.dictionary !== null)
	{
		if (!IsRecord(value.dictionary) || typeof value.dictionary.status !== "string"
			|| !Array.isArray(value.dictionary.entries) || typeof value.dictionary.possibly_truncated !== "boolean")
		{
			throw new Error("PlatoSI returned invalid related-lemma dictionary evidence.");
		}
		const entries = value.dictionary.entries.map(DecodeDictionaryEntry);
		dictionary = { status: value.dictionary.status, entries, possiblyTruncated: value.dictionary.possibly_truncated };
	}
	return {
		lemma: value.lemma,
		relationType: value.relation_type,
		direction: value.direction,
		presentInDialogue: value.present_in_dialogue,
		dictionary,
		total: value.count,
		forms,
		evidence: value.evidence.map(DecodeEvidenceRecord)
	};
}

function DecodeEvidenceRecord(value: unknown): Readonly<Record<string, WordEvidenceValue>>
{
	if (!IsRecord(value))
	{
		throw new Error("PlatoSI returned invalid provider evidence.");
	}
	return DecodeJsonObject(value);
}

function DecodePossibility(value: unknown): WordLemmaPossibility
{
	if (!IsRecord(value) || typeof value.lemma !== "string" || !Array.isArray(value.candidates))
	{
		throw new Error("PlatoSI returned an invalid lemma possibility.");
	}
	return { lemma: value.lemma, candidates: value.candidates.map(DecodeCandidate) };
}

function DecodeCandidate(value: unknown): WordEvidenceCandidate
{
	if (!IsRecord(value) || typeof value.provider !== "string" || typeof value.provider_version !== "string"
		|| !IsNullableString(value.method) || !IsNullableString(value.classification)
		|| !IsNullableString(value.language) || !IsNullableBoolean(value.proper)
		|| !IsNullableNumber(value.rank) || !IsNullableString(value.via)
		|| !IsNullableString(value.citation) || !IsNullableString(value.tag)
		|| !IsRecord(value.settings))
	{
		throw new Error("PlatoSI returned an invalid linguistic candidate.");
	}
	const headword = value.headword ?? null;
	const homograph = value.homograph ?? null;
	if (!IsNullableString(headword) || !IsNullableString(homograph))
	{
		throw new Error("PlatoSI returned an invalid headword identity.");
	}
	const features = DecodeFeatures(value.features);
	return {
		provider: value.provider,
		providerVersion: value.provider_version,
		method: value.method,
		classification: value.classification,
		language: value.language,
		proper: value.proper,
		rank: value.rank,
		via: value.via,
		citation: value.citation,
		tag: value.tag,
		headword,
		homograph,
		features,
		settings: DecodeJsonObject(value.settings),
		source: DecodeSourceMetadata(value.source)
	};
}

function DecodeDictionaryEntry(value: unknown): WordDictionaryEntry
{
	if (!IsRecord(value) || typeof value.provider !== "string" || typeof value.provider_version !== "string"
		|| typeof value.headword !== "string" || typeof value.matched_term !== "string"
		|| !IsNullableString(value.entry_id)
		|| typeof value.plain_text !== "string" || typeof value.entry_xml !== "string"
		|| !IsRecord(value.license))
	{
		throw new Error("PlatoSI returned an invalid dictionary entry.");
	}
	return {
		provider: value.provider,
		providerVersion: value.provider_version,
		headword: value.headword,
		matchedTerm: value.matched_term,
		entryId: value.entry_id,
		plainText: value.plain_text,
		entryXml: value.entry_xml,
		source: DecodeSourceMetadata(value.source),
		license: DecodeJsonObject(value.license)
	};
}

function DecodeMorphology(value: Record<string, unknown>): WordEvidenceResult["morphology"]
{
	if (typeof value.status !== "string")
	{
		throw new Error("PlatoSI returned invalid morphology evidence.");
	}
	const lemmas = value.lemmas === undefined ? [] : value.lemmas;
	if (!Array.isArray(lemmas))
	{
		throw new Error("PlatoSI returned invalid morphology lemma evidence.");
	}
	return {
		status: value.status,
		provider: value.provider === null || value.provider === undefined
			? null
			: DecodeProviderSource(value.provider),
		normalization: value.normalization === undefined ? null : DecodeJsonObjectValue(value.normalization),
		spellingSuggestions: value.spelling_suggestions === undefined ? null : DecodeJsonValue(value.spelling_suggestions),
		formAttestation: value.form_attestation === undefined || value.form_attestation === null
			? null
			: DecodeAttestation(value.form_attestation),
		lemmas: lemmas.map(DecodeLemmaEvidence),
		artifacts: value.artifacts === undefined ? null : DecodeJsonObjectValue(value.artifacts)
	};
}

function DecodeProviderSource(value: unknown): WordEvidenceSource
{
	if (!IsRecord(value))
	{
		throw new Error("PlatoSI returned invalid provider provenance.");
	}
	return DecodeSourceMetadata(value.source);
}

function DecodeSourceMetadata(value: unknown): WordEvidenceSource
{
	if (!IsRecord(value))
	{
		return { attribution: null, revision: null, repository: null };
	}
	return {
		attribution: typeof value.attribution === "string" ? value.attribution : null,
		revision: typeof value.revision === "string" ? value.revision : null,
		repository: typeof value.repository === "string" ? value.repository : null
	};
}

function DecodeLemmaEvidence(value: unknown): WordLemmaEvidence
{
	if (!IsRecord(value) || typeof value.lemma !== "string"
		|| (value.paradigm !== null && !IsRecord(value.paradigm)))
	{
		throw new Error("PlatoSI returned invalid lemma detail.");
	}
	let paradigm: WordLemmaEvidence["paradigm"] = null;
	if (IsRecord(value.paradigm))
	{
		if (typeof value.paradigm.part_of_speech !== "string" || !Array.isArray(value.paradigm.forms))
		{
			throw new Error("PlatoSI returned an invalid paradigm.");
		}
		paradigm = {
			partOfSpeech: value.paradigm.part_of_speech,
			forms: value.paradigm.forms.map(DecodeParadigmForm)
		};
	}
	return {
		lemma: value.lemma,
		attestation: value.attestation === null ? null : DecodeAttestation(value.attestation),
		paradigm
	};
}

function DecodeParadigmForm(value: unknown): WordParadigmForm
{
	if (!IsRecord(value) || typeof value.slot !== "string"
		|| typeof value.form !== "string" || typeof value.source !== "string")
	{
		throw new Error("PlatoSI returned an invalid paradigm form.");
	}
	return { slot: value.slot, form: value.form, source: value.source };
}

function DecodeAttestation(value: unknown): WordAttestation
{
	if (!IsRecord(value))
	{
		throw new Error("PlatoSI returned invalid attestation evidence.");
	}
	const citationsValue = value.citations === undefined ? [] : value.citations;
	if (!Array.isArray(citationsValue))
	{
		throw new Error("PlatoSI returned invalid attestation citations.");
	}
	return {
		form: typeof value.form === "string" ? value.form : null,
		attested: typeof value.attested === "boolean" ? value.attested : null,
		total: NumberValue(value.total_count ?? value.total),
		works: NumberValue(value.n_works),
		sourceCounts: DecodeNumberMap(value.source_counts),
		byGenre: DecodeNumberMap(value.by_genre),
		byCentury: DecodeNumberMap(value.by_century),
		byDialect: DecodeNumberMap(value.by_dialect),
		dominantPartOfSpeech: typeof value.dominant_pos === "string" ? value.dominant_pos : null,
		citations: citationsValue.map(DecodeCitation)
	};
}

function DecodeCitation(value: unknown): WordCitation
{
	if (!IsRecord(value) || typeof value.work_id !== "string" || typeof value.source !== "string")
	{
		throw new Error("PlatoSI returned an invalid attestation citation.");
	}
	return {
		workId: value.work_id,
		author: StringValue(value.author),
		title: StringValue(value.title),
		source: value.source,
		century: NumberValue(value.century),
		locus: StringValue(value.locus),
		locusScheme: StringValue(value.locus_scheme),
		count: NumberValue(value.count) ?? 0
	};
}

function DecodeNumberMap(value: unknown): Readonly<Record<string, number>>
{
	if (value === undefined || value === null)
	{
		return {};
	}
	if (!IsRecord(value) || Object.values(value).some((item) => typeof item !== "number" || !Number.isFinite(item)))
	{
		throw new Error("PlatoSI returned an invalid evidence distribution.");
	}
	return value as Record<string, number>;
}

function DecodeJsonObjectValue(value: unknown): Readonly<Record<string, WordEvidenceValue>>
{
	if (!IsRecord(value))
	{
		throw new Error("PlatoSI returned invalid structured evidence.");
	}
	return DecodeJsonObject(value);
}

function DecodeJsonObject(value: Record<string, unknown>): Readonly<Record<string, WordEvidenceValue>>
{
	const result: Record<string, WordEvidenceValue> = {};
	for (const [key, item] of Object.entries(value))
	{
		result[key] = DecodeJsonValue(item);
	}
	return result;
}

function DecodeJsonValue(value: unknown): WordEvidenceValue
{
	if (value === null || typeof value === "string" || typeof value === "boolean")
	{
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value))
	{
		return value;
	}
	if (Array.isArray(value))
	{
		return value.map(DecodeJsonValue);
	}
	if (IsRecord(value))
	{
		return DecodeJsonObject(value);
	}
	throw new Error("PlatoSI returned non-JSON evidence.");
}

function DecodeStrings(values: readonly unknown[], label: string): string[]
{
	if (values.some((value) => typeof value !== "string"))
	{
		throw new Error(`PlatoSI returned an invalid ${label}.`);
	}
	return values as string[];
}

function IsNullableString(value: unknown): value is string | null
{
	return value === null || typeof value === "string";
}

function IsNullableBoolean(value: unknown): value is boolean | null
{
	return value === null || typeof value === "boolean";
}

function IsNullableNumber(value: unknown): value is number | null
{
	return value === null || (typeof value === "number" && Number.isFinite(value));
}

function StringValue(value: unknown): string | null
{
	return typeof value === "string" ? value : null;
}

function NumberValue(value: unknown): number | null
{
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function IsRecord(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
