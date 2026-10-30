import type { DreamSnapshot, UpdateDreamCommand } from "../../shared/dreams/DreamTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

// Renderer-owned editable projection that resolves a Dream's canonical Signal identities for display.
export interface DreamView
{
	id: string;
	workId: string;
	dialogue: string | null;
	title: string;
	source: DreamSnapshot["source"];
	signals: SignalRecord[];
	reflection: string;
	linkedDreamIds: string[];
	createdAt: string;
	updatedAt: string;
}

// Creates one editable renderer projection from a canonical Dream aggregate.
export function CreateDreamView(snapshot: DreamSnapshot): DreamView
{
	const view: DreamView = {
		...structuredClone(snapshot),
		signals: structuredClone([...snapshot.signals]),
		linkedDreamIds: [...snapshot.linkedDreamIds]
	};

	return view;
}

// Removes renderer-only resolved Signal snapshots before crossing an IPC or persistence boundary.
export function CreateDreamSnapshot(view: DreamView): DreamSnapshot
{
	const snapshot: DreamSnapshot = {
		id: view.id,
		workId: view.workId,
		dialogue: view.dialogue,
		title: view.title,
		source: structuredClone(view.source),
		signals: structuredClone(view.signals),
		reflection: view.reflection,
		linkedDreamIds: [...view.linkedDreamIds],
		createdAt: view.createdAt,
		updatedAt: view.updatedAt
	};

	return snapshot;
}

// Creates one narrow Dream update command without authoritative aggregate fields.
export function CreateDreamUpdateCommand(view: DreamView): UpdateDreamCommand
{
	const command: UpdateDreamCommand = {
		dreamId: view.id,
		title: view.title,
		source: structuredClone(view.source),
		reflection: view.reflection,
		linkedDreamIds: [...view.linkedDreamIds]
	};

	return command;
}
