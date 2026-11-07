# Chora: A Reader's Living Memory of the Text

Chora is built around a simple idea: reading is not the extraction of information, and interpretation is not something a model should perform in place of a reader. Reading is an encounter between a person and a text. Chora should help that encounter accumulate, return, and deepen.

The application is not a general writing program with convenient links to Plato. Writing, lexical research, structural divisions, exact passages, and model assistance all serve a more specific purpose: helping a reader notice and preserve relationships within a dialogue without deciding those relationships for them.

This document describes Chora's new product vision. The currently implemented, passage-bound Dream and Signal workflow remains documented in [README.md](README.md) while a replacement is built alongside it. The transition plan is in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

| Standard AI Reading Tool | Chora |
|---|---|
| Reader asks; model explains | Reader reads and writes; Chora sustains attention |
| Text becomes information | Text remains present as exact evidence |
| Notes are isolated documents | Writing accumulates relationships across the work |
| Model supplies connections | Reader confirms connections |
| Universal interpretation | Different readers can see different things |
| Stateless assistance | A living memory of the reader's encounters |

---

## The Reader and the Whole

A word, phrase, scene, or syntactic construction does not signify in isolation. Its force appears through its relation to a passage, a movement of the argument, other uses, and eventually the whole dialogue. The whole becomes visible through specific details, while those details become more powerful as their place in the whole emerges.

Chora should therefore preserve both scales:

- the exact word, phrase, passage, person, scene, or construction that drew attention;
- the larger sections and movements in which it appears;
- relationships to evidence elsewhere in the dialogue;
- the reader's changing account of why those relationships matter.

The application must not restrict what a reader can see. Different readers will notice different relationships. What one reader does not see cannot be supplied as though it were their own perception. Chora may demonstrate a method of attention and make earlier evidence available, but the act of seeing remains the reader's.

---

## A Structural Translation

Chora includes a cultivated reading of Plato, but not primarily as an English replacement for the Greek. Its first translation is a translation of **structure** into a form a reader can navigate.

The creator may mark:

- transitions and movements within a dialogue;
- sections that belong together without pretending they are wholly separate;
- changes in speaker, scene, argument, image, or mode of inquiry;
- places where the beginning prepares something that becomes visible only later.

These divisions are an authored map, not neutral facts silently attributed to Plato. They demonstrate a way of attending to the dialogue while leaving readers free to accept, revise, ignore, or supplement them.

Readers may also need their own structural divisions. The precise relationship between the cultivated map and a reader's personal map remains a design question. Neither should divide a speech or argument so rigidly that its relation to the whole disappears.

English translations may eventually be available beside the Greek. That is a later concern. The present design must preserve exact Greek references and should not be organized around English equivalents.

---

## Writing Is the Primary Workspace

The middle workspace should become a continuous place for thought rather than a form opened only after the reader creates a passage-bound Dream.

The reader should be able to:

- read the dialogue;
- write continuously beside it;
- bring an exact word, phrase, or passage into the writing;
- continue a thought across several sections or distant parts of the dialogue;
- return from the writing to every cited location;
- open linguistic evidence for a Greek word referenced in the writing.

The selected text is not the container for the thought. It is evidence connected to the thought.

This distinction prevents the application from fragmenting an inquiry into increasingly narrow containers. A sustained account may concern an entire speech, several scenes, a repeated image, a family of words, and a syntactic pattern at once.

---

## Dreams as Living Thought

The current name **Dream** can remain while the new workflow is tested. Its responsibility changes.

A Dream is a sustained document the reader can return to and enlarge. It may begin while reading a particular speech or section, but that origin is context rather than a boundary.

A Dream about money may begin with one paragraph written while reading Cephalus. Later it may gather evidence from Polemarchus, Thrasymachus, another book of the *Republic*, or another dialogue. Its first passage explains where the thought began; it does not determine where the thought may go.

The same Dream may contain references to several Greek words concerned with possession, wealth, payment, inheritance, or debt. Chora can state the factual relationship that the reader used those words in the same Dream. It must not conclude that they share one meaning merely because they occur in the same writing.

A Dream should be discoverable from the evidence placed inside it. If the reader later encounters a referenced word, Chora should provide a direct route back to the Dream and to the exact place where that reference appears. The reader can then add the new occurrence and continue the existing inquiry rather than unknowingly creating another isolated note.

Dreams preserve the course of thought. Signals preserve relationships discovered through that thought. A Signal may begin in one Dream and later connect evidence or writing from several Dreams.

