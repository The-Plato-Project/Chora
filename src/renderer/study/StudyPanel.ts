import type { StudySource } from "../../shared/study/StudyTypes.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { StudyController } from "./StudyController.js";
import type { StudyStore } from "./StudyStore.js";

// Standard chat presentation; the open work and execution lifecycle belong to existing owners.
export class StudyPanel
{
	// The work is a read-only label, never a second context selector.
	private readonly work = document.createElement("span");
	// Retained scroll container for attributed conversation messages.
	private readonly transcript = document.createElement("div");
	// An idle invitation never starts retrieval or inference.
	private readonly empty = document.createElement("p");
	// Composer elements stay mounted through streaming and work changes.
	private readonly form = document.createElement("form");
	// Reader text uses the shared square, unchanging-focus input skin.
	private readonly input = document.createElement("textarea");
	// The only execution action needed to begin or continue a conversation.
	private readonly send = this.Button("Send", "send");
	// Cancellation is offered only while a response is in progress.
	private readonly stop = this.Button("Stop", "stop");
	// Inline activity and failure feedback stays outside message text.
	private readonly status = document.createElement("p");
	// Retrieved references are inspectable without overwhelming the conversation.
	private readonly sourceDetails = document.createElement("details");
	// Actual host-produced citations never come from parsing model commands.
	private readonly sources = document.createElement("div");
	// Keyed message bodies preserve their identities as chunks arrive.
	private readonly messageNodes: HTMLElement[] = [];
	// Delegated source actions resolve only known host-produced cards.
	private readonly sourceCards: StudySource[] = [];
	// Rebuilds source controls only when authoritative reference membership changes.
	private renderedSources: readonly StudySource[] | null = null;
	// Work navigation, rather than backend configuration, changes the displayed conversation.
	private renderedWorkId: string | null = null;
	// Feature subscriptions are released with the sidebar contribution.
	private readonly subscriptions: Unsubscribe[] = [];
	// Retained DOM listeners avoid per-render registration.
	private readonly click = this.HandleClick.bind(this);
	private readonly submit = this.HandleSubmit.bind(this);
	private readonly typing = this.HandleInput.bind(this);
	private readonly key = this.HandleKey.bind(this);

	// Uses the shared workspace host without taking responsibility for its dimensions.
	public constructor(private readonly root: HTMLElement, events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager, private readonly store: StudyStore, private readonly controller: StudyController)
	{
		root.classList.add("study-panel");
		const header = document.createElement("header");
		header.className = "study-header";
		const title = document.createElement("h2");
		title.className = "word-column-heading";
		title.textContent = "The Agentian Stranger";
		this.work.className = "study-work";
		header.append(title, this.work);
		this.transcript.className = "study-transcript";
		this.transcript.setAttribute("aria-label", "Conversation");
		this.empty.className = "study-empty";
		this.sourceDetails.className = "study-source-details";
		const summary = document.createElement("summary");
		summary.textContent = "Sources";
		this.sources.className = "study-sources";
		this.sourceDetails.append(summary, this.sources);
		this.sourceDetails.hidden = true;
		this.input.className = "control-input";
		this.input.rows = 3;
		this.input.maxLength = 8000;
		this.input.setAttribute("aria-label", "Message The Agentian Stranger");
		this.input.placeholder = "Find passages in this work…";
		this.form.className = "study-composer";
		const actions = document.createElement("div");
		actions.className = "study-actions";
		this.send.type = "submit";
		actions.append(this.send, this.stop);
		this.status.className = "study-status";
		this.status.setAttribute("role", "status");
		this.form.append(this.input, actions, this.status);
		root.append(header, this.empty, this.transcript, this.sourceDetails, this.form);
		root.addEventListener("click", this.click);
		this.form.addEventListener("submit", this.submit);
		this.input.addEventListener("input", this.typing);
		this.input.addEventListener("keydown", this.key);
		this.subscriptions.push(events.Subscribe("study.changed", this.Render.bind(this)));
		this.Render();
	}

	// Creates ordinary shared buttons without alternate control styling.
	private Button(text: string, action: string): HTMLButtonElement
	{
		const button = document.createElement("button");
		button.type = "button";
		button.className = "control-button button-control";
		button.textContent = text;
		button.dataset.studyAction = action;
		return button;
	}

