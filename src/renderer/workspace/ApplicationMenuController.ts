import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { ApplicationMenuGateway } from "./ApplicationMenuGateway.js";

// Coordinates local preferences and privileged actions requested by the application menu.
export class ApplicationMenuController
{
	// The controller's subscription ends with the renderer application.
	private readonly unsubscribe: () => void;

	// Wires menu requests to their existing workflow owners.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly gateway: ApplicationMenuGateway)
	{
		this.unsubscribe = events.Subscribe("workspace.menu-command-requested", this.HandleRequestedAsync.bind(this));
	}

	// Releases command handling before application teardown completes.
	public Dispose(): void
	{
		this.unsubscribe();
	}

	// Settings remain renderer-owned; operating-system actions cross the validated IPC boundary.
	private async HandleRequestedAsync(event: ChoraEvents["workspace.menu-command-requested"]): Promise<void>
	{
		if (event.command === "settings")
		{
			await this.events.PublishAsync("workspace.settings-open-requested", {});
		}
		else
		{
			await this.gateway.ExecuteAsync(event.command);
		}
	}
}
