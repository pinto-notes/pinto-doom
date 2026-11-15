// Sound for the Pinto Notes web build of Doom (doomgeneric, built with FEATURE_SOUND).
//
// Sound effects: Doom's sound module hands each effect to the page (Module.pintoAudio in
// main.js), which plays it with Web Audio. The effect is the WAD's own DS* lump: 8-bit
// unsigned PCM after an 8-byte header (format 3, sample rate, sample count). Like DMX and
// Chocolate Doom, the first and last 16 samples are skipped. Doom's 8 channels map to 8
// page channels; volume (0-127) and separation (0-254, 128 = centre) go along with it.
//
// Music: Chocolate Doom's OPL music player (i_oplmusic.c: MUS -> MIDI -> OPL2 FM synthesis
// with the WAD's GENMIDI instruments), on the DOSBox OPL emulator. The page pulls samples
// from pinto_music_render() (opl_pinto.c).
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.

#include <emscripten.h>
#include <stdio.h>
#include <string.h>

#include "doomtype.h"
#include "i_sound.h"
#include "m_misc.h"
#include "w_wad.h"
#include "z_zone.h"

#define NUM_CHANNELS 8

// i_sound.c binds these config variables when FEATURE_SOUND is on (SDL's resampler; unused).
int use_libsamplerate = 0;
float libsamplerate_scale = 0.65f;

void I_InitTimidityConfig(void) {}

static boolean use_sfx_prefix;

EM_JS(void, js_sfx_start, (int channel, int lump, const unsigned char *data, int length, int rate, int vol, int sep), {
  var a = Module.pintoAudio;
  if (a) a.start(channel, lump, HEAPU8.subarray(data, data + length), rate, vol, sep);
});
EM_JS(void, js_sfx_params, (int channel, int vol, int sep), {
  var a = Module.pintoAudio;
  if (a) a.params(channel, vol, sep);
});
EM_JS(void, js_sfx_stop, (int channel), {
  var a = Module.pintoAudio;
  if (a) a.stop(channel);
});
EM_JS(int, js_sfx_playing, (int channel), {
  var a = Module.pintoAudio;
  return a && a.playing(channel) ? 1 : 0;
});

static void GetSfxLumpName(sfxinfo_t *sfx, char *buf, size_t buf_len)
{
    // Linked sfx lumps? Get the lump number for the sound linked to.
    if (sfx->link != NULL)
    {
        sfx = sfx->link;
    }

    // Doom adds a DS* prefix to sound lumps; Heretic and Hexen don't.
    if (use_sfx_prefix)
    {
        M_snprintf(buf, buf_len, "ds%s", sfx->name);
    }
    else
    {
        M_StringCopy(buf, sfx->name, buf_len);
    }
}

static boolean Pinto_InitSound(boolean _use_sfx_prefix)
{
    use_sfx_prefix = _use_sfx_prefix;
    return true;
}

static void Pinto_ShutdownSound(void)
{
    int i;

    for (i = 0; i < NUM_CHANNELS; ++i)
    {
        js_sfx_stop(i);
    }
}

static int Pinto_GetSfxLumpNum(sfxinfo_t *sfx)
{
    char namebuf[9];

    GetSfxLumpName(sfx, namebuf, sizeof(namebuf));
    return W_CheckNumForName(namebuf);
}

static void Pinto_UpdateSound(void)
{
}

static void Pinto_UpdateSoundParams(int channel, int vol, int sep)
{
    if (channel < 0 || channel >= NUM_CHANNELS)
    {
        return;
    }

    js_sfx_params(channel, vol, sep);
}

