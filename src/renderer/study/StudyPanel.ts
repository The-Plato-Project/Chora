import type { StudyScope, StudySource } from "../../shared/study/StudyTypes.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { StudyController } from "./StudyController.js";
import type { StudyStore } from "./StudyStore.js";

// Persistent, geometry-independent interlocutor surface using the shared control styles.
export class StudyPanel
{
	// Controls retain their DOM identities throughout streamed responses.
	private readonly context = document.createElement("fieldset");
	// Displays the captured work and saved-writing scope.
	private readonly contextTitle = document.createElement("p");
	// Hosts explicit opt-in choices for saved Visions.
	private readonly choices = document.createElement("div");
	// Controls explicit attachment of the captured Greek selection.
	private readonly selection = document.createElement("input");
	// Presents the supported deliberate local-model choices.
	private readonly model = document.createElement("select");
	// Launches execution only after the reader chooses context.
	private readonly start = this.Button("Start local conversation", "start");
	// Ends the runtime and revokes evidence access.
	private readonly stop = this.Button("Stop", "stop");
	// Opens passive saved history without replaying a turn.
	private readonly history = this.Button("View last conversation", "history");
	// Communicates execution availability independently of transcript content.
	private readonly status = document.createElement("p");
	// Hosts retained attributed message nodes.
	private readonly transcript = document.createElement("div");
	// Hosts navigation cards produced from actual retrieved evidence.
	private readonly sources = document.createElement("div");
	// Retains unsent reader text across streaming updates.
	private readonly input = document.createElement("textarea");
	// Submits a reader contribution to the captured conversation.
	private readonly send = this.Button("Send", "send");
	// Keeps existing message DOM stable while new chunks arrive.
	private readonly messageNodes: HTMLElement[] = [];
	// Maps delegated navigation actions to host-produced references.
	private readonly sourceCards: StudySource[] = [];
	// Retains explicitly captured context independently of workspace navigation.
	private scope: StudyScope | null = null;
	// Rejects updates belonging to a retired conversation.
	private conversationId: string | null = null;
	// Releases the owned feature subscription.
	private readonly unsubscribe: () => void;
	// Retains one delegated action listener for the panel lifetime.
	private readonly click = this.HandleClick.bind(this);
	// The panel handles presentation; all execution and context access belongs to the controller.
	public constructor(private readonly root: HTMLElement, events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager, private readonly store: StudyStore, private readonly controller: StudyController)
	{
		root.classList.add("study-panel");
		const heading = document.createElement("h2");
		heading.className = "word-column-heading";
		heading.textContent = "The Athenian Stranger";
		const description = document.createElement("p");
		description.textContent = "Give The Athenian Stranger a specific task or question about this work or your selected Visions. Your writing provides guidance; it is not permission for independent interpretation. Your documents remain unchanged.";
		const legend = document.createElement("legend");
		legend.textContent = "Conversation context";
		const choose = this.Button("Choose current work", "context");
		this.contextTitle.textContent = "No work chosen. Save your writing before choosing Visions.";
		this.choices.className = "study-context-choices";
		this.selection.type = "checkbox";
		this.selection.disabled = true;
		const selectionLabel = document.createElement("label");
		selectionLabel.append(this.selection, document.createTextNode(" Attach the selected Greek passage"));
		const modelLabel = document.createElement("label");
		modelLabel.className = "control-field";
		modelLabel.textContent = "Local Ollama model";
		this.model.className = "control-input";
		for (const name of ["qwen3.5:9b", "qwen3.5:4b"])
		{
			const option = document.createElement("option");
			option.value = name;
			option.textContent = name;
			this.model.append(option);
		}
		modelLabel.append(this.model);
		this.context.append(legend, choose, this.contextTitle, this.choices, selectionLabel, modelLabel, this.start);
		this.status.setAttribute("role", "status");
		this.status.className = "study-status";
		this.transcript.className = "study-transcript";
		this.transcript.setAttribute("aria-label", "Conversation");
		this.sources.className = "study-sources";
		const inputLabel = document.createElement("label");
		inputLabel.className = "control-field";
		inputLabel.textContent = "Your task or question";
		this.input.className = "control-input";
		this.input.rows = 4;
		this.input.maxLength = 8000;
		this.input.placeholder = "For example: Find where my selected Visions discuss time, and show the relevant excerpts.";
		inputLabel.append(this.input);
		const actions = document.createElement("div");
		actions.className = "study-actions";
		actions.append(this.send, this.stop, this.history);
		root.append(heading, description, this.context, this.status, this.transcript, this.sources, inputLabel, actions);
		root.addEventListener("click", this.click);
		this.unsubscribe = events.Subscribe("study.changed", this.Render.bind(this));
		this.Render();
	}

