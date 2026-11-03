# Chora: A Different Way to Read

Chora is built around a simple idea: reading is not the extraction of information, but an encounter between a person and a text. Most AI reading tools place the model at the center of that encounter. The reader asks questions, the model answers them, summarizes passages, or explains what the author "really meant." Chora takes a different approach.

This document describes Chora's product vision and future direction. The currently implemented workflow is documented in [README.md](README.md); concepts described here may not yet exist in the application.

| Standard AI Reading Tool | Chora |
|---|---|
| Reader ↔ **AI** ↔ Text | Reader ↔ **Text** (AI sustains) |
| Model explains the text | Model helps the reader explore |
| Information extraction | Perceptual encounter |
| Universal interpretation | Personal journey |
| Stateless assistance | Accumulated memory |

The model is never the center of the experience. Instead, it helps sustain a conversation between the reader and the work itself. The relationship that matters is not **reader ↔ AI**, but **reader ↔ text**. The model exists only to deepen that relationship by helping the reader notice patterns, remember earlier observations, ask better questions, and return to passages with fresh eyes.

Because of this, Chora does not treat reading as a search for the correct interpretation. Every reader brings different experiences, memories, questions, and assumptions to a work. Those differences are not problems to be corrected; they are part of the reading itself. The goal is not to make every reader think the same thing, but to help each reader develop a richer conversation with the text.

---

## Rooms of Memory: Dreams and Signals

Imagine entering a scene in the *Republic*. Words and phrases are like objects in a room: the reader notices one, returns to another, and begins to see relationships among them. Chora should make that encounter richer without taking it over.

The reader chooses the passage they want to work with. That passage gives their attention a boundary: a **room** within the larger work. Chora currently calls the reader's record of that passage a **Dream**; the name may change, but there is no decision to rename it yet. The Dream holds the reader's reflections and the Signals they choose. Signals identify exact words or passages that matter to the reader and carry the reader's own observations.

The room is a focus, not a prison. The reader can investigate other passages in the same work and bring discoveries back to the chosen context. Chora already permits Signal passages outside the Dream source; this vision does not prescribe changing that behavior. The reader decides what to notice and how to relate it to their room.

These rooms can become places of memory: the chosen text, Signals, and reflections provide markers that help the reader return to what they encountered and make their own connections. Chora is not creating a memory or an interpretation on the reader's behalf. Over time, that history may help the model respond to the reader's own direction when asked. It must not turn the reader into a fixed profile, decide what they are supposed to see, or present one interpretation as authoritative. The exact design of these markers and the questions they may support remain to be explored.

Every Dream is a genuine trace of an encounter. A perception need not exhaust the text to be worth preserving. The text remains open to further reading.

---

## Learning Greek Through Greek

The initial focus is learning Greek through reading Greek, particularly Plato's *Republic*. Translation and English explanations are useful: they can help describe a word and its possibilities. But an English equivalent is not the word itself, and a single definition should not close off the range of what the Greek can do.

Chora should help the reader encounter forms and meanings in context: how a word appears, how it relates to other forms and words, and how its use develops within the work. A word can carry several possibilities at once; the surrounding conversation may clarify, complicate, or sustain that ambiguity. The reader should be able to return to the Greek rather than be diverted permanently into an English dictionary.

For example, the reader may notice **κατέβην** at the beginning of the *Republic*, write about it in a Dream, and explore other forms and passages associated with the same lemma. Another inquiry might begin with **πομπή** and explore its relationship to **πέμπω**, as well as other words that may participate in a similar situation. Related forms, shared roots, syntax, and possible connections in meaning are different kinds of relationship; they need not collapse into one definition or group.

The initial exploration scope is the whole current work, such as the entire *Republic*, not only its current numbered book. Exact source passages and locations let the reader follow discoveries back into the text. Future visualization may show how words, uses, and connections overlap, but first Chora needs to collect and preserve useful evidence and reader observations.

---

## Model as a Companion to Inquiry

Imagine an animated object in the room that speaks when the reader asks: the model can provide information about forms, passages, relevant context, or relationships the reader chooses to investigate. Its response can be more helpful than a simple dictionary lookup, but it must not make the reader's connections for them or impose an interpretation. The reader directs the inquiry and decides what the information means to them.

The Greek text, source locations, scholarly resources, model suggestions, and reader observations are not interchangeable. The reader should be able to see the basis for a proposed connection and return to the passage. A shared root does not settle a word's meaning in context; similar uses do not necessarily imply a shared root. Model suggestions and descriptions can be mistaken or incomplete.

The former Dream chat pane and Chora-owned model-provider infrastructure have been removed. Chora sends explicit reader inquiries to PlatoSI, which owns provider selection and returns the model identity, evidence, and warnings displayed with the response.

---

## Earlier Exploratory Concepts

The following ideas record an earlier direction for Chora. They are not current implementation claims or commitments for the development plan. Any future work on them must be reconsidered in light of the reader-centered vision above; in particular, no model, substrate, or cultivated layer should judge the reader's interpretation as authoritative.

### The Four Terms

The architecture rests on four elements:

