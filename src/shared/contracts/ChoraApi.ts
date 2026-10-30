import type { ChatConversationSnapshot, SendChatMessageCommand } from "../chat/ChatTypes.js";
import type { AvailableModel } from "../models/ModelSelection.js";
import type { OperationResult } from "../diagnostics/OperationResult.js";
import type { ErrorRecord } from "../diagnostics/DiagnosticManager.js";
import type { DreamTrashSnapshot } from "../dreams/DreamTrashTypes.js";
import type { TextDocumentSnapshot, LibraryTextSummary, SourceNotice } from "../library/LibraryTypes.js";
import type { SelectionAction } from "../text/TextSelection.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, MoveDreamCommand, UpdateDreamCommand } from "../dreams/DreamTypes.js";
import type { LookupBounds, LookupCommand, LookupState } from "../library/LookupTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../signals/SignalTypes.js";

export type ApiSubscription = () => void;

export type FormattingAction = "bold" | "italic" | "bullet_list" | "ordered_list" | "blockquote" | "link" | null;

export interface ChoraApi
{
	// Loads saved conversation history after validating the owning feature identity.
	OpenChat(id: string): Promise<OperationResult<ChatConversationSnapshot | null>>;
	// Sends one reader message with an idempotency key and selected model.
	SendChat(command: SendChatMessageCommand): Promise<OperationResult<ChatConversationSnapshot>>;
	// Stops one active provider request.
	CancelChat(id: string): Promise<OperationResult<void>>;
	// Lists model choices exposed by the configured provider.
	ListModels(): Promise<OperationResult<readonly AvailableModel[]>>;
	// Stores one bounded renderer diagnostic in the main-process log.
	RecordDiagnostic(record: ErrorRecord): Promise<OperationResult<void>>;
	// Subscribes to explicitly reported main-process diagnostics.
	SubscribeDiagnostics(callback: (record: ErrorRecord) => void): ApiSubscription;
	ListLibraryTexts(): Promise<OperationResult<LibraryTextSummary[]>>;
	LoadLibraryText(workId: string): Promise<OperationResult<TextDocumentSnapshot>>;
	SubscribeLibraryTextSelected(callback: (workId: string) => void): ApiSubscription;
	ShowSelectionContextMenu(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean): Promise<OperationResult<SelectionAction>>;
	ShowDreamSourceContextMenu(canAddToSelectedSignal: boolean): Promise<OperationResult<SelectionAction>>;
	ShowFormattingContextMenu(): Promise<OperationResult<FormattingAction>>;
	CopySelectedText(selectedText: string): Promise<OperationResult<void>>;
	LookUpWord(selectedText: string): Promise<OperationResult<void>>;
	GetLookupState(): Promise<OperationResult<LookupState>>;
	SetLookupBounds(bounds: LookupBounds | null): Promise<OperationResult<void>>;
	ExecuteLookupCommand(command: LookupCommand): Promise<OperationResult<void>>;
	SubscribeLookupState(callback: (state: LookupState) => void): ApiSubscription;
	GetSourceNotice(workId: string): Promise<OperationResult<SourceNotice>>;
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
