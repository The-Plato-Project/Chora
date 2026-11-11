import type { ErrorManager } from "../../core/diagnostics/RendererErrorManager.js";
import { CloseIcon } from "../Icons.js";

// Content and commit boundary for a standard application dialog.
export interface DialogRequest
{
	// Reader-facing question or form title.
	readonly Title: string;
	// Feature-owned content mounted inside the dialog form.
	readonly Content: HTMLElement | string;
	// Commits the feature action; false keeps the dialog open for correction or retry.
	readonly CommitAsync?: () => boolean | Promise<boolean>;
	// Failure copy displayed without discarding the current input.
	readonly FailureMessage?: string;
	// Control or selector to focus initially; confirmations default to Cancel.
	readonly InitialFocus?: HTMLElement | string;
	// Whether OK can initially commit the request.
	readonly CanCommit?: boolean;
	// Original invocation control restored after dismissal.
	readonly Trigger?: HTMLElement | null;
	// Receives the completed dialog outcome once.
	readonly Closed?: (accepted: boolean) => void;
}

// Owns accessible modal behavior, Cancel/OK, pending commits, and focus restoration.
export class DialogControl
{
	// Stable native modal root; the browser owns focus trapping and inert background content.
	public readonly Root = document.createElement("dialog");
	// Feature content, scoped to this instance rather than document-wide selectors.
	public readonly Content = document.createElement("fieldset");
	// Associates the heading with its dialog.
	private static nextId = 0;
	// Persistent form owns Enter submission and native input validation.
	private readonly form = document.createElement("form");
	// Shared title element.
	private readonly heading = document.createElement("h2");
	// Standard confirmation button, independent of the feature action name.
	private readonly ok = document.createElement("button");
	// Standard cancellation button.
	private readonly cancel = document.createElement("button");
	// Header dismissal is equivalent to Cancel.
	private readonly close = document.createElement("button");
	// Local failure feedback retained beside the current draft.
	private readonly error = document.createElement("p");
	// Current request; null after a completed dismissal.
	private request: DialogRequest | null = null;
	// Focus origin captured before entering the modal top layer.
	private trigger: HTMLElement | null = null;
	// Prevents duplicate commits and cancellation during an in-flight action.
	private busy = false;
	// Commit availability independent of pending work.
	private canCommit = true;
	// Prevents asynchronous completion from reopening disposed DOM.
	private disposed = false;
	// Retained root listeners.
	private readonly submitHandler = this.HandleSubmitAsync.bind(this);
	private readonly cancelHandler = this.HandleCancel.bind(this);
	private readonly nativeCloseHandler = this.HandleNativeClose.bind(this);
	private readonly dismissHandler = this.Cancel.bind(this);
	// Prevents background application shortcuts from acting through a modal form.
	private readonly keyHandler = this.HandleKeyDown.bind(this);

	// Mounts one reusable modal using the application's diagnostic boundary.
	public constructor(private readonly errors: ErrorManager)
	{
		DialogControl.nextId += 1;
		this.Root.className = "dialog-control control-window";
		this.Root.hidden = true;
		this.Root.setAttribute("aria-modal", "true");
		this.heading.id = `chora-dialog-${DialogControl.nextId}`;
		this.Root.setAttribute("aria-labelledby", this.heading.id);
		const header = document.createElement("header");
		header.className = "control-window-header";
		this.close.type = "button";
		this.close.className = "control-window-close button-control";
		this.close.setAttribute("aria-label", "Cancel");
		this.close.innerHTML = CloseIcon;
		header.append(this.heading, this.close);
		this.Content.className = "dialog-content";
		this.error.className = "control-error";
		this.error.setAttribute("role", "alert");
		this.error.hidden = true;
		const actions = document.createElement("footer");
		actions.className = "dialog-actions";
		this.cancel.type = "button";
		this.cancel.className = "control-button button-control";
		this.cancel.dataset.dialogCancel = "";
		this.cancel.textContent = "Cancel";
		this.ok.type = "submit";
		this.ok.className = "control-button button-control";
		this.ok.dataset.dialogOk = "";
		this.ok.textContent = "OK";
		actions.append(this.cancel, this.ok);
		this.form.append(this.Content, this.error, actions);
		this.Root.append(header, this.form);
		document.body.append(this.Root);
		this.form.addEventListener("submit", this.submitHandler);
		this.cancel.addEventListener("click", this.dismissHandler);
		this.close.addEventListener("click", this.dismissHandler);
		this.Root.addEventListener("cancel", this.cancelHandler);
		this.Root.addEventListener("close", this.nativeCloseHandler);
		this.Root.addEventListener("keydown", this.keyHandler);
	}

