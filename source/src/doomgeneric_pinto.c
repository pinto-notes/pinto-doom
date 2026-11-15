// doomgeneric platform layer for a Pinto Notes note app: no SDL. Sound and music are in pinto_sound.c.
// The page drives the game: it calls doomgeneric_Tick() once per Doom tic (35 a second),
// feeds keys with pinto_key(), and copies DG_ScreenBuffer (pinto_screen()) to a canvas.
#include <emscripten.h>
#include <stdint.h>
#include "doomgeneric.h"

#define KEYQUEUE_SIZE 64
static unsigned short queue[KEYQUEUE_SIZE];
static unsigned int writeIndex = 0, readIndex = 0;
static unsigned int frames = 0;

EMSCRIPTEN_KEEPALIVE void pinto_key(int pressed, int key) {
  queue[writeIndex] = (unsigned short)(((pressed ? 1 : 0) << 8) | (key & 0xff));
  writeIndex = (writeIndex + 1) % KEYQUEUE_SIZE;
}

EMSCRIPTEN_KEEPALIVE uint32_t *pinto_screen(void) { return (uint32_t *)DG_ScreenBuffer; }
EMSCRIPTEN_KEEPALIVE unsigned int pinto_frames(void) { return frames; }

void DG_Init(void) {}
void DG_DrawFrame(void) { frames++; }
void DG_SleepMs(uint32_t ms) { (void)ms; }
uint32_t DG_GetTicksMs(void) { return (uint32_t)emscripten_get_now(); }

int DG_GetKey(int *pressed, unsigned char *key) {
  if (readIndex == writeIndex) return 0;
  unsigned short d = queue[readIndex];
  readIndex = (readIndex + 1) % KEYQUEUE_SIZE;
  *pressed = d >> 8;
  *key = d & 0xff;
  return 1;
}

void DG_SetWindowTitle(const char *title) { (void)title; }

int main(int argc, char **argv) {
  doomgeneric_Create(argc, argv);
  return 0;
}
