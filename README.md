# DopeWars 2.4.6 — web remake

A browser recreation of **DopeWars 2.4.6 for Palm OS** (Matthew Lee / Michael Hallett, compiled
12/10/2005), rebuilt from the original `DopeWars2.4.6.prc`. The game logic in `game.js` is a
function-by-function port of the app's 68k machine code, so prices, odds, wording and the
original's bugs all match the Palm version.

This folder holds the source for the full version (`index.html`). A picker under the game switches
between three views, and the choice is remembered:

* **Palm** (default): an m515-style device with Graffiti area, silkscreen buttons and a launcher.
* **Screen**: just the 160×160 Palm screen, scaled to fill the window.
* **Modern**: a restyled HTML interface (see below).

The phone-friendly **game-only** page (Classic/Modern only, no device) is built from these same
files into one self-contained `../game-only/index.html`.

## Run it

No build step; it's plain HTML and JavaScript.

```bash
python3 -m http.server 8246
```

Then open <http://127.0.0.1:8246/>.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css`, `main.js` | The page: an m515-style Palm body with Graffiti area, silkscreen buttons (Home, Menu, abc/123), scroll rocker, a small app launcher, the Palm/Screen/Modern picker, scaling and keyboard input. |
| `game.js` | The game: one JavaScript function per original C function (`initGame`, `DoTravel`, `FuzzEncounter`, `NegotiateBuy`, …), with code addresses in comments. Saves to `localStorage`. |
| `palmos.js` | A small Palm OS 3.5 UI layer providing just the calls the game makes (forms, controls, fields, alerts, Tips, menus, events, `SysRandom`), drawn into a 160×160 canvas. Modal calls such as `FrmAlert` return Promises and run nested event loops, like the real ones. |
| `font.js` | Hand-drawn pixel fonts at Palm metrics (Std, Bold, Large). |
| `data.js` | **Generated**: forms, alerts, menus, help text, bitmaps and the random-event table extracted from the PRC. Don't edit it; regenerate with `tools/build_data.py`. |
| `modern.js` | The **Modern** view, shared with the game-only page. |

## Modern style

`modern.js` is an alternative HTML view of the same running game: stat cards, a market list with
Buy/Sell buttons, bottom-sheet dialogs with numeric keypads, a menu sheet, and light/dark themes.
It's sized to fit a phone screen without scrolling.

It never changes game state itself. It reads:

* `DopeWars.state` (cash, inventory, prices, days…),
* `PalmOS.view()` (the active form and the stack of open dialogs or alerts), and
* the text the game drew on each form (`form.texts`, recorded by `WinDrawChars`). This is how the
  Game Over and High Score screens get their exact wording.

It sends back the same input the Palm screen would: control taps (`ctlSelectEvent`), menu choices
(`menuEvent`) and typed field text. The canvas keeps running underneath, so switching between
Classic and Modern is possible at any moment, even with a dialog open.

The hooks it relies on in `palmos.js` are read-only: a change counter (`PalmOS.version`), `view()`,
text capture, and the raw alert and help text kept on alert/Tips forms. The canvas drawing is
unchanged.

## Rebuilding

From the parent folder (`DopeWars-2.4.6/`):

```bash
.venv/bin/python tools/build_data.py     # regenerate web/data.js from the extracted PRC
python3 tools/build_game_only.py         # rebuild game-only/index.html from these sources
node tests/sim.js 200                    # headless checks + a bot that plays 200 games
```

The game-only page's layout, CSS and style switch live in `tools/game_only_template.html`.
Rebuild it after changing anything in this folder. The Modern CSS is duplicated there and in
`style.css`, so change both.

## Controls (device version)

* Tap with the mouse or a finger, as with a stylus. Type digits and names on the keyboard; on a
  phone, tap a field or **abc**/**123**.
* **Menu** or tapping the title bar opens the menus. Ctrl+N / Ctrl+S / Ctrl+V are the command
  strokes.
* **Home** saves and quits to the launcher. In the Modern view the launcher is a Play screen.
* The picker is remembered under the `localStorage` key `dopewars-2.4.6/view`.
* Hidden cheat from the original: write `¥` (Option-Y on a Mac), then a letter.

See `../notes/REVERSE_ENGINEERING.md` for the full game rules, formulas and code addresses.
