import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { LayoutSettings } from "../core/settings/LayoutSettingsStore.js";

// Identifies the two resizable workspace side panes.
type ResizablePane = "left" | "dream";

// Owns workspace geometry, persisted pane dimensions, and Explorer collapse interaction.
export class WorkspaceLayoutPanel
{
	// Root event listeners retained for deterministic disposal.
	private readonly panelResizePointerDownHandler = this.HandlePanelResizePointerDown.bind(this);
	// Pointer-move listener installed only while a resize gesture is active.
	private readonly panelResizePointerMoveHandler = this.HandlePanelResizePointerMove.bind(this);
	// Pointer-up listener installed only while a resize gesture is active.
	private readonly panelResizePointerUpHandler = this.StopPanelResize.bind(this);
	// Rebalances dimensions after the native window changes size.
	private readonly windowResizeHandler = this.NormalizePanelWidths.bind(this);
	// Expands the sidebar in response to activity-bar selection.
	private readonly openSubscription: Unsubscribe;
	// Current local drag state; durable dimensions remain in LayoutSettings.
	private activeResizablePane: ResizablePane | null = null;
	// Initial pointer position for the current resize gesture.
	private resizeStartX = 0;
	// Initial pane dimension for the current resize gesture.
	private resizeStartWidth = 0;

	// Restores layout and registers the DOM interactions owned by this panel.
	public constructor(private readonly root: HTMLElement, events: ChoraEventBus<ChoraEvents>)
	{
		this.ApplyPersistedLayout();
		this.NormalizePanelWidths();
		root.addEventListener("pointerdown", this.panelResizePointerDownHandler);
		const openSidebar = this.ExpandLeftPane.bind(this);
		this.openSubscription = events.Subscribe("workspace.sidebar-open-requested", openSidebar);
		window.addEventListener("resize", this.windowResizeHandler);
	}

	// Persists the final gesture state and releases every registered listener.
	public Dispose(): void
	{
		this.StopPanelResize();
		this.root.removeEventListener("pointerdown", this.panelResizePointerDownHandler);
		this.openSubscription();
		window.removeEventListener("resize", this.windowResizeHandler);
	}

	// Begins tracking a pane-resize drag started from a resize handle.
	private HandlePanelResizePointerDown(event: PointerEvent): void
	{
		const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-pane]");
		const pane = handle?.dataset.resizePane;
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const panel = pane === "left"
			? this.root.querySelector<HTMLElement>(".left-panel")
			: this.root.querySelector<HTMLElement>(".right-panel");

