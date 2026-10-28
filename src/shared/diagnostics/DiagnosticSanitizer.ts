// Produces bounded JSON-safe diagnostic details without request bodies, credentials, or reader documents.
export class DiagnosticSanitizer
{
	// Removes common credential representations from diagnostic strings.
	public static Text(value: string): string
	{
		const redacted = value.replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
			.replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/giu, "$1<redacted>")
			.slice(0, 16000);

		return redacted;
	}

	// Serializes exception causes and structured details with depth, size, and cycle limits.
	public static Details(value: unknown, depth = 0, seen = new Set<object>()): unknown
	{
		let safe: unknown = null;
		if (typeof value === "string") safe = this.Text(value);
		else if (value === null || typeof value === "number" || typeof value === "boolean") safe = value;
		else if (typeof value === "object" && depth < 4 && !seen.has(value))
		{
			seen.add(value);
			if (value instanceof Error)
			{
				safe = { name: value.name, message: this.Text(value.message), stack: this.Text(value.stack ?? ""), cause: this.Details(value.cause, depth + 1, seen) };
			}
			else if (Array.isArray(value))
			{
				const values: unknown[] = [];
				for (const item of value.slice(0, 20)) values.push(this.Details(item, depth + 1, seen));
				safe = values;
			}
			else
			{
				const record: Record<string, unknown> = {};
				for (const [key, item] of Object.entries(value).slice(0, 30))
				{
					const sensitive = /key|token|secret|password|authorization|prompt|history|reflection|description|readingDocument|content|text|body/iu.test(key);
					record[key] = sensitive ? "<redacted>" : this.Details(item, depth + 1, seen);
				}
				safe = record;
			}
		}

		return safe;
	}
}
