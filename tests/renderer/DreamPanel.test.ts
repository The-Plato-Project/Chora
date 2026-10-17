// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ReadingSettingsStore } from "../../src/renderer/core/settings/ReadingSettingsStore.js";
import { DreamPanel } from "../../src/renderer/dreams/DreamPanel.js";
import { DreamController } from "../../src/renderer/dreams/DreamController.js";
import { DreamStore } from "../../src/renderer/dreams/DreamStore.js";
import { DreamGateway } from "../../src/renderer/dreams/DreamGateway.js";
import { LibraryStore } from "../../src/renderer/library/LibraryStore.js";
import { SessionStore } from "../../src/renderer/core/session/SessionStore.js";
import { ChoraEventBus } from "../../src/renderer/core/events/ChoraEventBus.js";
import { ErrorManager } from "../../src/renderer/core/diagnostics/RendererErrorManager.js";
import type { ChoraEvents } from "../../src/renderer/core/events/ChoraEvents.js";
import type { DreamView } from "../../src/renderer/dreams/DreamView.js";
import type { IdeaRecord } from "../../src/shared/ideas/IdeaTypes.js";
import { IdeaStore } from "../../src/renderer/ideas/IdeaStore.js";
import { AddIcon } from "../../src/renderer/ui/Icons.js";

// Creates a small persisted DreamView with two independently editable signals.
function CreateDream(): DreamView
{
	const selection = {
		documentId: "republic", start: { segmentKey: "s1", offset: 0 },
		end: { segmentKey: "s1", offset: 6 }, selectedText: "abcdef",
		locatorStart: null, locatorEnd: null
	};
	const dream: DreamView = {
		id: "dream-1", workId: "republic", dialogue: "Republic", title: "A long Dream title",
		source: { ...selection, sourceRefs: ["s1"], startSourceRef: "s1", endSourceRef: "s1" },
		signals: [
			{ id: "signal-1", text: "abc", description: "First description", sourceRef: "s1", selection },
			{ id: "signal-2", text: "def", description: "Second description", sourceRef: "s1", selection }
		],
		reflection: "Initial Reflections", synopticView: "", linkedDreamIds: [], createdAt: "2026-09-06", updatedAt: "2026-09-06"
	};
	return dream;
}

function CreateIdeas(): IdeaRecord[]
{
	return [
		{
			id: "idea-origin", workId: "republic", title: "Descent", content: "",
			originSignal: { signalId: "signal-1" }, relatedSignals: [],
			createdAt: "2026-01-01", updatedAt: "2026-01-01"
		},
		{
			id: "idea-related", workId: "republic", title: "Seeing", content: "",
			originSignal: { signalId: "another-signal" },
			relatedSignals: [{ signalId: "signal-1" }],
			createdAt: "2026-01-01", updatedAt: "2026-01-01"
		},
		{
			id: "idea-available", workId: "republic", title: "Justice", content: "",
			originSignal: null, relatedSignals: [],
			createdAt: "2026-01-01", updatedAt: "2026-01-01"
		}
	];
}

// Selects editor content and activates its bold toolbar action.
function FormatBold(root: HTMLElement): void
{
	const content = root.querySelector<HTMLElement>("[contenteditable=true]")!;
	content.focus();
	const range = document.createRange();
	range.selectNodeContents(content);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	root.querySelector<HTMLButtonElement>('[data-markdown-command="bold"]')!.click();
}

// Requires one document element for rename workflow assertions.
function RequireDocumentElement<T extends Element>(selector: string): T
{
	const element = document.querySelector<T>(selector);

	if (element === null)
	{
		throw new Error(`Missing test element: ${selector}`);
	}

	return element;
}

// Requires one ancestor element for rename workflow assertions.
function RequireClosestElement<T extends Element>(element: Element, selector: string): T
{
	const closest = element.closest<T>(selector);

	if (closest === null)
	{
		throw new Error(`Missing test ancestor: ${selector}`);
	}

	return closest;
}

