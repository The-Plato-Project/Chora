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

		expect(shell).toMatch(/class="workspace-activity-rail"[^>]*data-sidebar-rail/);
		expect(css).toMatch(/\.workspace-activity-rail\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
		expect(css).toMatch(/\.workspace-activity-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
		expect(css).toMatch(/\.shell\.left-collapsed \.left-view\s*\{[^}]*display:\s*none;/s);
	});
});
