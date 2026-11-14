# Handoff

Status snapshot for resuming work. Conventions and gotchas live in `AGENTS.md`;
user documentation lives in `README.md`.

## Where things stand (2026-11-14)

| | |
|---|---|
| Branch | `main`, clean, CI green on ubuntu-latest and macos-latest |
| Plugin | v0.1.1, 8 tests, 6 permissions |
| Registry | merged as eugenioenko/ttt#1602; the live entry still says `version: 0.1.0` |
| Open PR | eugenioenko/ttt#1611 — sets that live entry to `0.1.1` (metadata only, no code) |
| Local editor | ttt 1.12.1 (brew), plugin installed from the registry and enabled |

Everything requested so far is done: braille map, three theme grays with a
picker, live updates while typing, viewport thumb and caret markers,
click-to-scroll, and the public install path.

## Verified, so you do not have to re-prove it

| Check | Result |
|---|---|
| `make test` against pinned ttt 1.12.1 | 8/8 |
| `make test TTT_BIN=/tmp/ttt-1.11.0` | 8/8 (second data point; brew shipped 1.11.0 for a while) |
| ttt 1.7.1 | plugin loads, its tab renders `Minimap needs ttt 1.10.0 or newer (this is v1.7.1)`, no init error |
| `Plugins: Install from URL` and registry install | clone lands, approval lists the 6 permissions, panel loads, startup log appears |
| Click on map row 5 of `fixtures/sample.go` | editor scrolls to line 21, caret unmoved, typing still reaches the buffer |

Re-fetch the second binary before trusting that row:

```sh
curl -sSfL -o /tmp/ttt-1.11.0 \
  https://github.com/eugenioenko/ttt/releases/download/v1.11.0/ttt-darwin-arm64
chmod +x /tmp/ttt-1.11.0 && make test TTT_BIN=/tmp/ttt-1.11.0
```

## Next steps, in order

1. **Merge eugenioenko/ttt#1611**, then restart ttt: the plugin's detail page
   shows `v0.1.1`. The registry number is cosmetic — installs and updates always
   come from the repository.
2. **Optional host fix.** `on_event` should deliver panel-relative coordinates as
   ttt's docs promise (`panel_widget.go` `dispatch`: translate by `pw.GetRect()`
   before `eventToLua`). Once a release carries it, delete `click_top` and the
   chrome assumption disappears for every plugin.
3. **Optional polish.** A screenshot or GIF in the README (the registry detail
   page renders it), and a `TTT_VERSION` bump once ttt ships past 1.12.1.
4. **Housekeeping.** The fork branch `add-ttt-minimap` is merged and can be
   deleted; `/tmp/ttt-registry/ttt`, `/tmp/ttt-src` and `/tmp/ttt-1.11.0` are
   disposable.

## Decisions and why

| Decision | Reason |
|---|---|
| Bottom panel docked right, not a drawer | `open_drawer` is modal and consumes every key while open |
| Named theme grays only | `panel:text` takes style names; there is no fg/bg parameter |
| Click centers the clicked line, caret stays | Matches VS Code, and keeps `◆` meaning "where the cursor is" |
| Chrome-offset click mapping (`click_top`) | Host sends absolute coordinates and exposes no panel rect; alternatives were `screen.read` or a patched editor |
| `editor.write` granted | `editor.scroll_to` sits behind it; there is no read-only way to scroll |
| 20,000-line sampling cap | Keeps a full-buffer copy off the hot path; one line per pixel row above the cap |
| No fold markers | No plugin API exposes fold ranges or names |

## Resuming in one line

```sh
cd ~/Projects/ttt-minimap && make test && make dev
```