		if ((pane === "left" || pane === "dream") && shell !== null && panel !== null)
		{
			event.preventDefault();
			handle?.classList.add("is-active");
			this.activeResizablePane = pane;
			this.resizeStartX = event.clientX;
			this.resizeStartWidth = panel.getBoundingClientRect().width;
			shell.classList.add("is-resizing");
			window.addEventListener("pointermove", this.panelResizePointerMoveHandler);
			window.addEventListener("pointerup", this.panelResizePointerUpHandler, { once: true });
		}
	}

	// Resizes the dragged pane, clamped so both the reader and the other pane stay usable.
	private HandlePanelResizePointerMove(event: PointerEvent): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");

		if (shell !== null && leftPanel !== null && this.activeResizablePane !== null)
		{
			const shellWidth = shell.getBoundingClientRect().width;
			const delta = event.clientX - this.resizeStartX;
			const leftWidth = leftPanel.getBoundingClientRect().width;
			const isDreamOpen = shell.classList.contains("dream-open");
			const compactLayout = shellWidth <= 760;
			const minimumLeftWidth = compactLayout ? 170 : 180;
			const minimumDreamWidth = this.GetMinimumDreamWidth(shellWidth);
			const minimumReaderWidth = compactLayout ? 220 : 320;
			let width = this.resizeStartWidth + delta;

			if (this.activeResizablePane === "left")
			{
				const isCollapsed = shell.classList.contains("left-collapsed");

				if (isCollapsed && delta > 0)
				{
					shell.classList.remove("left-collapsed");
					shell.style.setProperty("--left-pane-width", `${minimumLeftWidth}px`);
					this.resizeStartX = event.clientX;
					this.resizeStartWidth = minimumLeftWidth;
				}
				else if (width < 140)
				{
					this.CollapseLeftPane(shell);
				}
				else
				{
					shell.classList.remove("left-collapsed");
					const maximumWidth = shellWidth - minimumReaderWidth - (isDreamOpen ? minimumDreamWidth : 0);
					const clampedWidth = Math.max(minimumLeftWidth, Math.min(width, maximumWidth));
					shell.style.setProperty("--left-pane-width", `${clampedWidth}px`);
				}
			}

			else
			{
				const maximumWidth = shellWidth - leftWidth - minimumReaderWidth;
				width = Math.max(minimumDreamWidth, Math.min(width, maximumWidth));
				shell.style.setProperty("--dream-pane-width", `${width}px`);
			}
		}
	}

	// Keeps all three workspace columns visible after a native-window resize.
	private NormalizePanelWidths(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");
		const dreamPanel = this.root.querySelector<HTMLElement>(".right-panel");

		if (shell !== null && leftPanel !== null && dreamPanel !== null && !shell.classList.contains("left-collapsed"))
		{
			const shellWidth = shell.getBoundingClientRect().width;
			if (shellWidth > 0)
			{
				const compactLayout = shellWidth <= 760;
				const minimumLeftWidth = compactLayout ? 170 : 180;
				const minimumDreamWidth = this.GetMinimumDreamWidth(shellWidth);
				const minimumReaderWidth = compactLayout ? 220 : 320;
				const maximumLeftWidth = shellWidth - minimumReaderWidth;
				const leftWidth = Math.max(minimumLeftWidth, Math.min(leftPanel.getBoundingClientRect().width, maximumLeftWidth));
				const maximumDreamWidth = shellWidth - leftWidth - minimumReaderWidth;
				const requestedDreamWidth = Number.parseFloat(shell.style.getPropertyValue("--dream-pane-width"));
				const availableDreamWidth = Math.max(0, maximumDreamWidth);
				const dreamMinimum = Math.min(minimumDreamWidth, availableDreamWidth);
				const dreamWidth = Math.max(dreamMinimum, Math.min(requestedDreamWidth, availableDreamWidth));
				shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
				shell.style.setProperty("--dream-pane-width", `${dreamWidth}px`);
			}
		}
	}

	// Restores durable workspace widths and Explorer collapse state before feature panels mount.
	private ApplyPersistedLayout(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const leftPanel = this.root.querySelector<HTMLElement>(".left-panel");
		const editorPanel = this.root.querySelector<HTMLElement>(".right-panel");

		if (shell !== null && leftPanel !== null && editorPanel !== null)
		{
			const leftWidth = LayoutSettings.GetDimension("leftPaneWidth", leftPanel.getBoundingClientRect().width);
			const minimumEditorWidth = this.GetMinimumDreamWidth(window.innerWidth);
			const defaultEditorWidth = Math.min(1100, Math.max(minimumEditorWidth, window.innerWidth * 0.46));
			const storedEditorWidth = LayoutSettings.GetDimension("editorPaneWidth", defaultEditorWidth);
			const editorWidth = Math.max(minimumEditorWidth, storedEditorWidth);
			shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
			shell.style.setProperty("--dream-pane-width", `${editorWidth}px`);
			if (LayoutSettings.GetExplorerCollapsed()) this.CollapseLeftPane(shell);
		}
	}

	// Returns enough horizontal space for the Dream editor's Signal navigation and detail columns.
	private GetMinimumDreamWidth(shellWidth: number): number
	{
		let minimumWidth = Math.min(1050, Math.max(520, shellWidth * 0.42));
		if (shellWidth <= 1000) minimumWidth = 420;
		if (shellWidth <= 760) minimumWidth = 280;
		return minimumWidth;
	}

	// Leaves workspace navigation accessible when the left pane is collapsed.
	private CollapseLeftPane(shell: HTMLElement): void
	{
		shell.style.setProperty("--left-collapsed-width", "90px");
		shell.classList.add("left-collapsed");
		LayoutSettings.SetExplorerCollapsed(true);
	}

	// Restores the Explorer and focuses the requested workspace folder.
	private ExpandLeftPane(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");

		if (shell !== null)
		{
			shell.classList.remove("left-collapsed");
			const currentWidth = Number.parseFloat(shell.style.getPropertyValue("--left-pane-width"));
			if (!Number.isFinite(currentWidth) || currentWidth < 180) shell.style.setProperty("--left-pane-width", "180px");
			const restoredWidth = Number.parseFloat(shell.style.getPropertyValue("--left-pane-width"));
			LayoutSettings.SetExplorerCollapsed(false);
			LayoutSettings.SetDimension("leftPaneWidth", restoredWidth);
		}
	}

	// Ends a pane-resize drag and releases its pointer listeners.
	private StopPanelResize(): void
	{
		const shell = this.root.querySelector<HTMLElement>(".shell");
		this.activeResizablePane = null;
		window.removeEventListener("pointermove", this.panelResizePointerMoveHandler);
		window.removeEventListener("pointerup", this.panelResizePointerUpHandler);
		shell?.classList.remove("is-resizing");
		const handles = this.root.querySelectorAll<HTMLElement>(".panel-resize-handle.is-active");
		for (const handle of Array.from(handles)) handle.classList.remove("is-active");
		const leftWidth = this.root.querySelector<HTMLElement>(".left-panel")?.getBoundingClientRect().width;
		const editorWidth = this.root.querySelector<HTMLElement>(".right-panel")?.getBoundingClientRect().width;
		if (leftWidth !== undefined && !shell?.classList.contains("left-collapsed")) LayoutSettings.SetDimension("leftPaneWidth", leftWidth);
		if (editorWidth !== undefined) LayoutSettings.SetDimension("editorPaneWidth", editorWidth);
	}
}
