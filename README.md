# Data Visualizer

A local Windows desktop workspace for raw data and its visualization. Version 0.4 adds tab dragging to split an editor group at any edge, with a shaded preview. Explorer multi-selection, file and folder moves, selected context menus, and nested Text and Visualizer groups remain available. The desktop shell and document format follow [the original brief](docs/first-version-brief.txt).

The visualization pane deliberately starts blank with a faint **DV** mark. Chart rendering and additional data tools can be added in subsequent versions.

## Install and open

Run **Data-Visualizer-Setup-0.4.1.exe** in `release/0.4.1` after packaging. The installer offers a desktop shortcut and registers the `.dv` document type. Launch Data Visualizer from its shortcut to create or open a document, or open a saved `.dv` file from Windows. This build is unsigned; Windows may show an unknown-publisher notice.

The unpacked application is available at `release/0.4.1/win-unpacked/Data Visualizer.exe` after packaging. Keep the entire `win-unpacked` folder together; the executable depends on its neighboring files. Building or running the unpacked app does not install the application, create shortcuts, or register file associations. Those changes occur only when you run the installer.

## Workspace

- On the welcome page, choose **Create new file** for an empty document, **Open a file** to select a local file, or **Open Folder** to add a folder to the explorer.
- The **Text** pane appears on the left and the **Visualizer** pane on the right. Each title remains above the groups belonging to that pane.
- Use **Layout** to choose text only, visualizer only, or split view, and to toggle Focus View.
- Collapse or expand the explorer using the left activity rail. These panels have preset widths, with compact sizing in smaller windows.
- Add one or more folders to browse their supported text files. Added folders are remembered locally. Drag a file from the explorer onto an editor group to open it there.
- Right-click a workspace folder, nested folder, or file for its selected actions. The exact menus are documented in [Context menus](docs/CONTEXT-MENUS.md).
- Drag tabs to reorder them. Right-click a tab to split or move it between groups inside its current pane. These views share the same document content.
- Drag a tab over the left, right, top, or bottom edge of an editor group's content to preview a half-size split, then release to move it there. Drop in the center to join that group, or on its tab bar to reorder. Empty source groups collapse automatically. Hold **Ctrl** while dropping to keep the original view and create another view of the same document. Files dragged from the explorer can also open together in a new split.
- Pin tabs to keep them at the start of their group and protect them from bulk-close commands. An individual pinned tab can still be closed explicitly.
- Closing one view keeps any other views of that document open. Closing its final view prompts to save changes. **File → Close document** closes the document's views.
- Save documents through the **File** menu. An unsaved-change marker identifies edited documents.
- Use **History** to inspect and restore locally stored saved versions. Restored text is written to disk when you save it. Up to 20 versions per file are retained within a 32 MB total history limit.

Line numbers follow actual text lines. Resizing a pane does not create additional numbered lines.

The appearance follows the supplied dark desktop references and uses native Windows minimize, maximize/restore, and close controls.

## Explorer actions

Create files and folders inside an added workspace folder. New files without an extension use `.dv`. Rename preserves a file's extension; use **Save As** to change its format.

**Ctrl-click** toggles individual explorer items; **Shift-click** selects a visible range. **Ctrl+A** selects the visible files and nested folders. Drag a selected file or folder onto a highlighted destination folder to move the selection together, including between added workspace folders. Selecting both a folder and its contents moves the folder once. Workspace roots stay in place. Folders cannot be moved inside themselves or their descendants. Open documents keep their unsaved changes and follow their new paths. If the selection includes an Untitled document without a file path, save it first before moving the selection on disk.

Dragging selected files onto an editor group opens them there. Explorer context-menu commands act on the item you right-click; keyboard file commands act on the focused item.

**Cut**, **Copy**, and **Paste** work on explorer items using the app's file clipboard. Name conflicts produce a separate name such as `data copy.csv`. Moving between drives copies the complete item and checks the source before removing it. **Copy Path** and **Copy Relative Path** place text on the Windows clipboard.

**Remove Folder from Workspace** removes the folder from the explorer while keeping its files on disk. **Delete Permanently** confirms the exact path before deleting it; folders include their contents, and the Recycle Bin is not used.

Select one file with **Select for Compare**, then compare another file with that selection to view text differences. **Find in Folder** searches a nested folder's supported text files. A workspace folder's **Open Timeline** displays its saved document versions. **Open in Images Preview** displays raster images from a workspace folder.

## File formats

Data Visualizer uses `.dv` for its native documents. A `.dv` document is a versioned JSON wrapper containing the raw text:

```json
{
  "format": "data-visualizer",
  "version": 1,
  "content": "Your raw data here"
}
```

The application presents the content as editable text rather than displaying the wrapper itself.

The app can also open UTF-8 plain-text files: `.txt`, `.csv`, `.tsv`, `.json`, and `.md`, up to 8 MB of text each. Saving an existing plain-text document preserves its plain-text format. No cloud account is required; document access, recent files, and saved history are local.

Folder browsing is bounded to five nested levels and 1,500 entries. Folder search examines up to 2,000 supported files and returns up to 500 matches. A copy or cross-drive move is limited to 512 MB; file operations are limited to 20,000 items. Linked files and folders are excluded from explorer operations.

Image preview supports PNG, JPEG, GIF, WebP, BMP, and ICO files up to 20 MB each. A gallery contains up to 120 thumbnails, and the enlarged preview is scaled to a maximum dimension of 2,560 pixels.

## Development

Requirements: a current Node.js LTS release and npm on Windows.

```powershell
npm install
node node_modules/electron/install.js
npm start
```

Run the automated checks:

```powershell
npm test
```

Build the Windows installer and unpacked application:

```powershell
npm run dist
```

With Electron 45, install the runtime explicitly with `node node_modules/electron/install.js` if dependency installation has not downloaded it. Version 0.4.1 build output is written to `release/0.4.1`; earlier builds are retained separately. The first dependency installation and packaging run may need internet access to download Electron and packaging tools. Normal app use does not require a development server. The source also includes `pnpm-lock.yaml` for reproducible pnpm installation.

## Source layout

- `electron/` — native application lifecycle, file access, saved history, and the restricted desktop bridge.
- `src/` — the workspace interface and document state.
- `tests/` — automated model and desktop checks.
- `release/` — generated Windows builds.

The renderer has no direct Node.js access. Native file actions pass through the desktop bridge, and document content is treated as text.
