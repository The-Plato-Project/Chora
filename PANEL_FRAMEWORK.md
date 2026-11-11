# Renderer panel framework

`SplitViewControl` owns hosts, dividers, pointer capture, keyboard resizing, collapse/reopen behavior, responsive stacking, and layout snapshots. Feature content receives an ordinary DOM root. It never inspects its parent panel, sets its host size, or handles the host's divider.

The composition owner attaches content:

```ts
const columns = new SplitViewControl({ Direction: "columns" });
columns.AddPane({ Id: "explorer", Label: "Explorer", Content: explorer.Root, Size: 220 });
columns.AddPane({ Id: "vision", Label: "Vision", Content: vision.Root, Size: 460 });
columns.AddPane({ Id: "text", Label: "Text", Content: reader.Root, Fill: true });

const rows = new SplitViewControl({ Direction: "rows" });
rows.AddPane({ Id: "workspace", Label: "Workspace", Content: columns.Root, Fill: true });
rows.AddPane({ Id: "words", Label: "Word Lookup", Content: words.Root, Size: 220 });
```

Adding another row or column is another `AddPane` call. A nested split view's `Root` is ordinary content to its parent. `RemovePane` detaches content without disposing its feature owner. The application owns feature lifetimes; split views own layout resources only.

Every divider uses the same policy: expanded panes can shrink to 48 px, dragging within 32 px of an edge collapses that side to zero, and the divider remains reachable. Dragging back, double-clicking, or pressing Enter restores a collapsed side. Arrow keys resize by 24 px; Home and End collapse either side. Escape or pointer cancellation restores the pre-drag layout. Nested views handle only their own dividers.

Pane availability and collapse are separate. `SetPaneVisible` removes unavailable content from layout without forgetting its expanded size. `SetPaneCollapsed` hides available content behind a reachable divider. Explicit feature navigation reopens the corresponding host through the composition owner's typed event subscriptions. Ordinary content changes do not reopen a reader-collapsed panel.

Pass saved `State` and a `Changed` callback to persist a group through `LayoutSettings.GetSplitView` / `SetSplitView`. Snapshots contain stable pane IDs, remembered expanded sizes, and collapse flags. Availability is transient. Old workspace dimensions and Word Lookup ratios remain readable as migration defaults; the generic split snapshots take precedence.

`StackAt` optionally switches a column group to rows when its own container becomes narrow. Feature content stays mounted and keeps its DOM listeners and local state through resizing, collapse, stacking, and reopening. Content may observe its own root with normal browser resize observation; it has no dependency on the host implementation.

`WorkspaceLayoutPanel` composes Explorer, Vision, Text, and Word Lookup. Word Lookup composes its Dictionary/Occurrences and occurrence list/detail groups with the same control. The previous feature-specific drag handlers, grid tracks, ratio clamps, and minimum-width calculations are removed.

`StatusBarControl` is a separate reusable footer with empty `Start` and `End` slots. `WorkspaceShellPanel` mounts it after the resizable workspace, so it spans the entire application and remains visible when panels collapse. It owns no panel state or feature workflows.
