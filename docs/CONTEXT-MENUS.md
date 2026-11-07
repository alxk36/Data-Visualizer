# Context menus

These menus implement the marked choices in the supplied screenshots. Separator lines are omitted from the numbered lists below; the commands remain in screenshot order.

## Workspace folder — image 1

Right-click a top-level folder added to the workspace:

1. New File…
2. New Folder…
3. Reveal in File Explorer
4. Open in Images Preview
5. Add Folder to Workspace…
6. Remove Folder from Workspace
7. Open Timeline
8. Paste
9. Copy Path

The workspace-root menu excludes Open in Integrated Terminal, Open Folder Settings, Find in Folder, Add Folder to Chat, and Copy Relative Path, matching the X selections. Removing a workspace folder keeps its files on disk.

## File — image 2

Right-click a file in the explorer:

1. Reveal in File Explorer
2. Select for Compare
3. Cut
4. Copy
5. Copy Path
6. Copy Relative Path
7. Rename…
8. Delete Permanently

After a comparison source has been selected, the comparison command can compare the chosen file against that source. File content is displayed as text and does not execute.

The file menu excludes Open to the Side, Open With, Open in Integrated Terminal, Open Timeline, and Add File to Chat, matching the X selections.

## Nested folder — image 3

Right-click a folder inside a workspace folder:

1. New File…
2. New Folder…
3. Reveal in File Explorer
4. Find in Folder…
5. Cut
6. Copy
7. Paste
8. Copy Path
9. Copy Relative Path
10. Rename…
11. Delete Permanently

The nested-folder menu excludes Open in Images Preview, Open in Integrated Terminal, Open Timeline, and Add Folder to Chat, matching the X selections.

## Tabs and groups

Right-click a tab in a Text or Visualizer group for these selected commands:

| Command | Effect |
| --- | --- |
| Close | Close the selected tab. |
| Close Others | Close the other unpinned tabs in that group. |
| Close to the Right | Close unpinned tabs to the selected tab's right. |
| Close Saved | Close saved, unpinned tabs in that group. |
| Close All | Close unpinned tabs in that group. |
| Copy Path | Copy the document's absolute path. |
| Copy Relative Path | Copy the path relative to its containing workspace folder. |
| Reveal in File Explorer | Show the file in Windows File Explorer. |
| Reveal in Explorer View | Locate the document in the app's explorer. |
| Pin / Unpin | Keep the tab at the group's beginning and protect it from bulk closing, or remove that protection. |
| Split Right | Open another view of the document in a group to the right. |
| Split & Move → Up / Down / Left / Right | Create a group in the selected direction and move this tab into it. |
| Move into Group Above / Below / Left / Right | Move this tab to a neighboring group in the selected direction. |
| Split in Group | Split the document view inside the selected group. |

Text and Visualizer are separate outer panes, each with its title above its groups. Split and move commands stay within the selected pane. Copies of a tab share one document; splitting does not create a second file on disk.

Tabs can also be dragged to a group's content edges. The shaded half previews a split to the left, right, above, or below. A center drop joins the group; a tab-bar drop reorders tabs. An emptied source group collapses. Hold Ctrl while dropping to keep the original view too. These drag operations can be nested inside either outer pane.

Bulk-close commands operate on the selected group and skip pinned tabs. Explicit Close still works on a pinned tab. If closing removes the document's final view, unsaved edits must be saved or discarded before it closes. Path and reveal commands require a document saved on disk.

New-window commands, Reopen With, chat commands, and Keep Open are omitted because they were not selected.

## Keyboard actions in the explorer

| Action | Shortcut |
| --- | --- |
| Reveal in File Explorer | Shift+Alt+R |
| Cut | Ctrl+X |
| Copy | Ctrl+C |
| Paste | Ctrl+V |
| Copy Path | Shift+Alt+C |
| Copy Relative Path | Ctrl+K, then Ctrl+Shift+C |
| Rename | F2 |
| Delete Permanently | Delete |
| Find in Folder | Shift+Alt+F |
| Toggle an item's selection | Ctrl-click |
| Select a visible range | Shift-click |
| Select visible files and nested folders | Ctrl+A |
| Move selection up or down | Up / Down |
| Extend selection up or down | Shift+Up / Shift+Down |

Available commands depend on the selected item and its menu. Paste requires an item copied or cut in Data Visualizer. Permanent deletion shows a confirmation with the affected path, including whether folder contents will be deleted.

Drag selected files and nested folders onto a destination folder to move them together. Right-click selects one item for its context menu; keyboard file commands apply to the focused item. Dragging files onto an editor group opens the selected files in that group.
