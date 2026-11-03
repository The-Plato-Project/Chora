import { app } from "electron";
import path from "node:path";

export function ResolveResourcePath(...segments: string[]): string
{
	const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
	const resolvedPath = path.join(basePath, ...segments);
	return resolvedPath;
}
