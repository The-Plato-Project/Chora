import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application frame styles", () =>
{
	it("reserves five pixels below the entire application", () =>
	{
		const css = readFileSync(resolve(process.cwd(), "src", "renderer", "styles", "base.css"), "utf8");
		const status = readFileSync(resolve(process.cwd(), "src", "renderer", "styles", "status-bar.css"), "utf8");

		expect(css).toMatch(/body\s*\{[^}]*box-sizing:\s*border-box;[^}]*padding:\s*0\s+0\s+5px;/s);
		expect(css).toMatch(/#app\s*\{[^}]*height:\s*100%;/s);
		expect(css).toMatch(/\.shell\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;/s);
		expect(css).toMatch(/\.workspace-layout\s*\{[^}]*flex:\s*1;/s);
		expect(status).toMatch(/\.status-bar-control\s*\{[^}]*flex:\s*0 0 23px;/s);
		const stylesFolder = resolve(process.cwd(), "src", "renderer", "styles");
		for (const name of readdirSync(stylesFolder))
		{
			if (name.endsWith(".css"))
			{
				const stylesheet = readFileSync(resolve(stylesFolder, name), "utf8");
				const radii = Array.from(stylesheet.matchAll(/border-radius:\s*([^;]+);/g));
				const outlines = Array.from(stylesheet.matchAll(/\boutline:\s*([^;]+);/g));
				for (const outline of outlines)
				{
					expect(["0", "none"], name).toContain(outline[1]?.trim());
				}
				for (const radius of radii)
				{
					expect(radius[1]?.trim(), name).toBe("0");
				}
			}
		}
	});
});
