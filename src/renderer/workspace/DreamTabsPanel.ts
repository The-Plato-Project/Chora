import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { DreamController } from "../dreams/DreamController.js";
import type { DreamExportController } from "../dreams/DreamExportController.js";
import type { DreamSaveCoordinator } from "../dreams/DreamSaveCoordinator.js";
import type { DreamStore, DreamTab } from "../dreams/DreamStore.js";
import { DeleteConfirmation } from "../ui/DeleteConfirmation.js";
import { EscapeHtml } from "../ui/Html.js";
import { CloseIcon, CopyIcon, DocumentIcon, EditIcon, SaveIcon, TrashIcon } from "../ui/Icons.js";

// Owns the Dream editor tab strip and document actions independently of the Explorer.
export class DreamTabsPanel
{
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly confirmation = new DeleteConfirmation();
	private readonly clickHandler = this.HandleClick.bind(this);
	private readonly contextMenuHandler = this.HandleContextMenu.bind(this);
	private readonly dismissContextMenuHandler = this.HandleContextMenuDismiss.bind(this);
	private tabOrder: string[] = [];

	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly dreams: DreamStore,
		private readonly controller: DreamController,
		private readonly saves: DreamSaveCoordinator,
		private readonly exports: DreamExportController)
	{
		this.root.addEventListener("click", this.clickHandler);
		document.addEventListener("contextmenu", this.contextMenuHandler);
		document.addEventListener("pointerdown", this.dismissContextMenuHandler);
		const update = this.Update.bind(this);
		const eventNames = ["dream.opened", "dream.closed", "dream.catalogue-changed", "dream.changed", "dream.saved", "dream.save-state-changed"] as const;
		for (const eventName of eventNames)
		{
			const subscription = this.events.Subscribe(eventName, update);
			this.subscriptions.push(subscription);
		}
		this.Update();
	}

	public Dispose(): void
	{
		this.root.removeEventListener("click", this.clickHandler);
		document.removeEventListener("contextmenu", this.contextMenuHandler);
		document.removeEventListener("pointerdown", this.dismissContextMenuHandler);
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		this.confirmation.Dispose();
	}

	private Update(): void
	{
		const tabs = this.dreams.GetOpenTabs();
		const available = new Map<string, DreamTab>();
		for (const tab of tabs)
		{
			available.set(tab.dreamId, tab);
		}
		const order: string[] = [];
		for (const dreamId of this.tabOrder)
		{
			const exists = available.has(dreamId);
			if (exists)
			{
				order.push(dreamId);
			}
		}
		for (const tab of tabs)
		{
			const exists = order.includes(tab.dreamId);
			if (!exists)
			{
				order.push(tab.dreamId);
			}
		}
		this.tabOrder = order;
		let items = "";
		for (const dreamId of this.tabOrder)
		{
			const tab = available.get(dreamId);
			if (tab !== undefined)
			{
				const activeDream = this.dreams.GetActiveDream();
				const selected = activeDream?.id === tab.dreamId;
				const selectedClass = selected ? " selected" : "";
				const dirty = tab.isDirty ? `<span class="dream-document-tab-dirty" aria-label="Unsaved changes"></span>` : "";
				const escapedId = EscapeHtml(tab.dreamId);
				const escapedTitle = EscapeHtml(tab.title);
				items += `<div class="dream-document-tab${selectedClass}" role="presentation">`;
				items += `<button class="dream-document-tab-label button-control" data-workspace-tab="${escapedId}" type="button" role="tab" aria-selected="${selected}" title="${escapedTitle}">`;
				items += `<span class="dream-document-tab-icon" aria-hidden="true">${DocumentIcon}</span>`;
				items += `<span>${escapedTitle}</span></button>`;
				items += dirty;
				items += `<button class="dream-document-tab-close button-control" data-close-workspace-tab="${escapedId}" type="button" title="Close ${escapedTitle}" aria-label="Close ${escapedTitle}">${CloseIcon}</button>`;
				items += `</div>`;
			}
		}
		let markup = "";
		if (items.length > 0)
		{
			markup = `<div class="dream-document-bar workspace-document-bar">`;
			markup += `<div class="dream-document-tabs" role="tablist" aria-label="Open Dreams">${items}</div>`;
			markup += `</div>`;
			markup += this.RenderContextMenu();
		}
		this.root.innerHTML = markup;
	}

	private RenderContextMenu(): string
	{
		const saveState = this.dreams.GetSaveState();
		const disabled = saveState === "saving" ? " disabled" : "";
		let menu = `<div class="dream-context-menu" hidden>`;
		menu += `<button data-workspace-rename-dream type="button">${EditIcon}<span>Rename Dream</span></button>`;
		menu += `<button data-workspace-save-dream type="button"${disabled}>${SaveIcon}<span>Save Dream</span></button>`;
		menu += `<button data-workspace-copy-dream type="button">${CopyIcon}<span>Copy as Markdown</span></button>`;
		menu += `<button class="danger" data-workspace-delete-dream type="button">${TrashIcon}<span>Delete Dream</span></button>`;
		menu += `</div>`;
		return menu;
	}

	private HandleContextMenu(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const tab = target?.closest<HTMLElement>("[data-workspace-tab]");
		const explorerDream = target?.closest<HTMLElement>("[data-workspace-dream]");
		const tabDreamId = tab?.dataset.workspaceTab;
		const explorerDreamId = explorerDream?.dataset.workspaceDream;
		const dreamId = tabDreamId ?? explorerDreamId;

		if (dreamId !== undefined)
		{
			event.preventDefault();
			if (tabDreamId !== undefined)
			{
				this.controller.ActivateTab(dreamId);
			}
			else
			{
				this.controller.Open(dreamId);
			}
			const open = this.OpenContextMenu.bind(this, event.clientX, event.clientY);
			window.setTimeout(open, 0);
		}
	}

	private OpenContextMenu(clientX: number, clientY: number): void
	{
		const menu = this.root.querySelector<HTMLElement>(".dream-context-menu");
		if (menu !== null)
		{
			menu.hidden = false;
			const bounds = menu.getBoundingClientRect();
			const left = Math.min(clientX, Math.max(0, window.innerWidth - bounds.width - 8));
			const top = Math.min(clientY, Math.max(0, window.innerHeight - bounds.height - 8));
			menu.style.left = `${left}px`;
			menu.style.top = `${top}px`;
			menu.querySelector<HTMLButtonElement>("button")?.focus();
		}
	}

	private HandleContextMenuDismiss(event: PointerEvent): void
	{
		const target = event.target;
		const menu = this.root.querySelector<HTMLElement>(".dream-context-menu");
		if (menu !== null && target instanceof Node && !menu.contains(target))
		{
			menu.hidden = true;
		}
	}

	private HandleClick(event: Event): void
	{
		const target = event.target as HTMLElement | null;
		const tab = target?.closest<HTMLElement>("[data-workspace-tab]");
		const close = target?.closest<HTMLElement>("[data-close-workspace-tab]");
		const rename = target?.closest<HTMLElement>("[data-workspace-rename-dream]");
		const save = target?.closest<HTMLElement>("[data-workspace-save-dream]");
		const copy = target?.closest<HTMLElement>("[data-workspace-copy-dream]");
		const deleteTrigger = target?.closest<HTMLElement>("[data-workspace-delete-dream]");
		const tabId = tab?.dataset.workspaceTab;
		const closeId = close?.dataset.closeWorkspaceTab;
		if (tabId !== undefined)
		{
			this.controller.ActivateTab(tabId);
		}
		else if (closeId !== undefined)
		{
			void this.CloseTabAsync(closeId);
		}
		else if (rename !== null && rename !== undefined)
		{
			const dreamId = this.dreams.GetActiveDream()?.id;
			this.CloseContextMenu();
			if (dreamId !== undefined) void this.events.PublishAsync("dream.rename-requested", { dreamId });
		}
		else if (save !== null && save !== undefined)
		{
			this.CloseContextMenu();
			void this.saves.SaveAsync();
		}
		else if (copy !== null && copy !== undefined)
		{
			this.CloseContextMenu();
			void this.exports.CopyDreamAsMarkdownAsync();
		}
		else if (deleteTrigger !== null && deleteTrigger !== undefined)
		{
			const trigger = this.root.querySelector<HTMLElement>(".dream-document-tab.selected [data-workspace-tab]");
			this.CloseContextMenu();
			this.ConfirmDelete(trigger ?? deleteTrigger);
		}
	}

	private CloseContextMenu(): void
	{
		const menu = this.root.querySelector<HTMLElement>(".dream-context-menu");
		if (menu !== null) menu.hidden = true;
	}

	private async CloseTabAsync(dreamId: string): Promise<void>
	{
		await this.controller.CloseTabAsync(dreamId);
		this.Update();
	}

	private ConfirmDelete(trigger: HTMLElement): void
	{
		const dream = this.dreams.GetActiveDream();
		if (dream !== null)
		{
			const callback = this.DeleteAsync.bind(this);
			this.confirmation.Open("Dream", dream.title, "The Dream and its Signals will stay in Trash until you restore or permanently delete them.", trigger, callback);
		}
	}

	private async DeleteAsync(): Promise<boolean>
	{
		const deleted = await this.controller.DeleteAsync();
		if (deleted)
		{
			this.Update();
		}
		return deleted;
	}
}
