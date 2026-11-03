import type { TextAnnotationSnapshot } from "../../shared/text/TextDocument.js";
import { DecodeTextSelection, type TextSelection } from "../../shared/text/TextSelection.js";
import type {
	WordAttestation,
	WordCitation,
	WordDialogueForm,
	WordDialogueLemma,
	WordDictionaryEntry,
	WordEvidenceCandidate,
	WordEvidenceResult,
	WordEvidenceSource,
	WordEvidenceValue,
	WordLemmaEvidence,
	WordLemmaPossibility,
	WordParadigmForm,
	WordPersonResearch,
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

	public async GetPersonResearchAsync(location: TextSelection, lemma: string): Promise<WordPersonResearch>
	{
		const response = await this.client.RequestAsync("linguistics.person-research", { location, lemma });
		return DecodePersonResearch(response, location, lemma);
	}

}

function DecodePersonResearch(
	value: unknown,
	requested: TextSelection,
	lemma: string): WordPersonResearch
{
	if (!IsRecord(value) || value.contract !== "platosi.person-research.v1"
		|| typeof value.status !== "string" || value.lemma !== lemma
		|| !IsRecord(value.target) || !IsRecord(value.classification)
		|| typeof value.classification.proper_name_candidate !== "boolean"
		|| typeof value.classification.basis !== "string"
		|| !Array.isArray(value.roots) || !Array.isArray(value.sources)
		|| !Array.isArray(value.warnings)
		|| (value.model !== null && !IsRecord(value.model)))
	{
		throw new Error("PlatoSI returned invalid person research.");
	}
	const selection = DecodeTextSelection(value.target.location);
	if (JSON.stringify(selection) !== JSON.stringify(requested))
	{
		throw new Error("PlatoSI returned person research for a different selection.");
	}
	let summary: WordPersonResearch["summary"] = null;
	if (value.summary !== null)
	{
		if (!IsRecord(value.summary) || typeof value.summary.person !== "string"
			|| typeof value.summary.name_meaning !== "string"
			|| !Array.isArray(value.summary.relationships))
		{
			throw new Error("PlatoSI returned an invalid person summary.");
		}
		summary = {
			person: value.summary.person,
			nameMeaning: value.summary.name_meaning,
			relationships: DecodeStrings(value.summary.relationships, "person relationship")
		};
	}
	const sources = value.sources.map(function DecodePersonSource(source)
	{
		if (!IsRecord(source) || typeof source.id !== "string" || typeof source.kind !== "string"
			|| typeof source.title !== "string" || typeof source.url !== "string"
			|| typeof source.excerpt !== "string" || typeof source.provider !== "string"
			|| typeof source.cached !== "boolean")
		{
			throw new Error("PlatoSI returned an invalid person source.");
		}
		const url = new URL(source.url);
		if (url.protocol !== "https:")
		{
			throw new Error("PlatoSI returned an unsafe person source URL.");
		}
		return {
			id: source.id,
			kind: source.kind,
			title: source.title,
			url: url.toString(),
			excerpt: source.excerpt,
			provider: source.provider,
			cached: source.cached
		};
	});
	return {
		contract: "platosi.person-research.v1",
		status: value.status,
		lemma,
		classification: {
			properNameCandidate: value.classification.proper_name_candidate,
			basis: value.classification.basis
		},
		roots: DecodeStrings(value.roots, "person lexical root"),
		summary,
		sources,
		model: value.model === null ? null : DecodeJsonObject(value.model),
		warnings: DecodeStrings(value.warnings, "person research warning")
	};
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

function DecodeDialogueLexicon(value: unknown, requested: TextSelection): WordEvidenceResult
{
	if (!IsRecord(value) || value.contract !== "platosi.dialogue-lexicon.v1"
		|| !IsRecord(value.target) || !Array.isArray(value.lemmas)
		|| !IsRecord(value.dictionary) || !IsRecord(value.dilemma)
		|| !Array.isArray(value.warnings) || typeof value.limitations !== "string")
	{
		throw new Error("PlatoSI returned an invalid dialogue lexicon.");
	}
	const selection = DecodeTextSelection(value.target.location);
	if (JSON.stringify(selection) !== JSON.stringify(requested)
		|| typeof value.target.text !== "string" || !Array.isArray(value.target.context))
	{
		throw new Error("PlatoSI returned linguistic evidence for a different selection.");
	}
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
	const result: WordEvidenceResult = {
		contract: "platosi.dialogue-lexicon.v1",
		selection,
		form: value.target.text,
		context,
		possibilities: value.lemmas.map(DecodePossibility),
		lemmas: value.lemmas.map((lemma) => DecodeDialogueLemma(lemma, requested)),
		dictionary: {
			status: value.dictionary.status,
			entries: value.dictionary.entries.map(DecodeDictionaryEntry),
			possiblyTruncated: value.dictionary.possibly_truncated
		},
		morphology: DecodeMorphology(value.dilemma),
		warnings: DecodeStrings(value.warnings, "dialogue lexicon warning"),
		limitations: value.limitations
	};
	return result;
}

function DecodeDialogueLemma(value: unknown, requested: TextSelection): WordDialogueLemma
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

function DecodeDialogueForm(value: unknown, requested: TextSelection): WordDialogueForm
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
		if (selection.dialogue !== requested.dialogue || selection.text_version !== requested.text_version)
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

function DecodeRelatedLemma(value: unknown, requested: TextSelection): WordRelatedLemma
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
	return {
		lemma: value.lemma,
		relationType: value.relation_type,
		direction: value.direction,
		presentInDialogue: value.present_in_dialogue,
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
