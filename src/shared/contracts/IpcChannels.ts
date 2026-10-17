export const IPC_CHANNELS = {
	listLibraryTexts: "chora:list-library-texts",
	loadLibraryText: "chora:load-library-text",
	selectLibraryText: "chora:select-library-text",
	externalTextLoaded: "chora:external-text-loaded",
	showSelectionContextMenu: "chora:show-selection-context-menu",
	showDreamSourceContextMenu: "chora:show-dream-source-context-menu",
	showFormattingContextMenu: "chora:show-formatting-context-menu",
	copySelectedText: "chora:copy-selected-text",
	lookUpWord: "chora:look-up-word",
	lookupStateChanged: "chora:lookup-state-changed",
	getLookupState: "chora:get-lookup-state",
	setLookupBounds: "chora:set-lookup-bounds",
	lookupCommand: "chora:lookup-command",
	getSourceNotice: "chora:get-source-notice",
	listSignals: "chora:list-signals",
	saveSignal: "chora:save-signal",
	// Lists work-owned Ideas.
	listIdeas: "chora:list-ideas",
	// Discovers related existing Signals.
	discoverIdeaSignals: "chora:discover-idea-signals",
	// Saves reader-editable Idea data.
	saveIdea: "chora:save-idea",
	// Deletes one work-owned Idea.
	deleteIdea: "chora:delete-idea",
	saveDream: "chora:save-dream",
	deleteDream: "chora:delete-dream",
	listDreams: "chora:list-dreams",
	allocateDreamId: "chora:allocate-dream-id",
	createDreamSynopticView: "chora:create-dream-synoptic-view",
	cancelDreamSynopticView: "chora:cancel-dream-synoptic-view"
} as const;
