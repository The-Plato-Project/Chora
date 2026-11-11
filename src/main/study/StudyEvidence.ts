import type { LibraryService } from "../library/LibraryService.js";
import type { WordExplorationService } from "../library/WordExplorationService.js";
import type { VisionService } from "../visions/VisionService.js";
import type { TextAnchorService } from "../anchors/TextAnchorService.js";
import type { StudyScope, StudySource } from "../../shared/study/StudyTypes.js";
import type { VisionSnapshot } from "../../shared/visions/VisionTypes.js";
import { DecodeTextSelection } from "../../shared/text/TextSelection.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { WordEvidenceResult, WordOccurrence } from "../../shared/library/WordExplorationTypes.js";

// Bounded read-only projections over the existing authoritative feature services.
export class StudyEvidence
{
	// Frozen saved snapshots record exactly what the reader authorized at session start.
	private readonly allowed = new Map<string, VisionSnapshot>();
	// Calls and output are budgeted afresh for each reader turn.
	private calls = 0;
	// Bounds accumulated response or evidence characters for the current turn.
	private output = 0;
	// Revokes read access outside an explicit reader turn.
	private active = false;
	// Retrieved citations are host-produced, never parsed from the model's prose.
	private readonly sources: StudySource[] = [];
	// Scope is validated before the tool listener or backend is started.
	public constructor(private readonly library: Pick<LibraryService, "GetAsync">, private readonly visions: Pick<VisionService, "ListAsync">,
		private readonly anchors: Pick<TextAnchorService, "ValidateAsync">, private readonly words: Pick<WordExplorationService, "GetEvidenceAsync">,
		private readonly scope: StudyScope)
	{
	}

	// Validates every supplied identity through its owner and captures saved writing only.
	public async PrepareAsync(): Promise<void>
	{
		const document = await this.library.GetAsync(this.scope.workId);
		if (this.scope.selection !== null)
		{
			document.ValidateSelection(this.scope.selection);
			const text = document.ReconstructText(this.scope.selection);
			if (text.length > 8000) throw new Error("Attach a passage shorter than 8,000 characters.");
		}
		const catalogue = await this.visions.ListAsync();
		for (const id of this.scope.visionIds)
		{
			const vision = catalogue.visions.find(function Matches(item): boolean
			{
				const result = item.id === id;
				return result;
			});
			if (vision === undefined || vision.workId !== this.scope.workId)
			{
				throw ApplicationError.Expected("validation", "STUDY_SCOPE_INVALID", "Choose existing Visions belonging to the selected work.");
			}
			this.allowed.set(id, structuredClone(vision));
		}
	}

	// Enables evidence retrieval only while an explicit reader turn is executing.
	public BeginTurn(): void
	{
		this.calls = 0;
		this.output = 0;
		this.active = true;
	}

	// Revokes tool access before cancellation or session disposal.
	public EndTurn(): void
	{
		this.active = false;
	}

	// Returns verified navigation cards for the inspectable transcript.
	public GetSources(): readonly StudySource[]
	{
		const result = structuredClone(this.sources);
		return result;
	}

	// Returns validated initial context without sending the chosen documents in full.
	public async DescribeAsync(): Promise<string>
	{
		const document = await this.library.GetAsync(this.scope.workId);
		const selection = this.scope.selection;
		const passage = selection === null ? null : { selection, greek: document.ReconstructText(selection) };
		const visions = [];
		for (const vision of this.allowed.values()) visions.push({ id: vision.id, title: vision.title, savedRevision: vision.updatedAt });
		const description = JSON.stringify({ workId: this.scope.workId, textVersion: document.textVersion, visions, passage });
		return description;
	}

