import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { IdeaRecord } from "../../shared/ideas/IdeaTypes.js";
import type { IdeaStore } from "../ideas/IdeaStore.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { GetCoveredPassageKeys } from "../library/PassageCoverage.js";
import type { SignalStore } from "../signals/SignalStore.js";
import { EscapeHtml } from "../ui/Html.js";
import { DocumentIcon, IdeaIcon } from "../ui/Icons.js";
import { PopupPanel } from "../ui/PopupPanel.js";
import { DreamController } from "./DreamController.js";

// Owns Dream and Idea discovery buttons beside reading-pane passage labels.
export class DreamPassagePanel
{
	// Application subscriptions released with this panel.
	private readonly subscriptions: Unsubscribe[] = [];
	// Retained delegated click listener for deterministic cleanup.
	private readonly clickHandler = this.HandleClick.bind(this);
	private ideaPassages = new Map<string, readonly IdeaRecord[]>();
	private ideaChooser: PopupPanel | null = null;
	// Decorates existing labels without replacing source text or moving reading focus.
	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly library: LibraryStore,
		private readonly controller: DreamController,
		private readonly ideas: IdeaStore | null = null,
		private readonly signals: SignalStore | null = null)
	{
		this.root.addEventListener("click", this.clickHandler);
		const update = this.Update.bind(this);
		this.subscriptions.push(this.events.Subscribe("library.text-opened", update));
		this.subscriptions.push(this.events.Subscribe("dream.catalogue-changed", update));
		this.subscriptions.push(this.events.Subscribe("dream.saved", update));
		this.subscriptions.push(this.events.Subscribe("ideas.changed", update));
		this.subscriptions.push(this.events.Subscribe("signal.changed", update));
		this.Update();
	}

	// Removes listeners and owned buttons without touching the document content.
	public Dispose(): void
	{
		this.root.removeEventListener("click", this.clickHandler);
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		this.CloseIdeaChooser();
		const nodes = this.root.querySelectorAll("[data-passage-dreams], [data-passage-ideas]");
		const buttons = Array.from(nodes);
		for (const button of buttons)
		{
			button.remove();
		}
	}

	// Refreshes only passage buttons after catalogue changes, preserving selection and scrolling.
	private Update(): void
	{
		const counts = this.controller.GetPassageCounts();
		const titles = this.controller.GetPassageDreamTitles();
		this.ideaPassages = this.BuildIdeaPassages();
		const nodes = this.root.querySelectorAll<HTMLElement>(".source-locator");
		const locators = Array.from(nodes);
		for (const locator of locators)
		{
			const segment = locator.closest<HTMLElement>("[data-segment-key]");
			const key = segment?.dataset.segmentKey ?? "";
			const count = counts.get(key) ?? 0;
			let button = locator.querySelector<HTMLButtonElement>("[data-passage-dreams]");
			if (count > 0)
			{
				if (button === null)
				{
					button = document.createElement("button");
					button.type = "button";
					button.className = "passage-dream-button button-control";
					button.dataset.passageDreams = key;
					button.innerHTML = DocumentIcon;
					locator.append(button);
				}
				const locatorLabel = segment?.dataset.locator ?? "this passage";
				const heading = `${count} ${count === 1 ? "Dream" : "Dreams"} for ${locatorLabel}`;
				const dreamTitles = titles.get(key) ?? [];
				const label = dreamTitles.length === 0 ? heading : `${heading}:\n${dreamTitles.join("\n")}`;
				button.title = label;
				button.setAttribute("aria-label", label);
			}
			else
			{
				button?.remove();
			}

			const passageIdeas = this.ideaPassages.get(key) ?? [];
			let ideaButton = locator.querySelector<HTMLButtonElement>("[data-passage-ideas]");
			if (passageIdeas.length > 0)
			{
				if (ideaButton === null)
				{
					ideaButton = document.createElement("button");
					ideaButton.type = "button";
					ideaButton.className = "passage-idea-button button-control";
					ideaButton.dataset.passageIdeas = key;
					ideaButton.innerHTML = IdeaIcon;
					locator.append(ideaButton);
				}
				const locatorLabel = segment?.dataset.locator ?? "this passage";
				const heading = `${passageIdeas.length} ${passageIdeas.length === 1 ? "Idea" : "Ideas"} for ${locatorLabel}`;
				const ideaTitles = passageIdeas.map(function GetIdeaTitle(idea): string
				{
					return idea.title.trim() || "Untitled Idea";
				});
				const label = `${heading}:\n${ideaTitles.join("\n")}`;
				ideaButton.title = label;
				ideaButton.setAttribute("aria-label", label);
			}
			else
			{
				ideaButton?.remove();
			}
		}
	}

	// Groups each Idea once under every passage covered by one of its connected Signals.
	private BuildIdeaPassages(): Map<string, readonly IdeaRecord[]>
	{
		const passages = new Map<string, IdeaRecord[]>();
		const document = this.library.GetText();

		if (document !== null && this.ideas !== null && this.signals !== null)
		{
			for (const idea of this.ideas.GetIdeas())
			{
				if (idea.workId !== document.id) continue;
				const keys = new Set<string>();
				const references = idea.originSignal === null
					? idea.relatedSignals
					: [idea.originSignal, ...idea.relatedSignals];
				for (const reference of references)
				{
					const signal = this.signals.GetSignal(reference.signalId);
					if (signal === null) continue;
					for (const key of GetCoveredPassageKeys(document, signal.selection)) keys.add(key);
				}
				for (const key of keys)
				{
					const records = passages.get(key) ?? [];
					records.push(idea);
					passages.set(key, records);
				}
			}
		}

		return passages;
	}

	// Requests the catalogue restriction through the typed event bus.
	private HandleClick(event: MouseEvent): void
	{
		const target = event.target;
		if (target instanceof Element)
		{
			const button = target.closest<HTMLElement>("[data-passage-dreams]");
			const segmentKey = button?.dataset.passageDreams;
			const ideaButton = target.closest<HTMLElement>("[data-passage-ideas]");
			const ideaSegmentKey = ideaButton?.dataset.passageIdeas;
			const document = this.library.GetText();
			if (segmentKey !== undefined && document !== null)
			{
				event.preventDefault();
				void this.events.PublishAsync("dream.passage-filter-requested", { workId: document.id, segmentKey });
			}
			else if (ideaSegmentKey !== undefined)
			{
				event.preventDefault();
				this.OpenIdeas(ideaSegmentKey);
			}

		}
	}

	// Opens one associated Idea directly or asks the reader to choose among several.
	private OpenIdeas(segmentKey: string): void
	{
		const ideas = this.ideaPassages.get(segmentKey) ?? [];

		if (ideas.length === 1)
		{
			const idea = ideas[0];
			if (idea !== undefined) void this.events.PublishAsync("idea.open-requested", { ideaId: idea.id });
		}
		else if (ideas.length > 1)
		{
			this.CloseIdeaChooser();
			this.ideaChooser = new PopupPanel("Choose an Idea");
			let rows = "";
			for (const idea of ideas)
			{
				rows += `<button class="signal-destination-choice button-control" data-passage-idea-id="${EscapeHtml(idea.id)}" type="button"><span aria-hidden="true">${IdeaIcon}</span><span><strong>${EscapeHtml(idea.title.trim() || "Untitled Idea")}</strong><small>Idea</small></span></button>`;
			}
			this.ideaChooser.SetBodyHtml(`<p>More than one Idea is connected to this passage.</p><div class="signal-destination-list">${rows}</div>`);
			this.ideaChooser.OnBodyClick(this.HandleIdeaChooserClick.bind(this));
			this.ideaChooser.OnClose(this.CloseIdeaChooser.bind(this));
			this.ideaChooser.Open();
		}
	}

	private HandleIdeaChooserClick(event: MouseEvent): void
	{
		const target = event.target as HTMLElement | null;
		const ideaId = target?.closest<HTMLElement>("[data-passage-idea-id]")?.dataset.passageIdeaId;

		if (ideaId !== undefined)
		{
			this.CloseIdeaChooser();
			void this.events.PublishAsync("idea.open-requested", { ideaId });
		}
	}

	private CloseIdeaChooser(): void
	{
		const chooser = this.ideaChooser;
		this.ideaChooser = null;

		if (chooser !== null)
		{
			chooser.Close();
			chooser.Dispose();
		}
	}
}