static int Pinto_StartSound(sfxinfo_t *sfxinfo, int channel, int vol, int sep)
{
    int lumpnum;
    unsigned int lumplen, length;
    int samplerate;
    byte *data;

    if (channel < 0 || channel >= NUM_CHANNELS)
    {
        return -1;
    }

    js_sfx_stop(channel);

    lumpnum = sfxinfo->lumpnum;
    if (lumpnum < 0)
    {
        return -1;
    }

    data = W_CacheLumpNum(lumpnum, PU_STATIC);
    lumplen = W_LumpLength(lumpnum);

    // Check the header: format 3, 16-bit sample rate, 32-bit sample count.
    if (lumplen < 8 || data[0] != 0x03 || data[1] != 0x00)
    {
        W_ReleaseLumpNum(lumpnum);
        return -1;
    }

    samplerate = (data[3] << 8) | data[2];
    length = (data[7] << 24) | (data[6] << 16) | (data[5] << 8) | data[4];

    // Like DMX: drop sounds longer than their lump or 48 samples or shorter,
    // and skip the first and last 16 samples.
    if (length > lumplen - 8 || length <= 48)
    {
        W_ReleaseLumpNum(lumpnum);
        return -1;
    }

    js_sfx_start(channel, lumpnum, data + 8 + 16, length - 32, samplerate, vol, sep);

    // The page copies the samples the first time it sees a lump.
    W_ReleaseLumpNum(lumpnum);

    return channel;
}

static void Pinto_StopSound(int channel)
{
    if (channel < 0 || channel >= NUM_CHANNELS)
    {
        return;
    }

    js_sfx_stop(channel);
}

static boolean Pinto_SoundIsPlaying(int channel)
{
    if (channel < 0 || channel >= NUM_CHANNELS)
    {
        return false;
    }

    return js_sfx_playing(channel) != 0;
}

static snddevice_t sound_pinto_devices[] =
{
    SNDDEVICE_SB,
    SNDDEVICE_PAS,
    SNDDEVICE_GUS,
    SNDDEVICE_WAVEBLASTER,
    SNDDEVICE_SOUNDCANVAS,
    SNDDEVICE_AWE32,
};

sound_module_t DG_sound_module =
{
    sound_pinto_devices,
    arrlen(sound_pinto_devices),
    Pinto_InitSound,
    Pinto_ShutdownSound,
    Pinto_GetSfxLumpNum,
    Pinto_UpdateSound,
    Pinto_UpdateSoundParams,
    Pinto_StartSound,
    Pinto_StopSound,
    Pinto_SoundIsPlaying,
    NULL,  // CacheSounds: the page caches each effect the first time it plays
};

// Music: Chocolate Doom's OPL player, under the name i_sound.c expects.

extern music_module_t music_opl_module;

static boolean Pinto_InitMusic(void) { return music_opl_module.Init(); }
static void Pinto_ShutdownMusic(void) { music_opl_module.Shutdown(); }
static void Pinto_SetMusicVolume(int volume) { music_opl_module.SetMusicVolume(volume); }
static void Pinto_PauseMusic(void) { music_opl_module.PauseMusic(); }
static void Pinto_ResumeMusic(void) { music_opl_module.ResumeMusic(); }
static void *Pinto_RegisterSong(void *data, int len) { return music_opl_module.RegisterSong(data, len); }
static void Pinto_UnRegisterSong(void *handle) { music_opl_module.UnRegisterSong(handle); }
static void Pinto_PlaySong(void *handle, boolean looping) { music_opl_module.PlaySong(handle, looping); }
static void Pinto_StopSong(void) { music_opl_module.StopSong(); }
static boolean Pinto_MusicIsPlaying(void) { return music_opl_module.MusicIsPlaying(); }

static snddevice_t music_pinto_devices[] =
{
    SNDDEVICE_ADLIB,
    SNDDEVICE_SB,
};

music_module_t DG_music_module =
{
    music_pinto_devices,
    arrlen(music_pinto_devices),
    Pinto_InitMusic,
    Pinto_ShutdownMusic,
    Pinto_SetMusicVolume,
    Pinto_PauseMusic,
    Pinto_ResumeMusic,
    Pinto_RegisterSong,
    Pinto_UnRegisterSong,
    Pinto_PlaySong,
    Pinto_StopSong,
    Pinto_MusicIsPlaying,
    NULL,  // Poll
};
