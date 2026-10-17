import { createElement, ArrowLeft, ArrowRight, RotateCw, ExternalLink, X } from "lucide";
import { ChoraEventBus, type Unsubscribe } from "../../core/events/ChoraEventBus.js";
import { LayoutSettings } from "../../core/settings/LayoutSettingsStore.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import type { LookupCommand } from "../../../shared/library/LookupTypes.js";
import { LookupController } from "./LookupController.js";
import { LookupStore } from "./LookupStore.js";

// Owns dictionary toolbar DOM, divider interaction, and native-view placement.
export class LookupPanel
{
	private readonly unsubscribe: Unsubscribe;
	private readonly viewport: HTMLElement;
	private readonly divider: HTMLElement;
	private readonly title: HTMLElement;
	private readonly status: HTMLElement;
	private readonly failure: HTMLElement;
	private readonly back: HTMLButtonElement;
	private readonly forward: HTMLButtonElement;
	private readonly resizeObserver: ResizeObserver;
	private readonly mutationObserver: MutationObserver;
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly downHandler = this.HandlePointerDown.bind(this);
	private readonly moveHandler = this.HandlePointerMove.bind(this);
	private readonly upHandler = this.HandlePointerUp.bind(this);
	private readonly keyHandler = this.HandleKeyDown.bind(this);
	private readonly scheduleHandler = this.ScheduleBounds.bind(this);
	private frame: number | null = null;
	private drag: { pointerId: number; y: number; height: number } | null = null;
	private desiredHeight = LayoutSettings.GetDimension("lookupHeight", 320);

	public constructor(private readonly root: HTMLElement, events: ChoraEventBus<ChoraEvents>, private readonly store: LookupStore, private readonly controller: LookupController)
	{
		const backIcon = createElement(ArrowLeft).outerHTML;
		const forwardIcon = createElement(ArrowRight).outerHTML;
		const reloadIcon = createElement(RotateCw).outerHTML;
		const externalIcon = createElement(ExternalLink).outerHTML;
		const closeIcon = createElement(X).outerHTML;
		this.root.className = "lookup-panel";
		this.root.innerHTML = `<div class="lookup-divider" role="separator" aria-label="Resize dictionary" aria-orientation="horizontal" tabindex="0"></div><header class="lookup-toolbar"><button type="button" data-lookup-command="back" title="Back" aria-label="Back">${backIcon}</button><button type="button" data-lookup-command="forward" title="Forward" aria-label="Forward">${forwardIcon}</button><button type="button" data-lookup-command="reload" title="Reload dictionary" aria-label="Reload dictionary">${reloadIcon}</button><strong data-lookup-title>Logeion</strong><span data-lookup-status role="status"></span><button type="button" data-lookup-command="external" title="Open in browser" aria-label="Open in browser">${externalIcon}</button><button type="button" data-lookup-command="close" title="Close dictionary" aria-label="Close dictionary">${closeIcon}</button></header><div class="lookup-viewport"><p class="lookup-failure" role="alert" hidden></p></div>`;
		this.viewport = this.root.querySelector<HTMLElement>(".lookup-viewport")!;
		this.divider = this.root.querySelector<HTMLElement>(".lookup-divider")!;
		this.title = this.root.querySelector<HTMLElement>("[data-lookup-title]")!;
		this.status = this.root.querySelector<HTMLElement>("[data-lookup-status]")!;
		this.failure = this.root.querySelector<HTMLElement>(".lookup-failure")!;
		this.back = this.root.querySelector<HTMLButtonElement>('[data-lookup-command="back"]')!;
		this.forward = this.root.querySelector<HTMLButtonElement>('[data-lookup-command="forward"]')!;
		this.root.addEventListener("click", this.clickHandler);
		this.divider.addEventListener("pointerdown", this.downHandler);
		this.divider.addEventListener("pointermove", this.moveHandler);
		this.divider.addEventListener("pointerup", this.upHandler);
		this.divider.addEventListener("pointercancel", this.upHandler);
		this.divider.addEventListener("lostpointercapture", this.upHandler);
		this.divider.addEventListener("keydown", this.keyHandler);
		window.addEventListener("resize", this.scheduleHandler);
		this.resizeObserver = new ResizeObserver(this.scheduleHandler);
		this.resizeObserver.observe(this.viewport);
		if (this.root.parentElement !== null) this.resizeObserver.observe(this.root.parentElement);
		this.mutationObserver = new MutationObserver(this.scheduleHandler);
		this.mutationObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class", "style", "open"] });
		this.unsubscribe = events.Subscribe("lookup.changed", this.Update.bind(this));
		this.Update();
	}

