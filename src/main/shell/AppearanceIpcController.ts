import { ipcMain, nativeTheme, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";

// Owns the native-theme boundary; renderer preferences remain in their existing settings store.
export class AppearanceIpcController
{
	// The application window is the sole authority allowed to change its native appearance.
	public constructor(private readonly windows: ChoraWindowManager)
	{
	}

	// Starts light until the renderer supplies its persisted preference.
	public Register(): void
	{
		nativeTheme.themeSource = "light";
		IpcErrorBoundary.Register(IPC_CHANNELS.setAppearance, this.SetAppearance.bind(this));
	}

	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.setAppearance);
	}

	// Validates origin and values instead of trusting arbitrary renderer messages.
	private SetAppearance(event: IpcMainInvokeEvent, appearance: unknown, selectionColor: unknown): void
	{
		const window = this.windows.GetWindow();
		const contents = window?.webContents;
		if (contents === undefined || event.sender !== contents || event.senderFrame !== contents.mainFrame)
		{
			throw ApplicationError.Expected("validation", "UNTRUSTED_APPEARANCE", "Untrusted appearance request.");
		}
		if (appearance !== "light" && appearance !== "dark")
		{
			throw ApplicationError.Expected("validation", "INVALID_APPEARANCE", "Choose light or dark appearance.");
		}
		if (typeof selectionColor !== "string" || !/^#[0-9a-f]{6}$/iu.test(selectionColor))
		{
			throw ApplicationError.Expected("validation", "INVALID_CAPTION_COLOR", "The window color is invalid.");
		}
		nativeTheme.themeSource = appearance;
		// Windows draws the caption; reuse the renderer palette instead of the system accent.
		if (process.platform === "win32") window?.setAccentColor(selectionColor);
	}
}
