import type { TextDocument } from "../../shared/text/TextDocument.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";
import type {
	WordEvidenceResult,
	WordNameNote,
	WordNameNoteKey,
	WordObservation,
	WordObservationKey,
	WordOccurrence,
	WordPersonResearch,
	WordSearchResult
} from "../../shared/library/WordExplorationTypes.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { PlatoSiApi } from "../platosi/PlatoSiGateway.js";
import { LibraryService } from "./LibraryService.js";
import { WordObservationRepository } from "./WordObservationRepository.js";
import { WordNameNoteRepository } from "./WordNameNoteRepository.js";

export class WordExplorationService
{
	private static readonly ResultLimit = 200;

	public constructor(
		private readonly library: LibraryService,
		private readonly platosi: PlatoSiApi,
		private readonly observations: WordObservationRepository,
		private readonly nameNotes: WordNameNoteRepository)
	{
	}

	public async GetNameNoteAsync(value: unknown): Promise<WordNameNote>
	{
		const key = this.DecodeNameNoteKey(value);
		return this.nameNotes.GetAsync(key);
	}

	public async SaveNameNoteAsync(value: unknown): Promise<WordNameNote>
	{
		const key = this.DecodeNameNoteKey(value);
		const record = value as Record<string, unknown>;
		const text = record.text;
		if (typeof text !== "string" || text.length > 50000)
		{
			throw ApplicationError.Expected(
				"validation",
				"INVALID_WORD_NAME_NOTE",
				"Name notes must contain at most 50,000 characters.");
		}
		return this.nameNotes.SaveAsync({ ...key, text });
	}

	public async GetObservationAsync(value: unknown): Promise<WordObservation>
	{
		const key = this.DecodeObservationKey(value);
		return this.observations.GetAsync(key);
	}

	public async SaveObservationAsync(value: unknown): Promise<WordObservation>
	{
		const key = this.DecodeObservationKey(value);
		const record = value as Record<string, unknown>;
		const text = record.text;
		if (typeof text !== "string" || text.length > 50000)
		{
			throw ApplicationError.Expected(
				"validation",
				"INVALID_WORD_OBSERVATION",
				"Word observations must contain at most 50,000 characters.");
		}
		return this.observations.SaveAsync({ ...key, text });
	}

	public async SearchAsync(workId: unknown, value: unknown): Promise<WordSearchResult>
	{
		if (typeof workId !== "string" || typeof value !== "string")
		{
			throw ApplicationError.Expected("validation", "INVALID_WORD_SEARCH", "Select one Greek word to search.");
		}
		const form = this.NormalizeForm(value);
		const document = await this.library.GetAsync(workId);
		const result = this.FindOccurrences(document, form);
		return result;
	}

	public async GetEvidenceAsync(value: unknown): Promise<WordEvidenceResult>
	{
		if (value === null || typeof value !== "object")
		{
			throw ApplicationError.Expected("validation", "INVALID_WORD_REQUEST", "Select one Greek word to continue.");
		}
		const selection = DecodeTextSelection(value);
		const document = await this.library.GetAsync(selection.dialogue);
		document.ValidateSelection(selection);
		const selected = document.ReconstructText(selection);
		const form = this.NormalizeForm(selected);
		const evidence = await this.platosi.GetDialogueLexiconAsync(selection);
		if (evidence.form !== form)
		{
			throw new Error("PlatoSI returned evidence for a different word.");
		}
		return evidence;
	}

	public async GetPersonResearchAsync(value: unknown, lemma: unknown): Promise<WordPersonResearch>
	{
		if (value === null || typeof value !== "object"
			|| typeof lemma !== "string" || lemma.length === 0 || lemma.length > 200)
		{
			throw ApplicationError.Expected(
				"validation", "INVALID_PERSON_RESEARCH", "Select a proper-name lemma to research.");
		}
		const selection = DecodeTextSelection(value);
		const document = await this.library.GetAsync(selection.dialogue);
		document.ValidateSelection(selection);
		return this.platosi.GetPersonResearchAsync(selection, lemma.normalize("NFC"));
	}

