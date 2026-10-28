import { ErrorNotificationPanel } from "../core/diagnostics/ErrorNotificationPanel.js";
import { RendererDiagnosticsController } from "../core/diagnostics/RendererDiagnosticsController.js";
import { DreamTrashController } from "../dreams/DreamTrashController.js";
import { DreamTrashPanel } from "../dreams/DreamTrashPanel.js";
import "../styles.css";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { LibraryController } from "../library/LibraryController.js";
import { LibraryGateway } from "../library/LibraryGateway.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DreamController } from "../dreams/DreamController.js";
import { DreamGateway } from "../dreams/DreamGateway.js";
import { DreamStore } from "../dreams/DreamStore.js";
import { DocumentPanel } from "../library/DocumentPanel.js";
import { DreamPanel } from "../dreams/DreamPanel.js";
import { DreamPassagePanel } from "../dreams/DreamPassagePanel.js";
import { SessionStore } from "../core/session/SessionStore.js";
import { SignalController } from "../signals/SignalController.js";
import { SignalGateway } from "../signals/SignalGateway.js";
import { LookupStore } from "../library/lookup/LookupStore.js";
import { LookupGateway } from "../library/lookup/LookupGateway.js";
import { LookupController } from "../library/lookup/LookupController.js";
import { LookupPanel } from "../library/lookup/LookupPanel.js";
import { WorkspacePanel } from "../workspace/WorkspacePanel.js";
import { DreamExplorerController } from "../workspace/DreamExplorerController.js";

import { DreamSaveCoordinator } from "../dreams/DreamSaveCoordinator.js";
import { DreamCatalogueController } from "../dreams/DreamCatalogueController.js";
import { DreamClarityCheckController } from "../dreams/DreamClarityCheckController.js";
import { DreamExportController } from "../dreams/DreamExportController.js";
import { WorkspaceController } from "../workspace/WorkspaceController.js";
import { WorkspaceShellPanel } from "../workspace/WorkspaceShellPanel.js";
import { WorkspaceLayoutPanel } from "../workspace/WorkspaceLayoutPanel.js";
import { ReadingAppearancePanel } from "../workspace/ReadingAppearancePanel.js";
import type { EventHandlerFailure } from "../core/events/ChoraEventBus.js";
import { ReadingSettingsStore } from "../core/settings/ReadingSettingsStore.js";

// Composes renderer feature owners and their lifecycles without implementing layout or feature workflows.
export class ChoraApplication
{
	// Owned feature lifetimes, disposed in reverse composition order.
	private readonly disposables: Array<{ Dispose(): void }> = [];
	// Guards the application lifecycle against repeated startup.
	private isStarted = false;
	// Guards the application lifecycle against repeated disposal.
	private isDisposed = false;
	// Shared typed renderer event bus.
	private readonly events = new ChoraEventBus<ChoraEvents>();
	// Shared diagnostic reporting authority.
	private readonly errors = new ErrorManager(this.events);
	// Session persistence boundary for open Dream drafts.
	private readonly sessions = new SessionStore();
	// Sole Dream editing and catalogue state owner.
	private readonly dreamStore = new DreamStore(this.sessions);
	// Sole Library reading state owner.
	private readonly libraryStore = new LibraryStore();
	// Library IPC boundary shared by reading and export workflows.
	private readonly libraryGateway = new LibraryGateway();
	// Canonical Library workflows.
	private readonly library = new LibraryController(this.events, this.errors, this.libraryStore, this.libraryGateway, this.dreamStore);
	// Signal persistence IPC boundary.
	private readonly signalGateway = new SignalGateway();
	// Dream-owned Signal editing workflows.
	private readonly signals = new SignalController(this.errors, this.dreamStore, this.libraryStore, this.signalGateway, this.events);
	// Dream persistence IPC boundary shared by the feature workflow owners.
	private readonly dreamGateway = new DreamGateway();
	// Save timing, persistence ordering, and revision checks.
	private readonly saves = new DreamSaveCoordinator(this.events, this.errors, this.dreamStore, this.dreamGateway);
	// Dream editing and tab lifecycle.
	private readonly dreams = new DreamController(this.events, this.errors, this.libraryStore, this.dreamStore, this.dreamGateway, this.libraryGateway, this.saves);
	// Clarity Check request lifecycle and result application.
	private readonly clarity = new DreamClarityCheckController(this.events, this.errors, this.libraryStore, this.dreamStore, this.dreamGateway, this.saves);
	// Catalogue reads, reconciliation, filtering, and grouping.
	private readonly catalogue = new DreamCatalogueController(this.events, this.errors, this.libraryStore, this.dreamStore, this.dreamGateway, this.saves, this.clarity);
	// Explorer creation, organization, and folder workflows.
	private readonly explorer = new DreamExplorerController(this.dreamStore, this.libraryStore, this.dreamGateway, this.events, this.errors, this.catalogue, this.signals);
	// Export commands using the existing Markdown formatter.
	private readonly exports = new DreamExportController(this.dreamStore, this.libraryStore, this.libraryGateway);
	// Persisted reading appearance preferences.
	private readonly settings = new ReadingSettingsStore();
	// Dictionary state authority.
	private readonly lookupStore = new LookupStore();
	// Dictionary IPC boundary.
	private readonly lookupGateway = new LookupGateway();
	// Dictionary workflows.
	private readonly lookup = new LookupController(this.events, this.lookupStore, this.lookupGateway, this.errors);

