import type { SplitViewState } from "../../core/settings/LayoutSettingsStore.js";

// Describes an attached content surface without exposing layout to that content.
export interface SplitPaneOptions
{
	// Stable identity used only by the composition owner and saved layout.
	readonly Id: string;
	// Accessible name for the host and its divider.
	readonly Label: string;
	// Feature-owned root, attached without adding any layout dependency to its owner.
	readonly Content: HTMLElement;
	// Preferred expanded extent before optional fill or proportional shrinking.
	readonly Size?: number;
	// Receives spare room after the other expanded panes reach their preferred sizes.
	readonly Fill?: boolean;
	// Availability is independent of the saved collapse choice.
	readonly Visible?: boolean;
	// Initial collapse choice when no saved state exists.
	readonly Collapsed?: boolean;
}

// Shared layout policy and a durable-state notification for a row or column group.
export interface SplitViewOptions
{
	// The same interaction model applies on either axis.
	readonly Direction: "rows" | "columns";
	// Previously saved geometry; the control never mutates this snapshot.
	readonly State?: SplitViewState | null;
	// Notification emitted only after committed layout interactions.
	readonly Changed?: (state: SplitViewState) => void;
	// Optional container width at which a column group becomes a row group.
	readonly StackAt?: number;
}

// Private host state; the attached feature retains ownership of its own lifetime.
interface SplitPane
{
	readonly Options: SplitPaneOptions;
	readonly Host: HTMLElement;
	Size: number;
	Rendered: number;
	Collapsed: boolean;
	Visible: boolean;
}

// One divider and the adjacent content hosts it resizes.
interface SplitBoundary
{
	readonly Root: HTMLElement;
	readonly Before: SplitPane;
	readonly After: SplitPane;
}

// Captured pointer state allows Escape and pointer cancellation to undo a gesture.
interface SplitDrag
{
	readonly PointerId: number;
	readonly Boundary: SplitBoundary;
	readonly Start: number;
	readonly Before: number;
	readonly Total: number;
	readonly State: SplitViewState;
}

// Composes arbitrary content into nested rows/columns with one resize and collapse policy.
export class SplitViewControl
{
	// A collapsed pane occupies no content space; its adjacent divider stays reachable.
	private static readonly CollapseThreshold = 32;
	// Small expanded panes remain usable without imposing feature-specific minimum widths.
	private static readonly MinimumSize = 48;
	// Matches the separator thickness defined by split-view.css.
	private static readonly DividerSize = 6;
	// Unique accessibility identities do not depend on feature keys or tab identities.
	private static nextPaneId = 0;
	// Stable host which can itself be attached to another split view.
	public readonly Root: HTMLElement;
	// Attached content and generated dividers in display order.
	private readonly panes: SplitPane[] = [];
	private readonly boundaries: SplitBoundary[] = [];
	// Observes actual available space, including nested views and status-bar changes.
	private readonly observer: ResizeObserver;
	// Orientation after optional narrow-container stacking.
	private direction: "rows" | "columns";
	// Current drag, independent of the attached feature's events.
	private drag: SplitDrag | null = null;
	// Retained listeners released with the view.
	private readonly downHandler = this.HandlePointerDown.bind(this);
	private readonly moveHandler = this.HandlePointerMove.bind(this);
	private readonly upHandler = this.HandlePointerUp.bind(this);
	private readonly cancelHandler = this.HandlePointerCancel.bind(this);
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	private readonly doubleClickHandler = this.HandleDoubleClick.bind(this);

	// Adopts an optional empty composition host; feature content is attached separately.
	public constructor(private readonly options: SplitViewOptions, root?: HTMLElement)
	{
		this.Root = root ?? document.createElement("div");
		this.Root.classList.add("split-view");
		this.direction = options.Direction;
		this.Root.dataset.splitDirection = this.direction;
		this.Root.addEventListener("pointerdown", this.downHandler);
		this.Root.addEventListener("keydown", this.keyHandler);
		this.Root.addEventListener("dblclick", this.doubleClickHandler);
		this.Root.addEventListener("lostpointercapture", this.cancelHandler);
		this.observer = new ResizeObserver(this.Layout.bind(this));
		this.observer.observe(this.Root);
	}

