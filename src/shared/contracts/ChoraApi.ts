import type { OperationResult } from "../diagnostics/OperationResult.js";
import type { ErrorRecord } from "../diagnostics/DiagnosticManager.js";
import type { DreamTrashSnapshot } from "../dreams/DreamTrashTypes.js";
import type { TextDocumentSnapshot, LibraryTextSummary, SourceNotice } from "../library/LibraryTypes.js";
import type { SelectionAction, TextSelection } from "../text/TextSelection.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, MoveDreamCommand, UpdateDreamCommand } from "../dreams/DreamTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../signals/SignalTypes.js";
import type { WordEvidenceResult, WordObservation, WordObservationKey, WordPersonResearch, WordSearchResult } from "../library/WordExplorationTypes.js";

export type ApiSubscription = () => void;

export type FormattingAction = "bold" | "italic" | "bullet_list" | "ordered_list" | "blockquote" | "link" | null;

export interface ChoraApi
{
	// Stores one bounded renderer diagnostic in the main-process log.
	RecordDiagnostic(record: ErrorRecord): Promise<OperationResult<void>>;
	// Subscribes to explicitly reported main-process diagnostics.
	SubscribeDiagnostics(callback: (record: ErrorRecord) => void): ApiSubscription;
	ListLibraryTexts(): Promise<OperationResult<LibraryTextSummary[]>>;
	LoadLibraryText(workId: string): Promise<OperationResult<TextDocumentSnapshot>>;
	SubscribeLibraryTextSelected(callback: (workId: string) => void): ApiSubscription;
	ShowSelectionContextMenu(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean, canExploreWord: boolean): Promise<OperationResult<SelectionAction>>;
	ShowDreamSourceContextMenu(canAddToSelectedSignal: boolean, canExploreWord: boolean): Promise<OperationResult<SelectionAction>>;
	ShowFormattingContextMenu(): Promise<OperationResult<FormattingAction>>;
	CopySelectedText(selectedText: string): Promise<OperationResult<void>>;
	GetSourceNotice(workId: string): Promise<OperationResult<SourceNotice>>;
	SearchWord(workId: string, form: string): Promise<OperationResult<WordSearchResult>>;
	GetWordEvidence(selection: TextSelection): Promise<OperationResult<WordEvidenceResult>>;
	GetPersonResearch(selection: TextSelection, lemma: string): Promise<OperationResult<WordPersonResearch>>;
	OpenExternalSource(url: string): Promise<OperationResult<void>>;
	GetWordObservation(key: WordObservationKey): Promise<OperationResult<WordObservation>>;
	SaveWordObservation(observation: WordObservation): Promise<OperationResult<WordObservation>>;
	CreateSignal(command: CreateSignalCommand): Promise<OperationResult<SignalRecord>>;
	UpdateSignal(command: UpdateSignalCommand): Promise<OperationResult<SignalRecord>>;
	DeleteSignal(command: DeleteSignalCommand): Promise<OperationResult<void>>;
	CreateDream(command: CreateDreamCommand): Promise<OperationResult<DreamSnapshot>>;
	UpdateDream(command: UpdateDreamCommand): Promise<OperationResult<DreamSnapshot>>;
	DeleteDream(dreamId: string): Promise<OperationResult<void>>;
	// ListDreamTrash through the owning main-process library.
	ListDreamTrash(): Promise<OperationResult<readonly DreamTrashSnapshot[]>>;
	// RestoreDreamTrash through the owning main-process library.
	RestoreDreamTrash(id: string): Promise<OperationResult<void>>;
	// PurgeDreamTrash through the owning main-process library.
	PurgeDreamTrash(id: string): Promise<OperationResult<void>>;
	// EmptyDreamTrash through the owning main-process library.
	EmptyDreamTrash(): Promise<OperationResult<void>>;
	// Explicitly reconciles the filesystem-backed catalogue.
	ReloadDreamCatalogue(): Promise<OperationResult<DreamCatalogueSnapshot>>;
	ListDreamCatalogue(): Promise<OperationResult<DreamCatalogueSnapshot>>;
	CreateDreamFolder(command: CreateDreamFolderCommand): Promise<OperationResult<DreamFolderSnapshot>>;
	DeleteDreamFolder(command: DeleteDreamFolderCommand): Promise<OperationResult<void>>;
	MoveDream(command: MoveDreamCommand): Promise<OperationResult<DreamLocationSnapshot>>;
}
