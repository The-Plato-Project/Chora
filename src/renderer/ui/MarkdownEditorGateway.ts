import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { FormattingAction, VisionReferenceAction } from "../../shared/contracts/ChoraApi.js";

export class MarkdownEditorGateway
{
	public ShowFormattingMenuAsync(): Promise<FormattingAction>
	{
		const action = ReadOperationAsync(window.chora.ShowFormattingContextMenu());
		return action;
	}

	public ShowVisionReferenceMenuAsync(canExploreWord: boolean): Promise<VisionReferenceAction>
	{
		return ReadOperationAsync(window.chora.ShowVisionReferenceContextMenu(canExploreWord));
	}

	public CopyTextAsync(text: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.CopySelectedText(text));
	}
}