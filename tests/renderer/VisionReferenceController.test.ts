// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { TextAnchorSnapshot } from "../../src/shared/anchors/TextAnchorTypes.js";
import type { VisionSnapshot } from "../../src/shared/visions/VisionTypes.js";
import type { VisionReferencePlacement } from "../../src/shared/visions/VisionReferenceTypes.js";
import type { TextAnchorGateway } from "../../src/renderer/anchors/TextAnchorGateway.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import { VisionReferenceController } from "../../src/renderer/visions/VisionReferenceController.js";
import { VisionStore } from "../../src/renderer/visions/VisionStore.js";
import type { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { TextDocument } from "../../src/shared/text/TextDocument.js";

describe("VisionReferenceController", function VisionReferenceControllerTests()
{
	it("creates one exact anchor and a separate placement for the active Vision", async function CreatesPlacementAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const visions = new VisionStore();
		const vision: VisionSnapshot = {
			id: "123e4567-e89b-42d3-a456-426614174000",
			workId: "republic",
			folderPath: "",
			title: "Money",
			markdown: "",
			createdAt: "2026-09-08T00:00:00.000Z",
			updatedAt: "2026-09-08T00:00:00.000Z"
		};
		visions.SetCatalogue({ visions: [vision], folders: [] });
		visions.Open(vision.id);
		const selection = {
			dialogue: "republic",
			text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "327a", offset: 2 },
			end: { stephanus: "327a", offset: 9 }
		};
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"a".repeat(64)}`,
			workId: "republic",
			kind: "word",
			selection,
			selectedText: "κατέβην",
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const CreateAsync = vi.fn(async () => anchor);
		const library = { GetText: () => ({ id: "republic" }) } as unknown as LibraryStore;
		const controller = new VisionReferenceController(events, errors, visions, { CreateAsync } as unknown as TextAnchorGateway, library);
		let placement: VisionReferencePlacement | null = null;
		events.Subscribe("vision.reference-created", (event) =>
		{
			placement = event.placement;
		});

		await events.PublishAsync("vision.selection-reference-requested", { selection, anchorKind: "word" });

		expect(CreateAsync).toHaveBeenCalledWith({ kind: "word", selection });
		expect(placement).toMatchObject({
			visionId: vision.id,
			anchorId: anchor.id,
			presentation: "inline-word",
			label: "κατέβην"
		});
		expect(placement?.id).toMatch(/^placement:/u);
		controller.Dispose();
	});

	it("creates a passage anchor and inline range placement", async function CreatesPassagePlacementAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const visions = new VisionStore();
		const vision: VisionSnapshot = {
			id: "123e4567-e89b-42d3-a456-426614174000",
			workId: "republic",
			folderPath: "",
			title: "Passage",
			markdown: "",
			createdAt: "2026-09-08T00:00:00.000Z",
			updatedAt: "2026-09-08T00:00:00.000Z"
		};
		visions.SetCatalogue({ visions: [vision], folders: [] });
		visions.Open(vision.id);
		const selection = {
			dialogue: "republic",
			text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "327a", offset: 0 },
			end: { stephanus: "327b", offset: 8 }
		};
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"c".repeat(64)}`,
			workId: "republic",
			kind: "passage",
			selection,
			selectedText: "κατέβην\nπρὸς τὸν",
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const CreateAsync = vi.fn(async () => anchor);
		const library = { GetText: () => ({ id: "republic" }) } as unknown as LibraryStore;
		const controller = new VisionReferenceController(events, errors, visions, { CreateAsync } as unknown as TextAnchorGateway, library);
		let placement: VisionReferencePlacement | null = null;
		let createdRequestId: string | undefined;
		events.Subscribe("vision.reference-created", (event) =>
		{
			placement = event.placement;
			createdRequestId = event.requestId;
		});

		await events.PublishAsync("vision.selection-reference-requested", {
			selection,
			anchorKind: "passage",
			requestId: "drop-request"
		});

		expect(CreateAsync).toHaveBeenCalledWith({ kind: "passage", selection });
		expect(placement).toMatchObject({
			anchorId: anchor.id,
			presentation: "inline-range",
			label: anchor.selectedText
		});
		expect(createdRequestId).toBe("drop-request");
		controller.Dispose();
	});

	it("resolves Vision word actions through the exact anchor", async function ResolvesReferenceActionsAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const visions = new VisionStore();
		const selection = {
			dialogue: "republic",
			text_version: `sha256:${"0".repeat(64)}`,
			start: { stephanus: "327a", offset: 2 },
			end: { stephanus: "327a", offset: 9 }
		};
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"a".repeat(64)}`,
			workId: "republic",
			kind: "word",
			selection,
			selectedText: "κατέβην",
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const ValidateAsync = vi.fn(async () => anchor);
		const library = { GetText: () => ({ id: "republic" }) } as unknown as LibraryStore;
		const controller = new VisionReferenceController(
			events,
			errors,
			visions,
			{ ValidateAsync } as unknown as TextAnchorGateway,
			library);
		const jumps: ChoraEvents["library.jump-requested"][] = [];
		const lookups: ChoraEvents["word.exploration-requested"][] = [];
		events.Subscribe("library.jump-requested", (event) => { jumps.push(event); });
		events.Subscribe("word.exploration-requested", (event) => { lookups.push(event); });

		await events.PublishAsync("vision.reference-action-requested", { anchorId: anchor.id, action: "navigate" });
		await events.PublishAsync("vision.reference-action-requested", { anchorId: anchor.id, action: "explore-word" });

		expect(ValidateAsync).toHaveBeenCalledTimes(2);
		expect(jumps).toEqual([{ selection, target: "source" }]);
		expect(lookups).toEqual([{ selection }]);
		controller.Dispose();
	});

	it("opens an exact selected word inside a passage anchor", async function ResolvesPassageWordAsync(): Promise<void>
	{
		const events = new ChoraEventBus<ChoraEvents>();
		const errors = new ErrorManager(events);
		const visions = new VisionStore();
		const document = new TextDocument({
			id: "republic",
			textVersion: `sha256:${"0".repeat(64)}`,
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "test", commit: "test", sourceFile: "test", license: "test" },
			segments: [{ key: "327a", citation: null, text: "κατέβην πρὸς" }]
		});
		const selection = document.CreateSelection(
			{ stephanus: "327a", offset: 0 },
			{ stephanus: "327a", offset: 12 });
		const anchor: TextAnchorSnapshot = {
			id: `anchor:sha256:${"f".repeat(64)}`,
			workId: "republic",
			kind: "phrase",
			selection,
			selectedText: "κατέβην πρὸς",
			createdAt: "2026-09-08T00:00:00.000Z"
		};
		const ValidateAsync = vi.fn(async () => anchor);
		const library = { GetText: () => document } as unknown as LibraryStore;
		const controller = new VisionReferenceController(
			events,
			errors,
			visions,
			{ ValidateAsync } as unknown as TextAnchorGateway,
			library);
		let explored: ChoraEvents["word.exploration-requested"] | null = null;
		events.Subscribe("word.exploration-requested", (event) => { explored = event; });

		await events.PublishAsync("vision.reference-action-requested", {
			anchorId: anchor.id,
			action: "explore-word",
			relativeSelection: { start: 8, end: 12 }
		});

		expect(explored?.selection.start).toEqual({ stephanus: "327a", offset: 8 });
		expect(explored?.selection.end).toEqual({ stephanus: "327a", offset: 12 });
		controller.Dispose();
	});
});
