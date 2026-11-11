// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextAnchorSnapshot } from "../../src/shared/anchors/TextAnchorTypes.js";
import type { WordEvidenceResult } from "../../src/shared/library/WordExplorationTypes.js";
import { SerializeVisionReference } from "../../src/shared/visions/VisionReferenceMarkdown.js";
import type { VisionReferencePlacement } from "../../src/shared/visions/VisionReferenceTypes.js";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";
import type { TextAnchorGateway } from "../../src/renderer/anchors/TextAnchorGateway.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { WordExplorationStore } from "../../src/renderer/library/words/WordExplorationStore.js";
import { WordVisionReferenceController } from "../../src/renderer/library/words/WordVisionReferenceController.js";
import { WordVisionReferenceStore } from "../../src/renderer/library/words/WordVisionReferenceStore.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import { VisionController } from "../../src/renderer/visions/VisionController.js";
import type { VisionGateway } from "../../src/renderer/visions/VisionGateway.js";

afterEach(function Cleanup(): void
{
	window.sessionStorage.clear();
	vi.restoreAllMocks();
});

describe("WordVisionReferenceController", function WordVisionReferenceControllerTests()
{
	it("finds every Vision placement linked to one exact occurrence", async function FindsExactOccurrenceReferencesAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const words = new WordExplorationStore();
		const visions = new VisionStore();
		const references = new WordVisionReferenceStore();
		const library = new LibraryStore();
		const selection = {
			dialogue: "republic",
			text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "327a", offset: 2 },
			end: { stephanus: "327a", offset: 9 }
		};
		const otherSelection = {
			...selection,
			start: { stephanus: "328a", offset: 1 },
			end: { stephanus: "328a", offset: 8 }
		};
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"a".repeat(64)}`,
			workId: "republic",
			kind: "word",
			selection,
			selectedText: "κατέβην",
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const otherAnchor: TextAnchorSnapshot = {
			...anchor,
			id: `anchor:sha256:${"b".repeat(64)}`,
			selection: otherSelection
		};
		const firstPlacement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174002",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: anchor.id,
			presentation: "inline-word",
			label: "κατέβην"
		};
		const secondPlacement: VisionReferencePlacement = {
			...firstPlacement,
			id: "placement:123e4567-e89b-42d3-a456-426614174003",
			visionId: "123e4567-e89b-42d3-a456-426614174001"
		};
		const unrelatedPlacement: VisionReferencePlacement = {
			...firstPlacement,
			id: "placement:123e4567-e89b-42d3-a456-426614174004",
			anchorId: otherAnchor.id
		};
		const catalogue: VisionSnapshot[] = [
			{
				id: firstPlacement.visionId,
				workId: "republic",
				folderPath: "",
				title: "Descent",
				markdown: SerializeVisionReference(firstPlacement),
				createdAt: "2026-09-08T00:00:00.000Z",
				updatedAt: "2026-09-08T00:00:00.000Z"
			},
			{
				id: secondPlacement.visionId,
				workId: "republic",
				folderPath: "",
				title: "Return",
				markdown: `${SerializeVisionReference(secondPlacement)} ${SerializeVisionReference(unrelatedPlacement)}`,
				createdAt: "2026-09-08T00:00:00.000Z",
				updatedAt: "2026-09-08T00:00:00.000Z"
			}
		];
		visions.SetCatalogue({ visions: catalogue, folders: [] });
		words.Select(selection, "κατέβην");
		words.SetEvidence({ selection } as WordEvidenceResult);
		const ListAsync = vi.fn(async () => [anchor, otherAnchor]);
		library.Open(TextDocument.FromSnapshot({
			id: "republic",
			textVersion: selection.text_version,
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "", commit: "", sourceFile: "", license: "" },
			segments: [
				{ key: "327a", citation: null, text: "xxκατέβην" },
				{ key: "328a", citation: null, text: "xκατέβην" }
			]
		}), null);
		const controller = new WordVisionReferenceController(
			events,
			errors,
			words,
			visions,
			{ ListAsync } as unknown as TextAnchorGateway,
			library,
			references);

		await events.PublishAsync("word.exploration-changed", {});

		expect(ListAsync).toHaveBeenCalledWith("republic");
		expect(references.Get(selection)).toEqual([
			{
				visionId: firstPlacement.visionId,
				visionTitle: "Descent",
				placementId: firstPlacement.id,
				excerpt: firstPlacement.label
			},
			{
				visionId: secondPlacement.visionId,
				visionTitle: "Return",
				placementId: secondPlacement.id,
				excerpt: `${secondPlacement.label} ${unrelatedPlacement.label}`
			}
		]);
		expect(references.Get(otherSelection)).toEqual([{
			visionId: secondPlacement.visionId,
			visionTitle: "Return",
			placementId: unrelatedPlacement.id,
			excerpt: `${secondPlacement.label} ${unrelatedPlacement.label}`
		}]);

		const editing = new VisionController(events, errors, visions, {} as VisionGateway);
		const referenceChanges = vi.fn();
		const dirtyChanges = vi.fn();
		const saveStateChanges = vi.fn();
		const catalogueChanges = vi.fn();
		events.Subscribe("word.vision-references-changed", referenceChanges);
		events.Subscribe("vision.dirty-changed", dirtyChanges);
		events.Subscribe("vision.save-state-changed", saveStateChanges);
		events.Subscribe("vision.catalogue-changed", catalogueChanges);
		visions.Open(firstPlacement.visionId);
		const firstMarkdown = catalogue[0]!.markdown;
		editing.UpdateMarkdown(`Prose before the reference. ${firstMarkdown}`);
		editing.UpdateMarkdown(`More prose before the reference. ${firstMarkdown}`);
		await vi.waitFor(function ProseEditSettled(): void
		{
			expect(saveStateChanges).toHaveBeenCalledOnce();
		});
		expect(dirtyChanges).toHaveBeenCalledOnce();
		expect(catalogueChanges).not.toHaveBeenCalled();
		await vi.waitFor(function ContextUpdatedWithoutReloadingAnchors(): void
		{
			expect(references.Get(selection)[0]?.excerpt).toContain("More prose before the reference.");
		});
		expect(referenceChanges).toHaveBeenCalled();
		expect(ListAsync).toHaveBeenCalledOnce();

		editing.UpdateTitle("Descent revised");
		await vi.waitFor(function LinkedTitleUpdated(): void
		{
			expect(references.Get(selection)[0]?.visionTitle).toBe("Descent revised");
		});
		editing.UpdateMarkdown("Writing after removing the reference.");
		await vi.waitFor(function RemovedPlacementDisappeared(): void
		{
			expect(references.Get(selection)).toHaveLength(1);
			expect(references.Get(selection)[0]?.visionId).toBe(secondPlacement.visionId);
		});
		editing.UpdateMarkdown(firstMarkdown);
		await vi.waitFor(function RestoredPlacementReappeared(): void
		{
			expect(references.Get(selection)).toHaveLength(2);
		});
		expect(ListAsync).toHaveBeenCalledOnce();
		expect(references.Get(otherSelection)).toHaveLength(1);
		editing.Dispose();
		controller.Dispose();
	});

	it("links every exact word contained by a phrase or passage placement", async function FindsContainedWordReferencesAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const words = new WordExplorationStore();
		const visions = new VisionStore();
		const references = new WordVisionReferenceStore();
		const library = new LibraryStore();
		const textVersion = `sha256:${"0".repeat(64)}`;
		const document = TextDocument.FromSnapshot({
			id: "republic",
			textVersion,
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "", commit: "", sourceFile: "", license: "" },
			segments: [
				{ key: "327a", citation: null, text: "κατέβην χθὲς" },
				{ key: "327b", citation: null, text: "εἰς Πειραιᾶ" }
			]
		});
		library.Open(document, null);
		const passageSelection = {
			dialogue: "republic",
			text_version: textVersion,
			start: { stephanus: "327a", offset: 0 },
			end: { stephanus: "327b", offset: 10 }
		};
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"c".repeat(64)}`,
			workId: "republic",
			kind: "passage",
			selection: passageSelection,
			selectedText: document.ReconstructText(passageSelection),
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const placement: VisionReferencePlacement = {
			id: "placement:123e4567-e89b-42d3-a456-426614174005",
			visionId: "123e4567-e89b-42d3-a456-426614174000",
			anchorId: anchor.id,
			presentation: "inline-range",
			label: anchor.selectedText
		};
		visions.SetCatalogue({ visions: [{
			id: placement.visionId,
			workId: "republic",
			folderPath: "",
			title: "Descent",
			markdown: SerializeVisionReference(placement),
			createdAt: "2026-09-08T00:00:00.000Z",
			updatedAt: "2026-09-08T00:00:00.000Z"
		}], folders: [] });
		const contained = document.GetGreekWordSelections(passageSelection);
		words.Select(contained[0]!, "κατέβην");
		words.SetEvidence({ selection: contained[0]! } as WordEvidenceResult);
		const controller = new WordVisionReferenceController(
			events,
			errors,
			words,
			visions,
			{ ListAsync: vi.fn(async () => [anchor]) } as unknown as TextAnchorGateway,
			library,
			references);

		await events.PublishAsync("word.exploration-changed", {});

		expect(contained).toHaveLength(4);
		for (const selection of contained)
		{
			expect(references.Get(selection)).toEqual([{
				visionId: placement.visionId,
				visionTitle: "Descent",
				placementId: placement.id,
				excerpt: anchor.selectedText
			}]);
		}

		const editing = new VisionController(events, errors, visions, {} as VisionGateway);
		visions.Open(placement.visionId);
		editing.UpdateMarkdown("The passage reference was removed.");
		await vi.waitFor(() =>
		{
			expect(references.Get(contained[0]!)).toHaveLength(0);
			expect(references.Get(contained[3]!)).toHaveLength(0);
		});

		editing.Dispose();
		controller.Dispose();
	});
});
