import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type {
	CreateVisionCommand,
	CreateVisionFolderCommand,
	DeleteVisionFolderCommand,
	MoveVisionCommand,
	UpdateVisionCommand,
	VisionCatalogueSnapshot,
	VisionFolderSnapshot,
	VisionSnapshot
} from "../../shared/visions/VisionTypes.js";

export class VisionGateway
{
	public ListAsync(): Promise<VisionCatalogueSnapshot>
	{
		return ReadOperationAsync(window.chora.ListVisions());
	}

	public CreateFolderAsync(command: CreateVisionFolderCommand): Promise<VisionFolderSnapshot>
	{
		return ReadOperationAsync(window.chora.CreateVisionFolder(command));
	}

	public DeleteFolderAsync(command: DeleteVisionFolderCommand): Promise<void>
	{
		return ReadOperationAsync(window.chora.DeleteVisionFolder(command));
	}

	public MoveAsync(command: MoveVisionCommand): Promise<VisionSnapshot>
	{
		return ReadOperationAsync(window.chora.MoveVision(command));
	}

	public CreateAsync(command: CreateVisionCommand): Promise<VisionSnapshot>
	{
		return ReadOperationAsync(window.chora.CreateVision(command));
	}

	public UpdateAsync(command: UpdateVisionCommand): Promise<VisionSnapshot>
	{
		return ReadOperationAsync(window.chora.UpdateVision(command));
	}

	public DeleteAsync(visionId: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.DeleteVision(visionId));
	}

	public CopyMarkdownAsync(markdown: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.CopySelectedText(markdown));
	}
}
