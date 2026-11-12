import type { LibraryService } from "../library/LibraryService.js";
import type { WordExplorationService } from "../library/WordExplorationService.js";
import type { StudyScope, StudySource } from "../../shared/study/StudyTypes.js";
import { StudyTopicSearch, type StudyTopicTerm } from "./StudyTopicSearch.js";

// Text-only evidence: no Vision, anchor repository, note or reader-draft capabilities.
export class StudyEvidence
{
	// Current-turn receipts are independent of the persistent source-card limit.
	private readonly turnSources: StudySource[] = [];
	// Host-produced cards remain inspectable in the conversation.
	private readonly sources: StudySource[] = [];
	// Only an explicit reader submission permits retrieval.
	private active = false;
	// Each turn has a bounded tool and output allowance.
	private calls = 0;
	private output = 0;
	// Executes the fixed dictionary-to-occurrence workflow.
	private readonly topics: StudyTopicSearch;
	// Dependencies cannot reach reader documents or notes.
	public constructor(private readonly library: Pick<LibraryService, "GetAsync">,
		words: Pick<WordExplorationService, "GetLexicalEvidenceAsync">, private readonly scope: StudyScope)
	{
		this.topics = new StudyTopicSearch(library, words);
	}

	// Validates the work without opening reader-authored records.
	public async PrepareAsync(): Promise<void>
	{
		await this.library.GetAsync(this.scope.workId);
	}

	// Resets retrieval receipts and allowances for a new explicit request.
	public BeginTurn(): void
	{
		this.active = true;
		this.calls = 0;
		this.output = 0;
		this.turnSources.length = 0;
	}

	// Revokes retrieval before cancellation or final synthesis.
	public EndTurn(): void
	{
		this.active = false;
	}

	// Slow operations must check revocation before returning evidence.
	private RequireActive(): void
	{
		if (!this.active) throw new Error("Evidence access is stopped.");
	}

	// Returns independent host-produced navigation cards.
	public GetSources(): readonly StudySource[]
	{
		const result = structuredClone(this.sources);
		return result;
	}

	// Context contains only the canonical work and the current experiment.
	public async DescribeAsync(): Promise<string>
	{
		const document = await this.library.GetAsync(this.scope.workId);
		const result = JSON.stringify({ workId: document.id, title: document.title, textVersion: document.textVersion,
			experiment: "canonical-topic-retrieval-v1", access: "Canonical Greek and linguistic evidence only. No Visions, editor drafts or reader notes. Use find_topic_passages with proposed Greek headwords, then read_passage for context." });
		return result;
	}

