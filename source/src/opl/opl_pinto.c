// OPL driver for the Pinto Notes web build of Doom. Adapted from Chocolate Doom 2.1.0's
// opl_sdl.c (Copyright(C) 2005-2014 Simon Howard), GNU GPL v2 or later.
//
// There's no audio thread and no SDL: the page's Web Audio callback asks for samples with
// pinto_music_render(), which runs the DOSBox OPL emulator (dbopl.c) and the music
// callbacks (opl_queue.c) on the emulated clock, exactly as the SDL driver does from its
// mixer callback. Everything runs on the page's one thread, so there are no locks.
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>

#include "dbopl.h"
#include "opl.h"
#include "opl_internal.h"
#include "opl_queue.h"

#define MAX_RENDER 8192

typedef struct
{
    unsigned int rate;        // Number of times the timer is advanced per sec.
    unsigned int enabled;     // Non-zero if timer is enabled.
    unsigned int value;       // Last value that was set.
    uint64_t expire_time;     // Calculated time that timer will expire.
} opl_timer_t;

static opl_callback_queue_t *callback_queue;
static uint64_t current_time;      // us since startup, on the emulated clock
static int opl_paused;
static uint64_t pause_offset;      // us spent paused
static int callbacks_locked;       // OPL_Lock: don't run callbacks (re-entry guard)
static Chip opl_chip;
static int initialized;
static unsigned int mixing_freq;
static int register_num;
static opl_timer_t timer1 = { 12500, 0, 0, 0 };
static opl_timer_t timer2 = { 3125, 0, 0, 0 };

static Bit32s mix_buffer[MAX_RENDER];
static int16_t out_buffer[MAX_RENDER];

static void RunDueCallbacks(void)
{
    opl_callback_t callback;
    void *callback_data;

    if (callbacks_locked)
    {
        return;
    }

    while (!OPL_Queue_IsEmpty(callback_queue)
        && current_time >= OPL_Queue_Peek(callback_queue) + pause_offset)
    {
        if (!OPL_Queue_Pop(callback_queue, &callback, &callback_data))
        {
            break;
        }

        callback(callback_data);
    }
}

void OPL_Pinto_AdvanceTime(uint64_t us)
{
    current_time += us;

    if (opl_paused)
    {
        pause_offset += us;
    }

    RunDueCallbacks();
}

static void AdvanceSamples(unsigned int nsamples)
{
    OPL_Pinto_AdvanceTime(((uint64_t) nsamples * OPL_SECOND) / mixing_freq);
}

// Called by the page: fill n mono samples (16-bit) and return where they are.

EMSCRIPTEN_KEEPALIVE int16_t *pinto_music_render(int n)
{
    unsigned int filled = 0, i;

    if (n > MAX_RENDER) n = MAX_RENDER;
    if (n < 0) n = 0;

    if (!initialized)
    {
        for (i = 0; i < (unsigned int) n; ++i) out_buffer[i] = 0;
        return out_buffer;
    }

    while (filled < (unsigned int) n)
    {
        uint64_t nsamples;

        // Render up to the next callback, then run it, like opl_sdl.c.

        if (opl_paused || OPL_Queue_IsEmpty(callback_queue))
        {
            nsamples = n - filled;
        }
        else
        {
            uint64_t next = OPL_Queue_Peek(callback_queue) + pause_offset;

            nsamples = next > current_time ? (next - current_time) * mixing_freq : 0;
            nsamples = (nsamples + OPL_SECOND - 1) / OPL_SECOND;

            if (nsamples > n - filled)
            {
                nsamples = n - filled;
            }
        }

        if (nsamples > 0)
        {
            Chip__GenerateBlock2(&opl_chip, nsamples, mix_buffer);

            for (i = 0; i < nsamples; ++i)
            {
                Bit32s v = mix_buffer[i];
                if (v > 32767) v = 32767;
                if (v < -32768) v = -32768;
                out_buffer[filled + i] = (int16_t) v;
            }
        }

        filled += nsamples;
        AdvanceSamples(nsamples);
    }

    return out_buffer;
}

// Called by the page when it knows the audio output's sample rate.

