import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from "electron";
import type { SelectionAction } from "../../shared/text/TextSelection.js";
import type { FormattingAction, VisionReferenceAction } from "../../shared/contracts/ChoraApi.js";

export async function ShowFormattingContextMenu(window: BrowserWindow, params: ContextMenuParams): Promise<FormattingAction>
{
	const result = await new Promise<FormattingAction>(function OpenFormattingMenu(resolve): void
	{
		const template: MenuItemConstructorOptions[] = [];
		if (params.misspelledWord.length > 0)
		{
			for (const suggestion of params.dictionarySuggestions)
			{
				template.push({ label: suggestion, click: function CorrectSpelling(): void
				{
					window.webContents.replaceMisspelling(suggestion);
					resolve(null);
				} });
			}
			if (params.dictionarySuggestions.length === 0) template.push({ label: "No suggestions", enabled: false });
			template.push({ label: "Add to dictionary", click: function AddToDictionary(): void
			{
				window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
				resolve(null);
			} });
			template.push({ type: "separator" });
		}
		template.push(
			{ label: "Bold", click: function Bold(): void { resolve("bold"); } },
			{ label: "Italic", click: function Italic(): void { resolve("italic"); } },
			{
				label: "Lists",
				submenu: [
					{ label: "Bulleted list", click: function BulletedList(): void { resolve("bullet_list"); } },
					{ label: "Numbered list", click: function NumberedList(): void { resolve("ordered_list"); } }
				]
			},
			{ label: "Quotation", click: function Quotation(): void { resolve("blockquote"); } },
			{ type: "separator" },
			{ label: "Add link", enabled: params.selectionText.length > 0, click: function AddLink(): void { resolve("link"); } },
			{ type: "separator" },
			{ role: "cut", enabled: params.editFlags.canCut },
			{ role: "copy", enabled: params.editFlags.canCopy },
			{ role: "paste", enabled: params.editFlags.canPaste },
			{ type: "separator" },
			{ role: "selectAll", enabled: params.editFlags.canSelectAll }
		);
		const menu = Menu.buildFromTemplate(template);
		menu.popup({ window, callback: function Dismiss(): void { resolve(null); } });
	});
	return result;
}

// Shows the native editing menu, including spelling suggestions, for a right-clicked editable field.
export function ShowEditContextMenu(window: BrowserWindow, params: ContextMenuParams): void
{
	const webContents = window.webContents;
	const menuTemplate: MenuItemConstructorOptions[] = [];

	if (params.misspelledWord.length > 0)
	{
		for (const suggestion of params.dictionarySuggestions)
		{
			menuTemplate.push({ label: suggestion, click: () => webContents.replaceMisspelling(suggestion) });
		}

		if (params.dictionarySuggestions.length === 0) menuTemplate.push({ label: "No suggestions", enabled: false });
		menuTemplate.push({ type: "separator" });
		menuTemplate.push({ label: "Add to dictionary", click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
		menuTemplate.push({ type: "separator" });
	}

	menuTemplate.push({ role: "cut", enabled: params.editFlags.canCut });
	menuTemplate.push({ role: "copy", enabled: params.editFlags.canCopy });
	menuTemplate.push({ role: "paste", enabled: params.editFlags.canPaste });
	menuTemplate.push({ type: "separator" });
	menuTemplate.push({ role: "selectAll", enabled: params.editFlags.canSelectAll });

	const menu = Menu.buildFromTemplate(menuTemplate);
	menu.popup({ window });
}

export async function ShowVisionReferenceContextMenu(canExploreWord: boolean): Promise<VisionReferenceAction>
{
	const result = await new Promise<VisionReferenceAction>((resolve) =>
	{
		const menu = Menu.buildFromTemplate([
			{ label: "Copy", click: () => resolve("copy") },
			{ label: "Navigate to", click: () => resolve("navigate") },
			{ label: "Open word", enabled: canExploreWord, click: () => resolve("explore-word") }
		]);
		menu.popup({ callback: () => resolve(null) });
	});

	return result;
}

export async function ShowSelectionContextMenu(canExploreWord: boolean): Promise<SelectionAction>
{
	const result = await new Promise<SelectionAction>((resolve) =>
	{
		const menuTemplate: MenuItemConstructorOptions[] = [
			{
				label: "Copy anchor",
				click: () =>
				{
					resolve("copy-anchor");
				}
			},
			{
				label: "Copy text only",
				click: () =>
				{
					resolve("copy-text-only");
				}
			},
			{
				label: "Open word",
				enabled: canExploreWord,
				click: function LookUpWord(): void
				{
					resolve("explore-word");
				}
			}
		];
		const menu = Menu.buildFromTemplate(menuTemplate);
		menu.popup({
			callback: () =>
			{
				resolve(null);
			}
		});
	});
	return result;
}
