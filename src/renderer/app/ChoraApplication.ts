import { TextAnchorGateway } from "../anchors/TextAnchorGateway.js";
import { ErrorNotificationPanel } from "../core/diagnostics/ErrorNotificationPanel.js";
import { RendererDiagnosticsController } from "../core/diagnostics/RendererDiagnosticsController.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus, type EventHandlerFailure } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ReadingSettingsStore } from "../core/settings/ReadingSettingsStore.js";
import { ApplicationState } from "./ApplicationState.js";
import { DocumentPanel } from "../library/DocumentPanel.js";
import { LibraryController } from "../library/LibraryController.js";
import { LibraryGateway } from "../library/LibraryGateway.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { WordExplorationController } from "../library/words/WordExplorationController.js";
import { WordExplorationGateway } from "../library/words/WordExplorationGateway.js";
import { WordExplorationPanel } from "../library/words/WordExplorationPanel.js";
import { WordExplorationStore } from "../library/words/WordExplorationStore.js";
import { WordVisionReferenceController } from "../library/words/WordVisionReferenceController.js";
import { WordVisionReferenceStore } from "../library/words/WordVisionReferenceStore.js";
import "../styles.css";
import { DocumentIcon, SearchIcon, TextQuoteIcon } from "../ui/Icons.js";
import { StudyController } from "../study/StudyController.js";
import { StudyGateway } from "../study/StudyGateway.js";
import { StudyStore } from "../study/StudyStore.js";
import { StudySettingsStore } from "../study/StudySettingsStore.js";
import { ReadingAppearanceGateway } from "../workspace/ReadingAppearanceGateway.js";
import { StudyPanel } from "../study/StudyPanel.js";
import { WordSearchPanel } from "../library/words/WordSearchPanel.js";
import { VisionController } from "../visions/VisionController.js";
import { VisionGateway } from "../visions/VisionGateway.js";
import { VisionPanel } from "../visions/VisionPanel.js";
import { VisionReferenceController } from "../visions/VisionReferenceController.js";
import { VisionStore } from "../visions/VisionStore.js";
import { ReadingAppearancePanel } from "../workspace/ReadingAppearancePanel.js";
import { VisionTabsPanel } from "../workspace/VisionTabsPanel.js";
import { WorkspaceLayoutPanel } from "../workspace/WorkspaceLayoutPanel.js";
import { WorkspacePanel } from "../workspace/WorkspacePanel.js";
import { WorkspaceShellPanel } from "../workspace/WorkspaceShellPanel.js";
import { ApplicationMenuController } from "../workspace/ApplicationMenuController.js";
import { ApplicationMenuGateway } from "../workspace/ApplicationMenuGateway.js";
import { WorkspaceSidebar, type WorkspaceSidebarExtension } from "../workspace/WorkspaceSidebar.js";

export class ChoraApplication
{
	private readonly disposables: Array<{ Dispose(): void }> = [];
	private isStarted = false;
	private isDisposed = false;
	private readonly events = new ChoraEventBus<ChoraEvents>();
	private readonly errors = new ErrorManager(this.events);
	private readonly visionStore = new VisionStore();
	private readonly libraryStore = new LibraryStore();
	private readonly libraryGateway = new LibraryGateway();
	private readonly visionGateway = new VisionGateway();
	private readonly visions = new VisionController(this.events, this.errors, this.visionStore, this.visionGateway);
	private readonly library = new LibraryController(this.events, this.errors, this.libraryStore, this.libraryGateway);
	private readonly settings = new ReadingSettingsStore();
	private readonly wordStore = new WordExplorationStore();
	private readonly wordGateway = new WordExplorationGateway();
	private readonly words = new WordExplorationController(this.events, this.errors, this.libraryStore, this.library, this.wordStore, this.wordGateway);
	private readonly state = new ApplicationState(this.events, this.errors, this.libraryStore, this.library,
		this.visionStore, this.visions, this.wordStore, this.words);
	private readonly anchorGateway = new TextAnchorGateway();
	// Optional interlocutor state has no subscriptions to editor typing.
	private readonly studyStore = new StudyStore();
	private readonly studyGateway = new StudyGateway();
	// Application-wide inference preferences are separate from the chat composer.
	private readonly studySettings = new StudySettingsStore();
	private readonly study = new StudyController(this.events, this.errors, this.studyStore, this.studyGateway,
		this.libraryStore, this.visionStore, this.studySettings);
	private readonly visionReferences = new VisionReferenceController(this.events, this.errors, this.visionStore, this.anchorGateway, this.libraryStore);
	private readonly wordVisionReferenceStore = new WordVisionReferenceStore();
	private readonly wordVisionReferences = new WordVisionReferenceController(
		this.events,
		this.errors,
		this.wordStore,
		this.visionStore,
		this.anchorGateway,
		this.libraryStore,
		this.wordVisionReferenceStore);

