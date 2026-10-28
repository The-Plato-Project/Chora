import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus, type Unsubscribe } from "../core/events/ChoraEventBus.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DocumentIcon } from "../ui/Icons.js";
import { DreamCatalogueController } from "./DreamCatalogueController.js";

// Owns Dream discovery buttons beside reading-pane passage labels.
export class DreamPassagePanel
{
	private readonly subscriptions: Unsubscribe[] = [];
	private readonly clickHandler = this.HandleClick.bind(this);

	public constructor(
		private readonly root: HTMLElement,
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly library: LibraryStore,
		private readonly controller: DreamCatalogueController)
	{
		this.root.addEventListener("click", this.clickHandler);
		const update = this.Update.bind(this);
		this.subscriptions.push(this.events.Subscribe("library.text-opened", update));
		this.subscriptions.push(this.events.Subscribe("dream.catalogue-changed", update));
		this.subscriptions.push(this.events.Subscribe("dream.saved", update));
		this.Update();
	}

	public Dispose(): void
	{
		this.root.removeEventListener("click", this.clickHandler);
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
		const buttons = Array.from(this.root.querySelectorAll("[data-passage-dreams]"));
		for (const button of buttons) button.remove();
	}

	private Update(): void
	{
		const counts = this.controller.GetPassageCounts();
		const titles = this.controller.GetPassageDreamTitles();
		const locators = Array.from(this.root.querySelectorAll<HTMLElement>(".source-locator"));

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
		}
	}

	private HandleClick(event: MouseEvent): void
	{
		const target = event.target;

		if (target instanceof Element)
		{
			const button = target.closest<HTMLElement>("[data-passage-dreams]");
			const segmentKey = button?.dataset.passageDreams;
			const document = this.library.GetText();

			if (segmentKey !== undefined && document !== null)
			{
				event.preventDefault();
				void this.events.PublishAsync("dream.passage-filter-requested", { workId: document.id, segmentKey });
			}
		}
	}
}