	// Attaches another row/column without changing its content, events, or controller.
	public AddPane(options: SplitPaneOptions): void
	{
		this.CancelDrag();
		if (this.FindPane(options.Id) !== undefined)
		{
			throw new Error(`Duplicate split pane: ${options.Id}`);
		}
		const saved = this.options.State?.[options.Id];
		const host = document.createElement("div");
		SplitViewControl.nextPaneId += 1;
		host.id = `split-pane-${SplitViewControl.nextPaneId}`;
		host.className = "split-pane";
		host.setAttribute("role", "region");
		host.setAttribute("aria-label", options.Label);
		host.dataset.splitPane = options.Id;
		host.append(options.Content);
		const pane: SplitPane = { Options: options, Host: host, Size: saved?.Size ?? options.Size ?? 240,
			Rendered: 0, Collapsed: saved?.Collapsed ?? options.Collapsed ?? false, Visible: options.Visible ?? true };
		this.panes.push(pane);
		this.RebuildBoundaries();
	}

	// Detaches a surface without disposing the feature that supplied it.
	public RemovePane(id: string): void
	{
		const pane = this.FindPane(id);
		if (pane !== undefined)
		{
			this.CancelDrag();
			const index = this.panes.indexOf(pane);
			this.panes.splice(index, 1);
			pane.Options.Content.remove();
			pane.Host.remove();
			this.RebuildBoundaries();
			this.Publish();
		}
	}

	// Availability is transient; closing a document does not discard its remembered size.
	public SetPaneVisible(id: string, visible: boolean): void
	{
		const pane = this.FindPane(id);
		if (pane !== undefined && pane.Visible !== visible)
		{
			this.CancelDrag();
			pane.Visible = visible;
			this.RebuildBoundaries();
		}
	}

	// Restores the last expanded size without rebuilding the attached content.
	public SetPaneCollapsed(id: string, collapsed: boolean): void
	{
		const pane = this.FindPane(id);
		if (pane !== undefined && pane.Collapsed !== collapsed)
		{
			if (collapsed)
			{
				pane.Size = pane.Rendered || pane.Size;
				pane.Collapsed = true;
			}
			else
			{
				this.RestorePane(pane);
			}
			this.Layout();
			this.Publish();
		}
	}

	// Provides a defensive snapshot suitable for durable storage.
	public GetState(): SplitViewState
	{
		const state: Record<string, { Size: number; Collapsed: boolean }> = {};
		for (const pane of this.panes)
		{
			state[pane.Options.Id] = { Size: pane.Size, Collapsed: pane.Collapsed };
		}
		return state;
	}

	// Releases layout resources without invoking or disposing attached feature owners.
	public Dispose(): void
	{
		this.CancelDrag();
		this.observer.disconnect();
		this.Root.removeEventListener("pointerdown", this.downHandler);
		this.Root.removeEventListener("keydown", this.keyHandler);
		this.Root.removeEventListener("dblclick", this.doubleClickHandler);
		this.Root.removeEventListener("lostpointercapture", this.cancelHandler);
		this.Root.replaceChildren();
		this.panes.length = 0;
		this.boundaries.length = 0;
	}

	// Reconciles dividers only when membership/availability changes; content nodes survive.
	private RebuildBoundaries(): void
	{
		for (const boundary of this.boundaries)
		{
			boundary.Root.remove();
		}
		this.boundaries.length = 0;
		let previous: SplitPane | undefined;
		for (const pane of this.panes)
		{
			pane.Host.hidden = !pane.Visible;
			if (pane.Visible && previous !== undefined)
			{
				const divider = document.createElement("div");
				divider.className = "split-divider";
				divider.dataset.splitBefore = previous.Options.Id;
				divider.dataset.splitAfter = pane.Options.Id;
				divider.setAttribute("role", "separator");
				divider.setAttribute("aria-controls", `${previous.Host.id} ${pane.Host.id}`);
				divider.setAttribute("aria-label", `Resize ${previous.Options.Label} and ${pane.Options.Label}`);
				divider.title = "Drag to resize or collapse. Double-click or Enter to restore. Home/End collapse either side.";
				divider.tabIndex = 0;
				this.boundaries.push({ Root: divider, Before: previous, After: pane });
				this.Root.append(divider);
			}
			this.Root.append(pane.Host);
			if (pane.Visible)
			{
				previous = pane;
			}
		}
		this.Layout();
	}

