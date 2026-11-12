import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { Appearance } from "../core/settings/ReadingSettingsStore.js";

// Stateless bridge to native appearance; it neither owns nor persists preferences.
export class ReadingAppearanceGateway
{
	public async ApplyAsync(appearance: Appearance): Promise<void>
	{
		const style = getComputedStyle(document.documentElement);
		const selectionColor = style.getPropertyValue("--selection-background").trim();
		const operation = window.chora.SetAppearance(appearance, selectionColor);
		await ReadOperationAsync(operation);
	}
}
