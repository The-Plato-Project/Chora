import type { StudySource } from "../../shared/study/StudyTypes.js";

// A model may select evidence and suggest relevance, but cannot supply source text.
interface PassageChoice
{
	// The source is taken exclusively from the host's current-turn receipts.
	readonly source: StudySource;
	// This is explicitly provisional model commentary, not a verified assertion.
	readonly reason: string;
}

// Decodes a narrow selection response and renders evidence directly from its owner.
export class StudyPassageResult
{
	// Indicates whether the model supplied a valid structured selection.
	public readonly IsValid: boolean;
	// Safe application-rendered result, including evidence when model selection fails.
	public readonly Text: string;
	// A bounded explanation used for one internal correction, never raw diagnostics.
	public readonly Problem: string;

	// Only the decoder can create a result with verified source membership.
	private constructor(valid: boolean, text: string, problem: string)
	{
		this.IsValid = valid;
		this.Text = text;
		this.Problem = problem;
	}

	// Unknown model fields are ignored and cannot replace a citation or quotation.
	public static FromModel(text: string, sources: readonly StudySource[]): StudyPassageResult
	{
		const known = new Map<string, StudySource>();
		for (const source of sources)
		{
			if (source.selection !== null && source.candidateId !== undefined) known.set(source.candidateId, source);
		}
		let value: unknown = null;
		try
		{
			let serialized = text.trim();
			if (serialized.startsWith("```json\n") && serialized.endsWith("```")) serialized = serialized.slice(8, -3).trim();
			if (serialized.length <= 8000) value = JSON.parse(serialized);
		}
		catch
		{
			// Invalid output must not discard evidence already retrieved successfully.
		}
		let problem = "Return one JSON object with selections: [{candidateId, reason}], choosing at most three IDs from the supplied candidates.";
		const choices: PassageChoice[] = [];
		const selected = new Set<string>();
		let valid = false;
		let noSelectionReason = "";
		if (typeof value === "object" && value !== null && "selections" in value && Array.isArray(value.selections) && value.selections.length <= 3)
		{
			valid = true;
			for (const item of value.selections)
			{
				const source = typeof item?.candidateId === "string" ? known.get(item.candidateId) : undefined;
				if (source === undefined || selected.has(item.candidateId) || !this.ValidReason(item.reason))
				{
					valid = false;
					problem = "Use actual current-turn candidateId values once each. Each reason must be short English prose without Greek quotations or section references; the application supplies those.";
				}
				else
				{
					selected.add(item.candidateId);
					choices.push({ source, reason: item.reason.trim() });
				}
			}
			if (value.selections.length === 0)
			{
				if ("noSelectionReason" in value && this.ValidReason(value.noSelectionReason)) noSelectionReason = value.noSelectionReason.trim();
				else valid = false;
			}
		}
		if (known.size === 0)
		{
			valid = false;
			problem = "No canonical passage was retrieved in this turn.";
		}
		const lines: string[] = [];
		if (valid && choices.length > 0)
		{
			lines.push("Candidate passages. Greek and locations come directly from the retrieved text; reasons are provisional model suggestions.");
		}
		else if (known.size > 0)
		{
			lines.push(valid ? "The model did not select a strong candidate." : "The model's selection could not be verified. Here are actual passages retrieved by the search; their relevance has not been established.");
			if (valid) lines.push("Model's assessment: " + noSelectionReason);
			choices.length = 0;
			for (const source of known.values())
			{
				if (choices.length < 3) choices.push({ source, reason: "" });
			}
		}
		else
		{
			lines.push("No canonical passages are available for this request. This is an incomplete retrieval result, not evidence that the topic is absent from the work. Any tool feedback or dictionary evidence appears under Sources.");
		}
		for (let index = 0; index < choices.length; index += 1)
		{
			const choice = choices[index]!;
			const prefix = (choice.source.selection?.start.offset ?? 0) > 0 ? "[…]\n" : "";
			lines.push(`${index + 1}. ${choice.source.label}\n\nGreek excerpt:\n${prefix}${choice.source.excerpt}`);
			if (choice.reason.length > 0) lines.push("Possible relevance (model): " + choice.reason);
		}
		if (known.size > 0) lines.push("These are lexical candidates from the retrieved pages, not an exhaustive thematic search. Sources contains the search vocabulary, dictionary evidence and coverage details.");
		const rendered = lines.join("\n\n");
		const result = new StudyPassageResult(valid, rendered, problem);
		return result;
	}

	// Source references and Greek belong in application-controlled fields, not model commentary.
	private static ValidReason(value: unknown): value is string
	{
		const valid = typeof value === "string" && value.trim().length > 0 && value.length <= 500
			&& !/\p{Script=Greek}|\b[1-9]\d{1,2}[a-e](?:\d+)?\b/u.test(value);
		return valid;
	}
}
