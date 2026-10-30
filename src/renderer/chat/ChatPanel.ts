import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { AvailableModel } from "../../shared/models/ModelSelection.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChatController } from "./ChatController.js";
import { ChatStore } from "./ChatStore.js";

// Embeddable chat surface with a persistent composer and safe text-only transcript.
export class ChatPanel
{
	// Persistent root mounted by any feature panel.
	public readonly Root = document.createElement("section");
	// Scrollable message region independent of the composer.
	private readonly history = document.createElement("div");
	// Reader-owned draft input.
	private readonly composer = document.createElement("textarea");
	// Available provider/model choices.
	private readonly picker = document.createElement("select");
	// Explicit Send or Stop control.
	private readonly send = document.createElement("button");
	// Quiet progress and failure feedback.
	private readonly status = document.createElement("p");
	// Resolved catalogue used to translate picker indices into identities.
	private models: readonly AvailableModel[] = [];
	// Prevents a disposed feature from presenting delayed results.
	private disposed = false;
	// Loads the conversation once when its owning tab becomes visible.
	private started = false;
	// Delegated explicit retry listener.
	private readonly retryHandler = this.HandleRetry.bind(this);
	// Delegated form listener retained for cleanup.
	private readonly submitHandler = this.HandleSubmitAsync.bind(this);
	// Draft listener retained for cleanup.
	// Enter sends; Shift+Enter preserves multiline composition.
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	private readonly inputHandler = this.HandleInput.bind(this);
	// Model listener retained for cleanup.
	private readonly modelHandler = this.HandleModelChange.bind(this);
	// Conversation behavior stays separate from DOM.
	private readonly controller: ChatController;

	// Feature callbacks are the only integration needed to mount reusable Chat.
	public constructor(id: string, store: ChatStore, private readonly errors: ErrorManager, private readonly prepare: () => Promise<boolean>, private readonly selection: () => TextSelection | null)
	{
		this.controller = new ChatController(store, id);
		this.Root.className = "chat-panel";
		this.history.className = "chat-history";
		this.history.setAttribute("role", "log");
		this.history.setAttribute("aria-label", "Chora SI conversation");
		this.composer.className = "chat-composer";
		this.composer.placeholder = "Message Chora SI…";
		this.composer.setAttribute("aria-label", "Message");
		this.composer.maxLength = 16000;
		this.composer.value = store.Draft;
		this.picker.setAttribute("aria-label", "Model for the next reply");
		this.send.type = "submit";
		this.send.textContent = "Send";
		const form = document.createElement("form");
		form.className = "chat-form";
		const controls = document.createElement("div");
		controls.className = "chat-controls";
		controls.append(this.picker, this.send);
		form.append(this.composer, controls);
		this.status.className = "chat-status";
		this.status.setAttribute("role", "status");
		this.Root.append(this.history, form, this.status);
		form.addEventListener("submit", this.submitHandler);
		this.composer.addEventListener("input", this.inputHandler);
		this.composer.addEventListener("keydown", this.keyHandler);
		this.picker.addEventListener("change", this.modelHandler);
		this.send.disabled = true;
		this.history.addEventListener("click", this.retryHandler);
		this.UpdateControls();
	}

	// Starts history loading only after the embedding feature selects this surface.
	public Start(): void
	{
		if (!this.started)
		{
			this.started = true;
			void this.OpenAsync();
		}
	}

	// Releases UI listeners without abandoning a persisted in-flight turn.
	public Dispose(): void
	{
		this.disposed = true;
		this.history.removeEventListener("click", this.retryHandler);
		this.Root.querySelector("form")?.removeEventListener("submit", this.submitHandler);
		this.composer.removeEventListener("input", this.inputHandler);
		this.composer.removeEventListener("keydown", this.keyHandler);
		this.picker.removeEventListener("change", this.modelHandler);
		this.Root.remove();
	}

	// Restores conversation state and builds a picker without rebuilding the composer.
	private async OpenAsync(): Promise<void>
	{
		this.status.textContent = "Loading conversation…";
		try
		{
			this.models = await this.controller.OpenAsync();
			if (!this.disposed)
			{
				this.picker.replaceChildren();
				for (let index = 0; index < this.models.length; index++)
				{
					const model = this.models[index]!;
					const option = document.createElement("option");
					option.value = String(index);
					option.textContent = model.label;
					option.selected = model.provider === this.controller.Store.Model?.provider && model.model === this.controller.Store.Model?.model;
					this.picker.append(option);
				}
				const available = this.models.some(this.IsSelectedModel.bind(this));
				if (!available)
				{
					this.picker.selectedIndex = -1;
					this.controller.Store.Model = null;
				}
				this.status.textContent = available ? "" : "Choose an available model to continue.";
				this.composer.value = this.controller.Store.Draft;
				this.RenderHistory();
				this.UpdateControls();
			}
		}
		catch (error)
		{
			if (!this.disposed)
			{
				this.status.textContent = "The conversation could not be loaded. Reopen this tab to retry.";
				this.errors.Report("ChatPanel", error, "The conversation could not be loaded.");
			}
		}
	}

