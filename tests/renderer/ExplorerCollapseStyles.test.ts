import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Collapsed Explorer styles", function CollapsedExplorerStyleTests()
{
	it("shows Ideas and Dreams recovery controls instead of an empty column", function ShowsRecoveryRail(): void
	{
		const applicationPath = resolve(process.cwd(), "src", "renderer", "app", "ChoraApplication.ts");
		const stylesheetPath = resolve(process.cwd(), "src", "renderer", "styles", "base.css");
		const application = readFileSync(applicationPath, "utf8");
		const css = readFileSync(stylesheetPath, "utf8");

		expect(application).toMatch(/data-expand-explorer="idea"[^>]*title="Expand Ideas"/);
		expect(application).toMatch(/data-expand-explorer="dream"[^>]*title="Expand Dreams"/);
		expect(css).toMatch(/\.collapsed-explorer-rail\s*\{[^}]*display:\s*none;/s);
		expect(css).toMatch(/\.shell\.left-collapsed \.collapsed-explorer-rail\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
		expect(css).toMatch(/\.collapsed-explorer-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
	});
});
