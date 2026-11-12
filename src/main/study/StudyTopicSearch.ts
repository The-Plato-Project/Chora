import type { LibraryService } from "../library/LibraryService.js";
import type { WordExplorationService } from "../library/WordExplorationService.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { WordDictionaryEntry } from "../../shared/library/WordExplorationTypes.js";

// The model proposes vocabulary; the host preserves its status as a proposal.
export interface StudyTopicTerm
{
	// Exact Greek headword submitted for dictionary lookup.
	readonly lemma: string;
	// Model's proposed connection to the reader's topic, not a dictionary assertion.
	readonly reason: string;
}

// Inspectable lexical evidence for one proposed search term.
export interface StudyTopicVocabulary
{
	// Retains the original proposal without silently replacing it with a different sense.
	readonly proposal: StudyTopicTerm;
	// Dictionary evidence is separate from proposed relevance.
	readonly dictionary: readonly (Pick<WordDictionaryEntry, "headword" | "provider" | "entryId" | "plainText" | "source" | "license"> & {
		// Prevents an excerpt being mistaken for a complete dictionary entry.
		readonly totalCharacters: number;
		readonly truncated: boolean;
	})[];
	// Reports unavailable mapping rather than a false absence from the work.
	readonly occurrencesStatus: string;
	// Count of provider-mapped occurrences, including lexical ambiguity.
	readonly occurrences: number;
	// Provider warnings remain visible in the experiment.
	readonly warnings: readonly string[];
}

// One candidate section with exact canonical matches and surrounding text.
export interface StudyTopicCandidate
{
	// Stable section identity in the current canonical work.
	readonly stephanus: string;
	// Verbatim bounded text with explicit truncation.
	readonly greek: string;
	readonly truncated: boolean;
	// Selection covers exactly the supplied excerpt, not text the model has not read.
	readonly selection: TextSelection;
	// Each signal is a lexical mapping, never an interpretation or speaker attribution.
	readonly matches: readonly { readonly proposedLemma: string; readonly mappedLemma: string; readonly form: string; readonly selection: TextSelection }[];
}

// Only the workflow may append matches while constructing an immutable result.
type TopicCandidateDraft = Omit<StudyTopicCandidate, "matches"> & { matches: StudyTopicCandidate["matches"][number][] };

// Performs one controlled dictionary-to-occurrence workflow through existing owners.
export class StudyTopicSearch
{
	// No reader documents or notes are dependencies of this experiment.
	public constructor(private readonly library: Pick<LibraryService, "GetAsync">,
		private readonly words: Pick<WordExplorationService, "GetLexicalEvidenceAsync">)
	{
	}

	// Looks up all proposed terms before returning a deterministic page of lexical candidates.
	public async FindAsync(workId: string, terms: readonly StudyTopicTerm[], offset: number,
		requireActive: () => void): Promise<{ readonly vocabulary: readonly StudyTopicVocabulary[]; readonly candidates: readonly StudyTopicCandidate[]; readonly total: number; readonly nextOffset: number | null }>
	{
		const document = await this.library.GetAsync(workId);
		requireActive();
		const vocabulary: StudyTopicVocabulary[] = [];
		const sections = new Map<string, TopicCandidateDraft>();
		for (const term of terms)
		{
			const evidence = await this.words.GetLexicalEvidenceAsync(term.lemma, workId);
			requireActive();
			if (evidence.work?.dialogue !== document.id || evidence.work.text_version !== document.textVersion)
			{
				throw new Error("Linguistic evidence belongs to a different canonical work or version.");
			}
			const dictionary = evidence.dictionary.entries.map(function Project(entry)
			{
				const result = { headword: entry.headword, provider: entry.provider, entryId: entry.entryId,
					plainText: entry.plainText.slice(0, 700), source: entry.source, license: entry.license,
					totalCharacters: entry.plainText.length, truncated: entry.plainText.length > 700 };
				return result;
			});
			let occurrences = 0;
			if (dictionary.length > 0 && evidence.occurrencesStatus === "indexed")
			{
				for (const lemma of evidence.lemmas)
				{
					for (const form of lemma.forms)
					{
						for (const occurrence of form.occurrences)
						{
							document.ValidateSelection(occurrence.selection);
							occurrences += 1;
							const key = occurrence.selection.start.stephanus;
							let candidate = sections.get(key);
							if (candidate === undefined)
							{
								const segment = document.GetSegment(key);
								let start = Math.max(0, occurrence.selection.start.offset - 200);
								if (start > 0 && /[\uDC00-\uDFFF]/u.test(segment.text[start]!)) start -= 1;
								let end = Math.min(segment.text.length, start + 1400);
								if (end < segment.text.length && /[\uDC00-\uDFFF]/u.test(segment.text[end]!)) end -= 1;
								const selection = document.CreateSelection({ stephanus: key, offset: start }, { stephanus: key, offset: end });
								candidate = { stephanus: key, greek: segment.text.slice(start, end), truncated: start > 0 || end < segment.text.length, selection, matches: [] };
								sections.set(key, candidate);
							}
							const visible = document.Contains(occurrence.selection, candidate.selection);
							if (candidate.matches.length < 6 && visible)
							{
								candidate.matches.push({ proposedLemma: term.lemma, mappedLemma: lemma.lemma, form: form.form, selection: occurrence.selection });
							}
						}
					}
				}
			}
			const warnings = [...evidence.warnings];
			if (dictionary.length === 0) warnings.push("No dictionary evidence: this proposal was not used to generate candidates.");
			if (evidence.dictionary.possiblyTruncated) warnings.push("Dictionary inventory may be incomplete.");
			warnings.push(evidence.limitations);
			vocabulary.push({ proposal: term, dictionary: dictionary.slice(0, 2), occurrencesStatus: evidence.occurrencesStatus, occurrences, warnings });
		}
		// Canonical order is stable; multiple terms do not imply greater philosophical importance.
		const candidates: StudyTopicCandidate[] = [];
		for (const segment of document.segments)
		{
			const candidate = sections.get(segment.key);
			if (candidate !== undefined) candidates.push(candidate);
		}
		const page = candidates.slice(offset, offset + 4);
		const result = { vocabulary, candidates: page, total: candidates.length,
			nextOffset: offset + 4 < candidates.length ? offset + 4 : null };
		return result;
	}
}
