import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
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
	// Expands the Explorer when its collapsed rail is clicked.
	private readonly expandHandler = this.HandleExpand.bind(this);
	// Current local drag state; durable dimensions remain in LayoutSettings.
	private activeResizablePane: ResizablePane | null = null;
	// Initial pointer position for the current resize gesture.
	private resizeStartX = 0;
	// Initial pane dimension for the current resize gesture.
	private resizeStartWidth = 0;

	// Restores layout and registers the DOM interactions owned by this panel.
	public constructor(private readonly root: HTMLElement, private readonly events: ChoraEventBus<ChoraEvents>)
	{
		this.ApplyPersistedLayout();
		this.NormalizePanelWidths();
		root.addEventListener("pointerdown", this.panelResizePointerDownHandler);
		root.addEventListener("click", this.expandHandler);
		window.addEventListener("resize", this.windowResizeHandler);
	}

	// Persists the final gesture state and releases every registered listener.
	public Dispose(): void
	{
		this.StopPanelResize();
		this.root.removeEventListener("pointerdown", this.panelResizePointerDownHandler);
		this.root.removeEventListener("click", this.expandHandler);
		window.removeEventListener("resize", this.windowResizeHandler);
	}

	// Routes only the Explorer-rail expansion interaction.
	private HandleExpand(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		if (target !== null && target.closest("[data-expand-explorer='dream']") !== null) this.ExpandLeftPane();
	}

	// Begins tracking a pane-resize drag started from a resize handle.
	private HandlePanelResizePointerDown(event: PointerEvent): void
	{
		const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize-pane]");
		const pane = handle?.dataset.resizePane;
		const shell = this.root.querySelector<HTMLElement>(".shell");
		const panel = pane === "left" ? this.root.querySelector<HTMLElement>(".left-panel") : this.root.querySelector<HTMLElement>(".right-panel");

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
			const minimumDreamWidth = compactLayout ? 240 : 300;
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
			const compactLayout = shellWidth <= 760;
			const minimumLeftWidth = compactLayout ? 170 : 180;
			const minimumDreamWidth = compactLayout ? 240 : 300;
			const minimumReaderWidth = compactLayout ? 220 : 320;
			const maximumLeftWidth = shellWidth - minimumDreamWidth - minimumReaderWidth;
			const leftWidth = Math.max(minimumLeftWidth, Math.min(leftPanel.getBoundingClientRect().width, maximumLeftWidth));
			const maximumDreamWidth = shellWidth - leftWidth - minimumReaderWidth;
			const dreamWidth = Math.max(minimumDreamWidth, Math.min(dreamPanel.getBoundingClientRect().width, maximumDreamWidth));
			shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
			shell.style.setProperty("--dream-pane-width", `${dreamWidth}px`);
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
			const editorWidth = LayoutSettings.GetDimension("editorPaneWidth", editorPanel.getBoundingClientRect().width);
			shell.style.setProperty("--left-pane-width", `${leftWidth}px`);
			shell.style.setProperty("--dream-pane-width", `${editorWidth}px`);
			if (LayoutSettings.GetExplorerCollapsed()) this.CollapseLeftPane(shell);
		}
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
			void this.events.PublishAsync("workspace.dreams-focus-requested", {});
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
