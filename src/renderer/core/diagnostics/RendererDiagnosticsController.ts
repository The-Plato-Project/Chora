import type { ApiSubscription } from "../../../shared/contracts/ChoraApi.js";
import type { ErrorManager } from "./RendererErrorManager.js";

// Owns renderer diagnostic lifecycle and global exception capture separately from application layout.
export class RendererDiagnosticsController
{
	// Bound global handlers removed on disposal.
	private readonly rendererErrorHandler = this.HandleRendererError.bind(this);
	// Bound promise rejection handler removed on disposal.
	private readonly rejectionHandler = this.HandleUnhandledRejection.bind(this);
	// Main-process notification subscription, or null before startup.
	private unsubscribe: ApiSubscription | null = null;

	// Uses the existing diagnostic authority rather than creating a second logger.
	public constructor(private readonly errors: ErrorManager)
	{
	}

	// Attaches process notifications and browser exception listeners once.
	public Start(): void
	{
		if (this.unsubscribe === null)
		{
			this.unsubscribe = window.chora.SubscribeDiagnostics(this.errors.Receive.bind(this.errors));
			window.addEventListener("error", this.rendererErrorHandler);
			window.addEventListener("unhandledrejection", this.rejectionHandler);
		}
	}

	// Detaches all diagnostic listeners when the application stops.
	public Dispose(): void
	{
		this.unsubscribe?.();
		this.unsubscribe = null;
		window.removeEventListener("error", this.rendererErrorHandler);
		window.removeEventListener("unhandledrejection", this.rejectionHandler);
	}

	// Captures unexpected renderer exceptions without losing their technical causes.
	private HandleRendererError(event: ErrorEvent): void
	{
		this.errors.Report("Renderer.UnhandledError", event.error ?? new Error(event.message), "An unexpected application error occurred. Your current work should be checked.");
	}

	// Captures unhandled promise rejection once through the same reporting mechanism.
	private HandleUnhandledRejection(event: PromiseRejectionEvent): void
	{
		event.preventDefault();
		this.errors.Report("Renderer.UnhandledRejection", event.reason, "A background operation could not finish. Check your current work before trying again.");
	}

}