	// Dispatches only the declared read capabilities; model arguments cannot widen the work or Vision scope.
	public async CallAsync(name: string, args: Record<string, unknown>): Promise<string>
	{
		if (!this.active || ++this.calls > 24) throw new Error("Evidence access is stopped or this turn's tool budget is exhausted.");
		let value: unknown;
		const sources: StudySource[] = [];
		if (name === "find_visions")
		{
			const query = this.Text(args.query, 120).toLocaleLowerCase();
			const matches = [];
			for (const vision of this.allowed.values())
			{
				const index = vision.markdown.toLocaleLowerCase().indexOf(query);
				if (vision.title.toLocaleLowerCase().includes(query) || index >= 0)
				{
					const start = Math.max(0, index - 120);
					matches.push({
						visionId: vision.id, title: vision.title, savedRevision: vision.updatedAt,
						reason: index >= 0 ? "literal prose match" : "literal title match", offset: start, excerpt: vision.markdown.slice(start, start + 500)
					});
				}
			}
			value = { provenance: "reader-writing", items: matches.slice(0, 10), truncated: matches.length > 10 };
		}
		else if (name === "read_vision")
		{
			const id = this.Text(args.visionId, 100);
			const vision = this.allowed.get(id);
			if (vision === undefined) throw new Error("This Vision is outside the reader-approved scope.");
			const offset = args.offset ?? 0;
			if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > vision.markdown.length) throw new Error("Invalid document offset.");
			value = {
				provenance: "reader-writing", visionId: id, title: vision.title, savedRevision: vision.updatedAt,
				offset, markdown: vision.markdown.slice(offset, offset + 6000), nextOffset: offset + 6000 < vision.markdown.length ? offset + 6000 : null
			};
			sources.push({ label: `${vision.title} · saved ${vision.updatedAt}`, excerpt: vision.markdown.slice(offset, offset + 240), visionId: id, selection: null });
		}
		else if (name === "read_passage")
		{
			const document = await this.library.GetAsync(this.scope.workId);
			const key = this.Text(args.stephanus, 40);
			const segment = document.segments.find(function Matches(item): boolean
			{
				const result = item.key === key;
				return result;
			});
			if (segment === undefined) throw new Error("This canonical passage was not found.");
			value = {
				provenance: "canonical-text", workId: document.id, textVersion: document.textVersion,
				stephanus: key, greek: segment.text.slice(0, 8000), truncated: segment.text.length > 8000
			};
			const selection = document.CreateSelection({ stephanus: key, offset: 0 }, { stephanus: key, offset: segment.text.length });
			sources.push({ label: `${document.title} ${key}`, excerpt: segment.text.slice(0, 240), visionId: null, selection });
		}
		else if (name === "resolve_anchor")
		{
			const id = this.Text(args.anchorId, 150);
			const anchor = await this.anchors.ValidateAsync(id);
			if (anchor.workId !== this.scope.workId) throw new Error("This anchor is outside the approved work.");
			if (anchor.selectedText.length > 8000) throw new Error("This anchor exceeds the evidence window.");
			value = { provenance: "canonical-anchor", anchor };
			sources.push({ label: `${anchor.workId} ${anchor.selection.start.stephanus}`, excerpt: anchor.selectedText.slice(0, 240), visionId: null, selection: anchor.selection });
		}
		else if (name === "get_word_evidence")
		{
			const selection = DecodeTextSelection(args.selection);
			if (selection.dialogue !== this.scope.workId) throw new Error("This word is outside the approved work.");
			const document = await this.library.GetAsync(this.scope.workId);
			const word = document.GetSingleGreekWordSelection(selection);
			if (word === null) throw new Error("Supply one exact Greek word selection.");
			const evidence = await this.words.GetEvidenceAsync(word);
			value = this.ProjectWord(evidence, args);
			const greek = document.ReconstructText(word);
			sources.push({ label: `Word evidence · ${greek}`, excerpt: "Dictionary and morphology candidates for this exact occurrence.", visionId: null, selection: word });
		}
		else throw new Error("This tool is not available.");
		const result = JSON.stringify(value);
		if (!this.active) throw new Error("Evidence access was revoked.");
		if (result.length > 24000 || this.output + result.length > 64000) throw new Error("Evidence is too large for this turn. Request a smaller passage or document window.");
		this.output += result.length;
		for (const source of sources)
		{
			if (this.sources.length < 100) this.sources.push(source);
		}
		return result;
	}

	// Separates large dictionary and occurrence inventories into explicit, traceable pages.
	private ProjectWord(evidence: WordEvidenceResult, args: Record<string, unknown>): unknown
	{
		const section = args.section ?? "overview";
		const offset = args.offset ?? 0;
		if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid evidence offset.");
		let result: unknown;
		const provenance = { provenance: "linguistic-material", selection: evidence.selection, work: evidence.work, warnings: evidence.warnings, limitations: evidence.limitations };
		if (section === "overview")
		{
			const entries = evidence.dictionary.entries.map(function Label(entry, index)
			{
				const result = { entryIndex: index, headword: entry.headword, provider: entry.provider, length: entry.plainText.length };
				return result;
			});
			result = {
				...provenance, form: evidence.form, possibilities: evidence.possibilities, coverage: evidence.coverage,
				morphology: { status: evidence.morphology.status, provider: evidence.morphology.provider, normalization: evidence.morphology.normalization },
				dictionary: { status: evidence.dictionary.status, entries, possiblyTruncated: evidence.dictionary.possiblyTruncated }, occurrencesStatus: evidence.occurrencesStatus
			};
		}
		else if (section === "dictionary")
		{
			const index = args.entryIndex;
			if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) throw new Error("Choose a dictionary entryIndex from the overview.");
			const entry = evidence.dictionary.entries[index];
			if (entry === undefined || offset > entry.plainText.length) throw new Error("Dictionary entry or offset not found.");
			result = {
				...provenance, entryIndex: index, headword: entry.headword, entryId: entry.entryId, provider: entry.provider,
				providerVersion: entry.providerVersion, source: entry.source, license: entry.license, offset,
				text: entry.plainText.slice(offset, offset + 6000), nextOffset: offset + 6000 < entry.plainText.length ? offset + 6000 : null
			};
		}
		else if (section === "occurrences")
		{
			const lemma = this.Text(args.lemma, 150);
			const candidate = evidence.lemmas.find(function Matches(item): boolean
			{
				const result = item.lemma === lemma;
				return result;
			});
			if (candidate === undefined) throw new Error("Choose an actual candidate lemma from the overview.");
			const occurrences: WordOccurrence[] = [];
			for (const form of candidate.forms) occurrences.push(...form.occurrences);
			if (offset > occurrences.length) throw new Error("Invalid occurrence offset.");
			const page = occurrences.slice(offset, offset + 12);
			const items = page.map(function Project(item)
			{
				const result = {
					selection: item.selection, citation: item.citation, division: item.division,
					passage: item.passage.slice(0, 500), passageTruncated: item.passage.length > 500
				};
				return result;
			});
			result = { ...provenance, lemma, offset, total: occurrences.length, items, nextOffset: offset + 12 < occurrences.length ? offset + 12 : null };
		}
		else throw new Error("Choose overview, dictionary or occurrences.");
		return result;
	}

	// Validates bounded scalar input before invoking any authoritative service.
	private Text(value: unknown, limit: number): string
	{
		if (typeof value !== "string" || value.trim().length === 0 || value.length > limit) throw new Error("Invalid tool argument.");
		return value;
	}
}
