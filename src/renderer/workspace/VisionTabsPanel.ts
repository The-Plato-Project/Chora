import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { DialogControl } from "../ui/controls/DialogControl.js";
import { EscapeHtml } from "../ui/Html.js";
import { CloseIcon, CopyIcon, DocumentIcon, EditIcon, SaveIcon, TrashIcon } from "../ui/Icons.js";
import type { VisionController } from "../visions/VisionController.js";
import type { VisionStore } from "../visions/VisionStore.js";

export class VisionTabsPanel
{
	private readonly subscriptions: Unsubscribe[] = [];
	// Generic Cancel/OK confirmation; deletion remains a feature-owned command.
	private readonly confirmation: DialogControl;
	private readonly nodes = new Map<string, HTMLElement>();
	private readonly contextMenuHandler = this.HandleContextMenu.bind(this);
	private readonly dismissContextMenuHandler = this.HandleContextMenuDismiss.bind(this);
	private readonly tabList: HTMLElement;
	private order: string[] = [];

	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly visions: VisionStore,
		private readonly controller: VisionController)
	{
		const errors = new ErrorManager(events);
		this.confirmation = new DialogControl(errors);
		this.root.innerHTML = `<div class="document-tab-bar workspace-document-bar"><div class="document-tabs" role="tablist" aria-label="Open Visions"></div></div>${this.RenderContextMenu()}`;
		this.tabList = this.root.querySelector<HTMLElement>(".document-tabs")!;
		this.root.addEventListener("click", this.HandleClick.bind(this));
		document.addEventListener("contextmenu", this.contextMenuHandler);
		document.addEventListener("pointerdown", this.dismissContextMenuHandler);
		this.subscriptions.push(events.Subscribe("vision.opened", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.closed", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.catalogue-changed", this.Update.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.dirty-changed", this.HandleVisionChanged.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.metadata-changed", this.HandleMetadataChanged.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.save-state-changed", this.UpdateSaveMenu.bind(this)));
		this.Update();
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		this.confirmation.Dispose();
		document.removeEventListener("contextmenu", this.contextMenuHandler);
		document.removeEventListener("pointerdown", this.dismissContextMenuHandler);
		this.nodes.clear();
		this.root.replaceChildren();
	}

	private Update(): void
	{
		const tabs = new Map(this.visions.GetOpenTabs().map((tab) => [tab.visionId, tab]));
		this.order = [
			...this.order.filter((visionId) => tabs.has(visionId)),
			...[...tabs.keys()].filter((visionId) => !this.order.includes(visionId))
		];
		for (const [visionId, node] of this.nodes)
		{
			if (!tabs.has(visionId))
			{
				node.remove();
				this.nodes.delete(visionId);
			}
		}
		let position = this.tabList.firstElementChild;
		for (const visionId of this.order)
		{
			const tab = tabs.get(visionId);
			if (tab !== undefined)
			{
				let node = this.nodes.get(visionId);
				if (node === undefined)
				{
					node = this.CreateTab(visionId);
					this.nodes.set(visionId, node);
				}
				this.PatchTab(node, tab.title, tab.isDirty, this.visions.GetActive()?.id === visionId);
				if (node !== position) this.tabList.insertBefore(node, position);
				position = node.nextElementSibling;
			}
		}
		this.tabList.parentElement!.hidden = this.order.length === 0;
		this.UpdateSaveMenu();
	}

	private CreateTab(visionId: string): HTMLElement
	{
		const node = document.createElement("div");
		node.className = "document-tab vision-document-tab";
		node.setAttribute("role", "presentation");
		node.innerHTML = `<button class="document-tab-label button-control" data-workspace-vision-tab="${visionId}" type="button" role="tab"><span class="document-tab-icon" aria-hidden="true">${DocumentIcon}</span><span data-document-title></span></button><button class="document-tab-close button-control" data-close-workspace-vision-tab="${visionId}" type="button">${CloseIcon}</button>`;
		return node;
	}

	private PatchTab(node: HTMLElement, title: string, dirty: boolean, selected: boolean): void
	{
		const label = node.querySelector<HTMLButtonElement>(".document-tab-label")!;
		const text = node.querySelector<HTMLElement>("[data-document-title]")!;
		const close = node.querySelector<HTMLButtonElement>(".document-tab-close")!;
		const indicator = node.querySelector<HTMLElement>(".document-tab-dirty");
		if (text.textContent !== title)
		{
			text.textContent = title;
			label.title = title;
			close.title = `Close ${title}`;
			close.setAttribute("aria-label", `Close ${title}`);
		}
		if (dirty && indicator === null)
		{
			const next = document.createElement("span");
			next.className = "document-tab-dirty";
			next.setAttribute("aria-label", "Unsaved changes");
			node.insertBefore(next, close);
		}
		else if (!dirty && indicator !== null)
		{
			indicator.remove();
		}
		node.classList.toggle("selected", selected);
		label.setAttribute("aria-selected", String(selected));
	}

	private HandleVisionChanged(event: { readonly visionId: string }): void
	{
		const vision = this.visions.Get(event.visionId);
		const node = this.nodes.get(event.visionId);
		if (vision !== null && node !== undefined)
		{
			this.PatchTab(node, vision.title || "Untitled Vision", this.visions.IsDirty(vision.id), this.visions.GetActive()?.id === vision.id);
		}
	}

	private HandleMetadataChanged(event: ChoraEvents["vision.metadata-changed"]): void
	{
		if (event.titleChanged) this.HandleVisionChanged(event);
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const tabId = target?.closest<HTMLElement>("[data-workspace-vision-tab]")?.dataset.workspaceVisionTab;
		const closeId = target?.closest<HTMLElement>("[data-close-workspace-vision-tab]")?.dataset.closeWorkspaceVisionTab;
		if (tabId !== undefined)
		{
			this.controller.ActivateTab(tabId);
		}
		else if (closeId !== undefined)
		{
			void this.controller.CloseTabAsync(closeId);
		}
		else if (target?.closest("[data-workspace-rename-vision]") !== null)
		{
			this.CloseContextMenu();
			void this.events.PublishAsync("vision.rename-requested", {});
		}
		else if (target?.closest("[data-workspace-save-vision]") !== null)
		{
			this.CloseContextMenu();
			void this.controller.SaveAsync();
		}
		else if (target?.closest("[data-workspace-copy-vision]") !== null)
		{
			this.CloseContextMenu();
			void this.controller.CopyAsMarkdownAsync();
		}
		else if (target?.closest("[data-workspace-delete-vision]") !== null)
		{
			const trigger = this.root.querySelector<HTMLElement>(".document-tab.selected [data-workspace-vision-tab]");
			this.CloseContextMenu();
			this.ConfirmDelete(trigger);
		}
	}

	private HandleContextMenu(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const tabId = target?.closest<HTMLElement>("[data-workspace-vision-tab]")?.dataset.workspaceVisionTab;
		const explorerId = target?.closest<HTMLElement>("[data-workspace-vision]")?.dataset.workspaceVision;
		const visionId = tabId ?? explorerId;
		if (visionId !== undefined)
		{
			event.preventDefault();
			if (tabId !== undefined) this.controller.ActivateTab(visionId);
			else this.controller.Open(visionId);
			window.setTimeout(() => this.OpenContextMenu(event.clientX, event.clientY), 0);
		}
	}

	private OpenContextMenu(clientX: number, clientY: number): void
	{
		const menu = this.root.querySelector<HTMLElement>("[data-vision-document-menu]");
		if (menu !== null)
		{
			menu.hidden = false;
			const bounds = menu.getBoundingClientRect();
			menu.style.left = `${Math.min(clientX, Math.max(0, window.innerWidth - bounds.width - 8))}px`;
			menu.style.top = `${Math.min(clientY, Math.max(0, window.innerHeight - bounds.height - 8))}px`;
			menu.querySelector<HTMLButtonElement>("button")?.focus();
		}
	}

	private HandleContextMenuDismiss(event: PointerEvent): void
	{
		const menu = this.root.querySelector<HTMLElement>("[data-vision-document-menu]");
		if (menu !== null && event.target instanceof Node && !menu.contains(event.target)) menu.hidden = true;
	}

	private CloseContextMenu(): void
	{
		const menu = this.root.querySelector<HTMLElement>("[data-vision-document-menu]");
		if (menu !== null) menu.hidden = true;
	}

	private UpdateSaveMenu(): void
	{
		const button = this.root.querySelector<HTMLButtonElement>("[data-workspace-save-vision]");
		const active = this.visions.GetActive();
		if (button !== null) button.disabled = active !== null && this.visions.GetSaveState(active.id) === "saving";
	}

	private ConfirmDelete(trigger: HTMLElement | null): void
	{
		const vision = this.visions.GetActive();
		if (vision !== null)
		{
			const owner = this;
			// Commits only the Vision captured when the request was opened.
			async function DeleteVisionAsync(): Promise<boolean>
			{
				await owner.controller.DeleteAsync(vision!.id);
				const deleted = owner.visions.Get(vision!.id) === null;
				return deleted;
			}
			this.confirmation.Open({
				Title: "Delete vision?", Trigger: trigger,
				Content: `<p>Are you sure you want to delete <strong>${EscapeHtml(vision.title || "Untitled Vision")}</strong>?</p>`,
				CommitAsync: DeleteVisionAsync,
				FailureMessage: "The deletion could not finish. Check the Vision's status before trying again."
			});
		}
	}

	private RenderContextMenu(): string
	{
		return `<div class="document-context-menu" data-vision-document-menu hidden>
			<button data-workspace-rename-vision type="button">${EditIcon}<span>Rename Vision</span></button>
			<button data-workspace-save-vision type="button">${SaveIcon}<span>Save Vision</span></button>
			<button data-workspace-copy-vision type="button">${CopyIcon}<span>Copy as Markdown</span></button>
			<button class="danger" data-workspace-delete-vision type="button">${TrashIcon}<span>Delete Vision</span></button>
		</div>`;
	}
}
