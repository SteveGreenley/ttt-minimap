# Working in ttt-minimap

Agent-facing notes. User documentation lives in `README.md`; current status,
open items and the reasoning behind past choices live in `HANDOFF.md`.

## Verify a change

```sh
make ttt                                  # pinned ttt 1.12.1 into .tools/
make test                                 # 8 tests, ~12 s, Node >= 18
make test TTT_BIN=/tmp/ttt-1.11.0         # second data point users run
```

`make test` drives the real editor binary headlessly; nothing is mocked. A change
is done when both runs are green and, for anything visual, when a screenshot of
the actual frame proves it:

```sh
TTT_CONFIG_DIR=$(mktemp -d) ./.tools/ttt --size 120x36 --plugin ./plugin.lua \
  fixtures/sample.go --exec "wait 700;screenshot /tmp/frame.txt;quit"
```

`make dev` is the same thing interactively, with an isolated config and no
approval dialog.

## Layout

| Path | Holds |
|---|---|
| `plugin.lua` | the whole plugin: config, braille renderer, panel, events, commands |
| `plugin.ttt.json` | manifest: name, version, entry, API 2, 6 permissions |
| `tests/tui.js` | harness: `start`, `cli`, `wait`, `key`, `type`, `click`, `exec`, `snapshot`, `debug`, `run`, `seedStorage`, `installPlugin`, `preflight` |
| `tests/minimap.test.js` | 8 tests; helpers `BRAILLE`, `rightColumns`, `barRows`, `findPanelWidth` |
| `fixtures/` | `sample.go` (97 lines counted, one 163-column line), `empty.txt` |
| `Makefile` | `ttt`, `test`, `dev`, `install-local`, `uninstall-local`, `clean` |
| `.github/workflows/test.yml` | `make test` on ubuntu-latest and macos-latest |

## Constraints that shape the code

- **One file.** ttt's sandbox `require` resolves only its own `ttt*` modules, so a
  split source tree cannot load. Everything stays in `plugin.lua`.
- **API 2.** `ttt.text` exists from ttt 1.10.0; its require is guarded so older
  builds register a panel that states the requirement instead of failing.
- **Permissions are the contract:** `panel.bottom`, `commands`, `editor.read`,
  `editor.write`, `events.editor`, `storage`. Adding one re-prompts every
  installed user; `editor.write` buys `editor.scroll_to` for click-to-scroll.
- **Colors are theme style names** (`muted`, `line`, `border`, `default`), never
  hex. `panel:text(x, y, text, style)` is raw cell drawing; `panel:label` and
  `panel:list` are widgets.
- **Harness facts.** Snapshots and debug dumps are files written by `--exec`, so
  read them after `run()`. Debug JSON reports 0-based `viewport` and `cursor`
  lines. `node --test tests/` fails on Node 22 — pass the glob. One
  `tui.start()` per test, `tui.cleanup()` in `finally`.

## Gotchas the source does not tell you

- **Mouse coordinates are absolute.** ttt's plugin docs promise `on_event` x/y
  relative to the panel; the host sends screen coordinates and exposes no panel
  rect. `click_top` (default 4: menu bar, top border, tab row, divider)
  compensates, which is why a hidden menu bar wants `click_top: 3` and a
  bottom-docked panel mis-maps. A host fix upstream retires that key.
- **`--plugin` wires the log after init**, so top-level `ttt.log` lines are
  dropped in dev mode. Tests that assert the startup line load the plugin from a
  plugins directory instead.
- **`editor.viewport()` returns a table** (`top_line`, `bottom_line`, `height`).
  `line_count()` counts the trailing empty line. `editor.scroll_to` clamps only at
  zero, so clamp the top to `count - height` yourself.
- **`ttt.debounce` returns two values** (function, cancel).
- **One click can deliver the press twice**; click handlers must be idempotent.
- **The registry entry's `version` is display-only** and an in-app update does not
  refresh it for a loaded plugin, so the panel can show an older number than the
  installed manifest.

## Releasing

1. Change behaviour, bump `version` in `plugin.ttt.json`.
2. Land one PR against `eugenioenko/ttt` setting the same `version` in
   `community-plugins.json`. The entry is repo-root, so it has no `path`;
   `featured` and `community` are maintainer-owned fields.
3. Users update through the plugin row's `⋮` menu (`git pull` on `main`), then
   restart. Only a permissions change re-prompts approval.