	// Registers shared error policy and the lifetimes of composed workflow owners.
	public constructor(private readonly root: HTMLElement)
	{
		this.events.SetErrorHandler(this.HandleEventFailure.bind(this));
		this.disposables.push(this.saves, this.dreams, this.clarity, this.catalogue, this.explorer, this.lookup);
	}

	// Mounts feature-owned DOM surfaces and starts the composed workflows in dependency order.
	public async StartAsync(): Promise<void>
	{
		if (!this.isStarted && !this.isDisposed)
		{
			this.isStarted = true;
			const shell = new WorkspaceShellPanel(this.root, this.events);
			this.disposables.push(shell);
			const roots = shell.GetRoots();
			this.disposables.push(new ReadingAppearancePanel(this.root, this.settings));
			this.disposables.push(new WorkspaceLayoutPanel(this.root, this.events));
			this.disposables.push(new LookupPanel(roots.lookup, this.events, this.lookupStore, this.lookup));
			this.disposables.push(new DocumentPanel(roots.document, this.events, this.libraryStore, this.library, this.settings));
			this.disposables.push(new DreamPassagePanel(roots.document, this.events, this.libraryStore, this.catalogue));
			this.disposables.push(new DreamPanel(roots.dream, this.events, this.dreamStore, this.dreams, this.libraryStore, "editor", this.catalogue, this.saves, this.clarity, this.exports, this.explorer, this.signals));
			const trashController = new DreamTrashController(this.dreamGateway, this.catalogue, this.errors);
			const trashPanel = new DreamTrashPanel(trashController);
			this.disposables.push(trashPanel);
			this.disposables.push(new WorkspacePanel(roots.explorer, roots.tabs, this.events, this.dreamStore, this.dreams, this.libraryStore, this.explorer, trashPanel, this.saves, this.exports));
			this.disposables.push(new ErrorNotificationPanel(this.events));
			const diagnostics = new RendererDiagnosticsController(this.errors);
			diagnostics.Start();
			this.disposables.push(diagnostics);
			const workspace = new WorkspaceController(this.events, this.dreamStore, this.libraryStore, this.library, this.libraryGateway, this.catalogue, this.saves, this.explorer);
			workspace.Start();
			this.disposables.push(workspace);
			await this.lookup.StartAsync();
			const loaded = await this.catalogue.RefreshAsync();
			if (loaded) await this.dreams.StartAsync();
			await this.library.StartAsync();
			this.errors.Info("ChoraApplication", "Application started.");
		}
	}

	// Disposes the composition in reverse order before flushing the remaining Dream session state.
	public Dispose(): void
	{
		if (!this.isDisposed)
		{
			this.isDisposed = true;
			for (const disposable of [...this.disposables].reverse()) disposable.Dispose();
			this.disposables.length = 0;
			this.dreamStore.Dispose();
		}
	}

	// Routes failures in application event delivery into the existing shared diagnostic policy.
	private HandleEventFailure(failure: EventHandlerFailure): void
	{
		this.errors.Report("ChoraEventBus", failure.error, `Something went wrong while handling ${String(failure.eventName)}.`);
	}
}

// Starts one renderer composition when its DOM host becomes available.
function StartRenderer(): void
{
	const root = document.getElementById("app");
	if (root !== null)
	{
		const application = new ChoraApplication(root);
		// Disposes the composed renderer once the native page unloads.
		function DisposeRenderer(): void
		{
			application.Dispose();
		}
		window.addEventListener("beforeunload", DisposeRenderer, { once: true });
		void application.StartAsync();
	}
}

window.addEventListener("DOMContentLoaded", StartRenderer);