	public constructor(private readonly root: HTMLElement)
	{
		this.events.SetErrorHandler(this.HandleEventFailure.bind(this));
		this.disposables.push(this.words, this.visions, this.visionReferences, this.wordVisionReferences, this.state, this.study);
	}

	public async StartAsync(): Promise<void>
	{
		if (!this.isStarted && !this.isDisposed)
		{
			this.isStarted = true;
			const menuGateway = new ApplicationMenuGateway();
			const menu = new ApplicationMenuController(this.events, menuGateway);
			this.disposables.push(menu);
			const shell = new WorkspaceShellPanel(this.root, this.events);
			this.disposables.push(shell);
			const roots = shell.GetRoots();
			this.disposables.push(new ReadingAppearancePanel(this.settings, this.events, this.errors, new ReadingAppearanceGateway(), this.studySettings));
			this.disposables.push(new WorkspaceLayoutPanel(this.root, this.events));
			this.disposables.push(new DocumentPanel(roots.document, this.events, this.libraryStore, this.library));
			this.disposables.push(new VisionPanel(roots.vision, this.events, this.errors, this.visionStore, this.visions));
			const application = this;
			function MountExplorer(explorerRoot: HTMLElement): WorkspacePanel
			{
				return new WorkspacePanel(
					explorerRoot,
					application.events,
					application.libraryStore,
					application.visionStore,
					application.visions);
			}
			function MountWordSearch(searchRoot: HTMLElement): WordSearchPanel
			{
				return new WordSearchPanel(searchRoot, application.events, application.wordStore, application.words);
			}
			// Mounting the optional surface does not enable or launch its backend.
			function MountStudy(studyRoot: HTMLElement): StudyPanel
			{
				const panel = new StudyPanel(studyRoot, application.events, application.errors, application.studyStore, application.study);
				return panel;
			}
			const extensions: readonly WorkspaceSidebarExtension[] = [
				{ id: "explorer", title: "Explorer", icon: DocumentIcon, Mount: MountExplorer },
				{ id: "word-search", title: "Word Search", icon: SearchIcon, Mount: MountWordSearch },
				{ id: "interlocutor", title: "The Agentian Stranger", icon: TextQuoteIcon, Mount: MountStudy }
			];
			this.disposables.push(new WorkspaceSidebar(roots.sidebarRail, roots.sidebarHost, this.events, extensions));
			this.disposables.push(new WordExplorationPanel(
				roots.words,
				this.events,
				this.wordStore,
				this.words,
				this.wordVisionReferenceStore));
			this.disposables.push(new VisionTabsPanel(roots.tabs, this.events, this.visionStore, this.visions));
			this.disposables.push(new ErrorNotificationPanel(this.events));
			const diagnostics = new RendererDiagnosticsController(this.errors);
			diagnostics.Start();
			this.disposables.push(diagnostics);
			await this.state.RestoreAsync();
			this.errors.Info("ChoraApplication", "Application started.");
		}
	}

	public Dispose(): void
	{
		if (!this.isDisposed)
		{
			this.isDisposed = true;
			for (const disposable of [...this.disposables].reverse()) disposable.Dispose();
			this.disposables.length = 0;
		}
	}

	private HandleEventFailure(failure: EventHandlerFailure): void
	{
		this.errors.Report("ChoraEventBus", failure.error, `Something went wrong while handling ${String(failure.eventName)}.`);
	}
}

function StartRenderer(): void
{
	const root = document.getElementById("app");
	if (root !== null)
	{
		const application = new ChoraApplication(root);
		function DisposeRenderer(): void
		{
			application.Dispose();
		}
		window.addEventListener("beforeunload", DisposeRenderer, { once: true });
		void application.StartAsync();
	}
}

window.addEventListener("DOMContentLoaded", StartRenderer);