	private NormalizeForm(value: string): string
	{
		const trimmed = value.trim();
		const form = trimmed.normalize("NFC");
		const valid = /^(?:(?=\p{Script=Greek})\p{L}|\p{M})+$/u.test(form);
		if (!valid || form.length > 100)
		{
			throw ApplicationError.Expected("validation", "INVALID_GREEK_FORM", "Select a single Greek word without punctuation.");
		}
		return form;
	}

	private DecodeObservationKey(value: unknown): WordObservationKey
	{
		if (value === null || typeof value !== "object")
		{
			throw ApplicationError.Expected("validation", "INVALID_WORD_OBSERVATION", "Word observation identity is invalid.");
		}
		const record = value as Record<string, unknown>;
		const dialogue = record.dialogue;
		const textVersion = record.textVersion;
		const lemma = record.lemma;
		if (typeof dialogue !== "string" || dialogue.length === 0 || dialogue.length > 200
			|| typeof textVersion !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(textVersion)
			|| typeof lemma !== "string" || lemma.length === 0 || lemma.length > 200)
		{
			throw ApplicationError.Expected("validation", "INVALID_WORD_OBSERVATION", "Word observation identity is invalid.");
		}
		return { dialogue, textVersion, lemma: lemma.normalize("NFC") };
	}

	private DecodeNameNoteKey(value: unknown): WordNameNoteKey
	{
		if (value === null || typeof value !== "object")
		{
			throw ApplicationError.Expected(
				"validation", "INVALID_WORD_NAME_NOTE", "Name note identity is invalid.");
		}
		const record = value as Record<string, unknown>;
		const dialogue = record.dialogue;
		const lemma = record.lemma;
		if (typeof dialogue !== "string" || dialogue.length === 0 || dialogue.length > 200
			|| typeof lemma !== "string" || lemma.length === 0 || lemma.length > 200)
		{
			throw ApplicationError.Expected(
				"validation", "INVALID_WORD_NAME_NOTE", "Name note identity is invalid.");
		}
		return { dialogue, lemma: lemma.normalize("NFC") };
	}

	private FindOccurrences(document: TextDocument, form: string): WordSearchResult
	{
		const index = this.BuildOccurrenceIndex(document);
		const indexed = index.get(form);
		const occurrences = indexed?.occurrences ?? [];
		const total = indexed?.total ?? 0;
		const result: WordSearchResult = { form, occurrences, total };
		return result;
	}

	private BuildOccurrenceIndex(document: TextDocument): Map<string, { occurrences: WordOccurrence[]; total: number }>
	{
		const index = new Map<string, { occurrences: WordOccurrence[]; total: number }>();
		const expression = /(?:(?=\p{Script=Greek})\p{L}|\p{M})+/gu;
		for (const segment of document.segments)
		{
			expression.lastIndex = 0;
			let match = expression.exec(segment.text);
			while (match !== null)
			{
				const form = match[0].normalize("NFC");
				let indexed = index.get(form);
				if (indexed === undefined)
				{
					indexed = { occurrences: [], total: 0 };
					index.set(form, indexed);
				}
				indexed.total += 1;
				if (indexed.occurrences.length < WordExplorationService.ResultLimit)
				{
					const start = { stephanus: segment.key, offset: match.index };
					const end = { stephanus: segment.key, offset: match.index + match[0].length };
					const selection = document.CreateSelection(start, end);
					const citation = segment.citation?.value ?? null;
					const occurrence: WordOccurrence = {
						selection,
						citation,
						division: null,
						passage: segment.text
					};
					indexed.occurrences.push(occurrence);
				}
				match = expression.exec(segment.text);
			}
		}
		return index;
	}
}