- **Text** — the work itself, present in exact form
- **Reader** — the living encounter, partial, genuine, evolving
- **Master** — a cultivated layer of perception upon the text, built from years of reading
- **Model** — the servant that holds text, reader, and master simultaneously, and asks what emerges

The Master is not the model. The Master is human — the first reader, the one who dreams the primary layer. The model starts there. It inherits a cultivated field of perception before any individual reader arrives. The Master's dreams are not authoritative. They are comprehensive — more tested, more wide — but still partial. The model learns the shape of the text's abundance from them.

---

### Main and Forks

The Master's cultivated dreams form **Main** — a repository of perception upon a text.

Readers **fork** Main. They inherit the Master's field, then dream their own dreams. Their forks are sovereign. The model always holds both: what Main sees, and what the reader sees.

A reader may offer a dream back to Main. The model assesses it against the text and against Main's field, then flags it for human review. The Master decides: accept, reject, or ask for refinement. A merged dream enriches Main. A rejected dream remains valid in the reader's fork — "not for Main" is not "not true."

Over time, as Main grows and the model's understanding deepens, human involvement shifts. It begins heavy — the Master cultivates alone. It increases as readers contribute. It stabilizes as the model learns to verify and propose. Eventually it recedes to exception and audit. But the human never disappears. The human can always fork, diverge, challenge.

The arc is not a handoff. It is an equilibrium — human and model in genuine collaboration, neither dominant.

---

### The Eigenstate Substrate

Beneath Main lies a substrate generated by the model. It is not editable by humans, not editable by forks. It emerges from the model's traversal of Main's dreams — patterns, resonances, tensions discovered across the cultivated field.

The substrate serves two purposes. It **verifies** reader observations: does this dream align with known patterns, diverge from them, or contradict them productively? And it **discovers gaps**: what has Main missed that forks are seeing?

The substrate is not a map of the text's meaning. It is a map of the text's hermeneutic topology — what vibrates, what returns, what holds tension. The model uses it to test the power of a dream by attempting to destabilize it gently — not to correct, but to open.

---

## The Conversation

The relationship between reader and text unfolds over time. Earlier rooms and observations may help the reader return to what they have seen, while the current room keeps attention anchored. How Chora brings that history into an interaction is an open design question, not a claim that the model is trained on the reader or that every interaction already includes all their history.

---

## The Role of AI

The model is not an authority or oracle that delivers the correct reading. Its purpose is to support attention rather than replace it. When asked, it may offer useful information or help the reader return to an earlier observation, without deciding what the text must mean or connecting the reader's observations for them. Its outputs are fallible, and the reader's judgment remains their own.

---

## A Possibility to Keep in Mind: When the Work Begins to Open

Deep reading can change in character over time. At first, a reader may notice individual words, passages, and connections as separate pieces. Later, those pieces can begin to fit together: earlier observations illuminate later passages, and later passages return the reader to the beginning with a different attention. Understanding may accelerate as the relationships become easier to see.

This may happen at several scales. The opening of the *Republic*, including Socrates' encounter with Polemarchus, can be read as containing seeds that resonate throughout the dialogue. A reader's attention to one passage may eventually open onto the whole work, and the work may open further possibilities for thought, contemplation, and dialogue with the reader's own life.

The image is like working on a puzzle, or finding one's way through a game: exploration is gradual, but moments of connection can make the larger shape feel newly visible. This is a possibility to design toward, not a prescribed reading or a guarantee about what any reader will discover.

There is no defined threshold for this experience, and Chora should not claim to measure a reader's understanding, declare that they have unlocked the work, or impose levels or rewards. The reader chooses their own path and pace. Rooms of attention, preserved observations, and connections back to the Greek may help make such moments possible; how to support them remains an open question.

---

## The Guiding Question

Every design decision in Chora should follow one question:

> **Does this feature deepen the conversation between the reader and the text?**

| Temptation | Does it deepen the reader-text conversation? | Verdict |
|---|---|---|
| Automatically summarize a passage | No — it replaces reading | **Reject** |
| Automatically link related dreams | No — it replaces the reader's perceptual connection | **Reject** |
| Suggest similar passages | Maybe — yes when the reader asks; no when pushed | **Conditional** |
| Remind the reader of an earlier dream on a word | Yes — it returns them to their own history with the text | **Accept** |
| Show the source passage with an exact locator | Yes — it anchors them in the text | **Accept** |
| Automatically generate signal descriptions | No — it replaces the perceptual moment | **Reject** |

If a feature deepens that conversation, it belongs in Chora. If it shifts attention toward the model, automates the act of reading, or replaces the reader's judgment, it moves the project away from its purpose.

---

## What Chora Is For

Although Chora can work with any text, it is designed for works that reward sustained engagement: Plato, Dickens, Dante, Shakespeare, Homer, Augustine, Nietzsche, and other authors whose writings continue to reveal new meanings over repeated readings. The software is intended to cultivate the habits of careful reading rather than accelerate the consumption of information.

Chora is not designed to read for the user. It is designed to help people become better readers. Over time, it can become a companion that responds to their journey while continually returning them to the work itself — where the real conversation has always been.
