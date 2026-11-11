import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { CreateTextAnchorCommand, TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";

export class TextAnchorGateway
{
	public CreateAsync(command: CreateTextAnchorCommand): Promise<TextAnchorSnapshot>
	{
		return ReadOperationAsync(window.chora.CreateTextAnchor(command));
	}

	public ListAsync(workId: string): Promise<readonly TextAnchorSnapshot[]>
	{
		return ReadOperationAsync(window.chora.ListTextAnchors(workId));
	}

	public ValidateAsync(anchorId: string): Promise<TextAnchorSnapshot>
	{
		return ReadOperationAsync(window.chora.ValidateTextAnchor(anchorId));
	}
}