	// Rebalances actual available space; no feature imposes a growing minimum width.
	private Layout(): void
	{
		const width = this.Root.clientWidth || this.Root.getBoundingClientRect().width;
		this.direction = this.options.StackAt !== undefined && width > 0 && width <= this.options.StackAt
			? "rows" : this.options.Direction;
		this.Root.dataset.splitDirection = this.direction;
		const bounds = this.Root.getBoundingClientRect();
		const extent = this.direction === "columns" ? width : this.Root.clientHeight || bounds.height;
		const available = Math.max(0, extent - this.boundaries.length * SplitViewControl.DividerSize);
		const expanded = this.panes.filter(function Expanded(pane): boolean
		{
			return pane.Visible && !pane.Collapsed;
		});
		const fill = expanded.find(function Fills(pane): boolean
		{
			return pane.Options.Fill === true;
		}) ?? expanded.at(-1);
		let preferred = 0;
		for (const pane of expanded)
		{
			preferred += Math.max(SplitViewControl.MinimumSize, pane.Size);
		}
		const shrinking = preferred > available;
		const minimum = Math.min(SplitViewControl.MinimumSize, available / Math.max(1, expanded.length));
		const reserved = minimum * expanded.length;
		const weight = preferred - reserved;
		const factor = weight > 0 ? Math.max(0, available - reserved) / weight : 0;
		let consumed = 0;
		for (const pane of this.panes)
		{
			pane.Rendered = 0;
			if (pane.Visible && !pane.Collapsed)
			{
				const desired = Math.max(SplitViewControl.MinimumSize, pane.Size);
				if (shrinking)
				{
					pane.Rendered = minimum + (desired - minimum) * factor;
				}
				else if (pane !== fill)
				{
					pane.Rendered = desired;
				}
				consumed += pane.Rendered;
			}
		}
		if (fill !== undefined && !shrinking)
		{
			fill.Rendered = Math.max(0, available - consumed);
		}
		for (const pane of this.panes)
		{
			pane.Host.hidden = !pane.Visible;
			pane.Host.inert = pane.Collapsed;
			pane.Host.dataset.collapsed = String(pane.Collapsed);
			pane.Host.setAttribute("aria-hidden", String(pane.Collapsed || !pane.Visible));
			pane.Host.style.flex = extent > 0 ? `0 0 ${pane.Rendered}px` : pane.Collapsed ? "0 0 0px" : `${pane.Size} 1 0px`;
		}
		for (const boundary of this.boundaries)
		{
			const total = boundary.Before.Rendered + boundary.After.Rendered;
			boundary.Root.setAttribute("aria-orientation", this.direction === "columns" ? "vertical" : "horizontal");
			boundary.Root.setAttribute("aria-valuemin", "0");
			boundary.Root.setAttribute("aria-valuemax", "100");
			const percent = total > 0 ? Math.round(boundary.Before.Rendered / total * 100) : 0;
			boundary.Root.setAttribute("aria-valuenow", String(percent));
		}
	}

	// Resolves only a divider belonging to this view, allowing arbitrary nested views.
	private FindBoundary(target: EventTarget | null): SplitBoundary | undefined
	{
		const element = target instanceof Element ? target.closest<HTMLElement>(".split-divider") : null;
		const boundary = this.boundaries.find(function Matches(candidate): boolean
		{
			return candidate.Root === element;
		});
		return boundary;
	}