	// Compares catalogue identities without relying on display labels.
	private IsSelectedModel(model: AvailableModel): boolean
	{
		const selected = model.provider === this.controller.Store.Model?.provider && model.model === this.controller.Store.Model?.model;
		return selected;
	}

	// Captures the draft synchronously so later renders never overwrite user typing.
	private HandleInput(): void
	{
		this.controller.Store.Draft = this.composer.value;
		this.UpdateControls();
	}

	// Submits plain Enter without intercepting IME composition or multiline entry.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229)
		{
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat && !this.controller.Store.Busy && !this.send.disabled)
			{
				this.Root.querySelector<HTMLFormElement>("form")?.requestSubmit();
			}
		}
	}

	// Changes only the model used by subsequent turns.
	private HandleModelChange(): void
	{
		this.controller.Store.Model = this.models[Number(this.picker.value)] ?? null;
		this.UpdateControls();
	}

	// Saves feature edits before sending and preserves the draft on every failure.
	private async HandleSubmitAsync(event: Event): Promise<void>
	{
		event.preventDefault();
		try
		{
			if (this.controller.Store.Busy)
			{
				await this.controller.CancelAsync();
				this.status.textContent = "Stopping…";
			}
			else if (this.composer.value.trim().length > 0 && this.controller.Store.Model !== null)
			{
				const selection = this.selection();
				this.controller.Store.Draft = this.composer.value;
				const sending = this.controller.SendAsync(selection, this.prepare);
				this.composer.value = this.controller.Store.Draft;
				this.RenderHistory();
				this.status.textContent = "Thinking with your Dream and Signals…";
				this.UpdateControls();
				await sending;
				if (!this.disposed)
				{
					this.composer.value = this.controller.Store.Draft;
					this.status.textContent = "";
					this.RenderHistory();
					this.composer.focus();
				}
			}
		}
		catch (error)
		{
			if (!this.disposed)
			{
				this.RenderHistory();
				this.composer.value = this.controller.Store.Draft;
				this.status.textContent = "The message did not complete. Press Send to retry.";
				this.errors.Report("ChatPanel", error, "The chat response could not be completed. Your draft has been retained.");
			}
		}
		finally
		{
			if (!this.disposed) this.UpdateControls();
		}
	}

	// Renders untrusted messages as text, preserving paragraphs without executing HTML.
	private RenderHistory(): void
	{
		this.history.replaceChildren();
		const messages = this.controller.Store.Snapshot?.messages ?? [];
		for (const message of messages)
		{
			const article = document.createElement("article");
			article.className = `chat-message chat-message-${message.role}`;
			const speaker = document.createElement("h4");
			speaker.textContent = message.role === "user" ? "You" : "Chora SI";
			const content = document.createElement("div");
			content.className = "chat-message-content";
			content.textContent = message.content || (message.status === "completed" ? "" : `Response ${message.status}.`);
			article.append(speaker, content);
			if (message.role === "assistant" && ["failed", "cancelled", "interrupted"].includes(message.status))
			{
				const retry = document.createElement("button");
				retry.type = "button";
				retry.className = "chat-retry";
				retry.dataset.retryTurn = message.turnId;
				retry.textContent = "Retry this message";
				article.append(retry);
			}
			this.history.append(article);
		}
		const pending = this.controller.Store.Pending;
		if (pending !== null && !messages.some(function Acknowledged(message): boolean { return message.id === pending.id; }))
		{
			const article = document.createElement("article");
			article.className = "chat-message chat-message-user";
			const speaker = document.createElement("h4");
			speaker.textContent = pending.status === "failed" ? "You · Not sent" : "You";
			const content = document.createElement("div");
			content.className = "chat-message-content";
			content.textContent = pending.content;
			article.append(speaker, content);
			this.history.append(article);
		}
		this.history.scrollTop = this.history.scrollHeight;
	}

	// Restores an interrupted turn for explicit resubmission without duplicating its user message.
	private HandleRetry(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const turnId = target?.closest<HTMLButtonElement>("[data-retry-turn]")?.dataset.retryTurn;
		const messages = this.controller.Store.Snapshot?.messages ?? [];
		const message = messages.find(function Match(candidate): boolean { return candidate.turnId === turnId && candidate.role === "user"; });
		if (message !== undefined && !this.controller.Store.Busy)
		{
			this.controller.Store.Draft = message.content;
			this.controller.Store.RequestId = message.id;
			this.controller.Store.RequestContent = message.content;
			this.composer.value = message.content;
			this.status.textContent = "Press Send to retry this message.";
			this.UpdateControls();
			this.composer.focus();
		}
	}

	// Keeps Stop available during requests while protecting the submitted draft.
	private UpdateControls(): void
	{
		const busy = this.controller.Store.Busy;
		this.send.textContent = busy ? "Stop" : "Send";
		this.send.disabled = !busy && (this.controller.Store.Model === null || this.composer.value.trim().length === 0);
		this.composer.disabled = busy;
		this.picker.disabled = busy;
		this.Root.setAttribute("aria-busy", String(busy));
	}
}
