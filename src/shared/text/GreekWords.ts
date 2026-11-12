export interface GreekWordMatch
{
	readonly text: string;
	readonly start: number;
	readonly end: number;
}

export function FindGreekWords(text: string): readonly GreekWordMatch[]
{
	const words: GreekWordMatch[] = [];
	for (const match of text.matchAll(/(?:(?=\p{Script=Greek})\p{L}|\p{M})+/gu))
	{
		const start = match.index;
		if (start !== undefined)
		{
			words.push({ text: match[0], start, end: start + match[0].length });
		}
	}
	return words;
}