	// Draft edits are local state changes and do not publish an application refresh.
	private HandleInput(): void
	{
		this.controller.SetDraft(this.input.value);
		this.send.disabled = this.store.GetSnapshot()?.busy !== false || this.input.value.trim().length === 0;
	}

	// Enter sends while Shift+Enter preserves ordinary multiline writing.
	private HandleKey(event: KeyboardEvent): void
	{
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !this.send.disabled)
		{
			event.preventDefault();
			this.form.requestSubmit();
		}
	}

	// Sending is the sole launch action; no separate preparation or start step exists.
	private HandleSubmit(event: SubmitEvent): void
	{
		event.preventDefault();
		if (!this.send.disabled) void this.controller.SendAsync(this.input.value);
	}

	// Delegates cancellation and validated source navigation.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>("[data-study-action]");
		if (button !== null && button !== undefined) void this.ActAsync(button);
	}

	// Routes only application-created controls to their workflow owner.
	private async ActAsync(button: HTMLButtonElement): Promise<void>
	{
		try
		{
			const action = button.dataset.studyAction;
			if (action === "stop") await this.controller.StopAsync();
			else if (action === "source")
			{
				const source = this.sourceCards[Number(button.dataset.sourceIndex)];
				if (source !== undefined) await this.controller.OpenSourceAsync(source);
			}
		}
		catch (error)
		{
			this.errors.Report("Interlocutor.Action", error, "The chat action could not be completed.");
		}
	}

	// Reconciles only the chat surface, retaining input focus and message nodes.
	private Render(): void
	{
		const state = this.store.GetSnapshot();
		const workId = state?.workId ?? null;
		if (this.renderedWorkId !== workId)
		{
			this.renderedWorkId = workId;
			this.transcript.replaceChildren();
			this.messageNodes.length = 0;
			this.sources.replaceChildren();
			this.sourceCards.length = 0;
			this.renderedSources = null;
		}
		this.work.textContent = state?.title ?? "";
		this.input.disabled = state === null;
		if (this.input.value !== (state?.draft ?? "")) this.input.value = state?.draft ?? "";
		this.send.disabled = state === null || state.busy || this.input.value.trim().length === 0;
		this.stop.hidden = state?.busy !== true;
		this.status.textContent = state?.status ?? "";
		this.status.hidden = this.status.textContent.length === 0;
		const messages = state?.conversation?.messages ?? [];
		while (this.messageNodes.length > messages.length)
		{
			const body = this.messageNodes.pop();
			body?.parentElement?.remove();
		}
		this.empty.hidden = messages.length > 0;
		this.empty.textContent = state === null ? "Open a work to begin." : "Find passages in " + state.title + ".";
		const atBottom = this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight < 48;
		for (let index = 0; index < messages.length; index += 1)
		{
			const message = messages[index]!;
			let body = this.messageNodes[index];
			if (body === undefined)
			{
				const article = document.createElement("article");
				const author = document.createElement("strong");
				author.textContent = message.role === "reader" ? "You" : "The Agentian Stranger";
				body = document.createElement("p");
				article.append(author, body);
				this.transcript.append(article);
				this.messageNodes.push(body);
			}
			const text = message.text + (message.status === "partial" && !state?.busy ? "\n[Incomplete response]" : "");
			if (body.textContent !== text) body.textContent = text;
		}
		if (atBottom) this.transcript.scrollTop = this.transcript.scrollHeight;
		const sources = state?.conversation?.sources ?? [];
		if (this.renderedSources !== sources)
		{
			this.sources.replaceChildren();
			this.sourceCards.length = 0;
			this.renderedSources = sources;
		}
		this.sourceDetails.hidden = sources.length === 0;
		for (let index = this.sourceCards.length; index < sources.length; index += 1)
		{
			const source = sources[index]!;
			let label: HTMLElement;
			if (source.selection === null)
			{
				label = document.createElement("strong");
				label.textContent = source.label;
			}
			else
			{
				const button = this.Button(source.label, "source");
				button.dataset.sourceIndex = String(index);
				label = button;
			}
			const excerpt = document.createElement("p");
			excerpt.textContent = source.excerpt;
			this.sources.append(label, excerpt);
			this.sourceCards.push(source);
		}
	}

	// Removes only the feature's own DOM and subscriptions.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.root.removeEventListener("click", this.click);
		this.form.removeEventListener("submit", this.submit);
		this.input.removeEventListener("input", this.typing);
		this.input.removeEventListener("keydown", this.key);
		this.root.replaceChildren();
	}
}
