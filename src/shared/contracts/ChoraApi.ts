import type { TextDocumentSnapshot, LibraryTextSummary, SourceNotice } from "../library/LibraryTypes.js";
import type { SelectionAction } from "../text/TextSelection.js";
import type { DreamSnapshot, DreamSynopticViewRequest } from "../dreams/DreamTypes.js";
import type { DeleteIdeaCommand, IdeaDiscoveryRequest, IdeaDiscoverySuggestion, IdeaRecord, SaveIdeaCommand } from "../ideas/IdeaTypes.js";
import type { LookupBounds, LookupCommand, LookupState } from "../library/LookupTypes.js";
import type { DeleteSignalCommand, SaveSignalCommand, SignalRecord } from "../signals/SignalTypes.js";

export type ApiSubscription = () => void;

export type FormattingAction = "bold" | "italic" | "bullet_list" | "ordered_list" | "blockquote" | "link" | null;

export interface ChoraApi
{
	ListLibraryTexts(): Promise<LibraryTextSummary[]>;
	LoadLibraryText(workId: string): Promise<TextDocumentSnapshot>;
	SubscribeLibraryTextSelected(callback: (workId: string) => void): ApiSubscription;
	SubscribeExternalTextLoaded(callback: (work: TextDocumentSnapshot) => void): ApiSubscription;
	ShowSelectionContextMenu(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean): Promise<SelectionAction>;
	ShowDreamSourceContextMenu(canAddToSelectedSignal: boolean): Promise<SelectionAction>;
	ShowFormattingContextMenu(): Promise<FormattingAction>;
	CopySelectedText(selectedText: string): Promise<void>;
	LookUpWord(selectedText: string): Promise<void>;
	GetLookupState(): Promise<LookupState>;
	SetLookupBounds(bounds: LookupBounds | null): Promise<void>;
	ExecuteLookupCommand(command: LookupCommand): Promise<void>;
	SubscribeLookupState(callback: (state: LookupState) => void): ApiSubscription;
	GetSourceNotice(workId: string): Promise<SourceNotice>;
	ListSignals(workId: string): Promise<SignalRecord[]>;
	SaveSignal(command: SaveSignalCommand): Promise<SignalRecord>;
	DeleteSignal(command: DeleteSignalCommand): Promise<void>;
	// Lists durable Ideas belonging to one work.
	ListIdeas(workId: string): Promise<IdeaRecord[]>;
	// Discovers existing Signals related to an unsaved Idea draft.
	DiscoverIdeaSignals(request: IdeaDiscoveryRequest): Promise<IdeaDiscoverySuggestion[]>;
	// Creates or updates an Idea from reader-editable fields.
	SaveIdea(command: SaveIdeaCommand): Promise<IdeaRecord>;
	// Deletes one durable Idea through a narrow ownership command.
	DeleteIdea(command: DeleteIdeaCommand): Promise<void>;
	SaveDream(dream: DreamSnapshot): Promise<DreamSnapshot>;
	DeleteDream(dreamId: string): Promise<void>;
	ListDreams(): Promise<DreamSnapshot[]>;
	AllocateDreamId(): Promise<string>;
	CreateDreamSynopticView(request: DreamSynopticViewRequest): Promise<string>;
	CancelDreamSynopticView(dreamId: string): Promise<void>;
}
