#!/bin/zsh
# Builds doomgeneric to doom.js + doom.wasm (normal WebAssembly build) with sound effects and
# OPL music. Needs emsdk and a doomgeneric checkout in BUILD (default: ../build next to this
# folder); writes BUILD/out/doom.js and BUILD/out/doom.wasm. Built 2026-11-14 with emsdk latest
# (emcc 7.0.0), doomgeneric master, and Chocolate Doom 2.1.0's OPL music files in src/.
# Then: python3 pack.py <out dir> <DOOM1.WAD>; check with check-sound.mjs and check-tic-cost.mjs.
set -euo pipefail
HERE=${0:A:h}
BUILD=${BUILD:-${HERE:h}/build}
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
SRC=$BUILD/doomgeneric/doomgeneric
OUT=$BUILD/out
OBJ=$BUILD/obj
mkdir -p $OUT $OBJ
OBJS=(dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric mus2mid)
FILES=()
for o in $OBJS; do FILES+=($SRC/$o.c); done
# Pinto Notes platform and sound, and Chocolate Doom 2.1.0's OPL music (some files adapted).
FILES+=($HERE/src/doomgeneric_pinto.c $HERE/src/pinto_sound.c $HERE/src/i_oplmusic.c $HERE/src/midifile.c)
FILES+=($HERE/src/opl/opl.c $HERE/src/opl/opl_queue.c $HERE/src/opl/dbopl.c $HERE/src/opl/opl_pinto.c)
CFLAGS=(-O3 -I$HERE/include -I$HERE/src -I$HERE/src/opl -I$SRC -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE
  -DFEATURE_SOUND -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200
  -Wno-implicit-function-declaration -Wno-int-conversion -Wno-incompatible-pointer-types -w)
# Compile in parallel (at most 4 at once, at low priority), then link.
OFILES=()
n=0
for f in $FILES; do
  o=$OBJ/${${f:t}:r}.o
  OFILES+=($o)
  nice -n 10 emcc $CFLAGS -c $f -o $o &
  (( ++n % 4 == 0 )) && wait
done
wait
nice -n 10 emcc -O3 $OFILES -o $OUT/doom.js \
  -sENVIRONMENT=web -sMODULARIZE=1 -sEXPORT_NAME=DoomModule -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sFORCE_FILESYSTEM=1 -sDYNAMIC_EXECUTION=0 -sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=0 \
  -sEXPORTED_FUNCTIONS=_main,_doomgeneric_Tick,_pinto_key,_pinto_screen,_pinto_frames,_pinto_music_render,_pinto_music_rate \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain,HEAPU8,HEAPU32,HEAP16
ls -l $OUT