	// Captures the adjacent pair and tracks a gesture even when a pane reaches zero.
	private HandlePointerDown(event: PointerEvent): void
	{
		const boundary = this.FindBoundary(event.target);
		if (boundary !== undefined && event.button === 0)
		{
			event.preventDefault();
			event.stopPropagation();
			boundary.Root.focus({ preventScroll: true });
			const before = boundary.Before.Collapsed ? 0 : boundary.Before.Rendered || boundary.Before.Size;
			const after = boundary.After.Collapsed ? 0 : boundary.After.Rendered || boundary.After.Size;
			this.drag = { PointerId: event.pointerId, Boundary: boundary, Start: this.Coordinate(event), Before: before,
				Total: Math.max(SplitViewControl.MinimumSize * 2, before + after), State: this.GetState() };
			this.Root.classList.add("is-resizing");
			boundary.Root.classList.add("is-active");
			window.addEventListener("pointermove", this.moveHandler);
			window.addEventListener("pointerup", this.upHandler);
			window.addEventListener("pointercancel", this.cancelHandler);
			window.addEventListener("keydown", this.keyHandler);
			if (event.isTrusted)
			{
				boundary.Root.setPointerCapture(event.pointerId);
			}
		}
	}

	// Applies a drag to the adjacent pair without a stale minimum or pointer-origin reset.
	private HandlePointerMove(event: PointerEvent): void
	{
		const drag = this.drag;
		if (drag !== null && drag.PointerId === event.pointerId)
		{
			const position = this.Coordinate(event);
			this.ResizePair(drag.Boundary, drag.Before + position - drag.Start, drag.Total);
		}
	}

	// Persists one completed gesture rather than every pointer movement.
	private HandlePointerUp(event: PointerEvent): void
	{
		if (this.drag?.PointerId === event.pointerId)
		{
			this.EndDrag();
			this.Publish();
		}
	}

	// Restores the starting state when the platform cancels a gesture.
	private HandlePointerCancel(event: PointerEvent): void
	{
		if (this.drag?.PointerId === event.pointerId)
		{
			this.CancelDrag();
		}
	}

	// Shares keyboard resizing, collapse, and restoration across every divider.
	private HandleKeyDown(event: KeyboardEvent): void
	{
		const boundary = this.FindBoundary(event.target);
		if (event.key === "Escape" && this.drag !== null)
		{
			event.preventDefault();
			event.stopPropagation();
			this.CancelDrag();
		}
		else if (boundary !== undefined)
		{
			const previous = this.direction === "columns" ? "ArrowLeft" : "ArrowUp";
			const next = this.direction === "columns" ? "ArrowRight" : "ArrowDown";
			let handled = true;
			const before = boundary.Before.Collapsed ? 0 : boundary.Before.Rendered || boundary.Before.Size;
			const after = boundary.After.Collapsed ? 0 : boundary.After.Rendered || boundary.After.Size;
			const total = Math.max(SplitViewControl.MinimumSize * 2, before + after);
			if (event.key === previous || event.key === next)
			{
				let requested = before + (event.key === previous ? -24 : 24);
				if (boundary.Before.Collapsed && event.key === next)
				{
					requested = SplitViewControl.MinimumSize;
				}
				else if (boundary.After.Collapsed && event.key === previous)
				{
					requested = total - SplitViewControl.MinimumSize;
				}
				this.ResizePair(boundary, requested, total);
			}
			else if (event.key === "Home" || event.key === "End")
			{
				this.ResizePair(boundary, event.key === "Home" ? 0 : total, total);
			}
			else if (event.key === "Enter" || event.key === " ")
			{
				this.ToggleBoundary(boundary);
			}
			else
			{
				handled = false;
			}
			if (handled)
			{
				event.preventDefault();
				event.stopPropagation();
				this.Publish();
			}
		}
	}

	// Restores a collapsed side with the same gesture on either orientation.
	private HandleDoubleClick(event: MouseEvent): void
	{
		const boundary = this.FindBoundary(event.target);
		if (boundary !== undefined)
		{
			event.preventDefault();
			event.stopPropagation();
			this.ToggleBoundary(boundary);
			this.Publish();
		}
	}

	// Reopens either collapsed side, otherwise collapses the first side of the divider.
	private ToggleBoundary(boundary: SplitBoundary): void
	{
		const pane = boundary.Before.Collapsed ? boundary.Before : boundary.After.Collapsed ? boundary.After : boundary.Before;
		if (pane.Collapsed)
		{
			this.RestorePane(pane);
		}
		else
		{
			pane.Size = pane.Rendered || pane.Size;
			pane.Collapsed = true;
		}
		this.Layout();
	}

