# Data Visualizer

A local Windows desktop workspace for raw data and its visualization. This first version establishes the desktop shell, document editing, file handling, and pane layout described in [the original brief](docs/first-version-brief.txt).

The visualization pane deliberately starts blank with a faint **DV** mark. Chart rendering and additional data tools can be added in subsequent versions.

## Install and open

Run **Data-Visualizer-Setup-0.1.0.exe** in `release`. The installer offers a desktop shortcut and registers the `.dv` document type. Launch Data Visualizer from its shortcut to create or open a document, or open a saved `.dv` file from Windows. This initial build is unsigned; Windows may show an unknown-publisher notice.

The unpacked application is also available at `release/win-unpacked/Data Visualizer.exe` after packaging. Keep the entire `win-unpacked` folder together when using this version; the executable depends on its neighboring files. The unpacked version does not itself create shortcuts or register file associations.

## Workspace

- Choose **Create new file** to start with an empty document, or **Open a file** to select a local file.
- The text pane appears on the left and the visualization pane on the right.
- Use **Layout** to choose text only, visualizer only, or split view, and to toggle Focus View.
- Collapse or expand the explorer using the left activity rail. These panels have preset widths, with compact sizing in smaller windows.
- Open a folder to browse its supported text files. Drag a file from the explorer onto the text pane to add it to the workspace.
- Drag tabs to reorder them or move them between panes. Closing a tab keeps its counterpart open; closing the last tab prompts to save any changes. **File → Close document** closes both views.
- Save documents through the **File** menu. An unsaved-change marker identifies edited documents.
- Use **History** to inspect and restore locally stored saved versions. Restored text is written to disk when you save it. Up to 20 versions per file are retained within a 32 MB total history limit.

Line numbers follow actual text lines. Resizing a pane does not create additional numbered lines.

The appearance follows the supplied dark desktop references and uses native Windows minimize, maximize/restore, and close controls.

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

The app can also open UTF-8 plain-text files: `.txt`, `.csv`, `.tsv`, `.json`, and `.md`, up to 8 MB of text each. Saving an existing plain-text document preserves its plain-text format. No cloud account is required; document access, recent files, and saved history are local. Folder browsing is bounded to five nested levels and 1,500 entries.

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

With Electron 45, install the runtime explicitly with `node node_modules/electron/install.js` if dependency installation has not downloaded it. Build output is written to `release`. The first dependency installation and packaging run may need internet access to download Electron and packaging tools. Normal app use does not require a development server. The source also includes `pnpm-lock.yaml` for reproducible pnpm installation.

## Source layout

- `electron/` — native application lifecycle, file access, saved history, and the restricted desktop bridge.
- `src/` — the workspace interface and document state.
- `tests/` — automated model and desktop checks.
- `release/` — generated Windows builds.

The renderer has no direct Node.js access. Native file actions pass through the desktop bridge, and document content is treated as text.