	// Uses the same square application button skin as existing feature panels.
	private Button(text: string, action: string): HTMLButtonElement
	{
		const button = document.createElement("button");
		button.type = "button";
		button.className = "control-button button-control";
		button.textContent = text;
		button.dataset.studyAction = action;
		return button;
	}

	// Delegates user actions once, without new listeners on each chunk.
	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>("button[data-study-action]");
		if (button !== undefined && button !== null) void this.ActAsync(button);
	}

	// Captures explicit context choices independently of subsequent workspace navigation.
	private async ActAsync(button: HTMLButtonElement): Promise<void>
	{
		try
		{
			const action = button.dataset.studyAction;
			if (action === "context") this.ChooseContext();
			else if (action === "start" && this.scope !== null)
			{
				const ids: string[] = [];
				const checked = this.choices.querySelectorAll<HTMLInputElement>("input:checked");
				const choices = Array.from(checked);
				for (const choice of choices) ids.push(choice.value);
				const scope = { ...this.scope, visionIds: ids, selection: this.selection.checked ? this.scope.selection : null };
				const model = this.model.value === "qwen3.5:4b" ? "qwen3.5:4b" : "qwen3.5:9b";
				await this.controller.StartAsync(scope, model);
			}
			else if (action === "send")
			{
				const text = this.input.value;
				if (text.trim().length > 0)
				{
					this.input.value = "";
					await this.controller.SendAsync(text);
				}
			}
			else if (action === "stop") await this.controller.StopAsync();
			else if (action === "history") await this.controller.LoadAsync();
			else if (action === "source")
			{
				const source = this.sourceCards[Number(button.dataset.sourceIndex)];
				if (source !== undefined) await this.controller.OpenSourceAsync(source);
			}
		}
		catch (error)
		{
			this.errors.Report("Interlocutor.Action", error, "The requested interlocutor action could not be completed.");
		}
	}

	// Offers saved documents without granting any of them access by default.
	private ChooseContext(): void
	{
		const options = this.controller.CaptureContext();
		this.scope = options.scope;
		this.contextTitle.textContent = `${options.title}. Choose saved Visions to share; unchecked Visions and unsaved drafts are excluded.`;
		this.choices.replaceChildren();
		for (const vision of options.visions)
		{
			const label = document.createElement("label");
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.value = vision.id;
			label.append(checkbox, document.createTextNode(` ${vision.title}`));
			this.choices.append(label);
		}
		this.selection.disabled = options.scope.selection === null;
		this.selection.checked = false;
		this.Render();
	}

	// Updates retained message nodes only; editor, lookup and input DOM remain untouched.
	private Render(): void
	{
		const state = this.store.GetSnapshot();
		this.status.textContent = state.status;
		this.context.disabled = state.busy;
		this.start.disabled = this.scope === null || state.busy;
		this.stop.disabled = !state.connected && !state.busy;
		this.history.disabled = state.connected || state.busy;
		this.send.disabled = !state.connected || state.busy;
		if (this.conversationId !== (state.conversation?.id ?? null))
		{
			this.conversationId = state.conversation?.id ?? null;
			this.transcript.replaceChildren();
			this.messageNodes.length = 0;
			this.sources.replaceChildren();
			this.sourceCards.length = 0;
		}
		const messages = state.conversation?.messages ?? [];
		for (let index = 0; index < messages.length; index += 1)
		{
			const message = messages[index]!;
			let body = this.messageNodes[index];
			if (body === undefined)
			{
				const article = document.createElement("article");
				const author = document.createElement("strong");
				author.textContent = message.role === "reader" ? "You" : "The Athenian Stranger";
				body = document.createElement("p");
				article.append(author, body);
				this.transcript.append(article);
				this.messageNodes.push(body);
			}
			const text = message.text + (message.status === "partial" && !state.busy ? "\n[Incomplete response]" : "");
			if (body.textContent !== text) body.textContent = text;
		}
		const sources = state.conversation?.sources ?? [];
		for (let index = this.sourceCards.length; index < sources.length; index += 1)
		{
			const source = sources[index]!;
			if (index === 0)
			{
				const heading = document.createElement("h3");
				heading.textContent = "Retrieved sources";
				this.sources.append(heading);
			}
			const button = this.Button(source.label, "source");
			button.dataset.sourceIndex = String(index);
			const excerpt = document.createElement("p");
			excerpt.textContent = source.excerpt;
			this.sources.append(button, excerpt);
			this.sourceCards.push(source);
		}
	}

	// Releases only the feature surface; host geometry remains owned by the workspace.
	public Dispose(): void
	{
		this.unsubscribe();
		this.root.removeEventListener("click", this.click);
		this.root.replaceChildren();
	}
}
