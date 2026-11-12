# Topic retrieval experiment

## Purpose

Test and improve one practical capability with the existing local model: retrieve
passages from the current canonical work that have identifiable textual features
related to a reader's topic. Do not equate a lexical match with philosophical
significance or assume a specialized model or training project is required.

The [reading principles](READING_PRINCIPLES.md) constrain attention. Visions,
reader notes, editor drafts and earlier general-chat context are excluded.

## First reader trial

Use an ordinary question such as:

> Where in the Republic does Plato use expressions involving time, before and
> after, or things happening at the same time? Show a few passages I might want
> to examine.

Then try money as a contrast topic. Do not provide a fixed answer list or hardcode
those topics into retrieval. The model proposes Greek vocabulary; the application
checks dictionary availability and retrieves mapped occurrences.

For each response inspect:

- Were the proposed headwords sensible, and what dictionary evidence was returned?
- Did the quoted Greek and location match the retrieved passage?
- Was there a concrete temporal or monetary expression or a clear juxtaposition?
- Did the model distinguish an incidental reference from something conspicuous?
- Did it preserve uncertainty and stop without an essay or unsolicited inquiry?
- What relevant passages did it miss because of vocabulary, morphology, paging
  or model selection? Missing candidates are useful evidence for improvement.

Sources preserves the proposed vocabulary separately from dictionary excerpts
and actual mapped forms. Canonical text remains clickable. Note useful results,
false positives and wording that overstates significance. The reader's judgment
of the returned passages determines whether to expand or revise the experiment.

## Checks performed

The affected tests and application build passed, followed by the complete
149-test suite. Synthetic fixtures check dictionary-backed mapping, absent
entries, scope, revoked access, the exact two-tool inventory, lack of Vision
submission and quotation/citation rejection. They do not evaluate Greek judgment.

The isolated real Electron trial attempted the question above with the installed
local model on 12 November 2026. Windows Application Control blocked goose.exe
in the agent's execution environment before model execution. No model answer was
received in that initial attempt and no personal Vision content was sent.

Installing the official desktop bundle subsequently resolved execution without
changing Windows security settings. Its signed bundled CLI reports Goose 1.59.0.
The first live model run then failed on argument quality: proposals such as
`μετ(ά)` and a multiword phrase caused the whole batch to be rejected. Generic
tool feedback led the model to infer missing dictionary coverage incorrectly.
No canonical passages were retrieved and the Vision catalogue was not accessed.
This was not a successful thematic search despite the model finishing its turn.

The approved follow-up accepts valid headwords independently, returns rejected
terms with specific reasons, and distinguishes invalid-input-not-searched from
an actual dictionary lookup. Safe structured validation errors also survive MCP
instead of being hidden behind a generic dictionary-availability message.

### Live result after feedback correction

The same time question completed with one retrieval call and no Vision catalogue
reads. The model searched χρόνος, πρόσθεν and ὕστερον, then returned 327c, 328b
and 345c. Its Greek quotations matched the returned excerpts, including the
guillemet quotations used in the response. Guillemet quote checks are now part
of the host validator and focused tests, alongside ordinary double quotes.

This is a retrieval improvement, not thematic acceptance. The results include
ordinary narrative or argumentative sequence rather than an established striking
pattern. The gloss of 328b needs reader review, and the model ignored the request
to omit search narration and follow-up questions. These remain quality findings.

### Money contrast

The question “Where in the Republic is money, wealth or payment explicitly
discussed? Show a few passages I might want to examine.” produced no tool calls.
The model generated unsupported source material, and the host's bounded
correction did not produce a verified answer. Chora replaced the response with
an inline explanation marked incomplete. No source cards or Vision reads were
reported. This trial failed retrieval; it must not be counted as a successful
search merely because the provider finished generating text.

The test therefore remains experimental. Vocabulary quality, obedience to the
required retrieval step, relevance, translations and restrained presentation
need reader-led evaluation and further work. A likely next design question is
whether retrieval must be admitted by application workflow before synthesis,
rather than relying on the model to choose a tool at all. No such additional
workflow change has been implemented in this iteration.

A direct check of the actual local PlatoSI database succeeded without Goose.
Using fixed test vocabulary χρόνος and ἅμα, it returned one dictionary entry for
each, 46 and 57 supplied occurrence mappings respectively, and 88 distinct
candidate sections. The first canonical page contained 327a, 328b, 331d and
338d. The 7,124-character tool response passed its source/quotation check.
This verifies retrieval with supplied vocabulary, not the model's vocabulary
choice, thematic judgment or the significance of any listed passage.

## Guardrails and future work

### Structured-result follow-up

The reader's real question included the opening Greek passage and asked for
other places where time is shown similarly. Its first failure was not simply a
missing search: the model retrieved 328b, 357b, 363c and 369e, then cited unread
sections and changed one quotation. A correction used matching Greek but
mentioned rejected references as excluded; the whole-answer scanner rejected
those mentions and erased the useful material.

The replacement workflow assigns IDs to actual current-turn source receipts.
The model selects IDs with short provisional English reasons. Chora renders
locations and Greek directly; extra model fields cannot supply quotations or
citations. Model JSON and intermediate narration are not displayed. A failed
selection retains up to three retrieved lexical candidates as an incomplete
result, without implying that they are thematically significant.

The exact reader question was rerun through an isolated real application using
the signed runtime. It produced a valid structured selection of 357b, 328b and
363c; those excerpts were rendered from source receipts. No Vision catalogue
reads or raw JSON appeared in the displayed answer. The build and all 149 tests
passed, including unknown-ID rejection, ignored extraneous reference fields,
canonical-text preservation after failed correction and cancellation behavior.
Relevance and reasons still require reader review; this is not proof of a strong
parallel to the reader's interpretation of the opening.

Report literal or lemma-mapped evidence, model-proposed relevance and coverage
separately. Never conclude that the work has no treatment of a concept merely
because a bounded lexical search did not find a compelling passage.

After the first results feel useful, consider a separate verb-form exploration
or lightweight reader-authored theme marks. Broader cross-passage comparisons and
reader-writing context require another deliberate step. No automatic hidden
meaning detector, teacher or autonomous interpretation is part of this trial.