	// Reports whether this instance owns an open request.
	public get IsOpen(): boolean
	{
		const open = this.request !== null;
		return open;
	}

	// Opens content without invoking or committing the feature action.
	public Open(request: DialogRequest): void
	{
		if (!this.busy && !this.disposed)
		{
			this.Cancel();
			this.request = request;
			this.trigger = request.Trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
			this.heading.textContent = request.Title;
			if (typeof request.Content === "string")
			{
				this.Content.innerHTML = request.Content;
			}
			else
			{
				this.Content.replaceChildren(request.Content);
			}
			this.SetError("");
			this.canCommit = request.CanCommit ?? true;
			this.SetBusy(false);
			this.Root.hidden = false;
			this.Root.showModal();
			const focus = typeof request.InitialFocus === "string"
				? this.Content.querySelector<HTMLElement>(request.InitialFocus)
				: request.InitialFocus;
			const initial = focus ?? this.cancel;
			initial.focus({ preventScroll: true });
		}
	}

	// Enables confirmation only when a feature has a valid selection or draft.
	public SetCanCommit(enabled: boolean): void
	{
		this.canCommit = enabled;
		this.ok.disabled = this.busy || !enabled;
	}

	// Displays local validation or operation feedback without replacing the content.
	public SetError(message: string): void
	{
		this.error.textContent = message;
		this.error.hidden = message.length === 0;
	}

	// Dismisses a pending request without performing its action.
	public Cancel(): void
	{
		if (!this.busy)
		{
			this.Finish(false);
		}
	}

	// Releases native modal state and listeners, including while work completes later.
	public Dispose(): void
	{
		this.disposed = true;
		this.Finish(false);
		this.form.removeEventListener("submit", this.submitHandler);
		this.cancel.removeEventListener("click", this.dismissHandler);
		this.close.removeEventListener("click", this.dismissHandler);
		this.Root.removeEventListener("cancel", this.cancelHandler);
		this.Root.removeEventListener("close", this.nativeCloseHandler);
		this.Root.removeEventListener("keydown", this.keyHandler);
		this.Root.remove();
	}

	// Commits once, retaining the draft when validation or persistence rejects it.
	private async HandleSubmitAsync(event: SubmitEvent): Promise<void>
	{
		event.preventDefault();
		const request = this.request;
		if (request !== null && !this.busy && this.canCommit && this.form.reportValidity())
		{
			this.SetError("");
			this.SetBusy(true);
			try
			{
				const accepted = request.CommitAsync === undefined ? true : await request.CommitAsync();
				if (!this.disposed && this.request === request)
				{
					if (accepted)
					{
						this.Finish(true);
					}
					else
					{
						this.SetError(request.FailureMessage ?? "The action could not be completed. Your input has been retained.");
					}
				}
			}
			catch (error)
			{
				if (!this.disposed)
				{
					const diagnostic = this.errors.Describe("DialogControl.Commit", error, request.FailureMessage ?? "The action could not be completed. Your input has been retained.");
					this.SetError(`${diagnostic.userMessage} Diagnostic reference: ${diagnostic.id}`);
				}
			}
			finally
			{
				this.SetBusy(false);
				if (!this.disposed && this.request === request)
				{
					this.ok.focus({ preventScroll: true });
				}
			}
		}
	}

	// Disables all draft controls and dismissal until a commit outcome is known.
	private SetBusy(busy: boolean): void
	{
		this.busy = busy;
		this.Content.disabled = busy;
		this.ok.disabled = busy || !this.canCommit;
		this.cancel.disabled = busy;
		this.close.disabled = busy;
		this.form.setAttribute("aria-busy", String(busy));
	}

	// Keeps Escape equivalent to Cancel and prevents native dismissal during commit.
	private HandleCancel(event: Event): void
	{
		event.preventDefault();
		this.Cancel();
	}

	// Handles platform dismissal without publishing a second outcome.
	private HandleNativeClose(): void
	{
		if (!this.Root.open)
		{
			this.Finish(false);
		}
	}

	// Lets native form and modal defaults run while isolating workspace shortcuts.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		event.stopPropagation();
	}

	// Completes one request and restores its invocation focus before notifying its owner.
	private Finish(accepted: boolean): void
	{
		const request = this.request;
		if (request !== null)
		{
			this.request = null;
			if (this.Root.open)
			{
				this.Root.close();
			}
			this.Root.hidden = true;
			if (this.trigger?.isConnected)
			{
				this.trigger.focus({ preventScroll: true });
			}
			this.trigger = null;
			request.Closed?.(accepted);
		}
	}
}
