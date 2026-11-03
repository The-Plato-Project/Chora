import path from "node:path";
import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";

// Maps stable work identities to readable, filesystem-safe storage locations.
export class WorkStoragePaths
{
	private readonly names = new Map<string, string>();

	public constructor(
		private readonly root: string,
		works: readonly Pick<LibraryTextSummary, "id" | "title">[] = [])
	{
		if (works.length > 0)
		{
			this.Initialize(works);
		}
	}

	// Installs the authoritative PlatoSI catalogue before reader storage is accessed.
	public Initialize(works: readonly Pick<LibraryTextSummary, "id" | "title">[]): void
	{
		if (this.names.size > 0)
		{
			throw new Error("Work storage paths are already initialized.");
		}
		const names = new Set<string>();

		for (const work of works)
		{
			const name = work.id === "republic" ? "The Republic" : work.title;
			const key = name.toLocaleLowerCase();
			const invalidName = name.length === 0 || name.length > 120 || name !== name.trim()
				|| /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || name.endsWith(".")
				|| /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
				|| ["dreams", "signals", "trash", "conversations"].includes(key);

			if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(work.id)
				|| invalidName || names.has(key) || this.names.has(work.id))
			{
				throw new Error("The Library catalogue contains an unsafe or duplicate work storage name.");
			}

			names.add(key);
			this.names.set(work.id, name);
		}
	}

	// Returns the directory belonging to a known work and record type.
	public Resolve(workId: string, kind: "Dreams" | "Signals"): string
	{
		const name = this.names.get(workId);
		if (name === undefined) throw new Error(`Unknown work storage identity: ${workId}`);
		const directory = path.join(this.root, name, kind);

		return directory;
	}

	// Enumerates the identities explicitly supplied by the Library catalogue.
	public WorkIds(): readonly string[]
	{
		const ids = [...this.names.keys()];

		return ids;
	}
}
