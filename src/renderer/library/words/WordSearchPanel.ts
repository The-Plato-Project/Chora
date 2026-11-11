import type { ChoraEventBus, Unsubscribe } from "../../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import { ListViewControl, type ListViewItem } from "../../ui/controls/ListViewControl.js";
import type { WordExplorationController } from "./WordExplorationController.js";
import type { WordExplorationStore } from "./WordExplorationStore.js";

// Owns the search sidebar DOM; lexical state and requests stay in the word feature.
export class WordSearchPanel
{
	// Persistent controls keep input focus and keyboard selection through async updates.
	private readonly form = document.createElement("form");
	private readonly input = document.createElement("input");
	private readonly status = document.createElement("p");
	private readonly list: ListViewControl;
	private readonly unsubscribe: Unsubscribe;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly inputHandler = this.HandleInput.bind(this);
	private readonly submitHandler = this.HandleSubmit.bind(this);

	// Uses shared list rows and existing workspace hosting, with no geometry knowledge.
	public constructor(private readonly root: HTMLElement, private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly store: WordExplorationStore, private readonly controller: WordExplorationController)
	{
		root.classList.add("word-search-panel");
		const heading = document.createElement("h2");
		heading.className = "word-column-heading";
		heading.textContent = "Word Search";
		const label = document.createElement("label");
		label.className = "control-field";
		const title = document.createElement("span");
		title.textContent = "Greek word";
		this.input.type = "search";
		this.input.className = "control-input";
		this.input.lang = "grc";
		this.input.maxLength = 100;
		this.input.autocomplete = "off";
		this.input.spellcheck = false;
		this.input.placeholder = "e.g. πρός";
		label.append(title, this.input);
		const button = document.createElement("button");
		button.type = "submit";
		button.className = "control-button button-control";
		button.textContent = "Search";
		this.form.append(label, button);
		this.status.setAttribute("role", "status");
		this.status.className = "word-search-status";
		this.list = new ListViewControl("Greek headwords", this.HandleSelectedAsync.bind(this), true);
		root.append(heading, this.form, this.status, this.list.Root);
		this.input.addEventListener("input", this.inputHandler);
		this.form.addEventListener("submit", this.submitHandler);
		this.unsubscribe = events.Subscribe("word.lexical-search-changed", this.Render.bind(this));
		this.Render();
	}

	// Debounces only the request; text input remains immediate.
	private HandleInput(): void
	{
		this.CancelTimer();
		this.controller.SetLexicalQuery(this.input.value);
		if (this.input.value.trim().length > 0) this.timer = setTimeout(this.Search.bind(this), 350);
	}

	private HandleSubmit(event: SubmitEvent): void
	{
		event.preventDefault();
		this.CancelTimer();
		this.Search();
	}

	private Search(): void
	{
		this.timer = null;
		void this.controller.SearchLexiconAsync();
	}

	// Selecting a result requests a normal lookup tab through the typed application bus.
	private async HandleSelectedAsync(lemma: string | null): Promise<void>
	{
		if (lemma !== null) await this.events.PublishAsync("word.lemma-open-requested", { lemma });
	}

	private Render(): void
	{
		const state = this.store.GetLexicalSearch();
		if (this.input.value !== state.query) this.input.value = state.query;
		this.form.setAttribute("aria-busy", String(state.loading));
		const items: ListViewItem[] = [];
		for (const item of state.result?.items ?? []) items.push({ Id: item.lemma, Text: item.lemma, Language: "grc" });
		this.list.SetItems(items);
		let message = "Enter a Greek word, then choose a headword.";
		if (state.loading) message = "Searching…";
		else if (state.error.length > 0) message = state.error;
		else if (state.result !== null)
		{
			message = items.length === 0 ? "No matching headwords were returned." : `${items.length} matching headwords.`;
			if (state.result.possiblyTruncated) message += " Type more letters to narrow the results.";
			if (state.result.warnings.length > 0) message += " Results may be incomplete.";
		}
		this.status.textContent = message;
	}

	private CancelTimer(): void
	{
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	public Dispose(): void
	{
		this.CancelTimer();
		this.unsubscribe();
		this.input.removeEventListener("input", this.inputHandler);
		this.form.removeEventListener("submit", this.submitHandler);
		this.list.Dispose();
		this.root.replaceChildren();
	}
}
