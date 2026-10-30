import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Collapsed Explorer styles", function CollapsedExplorerStyleTests()
{
	it("shows a Dreams recovery control instead of an empty column", function ShowsRecoveryRail(): void
	{
		const shellPath = resolve(process.cwd(), "src", "renderer", "workspace", "WorkspaceShellPanel.ts");
		const stylesheetPath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const shell = readFileSync(shellPath, "utf8");
		const css = readFileSync(stylesheetPath, "utf8");

		expect(shell).toMatch(/data-expand-explorer="dream"[^>]*title="Expand Dreams"/);
		expect(css).toMatch(/\.collapsed-explorer-rail\s*\{[^}]*display:\s*none;/s);
		expect(css).toMatch(/\.shell\.left-collapsed \.collapsed-explorer-rail\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
		expect(css).toMatch(/\.collapsed-explorer-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
	});
});