describe("DreamPanel", function DreamPanelTests()
{
	let panel: DreamPanel;
	let root: HTMLElement;
	let store: DreamStore;
	let events: ChoraEventBus<ChoraEvents>;
	let gateway: DreamGateway;
	let controller: DreamController;
	let library: LibraryStore;
	let ideas: IdeaStore;
	let auxiliaryPanels: DreamPanel[];

	beforeEach(async function SetupAsync()
	{
		window.sessionStorage.clear();
		root = document.createElement("div");
		document.body.append(root);
		events = new ChoraEventBus<ChoraEvents>();
		store = new DreamStore(new SessionStore());
		const dream = CreateDream();
		store.Open(dream, false);
		gateway = new DreamGateway();
		vi.spyOn(gateway, "ListAsync").mockResolvedValue([dream]);
		vi.spyOn(gateway, "SaveAsync").mockImplementation(async function SaveAsync(record: Dream): Promise<Dream>
		{
			const saved = structuredClone(record);
			return saved;
		});

		vi.spyOn(gateway, "SaveSignalDescriptionAsync").mockImplementation(async function SaveSignalDescriptionAsync(signal, workId, description)
		{
			return {
				...structuredClone(signal),
				workId,
				description,
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01"
			};
		});
		library = new LibraryStore();
		library.Open({
			id: "republic",
			urn: null,
			title: "Republic",
			titleGreek: null,
			author: "Plato",
			language: "grc",
			edition: { editor: null, title: null, volume: null, publisher: null, publicationPlace: null, publicationDate: null },
			provenance: { repository: "test", commit: "test", sourceFile: "test.xml", license: "test" },
			segments: [{ key: "s1", citation: { system: "stephanus", value: "327a" }, text: "abcdef" }]
		} as never, null);
		ideas = new IdeaStore();
		ideas.SetWork("republic", CreateIdeas());
		auxiliaryPanels = [];
		const errors = new ErrorManager(events);
		controller = new DreamController(events, errors, library, store, gateway);
		panel = new DreamPanel(root, events, store, controller, library, "editor", ideas);
		await vi.waitFor(function EditorsReady(): void
		{
			expect(root.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
		});
		vi.useFakeTimers();
	});

	afterEach(function Cleanup()
	{
		panel.Dispose();
		for (const auxiliaryPanel of auxiliaryPanels) auxiliaryPanel.Dispose();
		store.Dispose();
		document.body.replaceChildren();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("keeps Dream deletion out of the editor surface", function HidesDeleteFromEditor(): void
	{
		const deleteDream = vi.spyOn(gateway, "DeleteAsync").mockResolvedValue();
		expect(root.querySelector("[data-delete-dream]")).toBeNull();
		expect(deleteDream).not.toHaveBeenCalled();
	});

	// Opens the rename workflow from the DreamView Explorer, where title editing is exposed.
	function OpenRenameFromCatalogue(): void
	{
		const activeDream = store.GetActiveDream();
		if (activeDream !== null) store.SetCatalogue([activeDream]);
		const catalogueRoot = document.createElement("div");
		document.body.append(catalogueRoot);
		const cataloguePanel = new DreamPanel(catalogueRoot, events, store, controller, library, "catalogue");
		auxiliaryPanels.push(cataloguePanel);
		catalogueRoot.querySelector<HTMLButtonElement>("[data-rename-dream]")!.click();
	}

	it("opens, switches, and closes persistent Dream tabs without losing inner navigation", async function ManagesDreamTabsAsync()
	{
		const first = store.GetActiveDream()!;
		const second = structuredClone(first);
		second.id = "dream-2";
		second.title = "Second Dream";
		store.SetCatalogue([first, second]);
		const innerTabs = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		innerTabs[1]?.click();

		controller.Open(second.id);
		expect(store.GetOpenTabs()).toHaveLength(2);
		expect(store.GetActiveDream()?.id).toBe("dream-2");
		controller.ActivateTab("dream-1");

		expect(store.GetActiveDream()?.id).toBe("dream-1");
		expect(root.querySelector<HTMLButtonElement>('.dream-tabs-host [role=tab][aria-selected="true"]')?.textContent).toBe("Reflections");
		const restoredStore = new DreamStore(new SessionStore());
		expect(restoredStore.GetOpenTabs()).toHaveLength(2);
		expect(restoredStore.GetActiveDream()?.id).toBe("dream-1");
		expect(restoredStore.GetEditorTab("dream-1")).toBe("reflections");
		restoredStore.Dispose();

		await controller.CloseTabAsync("dream-1");
		expect(store.GetOpenTabs()).toHaveLength(1);
		expect(store.GetActiveDream()?.id).toBe("dream-2");
	});

	it("copies the complete Dream as Markdown from the outer document menu", async function CopiesDreamMarkdownAsync()
	{
		controller.UpdateSynopticView("The reader's developing account is visible.");
		const copy = vi.spyOn(gateway, "CopyAsync").mockResolvedValue(undefined);
		const tabs = root.querySelectorAll<HTMLButtonElement>('.dream-tabs-host [role="tab"]');
		expect(Array.from(tabs, function Label(tab): string | null { return tab.textContent; })).toEqual(["Signals", "Reflections", "Clarity Check"]);
		tabs[2]?.click();
		const checkButton = root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]");
		expect(checkButton?.title).toBe("Check clarity");
		expect(root.querySelector("[data-dream-synoptic-view] .markdown-toolbar")?.getAttribute("aria-label")).toBe("Clarity Check formatting");
		void controller.CopyDreamAsMarkdownAsync();
		await vi.waitFor(function DreamCopied(): void { expect(copy).toHaveBeenCalledOnce(); });
		const markdown = vi.mocked(copy).mock.calls[0]?.[0] ?? "";
		expect(markdown).toContain("# A long Dream title");
		expect(markdown).toContain("## Source Passage");
		expect(markdown).toContain("### Signal");
		expect(markdown).toContain("> abc");
		expect(markdown).toContain("Source: Republic · s1");
		expect(markdown).toContain("#### Observation");
		expect(markdown).toContain("First description");
		expect(markdown).toContain("## Reflections");
		expect(markdown).toContain("Initial Reflections");
		expect(markdown).toContain("## Clarity Check");
		expect(markdown).not.toContain("## Synoptic View");
	});

	it("generates an editable Clarity Check and copies it to the clipboard", async function CreatesAndCopiesSynopticViewAsync()
	{
		let complete: ((value: string) => void) | null = null;
		vi.spyOn(gateway, "CreateSynopticViewAsync").mockImplementation(() => new Promise<string>((resolve) => { complete = resolve; }));
		const copy = vi.spyOn(gateway, "CopyAsync").mockResolvedValue(undefined);
		const tabs = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		tabs[2]!.click();
		const create = root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]")!;
		expect(create.title).toBe("Check clarity");
		expect(create.textContent).toBe("");
		create.click();
		await vi.waitFor(function GenerationShown(): void
		{
			expect(create.title).toBe("Cancel");
			expect(root.querySelector<HTMLElement>("[data-synoptic-view-progress]")?.hidden).toBe(false);
		});
		await Promise.resolve();
		if (complete === null) throw new Error("Clarity Check request did not start.");
		complete("## Shared movement\n\nA generated relationship.");
		await vi.waitFor(function SynopticViewApplied(): void
		{
			expect(store.GetActiveDream()?.synopticView).toContain("Shared movement");
			expect(root.querySelector<HTMLElement>("[data-synoptic-view-progress]")?.hidden).toBe(true);
			expect(create.title).toBe("Check clarity");
		});

		const copyButton = root.querySelector<HTMLButtonElement>("[data-copy-synoptic-view]")!;
		expect(copyButton.title).toBe("Copy");
		expect(copyButton.textContent).toBe("");
		copyButton.click();
		await vi.waitFor(function SynopticViewCopied(): void { expect(copy).toHaveBeenCalledWith("## Shared movement\n\nA generated relationship."); });

		expect(store.GetActiveDream()?.reflection).toBe("Initial Reflections");
		expect(store.GetActiveDream()?.synopticView).toContain("Shared movement");
		expect(root.querySelector<HTMLButtonElement>('.dream-tabs-host [role=tab][aria-selected="true"]')?.textContent).toBe("Clarity Check");
	});

	it("does not replace a populated Clarity Check without confirmation", async function ProtectsSynopticViewAsync()
	{
		controller.UpdateSynopticView("Existing Clarity Check");
		await events.PublishAsync("dream.synoptic-view-state-changed", { dreamId: "dream-1" });
		const create = vi.spyOn(gateway, "CreateSynopticViewAsync").mockResolvedValue("Replacement");
		vi.spyOn(window, "confirm").mockReturnValue(false);
		root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]")[2]!.click();

		root.querySelector<HTMLButtonElement>("[data-create-synoptic-view]")!.click();

		expect(create).not.toHaveBeenCalled();
		expect(store.GetActiveDream()?.synopticView).toBe("Existing Clarity Check");
	});

	it("uses the document tab as the title and retains source disclosure on structural updates", async function PreservesSource()
	{
		expect(root.querySelector("[data-dream-title]")).toBeNull();
		expect(root.querySelector("[data-dream-heading]")).toBeNull();
		expect(root.querySelector(".signal-observation-heading")).toBeNull();
		expect(document.querySelectorAll(".popup-overlay")).toHaveLength(0);
		const title = root.querySelector<HTMLInputElement>("[data-dream-editor-title]")!;
		expect(title.value).toBe("A long Dream title");
		expect(root.querySelector("[data-dream-reflections]")).not.toBeNull();
		title.value = "A titled Dream";
		title.dispatchEvent(new Event("input", { bubbles: true }));
		expect(store.GetActiveDream()?.title).toBe("A titled Dream");
		const details = root.querySelector<HTMLDetailsElement>(".dream-source-section")!;
		const source = root.querySelector("[data-dream-source]")!;
		expect(source.tagName).toBe("BLOCKQUOTE");
		expect(details.open).toBe(true);
		expect(details.style.height).not.toBe("");
		const divider = root.querySelector<HTMLElement>("[data-dream-source-divider]")!;
		const editor = root.querySelector<HTMLElement>(".dream-editor.document-editor")!;
		vi.spyOn(details, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 144));
		vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 700, 800));
		divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(details.style.height).toBe("168px");
		expect(window.localStorage.getItem("chora:layout-settings")).toContain('"dreamSourceHeight":168');
		await events.PublishAsync("dream.structure-changed", { dreamId: "dream-1" });
		expect(root.querySelector(".dream-source-section")).toBe(details);
		expect(details.open).toBe(true);
		expect(source.textContent).toBe("abcdef");
	});

	it("applies reading size to Dream content", async function ScalesDreamContentAsync()
	{
		const stylesheet = document.createElement("style");
		const styles = ["base", "workspace-theme", "left-tab-panels", "dark-theme", "tabs", "dream-editor", "markdown-editor", "responsive"];
		stylesheet.textContent = styles.map(function ReadStyle(name): string
		{
			const content = readFileSync(`src/renderer/styles/${name}.css`, "utf8");
			return content;
		}).join("\n");
		const previousStyle = document.documentElement.style.cssText;
		const previousTheme = document.documentElement.dataset.theme;
		const previousSettings = window.localStorage.getItem("chora:reading-settings");
		document.head.append(stylesheet);
		try
		{
			const settings = new ReadingSettingsStore();
			settings.Apply();
			const selectors = [".dream-source", ".signal-markdown-editor .ProseMirror p", ".dream-reflections-markdown .ProseMirror p"];
			const formattingToolbar = root.querySelector<HTMLElement>(".signal-markdown-editor .markdown-toolbar")!;
			expect(getComputedStyle(root.querySelector<HTMLElement>(".signal-heading")!).fontSize).toBe("12px");
			expect(getComputedStyle(formattingToolbar).position).toBe("sticky");
			expect(getComputedStyle(formattingToolbar).top).toBe("0px");
			for (const delta of [0, 2, -1])
			{
				settings.ChangeFontSize(delta);
				expect(document.documentElement.style.getPropertyValue("--reading-font-size")).toBe(`${settings.GetFontSize()}px`);
				stylesheet.remove();
				document.head.append(stylesheet);
				for (const selector of selectors)
				{
					const content = root.querySelector<HTMLElement>(selector)!;
					expect(content, selector).not.toBeNull();
					expect(getComputedStyle(content).fontSize, selector).toBe(`${settings.GetFontSize()}px`);
				}
			}
		}
		finally
		{
			stylesheet.remove();
			document.documentElement.style.cssText = previousStyle;
			if (previousTheme === undefined) delete document.documentElement.dataset.theme;
			else document.documentElement.dataset.theme = previousTheme;
			if (previousSettings === null) window.localStorage.removeItem("chora:reading-settings");
			else window.localStorage.setItem("chora:reading-settings", previousSettings);
		}
	});

	it("preserves editors and expansion when switching tabs and autosaves content", async function PreservesEditors()
	{
		const buttons = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		expect(buttons[1]?.textContent).toBe("Reflections");
		const toggle = root.querySelector<HTMLButtonElement>("[data-signal-toggle]")!;
		toggle.click();
		const description = root.querySelector<HTMLElement>("[data-signal-description]")!;
		FormatBold(description);
		buttons[1]!.click();
		const reflections = root.querySelector<HTMLElement>("[data-dream-reflections]")!;
		FormatBold(reflections);
		buttons[0]!.click();
		expect(root.querySelector("[data-signal-toggle]")).toBe(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(description.hidden).toBe(false);
		expect(description.querySelector("strong")?.textContent).toBe("First description");
		expect(root.querySelector("[data-dream-reflections]")).toBe(reflections);
		await vi.advanceTimersByTimeAsync(800);
		expect(gateway.SaveAsync).toHaveBeenCalledWith(expect.objectContaining({ reflection: expect.stringContaining("**Initial Reflections**") }));
		expect(store.GetActiveDream()?.signals[0]?.description).toContain("**First description**");
		expect(store.GetSaveState()).toBe("idle");
	});

	it("selects one signal at a time, focuses it, and does not replace editors", async function SelectsOneSignalAsync()
	{
		const first = root.querySelector<HTMLElement>('[data-signal-id="signal-1"]')!;
		const second = root.querySelector<HTMLElement>('[data-signal-id="signal-2"]')!;
		const editor = first.querySelector("[contenteditable=true]");
		expect(first.hidden).toBe(false);
		expect(second.hidden).toBe(true);
		expect(second.querySelector("[contenteditable=true]")).toBeNull();
		expect(first.querySelector(".signal-detail-heading")).toBeNull();
		expect(first.querySelector("[data-signal-edit]")).toBeNull();
		expect(first.querySelector(".signal-detail-title [data-signal-chat]")).toBeNull();
		expect(root.querySelector('[data-signal-toggle="signal-1"]')?.textContent).toBe("abc");
		root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-2"]')!.click();
		expect(first.hidden).toBe(true);
		expect(second.hidden).toBe(false);
		await vi.waitFor(function SelectedDescriptionLoaded(): void
		{
			expect(second.querySelector("[contenteditable=true]")?.textContent).toBe("Second description");
		});
		const secondEditor = second.querySelector("[contenteditable=true]");
		expect(document.activeElement).toBe(secondEditor);
		root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-1"]')!.click();
		await Promise.resolve();
		expect(first.hidden).toBe(false);
		expect(first.querySelector("[contenteditable=true]")).toBe(editor);
		expect(document.activeElement).toBe(editor);
	});

	it("resizes the Signal list with its divider and shows complete Signal tooltips", function ResizesSignalList(): void
	{
		const body = root.querySelector<HTMLElement>(".signal-view-body")!;
		const list = root.querySelector<HTMLElement>(".signal-view-body > .signal-list")!;
		const divider = root.querySelector<HTMLElement>(".signal-view-divider")!;
		const first = root.querySelector<HTMLButtonElement>('[data-signal-toggle="signal-1"]')!;
		vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 500));
		vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 232, 500));
		vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(new DOMRect(232, 0, 5, 500));

		divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

		expect(first.title).toBe("abc");
		expect(divider.getAttribute("role")).toBe("separator");
		expect(divider.getAttribute("aria-orientation")).toBe("vertical");
		expect(divider.getAttribute("aria-valuenow")).toBe("256");
		expect(body.style.getPropertyValue("--signal-navigation-width")).toBe("256px");
		expect(window.localStorage.getItem("chora:layout-settings")).toContain('"signalNavigationWidth":256');
	});

	it("does not show Add Signal in the Dream Signal rail", function OmitsAddSignal()
	{
		expect(root.querySelector("[data-signal-view-add]")).toBeNull();
		expect(root.querySelector(".dream-signals-panel .signal-view-header")).toBeNull();
	});

	it("lists connected Ideas before available Ideas in the Add to Idea menu", async function OpensConnectedIdeaAsync()
	{
		const ideasMenu = root.querySelector<HTMLDetailsElement>(".signal-ideas-menu")!;
		const remove = root.querySelector<HTMLButtonElement>("[data-remove-signal-association]")!;
		const actions = ideasMenu.closest(".signal-toolbar-actions");
		expect(actions).not.toBeNull();
		expect(actions?.parentElement?.classList.contains("markdown-toolbar")).toBe(true);
		expect(actions?.nextElementSibling).toBeNull();
		expect(Array.from(actions?.children ?? [])).toEqual([ideasMenu, remove]);
		const summary = ideasMenu.querySelector<HTMLElement>("[data-signal-ideas-menu]")!;
		expect(summary.textContent).toBe("");
		expect(summary.title).toBe("Add to Idea");
		vi.spyOn(summary, "getBoundingClientRect").mockReturnValue(new DOMRect(700, 700, 28, 28));
		summary.click();
		const menuList = ideasMenu.querySelector<HTMLElement>(".action-menu-items")!;
		expect(menuList.style.left).not.toBe("");
		expect(menuList.style.top).not.toBe("");
		expect(menuList.style.width).not.toBe("");
		expect(menuList.style.maxHeight).not.toBe("");
		const ideaButtons = ideasMenu.querySelectorAll<HTMLButtonElement>("[data-open-signal-idea]");
		expect(Array.from(ideaButtons, function GetIdeaTitle(button): string | null
		{
			return button.textContent;
		})).toEqual(["Descent", "Seeing"]);
		expect(Array.from(ideasMenu.querySelectorAll(".signal-ideas-section-label"), function GetLabel(label): string | null
		{
			return label.textContent;
		})).toEqual(["Already in", "Add to"]);
		const addButton = ideasMenu.querySelector<HTMLButtonElement>('[data-idea-id="idea-available"]')!;
		expect(addButton.textContent).toBe("Justice");
		expect(addButton.querySelector("svg")?.outerHTML).toBe(AddIcon);
		expect(addButton.title).toBe("Justice");
		let openedIdeaId: string | null = null;
		events.Subscribe("idea.open-requested", function CaptureIdea(event): void
		{
			openedIdeaId = event.ideaId;
		});
		ideaButtons[1]?.click();
		await vi.waitFor(function IdeaOpened(): void
		{
			expect(openedIdeaId).toBe("idea-related");
		});
		expect(ideasMenu.open).toBe(false);
	});

	it("confirms removing a Signal from the Dream", function RemovesSignalAssociation()
	{
		const remove = root.querySelector<HTMLButtonElement>("[data-remove-signal-association]")!;
		expect(remove.textContent).toBe("");
		expect(remove.title).toBe("Remove from Dream");

		remove.click();
		const prompt = document.querySelector<HTMLElement>("[data-signal-remove-confirm]")?.closest<HTMLElement>(".popup-overlay");
		const cancel = prompt?.querySelector<HTMLButtonElement>("[data-signal-remove-cancel]");
		expect(prompt?.hidden).toBe(false);
		expect(prompt?.textContent).toContain("abc");
		expect(document.activeElement).toBe(cancel);
		cancel?.click();
		expect(store.GetActiveDream()?.signals).toHaveLength(2);

		remove.click();
		prompt?.querySelector<HTMLButtonElement>("[data-signal-remove-confirm]")?.click();
		expect(store.GetActiveDream()?.signals).toHaveLength(1);
		expect(store.GetActiveDream()?.signals[0]?.id).toBe("signal-2");
	});

	it("does not infer document-level Idea relationships from shared Signals", function OmitsIdeaRelationships()
	{
		const tabs = root.querySelectorAll<HTMLButtonElement>(".dream-tabs-host [role=tab]");
		expect(Array.from(tabs, function Label(tab): string | null { return tab.textContent; })).toEqual(["Signals", "Reflections", "Clarity Check"]);
		expect(root.querySelector(".signal-relationships-panel")).toBeNull();
	});

	it("renames Dreams without exposing deletion on Signal rows", async function EditsSettings()
	{
		expect(root.querySelector("[data-dream-heading]")).toBeNull();
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		const save = RequireDocumentElement<HTMLButtonElement>("[data-dream-rename-save]");
		expect(document.activeElement).toBe(input);
		expect(save.textContent).toBe("Save");
		input.value = "Renamed Dream";
		expect(store.GetActiveDream()?.title).toBe("A long Dream title");
		save.click();
		await vi.waitFor(function RenameSaved(): void
		{
			expect(overlay.hidden).toBe(true);
		});
		await vi.waitFor(function DreamRenamed(): void
		{
			expect(store.GetActiveDream()?.title).toBe("Renamed Dream");
		});
		const reflections = root.querySelector("[data-dream-reflections]");
		expect(document.querySelector("[data-settings-signals]")).toBeNull();
		const activeSignal = root.querySelector<HTMLElement>(".signal-item:not([hidden])")!;
		expect(activeSignal.querySelectorAll(".action-menu")).toHaveLength(1);
		expect(activeSignal.querySelector(".signal-ideas-menu")).not.toBeNull();
		const summary = activeSignal.querySelector<HTMLElement>("[data-signal-ideas-menu]")!;
		expect(summary.title).toBe("Add to Idea");
		summary.click();
		const addToIdea = activeSignal.querySelector<HTMLButtonElement>("[data-add-signal-to-idea]")!;
		expect(addToIdea.closest(".signal-toolbar-actions")?.parentElement?.classList.contains("markdown-toolbar")).toBe(true);
		expect(addToIdea.textContent).toBe("Justice");
		const addition = vi.fn();
		const unsubscribeAddition = events.Subscribe("idea.add-signal-requested", addition);
		addToIdea.click();
		await vi.waitFor(function IdeaAdditionRequested(): void
		{
			expect(addition).toHaveBeenCalledWith({ dreamId: "dream-1", signalId: "signal-1", ideaId: "idea-available" });
		});
		unsubscribeAddition();
		expect(root.querySelector("[data-delete-signal]")).toBeNull();
		expect(document.querySelector("[data-dream-title]")).toBe(input);
		expect(root.querySelector("[data-dream-reflections]")).toBe(reflections);
		expect(store.GetActiveDream()?.signals).toHaveLength(2);
		expect(root.querySelector('[data-signal-id="signal-1"]')).not.toBeNull();
		expect(gateway.SaveAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed Dream" }));
		expect(store.GetSaveState()).toBe("idle");
	});

	it("saves and closes the rename dialog when Enter is pressed", async function RenamesWithEnter()
	{
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		input.value = "Named with Enter";

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		await vi.waitFor(function RenameSaved(): void
		{
			expect(overlay.hidden).toBe(true);
		});
		expect(store.GetActiveDream()?.title).toBe("Named with Enter");
		expect(gateway.SaveAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "Named with Enter" }));
	});

	it("keeps the rename dialog open when saving fails", async function RetainsFailedRename()
	{
		vi.mocked(gateway.SaveAsync).mockRejectedValueOnce(new Error("Disk unavailable"));
		OpenRenameFromCatalogue();
		const input = RequireDocumentElement<HTMLInputElement>("[data-dream-title]");
		const overlay = RequireClosestElement<HTMLElement>(input, ".popup-overlay");
		const save = RequireDocumentElement<HTMLButtonElement>("[data-dream-rename-save]");
		const error = RequireDocumentElement<HTMLElement>("[data-dream-rename-error]");
		input.value = "Unsaved name";

		save.click();

		await vi.waitFor(function RenameFailed(): void
		{
			expect(error.hidden).toBe(false);
		});
		expect(overlay.hidden).toBe(false);
		expect(save.disabled).toBe(false);
		expect(store.GetSaveState()).toBe("error");
		expect(document.activeElement).toBe(input);
	});

	it("focuses the added signal description and resets tabs when opening a different Dream", async function SelectsSignals()
	{
		const reflectionsTab = root.querySelectorAll<HTMLButtonElement>("[role=tab]")[1]!;
		reflectionsTab.click();
		reflectionsTab.focus();
		const active = store.GetActiveDream()!;
		const added = { ...active.signals[0]!, id: "new-signal", description: "" };
		store.ReplaceSignals([added, ...active.signals]);
		const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
		await events.PublishAsync("dream.signal-added", { dreamId: "dream-1", signalId: "new-signal" });
		expect(root.querySelector("[role=tab]")?.getAttribute("aria-selected")).toBe("true");
		const row = root.querySelector<HTMLElement>('[data-signal-id="new-signal"]')!;
		const header = root.querySelector<HTMLElement>('[data-signal-toggle="new-signal"]')?.parentElement;
		expect(header?.querySelector('[data-signal-toggle="new-signal"]')?.getAttribute("aria-current")).toBe("true");
		expect(row.querySelector<HTMLElement>("[data-signal-description]")?.hidden).toBe(false);
		await vi.waitFor(function NewSignalRevealed(): void
		{
			expect(scroll).toHaveBeenCalledTimes(2);
			expect(scroll).toHaveBeenNthCalledWith(1, { block: "nearest", behavior: "smooth" });
			expect(scroll).toHaveBeenNthCalledWith(2, { block: "nearest", behavior: "smooth" });
			expect(scroll.mock.contexts).toContain(header);
			expect(scroll.mock.contexts).toContain(row);
			expect(row.querySelector('[aria-busy="true"]')).toBeNull();
			const content = row.querySelector<HTMLElement>("[contenteditable=true]");
			expect(content).not.toBeNull();
			expect(document.activeElement).toBe(content);
		});
		const oldEditor = root.querySelector("[data-dream-reflections]");
		const dream = CreateDream();
		dream.id = "dream-2";
		dream.reflection = "Another Dream";
		store.Open(dream, false);
		await events.PublishAsync("dream.opened", {});
		expect(root.querySelector("[data-dream-reflections]")).not.toBe(oldEditor);
		await vi.waitFor(function NewEditorReady(): void
		{
			expect(root.querySelector("[data-dream-reflections] [contenteditable=true]")?.textContent).toBe("Another Dream");
		});
	});
});
