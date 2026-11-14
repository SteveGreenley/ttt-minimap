# ttt-minimap

A VS Code-style minimap for the [ttt](https://tttedit.dev) editor: a live,
braille rendering of the active buffer in a narrow panel docked on the right.
Each source line becomes one pixel row of Unicode braille (2×4 dots per terminal
cell), so indentation and line length form the visible silhouette. The map fills
the panel width and uses one gray from the active theme. Clicking the map
scrolls the editor to that point.

## Requirements

- ttt ≥ 1.10.0 (`ttt.text`, `ttt.debounce`, `ttt.show_panel`); tested with
  v1.12.1.
- On older builds the panel still registers, but the plugin cannot open it
  automatically — select the **Minimap** tab manually.

## Install

Clone into the plugins directory:

```sh
git clone https://github.com/<owner>/ttt-minimap ~/.config/ttt/plugins/ttt-minimap
```

Or use **Plugins: Install from URL** with the repository URL. Either way, ttt
asks you to approve exactly six permissions: `panel.bottom`, `commands`,
`editor.read`, `editor.write` (scrolling), `events.editor`, `storage`. An
existing install prompts once more when the plugin gains `editor.write`.

## Use

The panel auto-opens on load, docks itself right, and keeps keyboard focus in
the editor. Drag the divider between the editor and the panel to set the width;
ttt remembers widths of 30 columns or more and resets anything narrower to its
default.

Left-click anywhere in the map to scroll the editor so the clicked point sits in
the middle of the viewport. The caret does not move; clicking blank space below a
short file's map scrolls to the last line.

Commands:

| Command | Effect |
|---|---|
| `Minimap: Show` | Re-dock right and activate the Minimap tab |
| `Minimap: Refresh` | Rebuild the map from the buffer now |
| `Minimap: Choose Color` | Pick one of the three theme grays |
| `Minimap: Toggle Auto-Open` | Stop the panel opening on startup |

## Rendering

- One source line per pixel row for files up to `panel height × 4` lines; above
  that, lines are aggregated per pixel row so the whole file always fits.
- 2×4 braille dots per cell (`U+2800`–`U+28FF`); the horizontal scale is the
  longest measured line in the buffer.
- The viewport thumb `▌` and the caret `◆` occupy the first column of the panel
  content, to the left of the map. The caret replaces the thumb on its row and is
  omitted while the cursor is scrolled out of view.
- Tabs are measured against the configured tab width; wide characters count as
  their display width.
- Implemented entirely in `plugin.lua`: the plugin sandbox only preloads its own
  modules, so there is no separate source tree to build.

## Configuration

State lives in `~/.config/ttt/state/plugins/ttt-minimap.json`:

```json
{
  "config": {
    "color": "muted",
    "show_viewport": true,
    "viewport_style": "line",
    "show_cursor": true,
    "cursor_style": "default",
    "tab_width": 4,
    "auto_open": true,
    "click_top": 4
  }
}
```

| Key | Values | Meaning |
|---|---|---|
| `color` | `muted` (default), `line`, `border` | Theme style for the map |
| `show_viewport` | boolean | Draw the viewport thumb column and reserve its space |
| `viewport_style` | `muted`, `line`, `border`, `default` | Style for `▌` |
| `show_cursor` | boolean | Draw `◆` at the cursor row |
| `cursor_style` | `muted`, `line`, `border`, `default` | Style for `◆` |
| `tab_width` | 1–16 | Display width of a tab when measuring lines |
| `auto_open` | boolean | Open and dock the panel on load |
| `click_top` | 0–16 | Screen rows of chrome above the panel content, used to map a click to a map row |

Colors are named theme styles, not hex values, so the map follows the active
theme:

| Preset | Theme key | Shipped default |
|---|---|---|
| `muted` | `muted` | `#888888` |
| `line` | `editor.lineNumber` | `#999999` |
| `border` | `border` | `#555555` |

For an arbitrary shade, change those keys in a custom theme instead of the
plugin config.

## Limitations

- **No fold markers.** The plugin API exposes no fold ranges or names.
- **No true overlay.** `ttt.open_drawer` is modal, so the only persistent
  right-side surface is the bottom panel docked right; ttt draws its tab row and
  divider around the map.
- **Files over 20,000 lines are sampled**, one representative line per pixel row,
  instead of copying the whole buffer.
- **Click mapping assumes ttt's default layout.** The host reports a click's
  absolute screen row and exposes no panel origin, so the plugin subtracts
  `click_top` (default 4: menu bar, top border, panel tab row, divider). Hide the
  menu bar and set `click_top` to 3. The panel must stay docked right (the plugin
  puts it there on load); docked below the editor, clicks land on the wrong row.
- **Shared panel.** The bottom panel hosts Terminal, Output and other plugin
  tabs; selecting another tab hides the minimap until you reselect it.

## Development

```sh
make ttt           # download the pinned ttt (v1.12.1) into .tools/
make dev           # run ttt with this plugin against fixtures/sample.go
make test          # node --test tests/*.test.js
make install-local # symlink this checkout into ~/.config/ttt/plugins/
```

Tests drive the real binary headlessly through `--exec` with an isolated
`TTT_CONFIG_DIR`, and cover rendering, live updates, viewport movement,
click-to-scroll, config loading, color persistence, install-path loading, and
empty/large buffers.

## License

MIT.
