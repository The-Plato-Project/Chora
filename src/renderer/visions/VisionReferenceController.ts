import { CreateVisionReferencePlacement } from "../../shared/visions/VisionReferenceTypes.js";
import type { TextAnchorGateway } from "../anchors/TextAnchorGateway.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { VisionStore } from "./VisionStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";

export class VisionReferenceController
{
	private readonly subscriptions: Unsubscribe[] = [];

	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly visions: VisionStore,
		private readonly anchors: TextAnchorGateway,
		private readonly library: LibraryStore)
	{
		this.subscriptions.push(events.Subscribe("vision.selection-reference-requested", this.CreateReferenceAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.reference-action-requested", this.HandleReferenceActionAsync.bind(this)));
	}

	private async HandleReferenceActionAsync(event: ChoraEvents["vision.reference-action-requested"]): Promise<void>
	{
		try
		{
			const anchor = await this.anchors.ValidateAsync(event.anchorId);
			const current = this.library.GetText();
			if (current === null || current.id !== anchor.workId)
			{
				await this.events.PublishAsync("library.text-open-requested", { textId: anchor.workId });
			}
			if (event.action === "navigate")
			{
				await this.events.PublishAsync("library.jump-requested", {
					selection: anchor.selection,
					target: "source"
				});
			}
			else
			{
				let selection = anchor.selection;
				if (anchor.kind !== "word")
				{
					const relative = event.relativeSelection;
					const document = this.library.GetText();
					if (relative === undefined || document === null || document.id !== anchor.workId)
					{
						throw new Error("Select one Greek word inside the linked text before opening Word Lookup.");
					}
					const candidate = document.CreateSubselection(anchor.selection, relative.start, relative.end);
					const word = document.GetSingleGreekWordSelection(candidate);
					if (word === null
						|| word.start.stephanus !== candidate.start.stephanus
						|| word.start.offset !== candidate.start.offset
						|| word.end.stephanus !== candidate.end.stephanus
						|| word.end.offset !== candidate.end.offset)
					{
						throw new Error("The selected linked text is not one exact Greek word.");
					}
					selection = word;
				}
				await this.events.PublishAsync("word.exploration-requested", { selection });
			}
		}
		catch (error)
		{
			this.errors.Report("VisionReferenceController", error, "The linked text could not be opened.");
		}
	}

	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
	}

	private async CreateReferenceAsync(event: ChoraEvents["vision.selection-reference-requested"]): Promise<void>
	{
		const vision = this.visions.GetActive();
		if (vision === null || vision.workId !== event.selection.dialogue)
		{
			this.errors.Report("VisionReferenceController", new Error("The active Vision does not belong to the selected text."), "Open a Vision for this work before adding the selection.");
			return;
		}
		try
		{
			const anchor = await this.anchors.CreateAsync({ kind: event.anchorKind, selection: event.selection });
			const placement = CreateVisionReferencePlacement(vision.id, anchor);
			await this.events.PublishAsync("vision.reference-created", {
				placement,
				...(event.requestId !== undefined ? { requestId: event.requestId } : {})
			});
		}
		catch (error)
		{
			this.errors.Report("VisionReferenceController", error, "The selected text could not be added to the Vision.");
		}
	}
}
