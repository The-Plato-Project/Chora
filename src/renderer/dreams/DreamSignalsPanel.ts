import type { DreamView } from "./DreamView.js";
import type { IdeaRecord } from "../../shared/ideas/IdeaTypes.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { IdeaStore } from "../ideas/IdeaStore.js";
import { SignalViewPanel } from "../signals/SignalViewPanel.js";
import { EscapeHtml } from "../ui/Html.js";
import { AddIcon, IdeaIcon } from "../ui/Icons.js";
import { DreamController } from "./DreamController.js";

// Adapts the shared Signal view to DreamView-owned associations.
export class DreamSignalsPanel extends SignalViewPanel
{
	// Identifies the DreamView currently represented by the panel.
	private dreamId: string | null = null;

	// Connects common Signal presentation to DreamView workflows.
	public constructor(
		private readonly controller: DreamController,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly ideas: IdeaStore | null,
		errors: ErrorManager)
	{
		super(errors, false, false);
		this.Root.classList.add("dream-signals-panel");
	}

	// Reconciles the active DreamView's Signal associations.
	public Update(dream: DreamView): void
	{
		this.dreamId = dream.id;
		this.UpdateSignals(dream.signals);
	}

	// Returns the DreamView session's remembered Signal.
	protected GetRememberedSignal(): string | null
	{
		const signalId = this.dreamId === null
			? null
			: this.controller.GetSelectedSignal(this.dreamId);

		return signalId;
	}

	// Stores selection in the active DreamView session.
	protected RememberSignal(signalId: string | null): void
	{
		if (this.dreamId !== null) this.controller.RememberSelectedSignal(this.dreamId, signalId);
	}

	// Navigates the reader to one DreamView Signal.
	protected async ViewSignalAsync(signalId: string): Promise<void>
	{
		await this.controller.ViewSignalAsync(signalId);
	}

	// Identifies the active DreamView as the owner of these Signal associations.
	protected GetAssociationOwner(): "Dream"
	{
		return "Dream";
	}

	// Removes one Signal from the active DreamView without affecting other associations.
	protected RemoveSignalAssociation(signalId: string): void
	{
		this.controller.RemoveSignal(signalId);
	}

	// Saves one shared Signal description.
	protected UpdateSignalDescription(signalId: string, description: string): void
	{
		this.controller.UpdateSignal(signalId, description);
	}

	// Adds the explicit Add to Idea command to a DreamView Signal.
	protected AppendSignalActions(actions: HTMLElement, signalId: string): void
	{
		const ideasMenu = document.createElement("details");
		ideasMenu.className = "action-menu signal-ideas-menu";
		ideasMenu.innerHTML = `<summary data-signal-ideas-menu="${EscapeHtml(signalId)}" title="Add to Idea" aria-label="Add to Idea">${AddIcon}</summary><div class="action-menu-items" data-signal-ideas-list="${EscapeHtml(signalId)}"></div>`;
		ideasMenu.addEventListener("toggle", this.HandleIdeasMenuToggle.bind(this, ideasMenu));
		actions.append(ideasMenu);
		this.PopulateIdeasMenu(signalId, ideasMenu);
	}

	// Routes the DreamView-specific Add to Idea command.
	protected HandleSignalAction(target: HTMLElement | null): boolean
	{
		const menuSummary = target?.closest<HTMLElement>("[data-signal-ideas-menu]") ?? null;
		const openIdeaId = target?.closest<HTMLElement>("[data-open-signal-idea]")?.dataset.openSignalIdea;
		const addChoice = target?.closest<HTMLElement>("[data-add-signal-to-idea]");
		const addSignalId = addChoice?.dataset.addSignalToIdea;
		const addIdeaId = addChoice?.dataset.ideaId;
		const handled = menuSummary !== null || openIdeaId !== undefined || addSignalId !== undefined;

		if (addSignalId !== undefined && addIdeaId !== undefined)
		{
			const menu = target?.closest<HTMLDetailsElement>(".signal-ideas-menu") ?? null;
			if (menu !== null) menu.open = false;
			const addition = this.controller.AddSignalToIdeaAsync(addSignalId, addIdeaId);
			void addition;
		}
		else if (menuSummary !== null)
		{
			const signalId = menuSummary.dataset.signalIdeasMenu;
			const menu = menuSummary.closest<HTMLDetailsElement>(".signal-ideas-menu");

			if (signalId !== undefined && menu !== null)
			{
				this.PopulateIdeasMenu(signalId, menu);
			}
		}
		else if (openIdeaId !== undefined)
		{
			const menu = target?.closest<HTMLDetailsElement>(".signal-ideas-menu") ?? null;
			if (menu !== null) menu.open = false;
			const opening = this.events.PublishAsync("idea.open-requested", { ideaId: openIdeaId });
			void opening;
		}

		return handled;
	}

