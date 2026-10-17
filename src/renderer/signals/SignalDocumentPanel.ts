import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { SignalController } from "./SignalController.js";
import { SignalStore } from "./SignalStore.js";

// Provides shared Signal dependencies for Dream and Idea document panels.
export abstract class SignalDocumentPanel
{
	protected constructor(
		protected readonly signalRoot: HTMLElement,
		protected readonly signalEvents: ChoraEventBus<ChoraEvents>,
		protected readonly signalStore: SignalStore | null,
		protected readonly signalController: SignalController | null)
	{
	}

	// Retains a common lifecycle hook for concrete document panels.
	protected DisposeSignalDocumentPanel(): void
	{
	}

	// Associates one chosen Signal with the concrete active document.
	protected abstract AssociateSignalAsync(signal: SignalRecord): Promise<void>;

	// Returns whether this panel represents the active editable document.
	protected abstract CanAssociateSignal(): boolean;
}