EMSCRIPTEN_KEEPALIVE void pinto_music_rate(int rate)
{
    if (initialized && rate > 0 && (unsigned int) rate != mixing_freq)
    {
        mixing_freq = rate;
        Chip__Setup(&opl_chip, mixing_freq);
    }
}

static int OPL_Pinto_Init(unsigned int port_base)
{
    (void) port_base;

    opl_paused = 0;
    pause_offset = 0;
    current_time = 0;
    callbacks_locked = 0;
    callback_queue = OPL_Queue_Create();
    mixing_freq = opl_sample_rate;

    DBOPL_InitTables();
    Chip__Chip(&opl_chip);
    Chip__Setup(&opl_chip, mixing_freq);

    initialized = 1;
    return 1;
}

static void OPL_Pinto_Shutdown(void)
{
    if (initialized)
    {
        OPL_Queue_Destroy(callback_queue);
        initialized = 0;
    }
}

static unsigned int OPL_Pinto_PortRead(opl_port_t port)
{
    unsigned int result = 0;

    (void) port;

    if (timer1.enabled && current_time > timer1.expire_time)
    {
        result |= 0x80;   // Either have expired
        result |= 0x40;   // Timer 1 has expired
    }

    if (timer2.enabled && current_time > timer2.expire_time)
    {
        result |= 0x80;   // Either have expired
        result |= 0x20;   // Timer 2 has expired
    }

    return result;
}

static void OPLTimer_CalculateEndTime(opl_timer_t *timer)
{
    int tics;

    if (timer->enabled)
    {
        tics = 0x100 - timer->value;
        timer->expire_time = current_time
                           + ((uint64_t) tics * OPL_SECOND) / timer->rate;
    }
}

static void WriteRegister(unsigned int reg_num, unsigned int value)
{
    switch (reg_num)
    {
        case OPL_REG_TIMER1:
            timer1.value = value;
            OPLTimer_CalculateEndTime(&timer1);
            break;

        case OPL_REG_TIMER2:
            timer2.value = value;
            OPLTimer_CalculateEndTime(&timer2);
            break;

        case OPL_REG_TIMER_CTRL:
            if (value & 0x80)
            {
                timer1.enabled = 0;
                timer2.enabled = 0;
            }
            else
            {
                if ((value & 0x40) == 0)
                {
                    timer1.enabled = (value & 0x01) != 0;
                    OPLTimer_CalculateEndTime(&timer1);
                }

                if ((value & 0x20) == 0)
                {
                    timer2.enabled = (value & 0x02) != 0;
                    OPLTimer_CalculateEndTime(&timer2);
                }
            }

            break;

        default:
            Chip__WriteReg(&opl_chip, reg_num, value);
            break;
    }
}

static void OPL_Pinto_PortWrite(opl_port_t port, unsigned int value)
{
    if (port == OPL_REGISTER_PORT)
    {
        register_num = value;
    }
    else if (port == OPL_DATA_PORT)
    {
        WriteRegister(register_num, value);
    }
}

static void OPL_Pinto_SetCallback(uint64_t us, opl_callback_t callback, void *data)
{
    OPL_Queue_Push(callback_queue, callback, data, current_time - pause_offset + us);
}

static void OPL_Pinto_ClearCallbacks(void)
{
    OPL_Queue_Clear(callback_queue);
}

static void OPL_Pinto_Lock(void)
{
    callbacks_locked++;
}

static void OPL_Pinto_Unlock(void)
{
    if (callbacks_locked > 0) callbacks_locked--;
}

static void OPL_Pinto_SetPaused(int paused)
{
    opl_paused = paused;
}

static void OPL_Pinto_AdjustCallbacks(float factor)
{
    OPL_Queue_AdjustCallbacks(callback_queue, current_time, factor);
}

opl_driver_t opl_pinto_driver =
{
    "Pinto",
    OPL_Pinto_Init,
    OPL_Pinto_Shutdown,
    OPL_Pinto_PortRead,
    OPL_Pinto_PortWrite,
    OPL_Pinto_SetCallback,
    OPL_Pinto_ClearCallbacks,
    OPL_Pinto_Lock,
    OPL_Pinto_Unlock,
    OPL_Pinto_SetPaused,
    OPL_Pinto_AdjustCallbacks,
};