	// Gives a restored fill pane its remembered extent by taking space from a neighbor.
	private RestorePane(pane: SplitPane): void
	{
		const index = this.panes.indexOf(pane);
		const neighbors = [...this.panes.slice(index + 1), ...this.panes.slice(0, index).reverse()];
		const donor = neighbors.find(function Available(candidate): boolean
		{
			return candidate.Visible && !candidate.Collapsed;
		});
		if (donor !== undefined)
		{
			const total = donor.Rendered || donor.Size;
			const size = Math.max(SplitViewControl.MinimumSize, Math.min(pane.Size, total - SplitViewControl.MinimumSize));
			pane.Size = size;
			donor.Size = Math.max(SplitViewControl.MinimumSize, total - size);
		}
		pane.Collapsed = false;
	}

	// Uses the same snap threshold for all hosts, preserving their last expanded sizes.
	private ResizePair(boundary: SplitBoundary, requested: number, total: number): void
	{
		const beforeCollapsed = requested <= SplitViewControl.CollapseThreshold;
		const afterCollapsed = total - requested <= SplitViewControl.CollapseThreshold;
		const before = beforeCollapsed ? 0 : afterCollapsed ? total
			: Math.max(SplitViewControl.MinimumSize, Math.min(requested, total - SplitViewControl.MinimumSize));
		boundary.Before.Collapsed = beforeCollapsed;
		boundary.After.Collapsed = !beforeCollapsed && afterCollapsed;
		if (this.drag !== null)
		{
			if (beforeCollapsed)
			{
				const original = this.drag.State[boundary.Before.Options.Id];
				boundary.Before.Size = original?.Collapsed ? original.Size : this.drag.Before;
			}
			if (afterCollapsed)
			{
				const original = this.drag.State[boundary.After.Options.Id];
				boundary.After.Size = original?.Collapsed ? original.Size : this.drag.Total - this.drag.Before;
			}
		}
		if (!boundary.Before.Collapsed)
		{
			boundary.Before.Size = before;
		}
		if (!boundary.After.Collapsed)
		{
			boundary.After.Size = total - before;
		}
		this.Layout();
	}

	// Restores state before releasing the gesture resources.
	private CancelDrag(): void
	{
		if (this.drag !== null)
		{
			for (const pane of this.panes)
			{
				const state = this.drag.State[pane.Options.Id];
				if (state !== undefined)
				{
					pane.Size = state.Size;
					pane.Collapsed = state.Collapsed;
				}
			}
			this.EndDrag();
			this.Layout();
		}
	}

	// Removes global listeners on completion, cancellation, removal, and disposal.
	private EndDrag(): void
	{
		const drag = this.drag;
		drag?.Boundary.Root.classList.remove("is-active");
		this.drag = null;
		if (drag !== null && drag.Boundary.Root.hasPointerCapture?.(drag.PointerId))
		{
			drag.Boundary.Root.releasePointerCapture(drag.PointerId);
		}
		this.Root.classList.remove("is-resizing");
		window.removeEventListener("pointermove", this.moveHandler);
		window.removeEventListener("pointerup", this.upHandler);
		window.removeEventListener("pointercancel", this.cancelHandler);
		window.removeEventListener("keydown", this.keyHandler);
	}

	// Reads the pointer coordinate corresponding to the effective orientation.
	private Coordinate(event: PointerEvent): number
	{
		const coordinate = this.direction === "columns" ? event.clientX : event.clientY;
		return coordinate;
	}

	// Finds an attached surface without exposing internal host state.
	private FindPane(id: string): SplitPane | undefined
	{
		const pane = this.panes.find(function Matches(candidate): boolean
		{
			return candidate.Options.Id === id;
		});
		return pane;
	}

	// Announces durable geometry without coupling the control to storage or feature events.
	private Publish(): void
	{
		const state = this.GetState();
		this.options.Changed?.(state);
	}
}