	// Lists connected Ideas first, followed by Ideas that can receive the Signal.
	private PopulateIdeasMenu(signalId: string, menu: HTMLDetailsElement): void
	{
		const list = menu.querySelector<HTMLElement>("[data-signal-ideas-list]");
		const ideas = this.ideas?.GetIdeas() ?? [];
		const matchingIdeas = this.GetIdeasForSignal(signalId, ideas);
		const matchingIds = new Set(matchingIdeas.map(function GetIdeaId(idea): string
		{
			return idea.id;
		}));
		const availableIdeas = ideas.filter(function IsAvailable(idea): boolean
		{
			return !matchingIds.has(idea.id);
		});
		let markup = "";

		if (matchingIdeas.length > 0)
		{
			markup += `<p class="signal-ideas-section-label">Already in</p>`;
			for (const idea of matchingIdeas)
			{
				const title = idea.title.trim() || "Untitled Idea";
				markup += `<button data-open-signal-idea="${EscapeHtml(idea.id)}" type="button" title="${EscapeHtml(title)}">${IdeaIcon}<span>${EscapeHtml(title)}</span></button>`;
			}
		}

		if (availableIdeas.length > 0)
		{
			markup += `<p class="signal-ideas-section-label${matchingIdeas.length > 0 ? " separated" : ""}">Add to</p>`;
			for (const idea of availableIdeas)
			{
				const title = idea.title.trim() || "Untitled Idea";
				markup += `<button data-add-signal-to-idea="${EscapeHtml(signalId)}" data-idea-id="${EscapeHtml(idea.id)}" type="button" title="${EscapeHtml(title)}">${AddIcon}<span>${EscapeHtml(title)}</span></button>`;
			}
		}

		if (markup.length === 0) markup = `<p class="signal-ideas-empty">No Ideas yet.</p>`;

		if (list !== null) list.innerHTML = markup;
	}

	// Positions the Idea list against the viewport so editor overflow cannot clip it.
	private HandleIdeasMenuToggle(menu: HTMLDetailsElement): void
	{
		if (menu.open)
		{
			const summary = menu.querySelector<HTMLElement>("[data-signal-ideas-menu]");
			const list = menu.querySelector<HTMLElement>(".action-menu-items");

			if (summary !== null && list !== null)
			{
				const bounds = summary.getBoundingClientRect();
				const viewportPadding = 12;
				const menuGap = 4;
				const preferredWidth = 320;
				const width = Math.min(preferredWidth, window.innerWidth - (viewportPadding * 2));
				const left = Math.max(viewportPadding, Math.min(bounds.right - width, window.innerWidth - width - viewportPadding));
				const below = window.innerHeight - bounds.bottom - menuGap - viewportPadding;
				const above = bounds.top - menuGap - viewportPadding;
				const opensBelow = below >= 220 || below >= above;
				const availableHeight = Math.max(120, opensBelow ? below : above);
				const top = opensBelow
					? bounds.bottom + menuGap
					: Math.max(viewportPadding, bounds.top - menuGap - availableHeight);
				list.style.left = `${Math.round(left)}px`;
				list.style.top = `${Math.round(top)}px`;
				list.style.width = `${Math.round(width)}px`;
				list.style.maxHeight = `${Math.round(availableHeight)}px`;
			}
		}
	}

	// Finds durable Ideas connected to one work-owned Signal.
	private GetIdeasForSignal(signalId: string, ideas: readonly IdeaRecord[]): IdeaRecord[]
	{
		const matchingIdeas: IdeaRecord[] = [];

		for (const idea of ideas)
		{
			const isOrigin = idea.originSignal?.signalId === signalId;
			const isRelated = idea.relatedSignals.some(function MatchesSignal(reference): boolean
			{
				return reference.signalId === signalId;
			});

			if (isOrigin || isRelated) matchingIdeas.push(idea);
		}

		return matchingIdeas;
	}

}