---

## Signals

The name **Signal** is important. Something in the text signifies, but not by itself. A Signal is the reader's growing recognition that several specific things may belong together.

A word on its own is not automatically a Signal. A selection on its own is not automatically a Signal. An interesting sentence is not automatically a Signal. A Signal begins with an **act of attention**: the reader brings evidence into their writing and records that something may matter.

That act can remain unresolved:

> There is something here involving seeing and the divine. I do not yet know what it becomes.

Uncertainty is not a defect to remove. A Signal may preserve a question, tension, echo, contrast, or possibility without forcing it into a conclusion.

### Signals grow

A Signal may begin with one anchored passage. Later it may gather:

- another use of the same Greek lemma;
- a different word participating in a similar situation;
- a person, goddess, place, image, or action;
- a syntactic construction;
- a distant passage that recalls or transforms the earlier one;
- the reader's revised explanation of the relationship.

The original observation should become more useful as the Signal grows. It should not be buried by the newer evidence.

### Signals are relationships, not folders of fragments

For example, one Signal might eventually connect:

- different words associated with a festival;
- the presence of a goddess;
- seeing;
- enjoyment and pleasure;
- Socrates' intention in going down to the Piraeus;
- later passages in which seeing and the divine appear together.

The Signal is not any one item in that list. It is the reader-authored relationship among them.

The application may preserve distinct kinds of connection—echo, contrast, development, repetition, shared lemma, shared scene—but it should not require a fixed taxonomy before the reader can record what they see.

---

## The Graph Emerges from Reading

The reader should not have to maintain a technical graph while reading. The graph should emerge from ordinary acts:

1. The reader writes.
2. The reader brings a word or passage into the writing.
3. Chora preserves an exact, versioned anchor to the Greek text.
4. The reader later encounters something that may be related.
5. Chora resurfaces the earlier thought as a possibility.
6. The reader confirms, rejects, postpones, or ignores the connection.
7. Confirmed relationships become durable and visible wherever their evidence appears.

The graph is the underlying memory of reader-confirmed relationships. A future graph visualization may expose that memory, but it must not become the primary task or make the reader think like a database designer.

The graph should support return in both directions:

- from writing or a Signal to every piece of evidence;
- from a passage or word to the reader's earlier writing and confirmed Signals.

Later evidence can therefore change what the reader sees at the beginning of the dialogue without overwriting what they originally wrote.

---

## Exact Evidence

Every textual reference must remain anchored to the source rather than becoming an untraceable quotation.

A passage reference should retain:

- work and canonical text version;
- exact start and end locations;
- the selected Greek text;
- section or structural context;
- a route back to the displayed passage.

A word reference should additionally retain or be able to retrieve:

- the exact surface form and occurrence;
- candidate lemmas;
- morphology;
- dictionary evidence;
- dialogue-wide occurrences;
- related linguistic evidence and its limitations.

This matters because an English translation can conceal distinctions among Greek words, while identical-looking forms can have different analyses. The model is not a substitute for morphology or lexical evidence.

Evidence and interpretation must remain distinct. Exact evidence makes a proposed relationship inspectable; it does not prove that the relationship has one necessary meaning.

---

## Word Lookup as an Entrance to Reader Memory

Word Lookup is not only a compact dictionary. It is a foundation for returning the reader to relationships they have already begun to form.

For a selected Greek occurrence, it should eventually answer two questions:

1. What linguistic evidence is available for this word and its possible lemmas?
2. Where has this word participated in my own reading?

A personal-memory section can distinguish:

- Dreams containing this exact occurrence;
- Dreams containing another occurrence with the same reader-selected lemma;
- possible same-lemma references where the lemma remains unresolved;
- Dreams containing words joined by a reader-confirmed Signal;
- later model-suggested similarities, clearly marked as suggestions.

These are different claims and must not be collapsed.

Clicking a Dream result should open that Dream at the embedded reference. The reader should then be able to add the current occurrence to the existing Dream without losing their current reading location.

The first useful version requires no model. Exact anchors and confirmed lemma choices are enough to give the reader a reliable path back to earlier writing. Model-assisted comparison belongs later, when Chora helps identify two separate Dreams that may concern a common theme.

---

## Chora as the Reader's Memory

The application should be able to remind the reader:

> You previously wrote about seeing and the divine at Republic 327a. Would you like to look at it?

It should not declare:

