import type { OperationResult } from "../diagnostics/OperationResult.js";
import type { ErrorRecord } from "../diagnostics/DiagnosticManager.js";
import type { TextDocumentSnapshot, LibraryTextSummary, SourceNotice } from "../library/LibraryTypes.js";
import type { SelectionAction, TextSelection } from "../text/TextSelection.js";
import type { WordEvidenceResult, WordLexicalSearchResult, WordNameNote, WordNameNoteKey, WordObservation, WordObservationKey, WordPersonResearch, WordSearchResult } from "../library/WordExplorationTypes.js";
import type {
	CreateVisionCommand,
	CreateVisionFolderCommand,
	DeleteVisionFolderCommand,
	MoveVisionCommand,
	UpdateVisionCommand,
	VisionCatalogueSnapshot,
	VisionFolderSnapshot,
	VisionSnapshot
} from "../visions/VisionTypes.js";
import type { CreateTextAnchorCommand, TextAnchorSnapshot } from "../anchors/TextAnchorTypes.js";
import type { VisionReferenceDragPayload } from "../visions/VisionReferenceTypes.js";
import type { StudyConversation, StudySendCommand, StudyUpdate } from "../study/StudyTypes.js";

export type ApiSubscription = () => void;

export type FormattingAction = "bold" | "italic" | "bullet_list" | "ordered_list" | "blockquote" | "link" | null;
export type VisionReferenceAction = "copy" | "navigate" | "explore-word" | null;

// Explicit application commands available to the shared top menu.
export type ApplicationMenuCommand = "quit" | "settings" | "logs";

export interface ChoraApi
{
	// Explicit optional interlocutor commands, independent of the execution backend.
	SendStudy(command: StudySendCommand): Promise<OperationResult<StudyConversation>>;
	StopStudy(workId: string): Promise<OperationResult<void>>;
	LoadStudyHistory(workId: string): Promise<OperationResult<StudyConversation | null>>;
	SubscribeStudy(callback: (update: StudyUpdate) => void): ApiSubscription;
	// macOS retains its operating-system application menu.
	readonly UsesNativeMenu: boolean;
	// Privileged menu actions are validated by the application's main-process boundary.
	ExecuteApplicationMenuCommand(command: ApplicationMenuCommand): Promise<OperationResult<void>>;
	// The privileged host synchronizes native chrome with the renderer's application preference.
	SetAppearance(appearance: "light" | "dark", selectionColor: string): Promise<OperationResult<void>>;
	// Native menu requests are translated into renderer application events.
	SubscribeSettingsRequested(callback: () => void): ApiSubscription;
	// Word search and dictionary lookup are independent of passage selections.
	SearchLexicon(query: string): Promise<OperationResult<WordLexicalSearchResult>>;
	GetLexicalEvidence(lemma: string, workId: string | null): Promise<OperationResult<WordEvidenceResult>>;
	// Stores one bounded renderer diagnostic in the main-process log.
	RecordDiagnostic(record: ErrorRecord): Promise<OperationResult<void>>;
	// Subscribes to explicitly reported main-process diagnostics.
	SubscribeDiagnostics(callback: (record: ErrorRecord) => void): ApiSubscription;
	ListLibraryTexts(): Promise<OperationResult<LibraryTextSummary[]>>;
	LoadLibraryText(workId: string): Promise<OperationResult<TextDocumentSnapshot>>;
	SubscribeLibraryTextSelected(callback: (workId: string) => void): ApiSubscription;
	ShowSelectionContextMenu(canExploreWord: boolean): Promise<OperationResult<SelectionAction>>;
	ShowFormattingContextMenu(): Promise<OperationResult<FormattingAction>>;
	ShowVisionReferenceContextMenu(canExploreWord: boolean): Promise<OperationResult<VisionReferenceAction>>;
	CopySelectedText(selectedText: string): Promise<OperationResult<void>>;
	CopySelectionAnchor(payload: VisionReferenceDragPayload): Promise<OperationResult<void>>;
	GetSourceNotice(workId: string): Promise<OperationResult<SourceNotice>>;
	SearchWord(workId: string, form: string): Promise<OperationResult<WordSearchResult>>;
	GetWordEvidence(selection: TextSelection): Promise<OperationResult<WordEvidenceResult>>;
	GetPersonResearch(selection: TextSelection, lemma: string): Promise<OperationResult<WordPersonResearch>>;
	GetWordNameNote(key: WordNameNoteKey): Promise<OperationResult<WordNameNote>>;
	SaveWordNameNote(note: WordNameNote): Promise<OperationResult<WordNameNote>>;
	OpenExternalSource(url: string): Promise<OperationResult<void>>;
	GetWordObservation(key: WordObservationKey): Promise<OperationResult<WordObservation>>;
	SaveWordObservation(observation: WordObservation): Promise<OperationResult<WordObservation>>;
	CreateVision(command: CreateVisionCommand): Promise<OperationResult<VisionSnapshot>>;
	UpdateVision(command: UpdateVisionCommand): Promise<OperationResult<VisionSnapshot>>;
	DeleteVision(visionId: string): Promise<OperationResult<void>>;
	ListVisions(): Promise<OperationResult<VisionCatalogueSnapshot>>;
	CreateVisionFolder(command: CreateVisionFolderCommand): Promise<OperationResult<VisionFolderSnapshot>>;
	DeleteVisionFolder(command: DeleteVisionFolderCommand): Promise<OperationResult<void>>;
	MoveVision(command: MoveVisionCommand): Promise<OperationResult<VisionSnapshot>>;
	CreateTextAnchor(command: CreateTextAnchorCommand): Promise<OperationResult<TextAnchorSnapshot>>;
	ListTextAnchors(workId: string): Promise<OperationResult<readonly TextAnchorSnapshot[]>>;
	ValidateTextAnchor(anchorId: string): Promise<OperationResult<TextAnchorSnapshot>>;
}
