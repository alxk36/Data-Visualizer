# Implementation decisions

## Original version 0.1 scope

This application implements the local desktop workspace requested in `first-version-brief.txt` and the five accompanying visual references.

- Windows x64 desktop app; the original installer and unpacked executable are in `release`.
- Native document extension: `.dv`, a versioned JSON envelope around raw text.
- Additional editable formats: UTF-8 text, CSV, TSV, JSON, and Markdown.
- Editor on the left, blank visualizer with faint DV logo on the right.
- The visualizer intentionally has no chart engine in this version.
- Native Windows window buttons; dark title bar, fixed height of 40 pixels.
- Window minimum: 560 × 480; initial size: 1440 × 920.
- Explorer and icon rail have preset widths, with compact presets at narrow widths. The editor/canvas divider is adjustable.
- Each pane has its own tab order and selection. Moving tabs never removes their document from the explorer.
- Closing the last tab closes the document, with a save prompt when needed. Closing one of two views keeps the other view open.
- Current layout, font size, word wrapping, and explorer visibility persist locally.
- Save history is local, limited to 20 snapshots per file and 32 MB in total.
- No telemetry, cloud account, hosted service, or external runtime connection is required to use the installed app.

## Version 0.2 additions

The selected context-menu actions follow the user's O/X markings. [Context menus](CONTEXT-MENUS.md) records all included commands in their displayed order. The explorer contains nine workspace-root actions, eight file actions, and eleven nested-folder actions.

- Multiple workspace folders are stored locally in `workspaceRoots`.
- Explorer actions create, rename, copy, cut, paste, and permanently delete files or nested folders. Removing a workspace root only changes the workspace list.
- File operations use authorized workspace roots or exact opened-file grants, validate names, reject linked paths, and preserve existing destination files by choosing a unique copy name.
- Permanent deletion requires a native confirmation with the exact path and defaults to Cancel. Workspace roots cannot be renamed, cut, or deleted through these operations.
- Cross-drive moves complete a bounded copy and check the source manifest before removing the source. Saves and explorer mutations share an operation queue; an in-place save revalidates its target when it reaches the queue.
- Renames and moves update open-file paths through the renderer and remap recent files and saved history in the storage layer. Timeline paths are retained in `historyPaths`, independently of the recent-files list.
- The selected nested-folder menu includes text search; the workspace-root menu includes saved-version timeline and image previews. File comparison displays two documents' text differences.
- **Text** and **Visualizer** titles sit above their respective group areas. Directional split and move commands create or navigate groups within that same pane. Multiple views share one document.
- A tab can be pinned, reordered, closed, split, or moved. Bulk-close commands apply to the selected group and preserve pinned tabs. Explicit Close may close a pinned tab and still respects unsaved changes.
- The versioned Windows build is written to `release/0.2.0`. Building and testing the unpacked executable does not run the installer or change Windows file associations.

File clipboard operations are internal to the app. Path-copy actions write plain text to the Windows clipboard. Image galleries use local raster data and do not open a browser or external image service.

## Version 0.3 additions

- Explorer selection supports Ctrl-click, Shift-click, Ctrl+A, and arrow keys. Duplicate Open Files and folder-tree rows share one selected path.
- Dragging the selection onto a folder moves saved files and nested folders together. Dropping files onto an editor group opens them there. Workspace roots and unsaved documents are excluded from disk moves.
- Batch moves validate all source trees and the destination first, absorb selected children of selected folders, avoid name collisions, and return completed moves separately from runtime failures. The renderer remaps every completed move while keeping unsaved buffers intact.
- File moves use the same operation queue and cross-drive checks as existing explorer actions. Dragging does not replace the app's cut/copy clipboard.
- The right-hand label above the visualizer now reads **Data Visualizer**. Version 0.3 output is written to `release/0.3.0`, retaining earlier builds.

## Version 0.4.1 addition

The welcome page includes **Open Folder**, which uses the existing native folder picker and reveals the selected folder in the explorer. Version 0.4.1 output is written to `release/0.4.1`, retaining earlier builds.

## Verification

Version 0.4 adds edge dragging for tabs and files. A pointer in the nearest outer quarter of a group's content previews the appropriate half; the middle remains an existing-group drop, and the tab bar retains reordering. Drag moves collapse an empty source group. Ctrl-drop retains the source view. Drops stay in the chosen outer pane, and pane titles stay above all nested groups. External file reads finish before creating a split and re-resolve their target if the layout changed while loading.

`tests/edge-drag-ui-smoke.cjs` checks the recording's right-then-bottom sequence, all directions, nested layout, preview bounds, pins, dirty text, center moves, tab reordering, and explorer file drops. It can run against the packaged executable with `DV_PACKAGED=1`. `tests/drop-target.test.mjs` covers edge geometry independently of the renderer.

The model and storage suite covers line counts, file deduplication, dirty tracking including edits during saves, tab movement, safe disk writes, format validation, folder enumeration, and history bounds. Explorer tests cover safe creation, destination conflicts, rename and history remapping, cut/copy/paste, cross-drive fallback, source preservation on failure, search, and linked-path protection. Bridge tests cover deletion confirmation, path copying, timeline scope, and image-gallery limits.

`tests/ui-smoke.cjs` exercises the actual Electron renderer: Create/Open, file save and history, layout modes, focus mode, explorer toggling, tab dragging between panes, explorer drops, find, minimum window sizing, and canceled close.

`tests/packaged-smoke.cjs` launches the built executable and verifies initial `.dv` arguments, subsequent file opens in the existing process, and native minimize/maximize/restore behavior.

`tests/explorer-ui-smoke.cjs` verifies every selected explorer menu and exercises its file actions, previews, search, comparisons, timeline snapshots, and persistent workspace folders on temporary fixtures. `tests/groups-ui-smoke.cjs` checks nested geometry, shared edits, cursor and undo retention, pinned tabs, menu actions, and visible-pane shortcuts. `tests/save-ui-smoke.cjs` checks repeated saves while a folder refresh is pending, including edits made between the two saves.

`tests/explorer-drag-ui-smoke.cjs` checks range and individual selection, moving selections with actual pointer dragging, mixed file/folder batches, protected destinations, collision handling, unsaved edits, and opening selected files in editor groups. Batch service tests cover preflight rejection, nested selection, partial failures, clipboard and history remapping, and cross-drive moves.

The installer is generated with a per-user `.dv` association and optional desktop shortcut. Installation and Windows Explorer double-click association are not exercised automatically because that would modify this computer's installed applications and registered file types. The packaged application's file-launch behavior is tested directly.

The installer is unsigned. Signing and distribution updates can be added when a publisher certificate is available.

## Adding capabilities

`src/model.mjs` contains document and group state, `src/app.mjs` owns workspace interaction, and `electron/document-store.cjs` owns the native document format and history. `electron/explorer-service.cjs` performs authorized filesystem operations; `electron/explorer-bridge.cjs` adapts those operations to native dialogs, clipboard access, image previews, and application requests. `src/explorer-menu.mjs` defines the selected explorer menus, while `src/explorer-views.mjs` presents comparison, search, timeline, and gallery views.

Future chart types and data tools can be introduced behind the existing visualizer pane without changing the basic desktop workflow. Increment the `.dv` schema version if future persistent data cannot be represented compatibly with version 1.
