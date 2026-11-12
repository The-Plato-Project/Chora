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
in the agent's execution environment before model execution. No model answer was received and no personal Vision
content was sent. A real model-quality result is therefore still pending.

A direct check of the actual local PlatoSI database succeeded without Goose.
Using fixed test vocabulary χρόνος and ἅμα, it returned one dictionary entry for
each, 46 and 57 supplied occurrence mappings respectively, and 88 distinct
candidate sections. The first canonical page contained 327a, 328b, 331d and
338d. The 7,124-character tool response passed its source/quotation check.
This verifies retrieval with supplied vocabulary, not the model's vocabulary
choice, thematic judgment or the significance of any listed passage.

## Guardrails and future work

Report literal or lemma-mapped evidence, model-proposed relevance and coverage
separately. Never conclude that the work has no treatment of a concept merely
because a bounded lexical search did not find a compelling passage.

After the first results feel useful, consider a separate verb-form exploration
or lightweight reader-authored theme marks. Broader cross-passage comparisons and
reader-writing context require another deliberate step. No automatic hidden
meaning detector, teacher or autonomous interpretation is part of this trial.