	public Dispose(): void
	{
		this.unsubscribe();
		this.resizeObserver.disconnect();
		this.mutationObserver.disconnect();
		if (this.frame !== null) cancelAnimationFrame(this.frame);
		window.removeEventListener("resize", this.scheduleHandler);
		this.root.removeEventListener("click", this.clickHandler);
		this.divider.removeEventListener("pointerdown", this.downHandler);
		this.divider.removeEventListener("pointermove", this.moveHandler);
		this.divider.removeEventListener("pointerup", this.upHandler);
		this.divider.removeEventListener("pointercancel", this.upHandler);
		this.divider.removeEventListener("lostpointercapture", this.upHandler);
		this.divider.removeEventListener("keydown", this.keyHandler);
		void this.controller.SetBoundsAsync(null);
	}

	private Update(): void
	{
		const state = this.store.GetState();
		const wasOpen = !this.root.hidden;
		this.root.hidden = !state.open;
		this.back.disabled = !state.canGoBack;
		this.forward.disabled = !state.canGoForward;
		this.status.textContent = state.loading ? "Loading..." : "";
		this.failure.hidden = state.error === null;
		this.failure.textContent = state.error ?? "";
		let title = "Logeion";
		if (state.url.length > 0)
		{
			try
			{
				const url = new URL(state.url);
				const word = decodeURIComponent(url.pathname.slice(1));
				title = word.length > 0 ? `Logeion: ${word}` : "Logeion";
			}
			catch
			{
				title = "Logeion";
			}
		}
		this.title.textContent = title;
		this.title.title = state.url;
		if (state.open) this.SetHeight(this.desiredHeight);
		if (wasOpen && !state.open)
		{
			const reader = this.root.parentElement?.querySelector<HTMLElement>("[data-locator-navigation]");
			reader?.focus({ preventScroll: true });
		}
		this.ScheduleBounds();
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const command = target?.closest<HTMLElement>("[data-lookup-command]")?.dataset.lookupCommand;
		if (command === "back" || command === "forward" || command === "reload" || command === "external" || command === "close") void this.controller.ExecuteAsync(command as LookupCommand);
	}

	private HandlePointerDown(event: PointerEvent): void
	{
		if (event.button === 0)
		{
			event.preventDefault();
			this.drag = { pointerId: event.pointerId, y: event.clientY, height: this.root.getBoundingClientRect().height };
			this.divider.setPointerCapture(event.pointerId);
			void this.controller.SetBoundsAsync(null);
		}
	}

	private HandlePointerMove(event: PointerEvent): void
	{
		if (this.drag !== null && this.drag.pointerId === event.pointerId) this.SetHeight(this.drag.height + this.drag.y - event.clientY);
	}

	private HandlePointerUp(): void
	{
		if (this.drag !== null)
		{
			const pointerId = this.drag.pointerId;
			this.drag = null;
			if (this.divider.hasPointerCapture(pointerId)) this.divider.releasePointerCapture(pointerId);
			this.ScheduleBounds();
		}
	}

	private HandleKeyDown(event: KeyboardEvent): void
	{
		if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End")
		{
			event.preventDefault();
			let height = this.desiredHeight + (event.key === "ArrowUp" ? 24 : -24);
			if (event.key === "Home") height = 140;
			if (event.key === "End") height = Number.MAX_SAFE_INTEGER;
			this.SetHeight(height);
			this.ScheduleBounds();
		}
	}

	private SetHeight(height: number): void
	{
		const total = this.root.parentElement?.getBoundingClientRect().height ?? 600;
		const maximum = Math.max(140, total - 180);
		this.desiredHeight = Math.min(maximum, Math.max(140, height));
		LayoutSettings.SetDimension("lookupHeight", this.desiredHeight);
		const value = `${this.desiredHeight}px`;
		if (this.root.style.height !== value) this.root.style.height = value;
		this.divider.setAttribute("aria-valuemin", "140");
		this.divider.setAttribute("aria-valuemax", `${maximum}`);
		this.divider.setAttribute("aria-valuenow", `${this.desiredHeight}`);
	}

	private ScheduleBounds(): void
	{
		if (this.frame === null) this.frame = requestAnimationFrame(this.SendBounds.bind(this));
	}

	private SendBounds(): void
	{
		this.frame = null;
		if (!this.root.hidden) this.SetHeight(this.desiredHeight);
		const bounds = this.viewport.getBoundingClientRect();
		const modal = document.querySelector('.popup-overlay:not([hidden]), dialog[open], [aria-modal="true"]');
		const hidden = this.root.hidden || this.drag !== null || modal !== null || bounds.width <= 0 || bounds.height <= 0 || this.store.GetState().error !== null;
		const viewport = hidden ? null : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
		void this.controller.SetBoundsAsync(viewport);
	}
}