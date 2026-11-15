# Doom

The real Doom (id Software, 1993) running in a note: the shareware episode, Knee-Deep in the Dead.

The page is the note's own: its title at the top, the game below on the note's background, sized to the note. Click the game, then press Enter. Arrows move, Ctrl fires, Space opens doors, Shift runs, Alt strafes, Esc opens the menu. The line of keys under the game fades once you move or fire, and comes back when you press Esc. On a phone, drag the pad at the bottom left to move and turn, hold Fire to shoot, tap Use to open doors and pick menu items, and tap Menu to open or back out of the menu. Saved games last only while the app is open.

## Sound
The game has its sound effects and its music. Browsers only allow sound after you interact with a page, so the sound starts with your first click, tap or key press; nothing plays before that. Change the volume in the game's menu: Options, then Sound Volume. The sound pauses while the app is hidden.

- Sound effects are the WAD's own recordings, played with Web Audio on Doom's 8 channels, with each sound's volume and left-right position.
- Music is the original FM synthesizer music: the WAD's MUS songs, played through an emulated OPL2 (AdLib / Sound Blaster) chip with the WAD's GENMIDI instruments, as Doom sounded on a Sound Blaster.

## Files
- index.html: the note's title, the canvas and the line of keys under it, in the note's colours (light and dark).
- main.js: loads the engine and the game data, runs a game tic 35 times a second, draws each frame to the canvas, passes keys to the game, and plays the sound.
- touch.js: on-screen controls for touch screens (move pad, Fire, Use, Menu) that send the same key events as a keyboard.
- doom.js: Emscripten's loader for the engine, as built.
- doom.wasm: the engine, WebAssembly, as built.
- doom1.wad: DOOM1.WAD, the shareware v1.9 game data, as it ships. main.js checks it against id's SHA-1 (5b2e249b9c5133ec987b3ea77596381dc0d6bc1d) before it runs.

## Where it comes from
- The engine is doomgeneric (https://github.com/ozkl/doomgeneric), a port of Chocolate Doom, under the GNU GPL v2. It's built unchanged with Emscripten, plus a small platform file that hands frames and keys to main.js and a sound module that hands sound effects to it.
- The music player is from Chocolate Doom 2.1.0 (https://github.com/chocolate-doom/chocolate-doom), Copyright (C) 2005-2014 Simon Howard, under the GNU GPL v2: its OPL music code (i_oplmusic.c), MIDI reader (midifile.c) and OPL library (opl.c, opl_queue.c), with an OPL driver adapted from its SDL one so the page can pull samples (no SDL). The MUS to MIDI converter (mus2mid.c, Ben Ryves and Simon Howard, GPL v2) comes with doomgeneric.
- The OPL chip emulator is DOSBox's DBOPL (dbopl.c), Copyright (C) 2002-2010 The DOSBox Team, under the GNU GPL v2, as included in Chocolate Doom.
- DOOM1.WAD is id Software's shareware data, which id allows to be shared unmodified. It's here byte for byte.

## Needs
WebAssembly, Web Audio, and binary files in a note app (Pinto Notes 1.4): the app stores them compressed, about 2.6 MB for the whole game.
