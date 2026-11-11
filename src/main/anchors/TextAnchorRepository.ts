import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";
import type { WorkStoragePaths } from "../storage/WorkStoragePaths.js";
import { TextAnchorCodec } from "./TextAnchorCodec.js";

export class TextAnchorRepository
{
	public constructor(
		private readonly paths: WorkStoragePaths,
		private readonly codec = new TextAnchorCodec())
	{
	}

	public async LoadAllAsync(): Promise<readonly TextAnchorSnapshot[]>
	{
		const anchors: TextAnchorSnapshot[] = [];
		const identities = new Set<string>();
		for (const workId of this.paths.WorkIds())
		{
			const directory = this.paths.Resolve(workId, "Anchors");
			await mkdir(directory, { recursive: true });
			const entries = await readdir(directory, { withFileTypes: true });
			for (const entry of entries)
			{
				if (entry.isFile() && path.extname(entry.name).toLocaleLowerCase() === ".json")
				{
					const anchor = this.codec.Decode(await readFile(path.join(directory, entry.name), "utf8"));
					if (anchor.workId !== workId) throw new Error("A text anchor is stored beneath the wrong work.");
					if (identities.has(anchor.id)) throw new Error("Duplicate text anchor identities were found.");
					identities.add(anchor.id);
					anchors.push(anchor);
				}
			}
		}
		return anchors;
	}

	public async SaveAsync(anchor: TextAnchorSnapshot): Promise<void>
	{
		const directory = this.paths.Resolve(anchor.workId, "Anchors");
		await mkdir(directory, { recursive: true });
		const destination = path.join(directory, `${anchor.id.replaceAll(":", "-")}.json`);
		const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporary, this.codec.Encode(anchor), "utf8");
		try
		{
			await rename(temporary, destination);
		}
		catch (error)
		{
			await rm(temporary, { force: true });
			throw error;
		}
	}
}
