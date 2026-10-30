import type { ProviderId } from "./ModelTypes.js";

// Stable provider and model identity selected for a conversation turn.
export interface ModelSelection
{
	// Configured provider that owns this model.
	readonly provider: ProviderId;
	// Provider-specific model identifier; never a URL or credential.
	readonly model: string;
}

// Reader-facing model choice supplied by the configured provider catalogue.
export interface AvailableModel extends ModelSelection
{
	// Display label independent of stored identity.
	readonly label: string;
}
