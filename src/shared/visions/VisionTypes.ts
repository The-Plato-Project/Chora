export interface VisionSnapshot
{
	readonly id: string;
	readonly workId: string;
	readonly folderPath: string;
	readonly title: string;
	readonly markdown: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface VisionFolderSnapshot
{
	readonly workId: string;
	readonly path: string;
	readonly name: string;
	readonly parentPath: string;
}

export interface VisionCatalogueSnapshot
{
	readonly visions: readonly VisionSnapshot[];
	readonly folders: readonly VisionFolderSnapshot[];
}

export interface CreateVisionCommand
{
	readonly workId: string;
	readonly folderPath: string;
}

export interface UpdateVisionCommand
{
	readonly id: string;
	readonly title: string;
	readonly markdown: string;
}

export interface CreateVisionFolderCommand
{
	readonly workId: string;
	readonly parentPath: string;
	readonly name: string;
}

export interface DeleteVisionFolderCommand
{
	readonly workId: string;
	readonly folderPath: string;
}

export interface MoveVisionCommand
{
	readonly visionId: string;
	readonly folderPath: string;
}
