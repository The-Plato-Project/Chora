// Base for content owned by a tab control; the root survives tab changes.
export abstract class TabPanel
{
	// Persistent content root.
	public readonly Root: HTMLElement = document.createElement("section");

	// Identifies and labels this panel within its owning control.
	protected constructor(public readonly Id: string, public readonly Title: string)
	{
		this.Root.className = "tab-panel";
		this.Root.setAttribute("role", "tabpanel");
		this.Root.tabIndex = 0;
	}

	// Releases panel-owned DOM and resources.
	public OnSelected(): void
	{
	}

	public Dispose(): void
	{
		this.Root.remove();
	}
}