# Doom in a Pinto note

The real Doom (id Software, 1993) built for the web, so it runs as a note app in [Pinto Notes](https://pintonotes.com). It's the shareware episode, Knee-Deep in the Dead, with its sound effects and the original FM synthesizer music.

This isn't a remake or a video. The game engine is doomgeneric, a port of Chocolate Doom, compiled to WebAssembly. The game data is id's shareware DOOM1.WAD, byte for byte.

## Put it in a note

Ask the AI you've connected to Pinto Notes:

> Make my note "Doom" run the game from github.com/pinto-notes/pinto-doom. The files are in app/.

The AI reads the files in `app/` and writes them into the note's app. It can give Pinto Notes the address of each large file (`doom.wasm`, `doom1.wad`) to download, so nothing has to be copied by hand. For example:

```
https://raw.githubusercontent.com/pinto-notes/pinto-doom/main/app/doom1.wad
```

You can also drop the `app` folder onto a note in the Mac app, or push it with the `pinto` command line tool. This needs Pinto Notes 1.4, which lets note apps use WebAssembly and large files.

## Play

Click the game, then press Enter. Arrows move, Ctrl fires, Space opens doors, Shift runs, Alt strafes, Esc opens the menu. On a phone, use the pad at the bottom left to move and turn, and the Fire, Use and Menu buttons. Sound starts with your first click, tap or key press. [app/README.md](app/README.md) has the details.

## What's here

- `app/`: the note app as it's played. `index.html`, `main.js` (runs the game 35 times a second, draws it, plays the sound), `touch.js` (on-screen controls), `doom.js` and `doom.wasm` (the engine as built), and `doom1.wad` (the game data).
- `source/`: everything needed to build `app/` again. That's the platform file that connects the engine to the page, the sound and music modules, `build.sh`, `pack.py`, and two offscreen checks (`check-sound.mjs`, `check-tic-cost.mjs`).

## Build it yourself

1. Install [emsdk](https://emscripten.org/docs/getting_started/downloads.html) into `build/emsdk`.
2. Clone doomgeneric into `build/doomgeneric` at commit `e257a09527062bfb986b6e5e0780839b6cbd5b71`. The engine is built from it unchanged.
3. Run `source/build.sh`, which writes `build/out/doom.js` and `build/out/doom.wasm`.
4. Run `python3 source/pack.py <out dir> <DOOM1.WAD>`. It checks the WAD's SHA-1 (`5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`, shareware v1.9) and writes the app's files.

## Licences

- **Code: GNU GPL v2** (see [LICENSE](LICENSE)).
  - The engine is [doomgeneric](https://github.com/ozkl/doomgeneric), a port of Chocolate Doom.
  - The music player comes from [Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom) 2.1.0 (Copyright (C) 2005-2014 Simon Howard): `i_oplmusic.c`, `midifile.c`, `opl.c` and `opl_queue.c`. Some of these files are adapted.
  - The OPL chip emulator is DOSBox's DBOPL (Copyright (C) 2002-2010 The DOSBox Team).
  - The files written for this project are `doomgeneric_pinto.c`, `pinto_sound.c`, `opl_pinto.c`, the files in `app/` other than the game data, and the build and check scripts. They are also under the GPL v2.
- **Game data: `app/doom1.wad`** is id Software's shareware DOOM1.WAD v1.9. id allowed the shareware version to be shared as long as it isn't changed, and it's included here unchanged. It isn't covered by the GPL.

DOOM is a trademark of id Software. This project isn't affiliated with or endorsed by id Software or ZeniMax.
