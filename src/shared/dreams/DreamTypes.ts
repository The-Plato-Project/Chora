import type { TextSelection } from "../text/TextSelection.js";
import type { SignalRecord } from "../signals/SignalTypes.js";

// Carries the source and work metadata required to create one Dream.
export interface CreateDreamCommand
{
	readonly workId: string;
	readonly dialogue: string | null;
	readonly source: TextSelection;
	// Relative destination folder, or an empty string for the work root.
	readonly folderPath: string;
}

// Carries only reader-editable Dream fields across the update boundary.
export interface UpdateDreamCommand
{
	// Stable identity of the Dream being updated.
	readonly dreamId: string;
	// Reader-authored Dream title.
	readonly title: string;
	// Exact source passage owned by the Dream.
	readonly source: TextSelection;
	// Reader-authored reflection Markdown.
	readonly reflection: string;
	// Reader-editable Clarity Check Markdown.
	readonly synopticView: string;
	// Stable identities of explicitly linked Dreams.
	readonly linkedDreamIds: readonly string[];
}

// Serialized Dream aggregate at IPC and session boundaries.
export interface DreamSnapshot
{
	readonly id: string;
	readonly workId: string;
	readonly dialogue: string | null;
	readonly title: string;
	readonly source: TextSelection;
	readonly signals: readonly SignalRecord[];
	readonly reflection: string;
	readonly synopticView: string;
	readonly linkedDreamIds: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

// One reader-created filesystem folder within a work's Dream library.
export interface DreamFolderSnapshot
{
	// Work whose Dream directory contains this folder.
	readonly workId: string;
	// Slash-separated path relative to the work's Dream directory.
	readonly path: string;
	// Final folder name displayed to the reader.
	readonly name: string;
	// Parent folder path, or an empty string for a root folder.
	readonly parentPath: string;
}

// Canonical placement of one Dream within its work's folder tree.
export interface DreamLocationSnapshot
{
	// Stable Dream identity.
	readonly dreamId: string;
	// Work containing the Dream.
	readonly workId: string;
	// Relative folder path, or an empty string for the work root.
	readonly folderPath: string;
}

// Complete Dream catalogue projection returned by the main process.
export interface DreamCatalogueSnapshot
{
	// Dream aggregate snapshots visible to the reader.
	readonly dreams: readonly DreamSnapshot[];
	// Reader-created folders, including empty folders.
	readonly folders: readonly DreamFolderSnapshot[];
	// Filesystem-derived placement for every Dream.
	readonly locations: readonly DreamLocationSnapshot[];
}

// Requests creation of one nested folder within a work's Dream library.
export interface CreateDreamFolderCommand
{
	// Work whose Dream directory receives the folder.
	readonly workId: string;
	// Existing parent folder path, or an empty string for the work root.
	readonly parentPath: string;
	// Reader-authored folder name.
	readonly name: string;
}

// Requests safe deletion of one empty Dream folder.
export interface DeleteDreamFolderCommand
{
	// Work containing the folder.
	readonly workId: string;
	// Relative path of the folder to delete.
	readonly folderPath: string;
}

// Requests movement of one Dream to a folder within its own work.
export interface MoveDreamCommand
{
	// Stable Dream identity.
	readonly dreamId: string;
	// Destination folder path, or an empty string for the work root.
	readonly folderPath: string;
}

export interface DreamSynopticViewRequest
{
	dreamId: string;
	readingDocument: string;
}