	// Dispatches only the experiment's two read-only capabilities.
	public async CallAsync(name: string, args: Record<string, unknown>): Promise<string>
	{
		this.RequireActive();
		this.calls += 1;
		let result: string;
		if (this.calls > 6)
		{
			result = JSON.stringify({ retrieval: { remainingCalls: 0, closed: true,
				nextAction: "Answer now from retrieved evidence. State limited coverage. Do not invent results or ask to continue." } });
		}
		else
		{
			const document = await this.library.GetAsync(this.scope.workId);
			const receipts: StudySource[] = [];
			let value: object;
			if (name === "find_topic_passages")
			{
				const terms = this.DecodeTerms(args.terms);
				const offset = args.offset ?? 0;
				if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid candidate offset.");
				const found = await this.topics.FindAsync(this.scope.workId, terms, offset, this.RequireActive.bind(this));
				value = { provenance: "dictionary-backed-lexical-candidates", workId: document.id, textVersion: document.textVersion,
					...found, limitations: "Topic relevance is a model proposal. Dictionary evidence validates vocabulary, not contextual sense. All supplied mapped occurrences were examined; missing or ambiguous morphology limits coverage. Canonical order is not an importance ranking. No implicit theme or speaker attribution is established." };
				for (const term of found.vocabulary)
				{
					receipts.push({ label: `Search proposal · ${term.proposal.lemma}`,
						excerpt: `Model-proposed relevance: ${term.proposal.reason}. Mapped occurrences: ${term.occurrences}; coverage: ${term.occurrencesStatus}.`, selection: null });
					for (const entry of term.dictionary)
					{
						receipts.push({ label: `Dictionary excerpt · ${entry.provider} · ${entry.headword}`, excerpt: entry.plainText, selection: null });
					}
				}
				receipts.push({ label: "Lexical search coverage", excerpt: `${found.total} candidate sections for the proposed vocabulary; this page starts at ${offset}. This is not exhaustive conceptual coverage.`, selection: null });
				for (const candidate of found.candidates)
				{
					const forms = candidate.matches.map(function Form(match): string
					{
						return match.form;
					});
					const unique = [...new Set(forms)];
					receipts.push({ label: `${document.title} ${candidate.stephanus} · mapped forms: ${unique.join(", ")}`,
						excerpt: candidate.greek, selection: candidate.selection });
				}
			}
			else if (name === "read_passage")
			{
				if (typeof args.stephanus !== "string" || args.stephanus.length > 40) throw new Error("Choose an actual section reference.");
				const segment = document.GetSegment(args.stephanus);
				const offset = args.offset ?? 0;
				if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset >= segment.text.length) throw new Error("Invalid passage offset.");
				let end = Math.min(segment.text.length, offset + 6000);
				if (end < segment.text.length && /[\uDC00-\uDFFF]/u.test(segment.text[end]!)) end -= 1;
				const selection = document.CreateSelection({ stephanus: segment.key, offset }, { stephanus: segment.key, offset: end });
				const greek = document.ReconstructText(selection);
				value = { provenance: "canonical-text", workId: document.id, textVersion: document.textVersion,
					stephanus: segment.key, greek, offset, nextOffset: end < segment.text.length ? end : null };
				receipts.push({ label: `${document.title} ${segment.key}`, excerpt: greek, selection });
			}
			else throw new Error("This tool is not part of the text-only experiment.");
			this.RequireActive();
			const remainingCalls = Math.max(0, 6 - this.calls);
			result = JSON.stringify({ ...value, retrieval: { remainingCalls,
				nextAction: remainingCalls <= 2 ? "Finish with a few supported candidates and disclose limits. Do not broaden the search." : "Inspect candidates, then return concrete textual signals, not an essay." } });
			if (result.length > 32000 || this.output + result.length > 80000) throw new Error("Evidence exceeds this turn's context allowance.");
			this.output += result.length;
			for (const receipt of receipts)
			{
				this.turnSources.push(receipt);
				if (this.sources.length < 100) this.sources.push(receipt);
			}
		}
		return result;
	}

	// Rejects oversized inventories and non-Greek headwords before any provider call.
	private DecodeTerms(value: unknown): readonly StudyTopicTerm[]
	{
		if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new Error("Propose one to four Greek headwords.");
		const terms: StudyTopicTerm[] = [];
		for (const item of value)
		{
			if (typeof item !== "object" || item === null || typeof item.lemma !== "string" || item.lemma.length > 80
				|| !/^[\p{Script=Greek}\p{M}]+$/u.test(item.lemma) || typeof item.reason !== "string" || item.reason.length > 240)
			{
				throw new Error("Each proposal needs a Greek headword and a short reason.");
			}
			terms.push({ lemma: item.lemma, reason: item.reason });
		}
		return terms;
	}

	// Checks explicit citations and double-quoted Greek against this turn's actual excerpts.
	public async CheckCitationsAsync(text: string): Promise<{ readonly unverified: readonly string[]; readonly allowed: readonly string[]; readonly cited: readonly string[]; readonly unverifiedQuotes: readonly string[] }>
	{
		const allowed = new Set<string>();
		const passages: string[] = [];
		for (const source of this.turnSources)
		{
			if (source.selection !== null)
			{
				allowed.add(source.selection.start.stephanus);
				const normalized = this.NormalizeQuote(source.excerpt);
				passages.push(normalized);
			}
		}
		const unverified = new Set<string>();
		const cited = new Set<string>();
		for (const citation of text.matchAll(/\b([1-9]\d{1,2}[a-e])(?:\d+)?\b/gu))
		{
			cited.add(citation[1]!);
			if (!allowed.has(citation[1]!)) unverified.add(citation[1]!);
		}
		const unverifiedQuotes: string[] = [];
		for (const quote of text.matchAll(/[“"]([^”"\n]+)[”"]/gu))
		{
			if (/\p{Script=Greek}/u.test(quote[1]!))
			{
				const normalized = this.NormalizeQuote(quote[1]!);
				const found = passages.some(function Contains(passage): boolean
				{
					const matches = passage.includes(normalized);
					return matches;
				});
				if (!found) unverifiedQuotes.push(quote[1]!);
			}
		}
		const result = { unverified: [...unverified], allowed: [...allowed], cited: [...cited], unverifiedQuotes };
		return result;
	}

	// Whitespace and composition can differ; Greek words, accents and punctuation must match.
	private NormalizeQuote(text: string): string
	{
		const composed = text.normalize("NFC");
		const result = composed.replace(/\s+/gu, " ").trim();
		return result;
	}
}