> These passages definitely have the same meaning.

A memory surface may show earlier thoughts and explain why each appeared:

- the same exact word or lemma;
- a related lemma supported by linguistic evidence;
- a person, place, or named figure;
- a reader-assigned term;
- an existing confirmed Signal;
- similar language in the reader's writing;
- a possible semantic relationship suggested by a model.

The reader can open, connect, dismiss, or ignore a suggestion. Dismissal is useful feedback about that suggestion; it is not proof that no relationship exists.

Every suggestion must preserve its reason for appearing. Chora must not turn opaque similarity into an authoritative connection.

---

## The Role of a Model

A local model can help Chora retrieve the reader's own intellectual history. Its central question is:

> Have I seen or written something related to this before?

The model may:

- search the reader's earlier writing;
- compare the current passage with earlier anchored evidence;
- use PlatoSI tools to inspect exact Greek forms and candidate lemmas;
- return a small set of possible earlier thoughts;
- explain why each candidate may be relevant.

The model must not:

- silently create a Signal;
- add an edge to the reader's graph;
- merge two Signals;
- rewrite uncertainty as a conclusion;
- present semantic similarity as linguistic proof;
- tell the reader that two passages must be understood together.

Only the reader makes a connection permanent.

Model suggestions are fallible and must remain visibly distinct from deterministic textual and linguistic evidence. Reader writing should remain local. Any future model workflow must specify exactly what local material it reads, why it is needed, and how the reader remains in control.

---

## Two Forms of Human Intelligence

Chora can contain two human layers without confusing them.

### The cultivated structural layer

The creator contributes:

- marked sections and transitions;
- a tested sense of the dialogue's movement;
- examples that demonstrate a method of careful attention;
- tools and evidence chosen to help readers investigate.

This layer is neither neutral nor final. It is an offered way into the dialogue.

### The individual reader's developing layer

The reader contributes:

- what they notice;
- what they connect;
- what they leave unresolved;
- what they later revise;
- what becomes important only after reading further.

The cultivated layer may help the reader learn how to look. It must not replace what the reader sees.

---

## Example: The Opening of the Republic

The opening presents more than a location and an event. Socrates narrates something that happened in his past; the reader waits in a later present to hear what occurred. Time, memory, narration, expectation, descent, seeing, honor, and the divine are already present.

A reader might bring Socrates' account of going down to the Piraeus into the writing workspace and notice a possible relationship between seeing and the divine. Nothing requires that question to be resolved immediately.

Much later, another passage may make that earlier observation newly relevant. Chora should then be able to return the reader to what they wrote, show the exact earlier Greek and its linguistic evidence, and offer the possible connection for inspection.

The reader—not the application and not the model—decides whether the later passage belongs to the same Signal.

This is the experience Chora should make possible: the reader's own mind becoming durably present within the application, so that the work can return them to what they once saw and allow them to build upon it.

---

## Design Commitments

- Writing must support sustained thought across distant passages.
- Exact selections become evidence, not mandatory containers.
- Signals are reader-authored relationships, not automatic annotations.
- Unresolved perceptions remain valuable.
- Structural divisions show a method without claiming neutrality or finality.
- The graph grows from reader-confirmed connections.
- Chora may resurface memories and candidates, but only the reader establishes a relationship.
- Greek text and linguistic evidence remain inspectable.
- Model output never becomes source evidence merely because it sounds plausible.
- Existing reader data must remain recoverable throughout the transition.
- The old Dream and Signal code should be removed only after the replacement is working and migration decisions are explicit.

---

## The Guiding Question

Every design decision should follow one question:

> **Does this help the reader see, preserve, and return to relationships in the text without taking the act of seeing away from them?**

| Temptation | Verdict |
|---|---|
| Automatically summarize a passage | Reject: it replaces reading |
| Require every thought to begin with a selected passage | Reject: it fragments sustained thought |
| Turn every selection into a Signal | Reject: then nothing remains significant |
| Preserve an exact passage inside continuous writing | Accept: evidence remains connected to thought |
| Surface an earlier reader-authored observation with a reason | Accept: it supports memory |
| Automatically connect two observations | Reject: it replaces reader judgment |
| Let the reader confirm and grow a relationship over time | Accept: this is the heart of a Signal |
| Show the relevant Greek and linguistic evidence | Accept: the connection remains inspectable |

Chora is not designed to read for the user. It is designed to help the reader's own encounter with the dialogue become visible, durable, and capable of growth.
