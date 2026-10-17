import fs from "node:fs/promises";
import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";
import type { TextDocument } from "../../shared/library/LibraryTypes.js";
import { BuildExternalText } from "./ExternalTextModel.js";

export class ExternalTextLoader
{
	public async OpenAsync(window: BrowserWindow | null): Promise<TextDocument | null>
	{
		const dialogOptions = {
		title: "Open Text",
		properties: ["openFile"],
		filters: [
			{
				name: "Text Files",
				extensions: ["txt"]
			}
		]
		} satisfies OpenDialogOptions;
		let result: TextDocument | null = null;
		const dialogResult = window
			? await dialog.showOpenDialog(window, dialogOptions)
			: await dialog.showOpenDialog(dialogOptions);

		if (!dialogResult.canceled && dialogResult.filePaths.length > 0)
		{
			const filePath = dialogResult.filePaths[0];

			if (filePath)
			{
				const fileText = await fs.readFile(filePath, "utf8");
				result = BuildExternalText(filePath, fileText);
			}
		}

		return result;
	}
}
