#!/usr/bin/env python3
"""Packs the Doom note app.

Usage: pack.py <out dir> <DOOM1.WAD> [<build dir with out/doom.js and out/doom.wasm>]

Writes <out dir>/project/ (the app's files as they are: index.html, main.js, touch.js, README.md,
doom.js, doom.wasm, doom1.wad) and <out dir>/doom.project.json, the note app as Pinto Notes stores it:
text files in "files", and binary files in "binary" as base64 of their raw-DEFLATE-compressed bytes
(the 1.4 format, see NotePageProject.swift)."""
import base64, hashlib, json, os, shutil, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(sys.argv[1])
WAD = sys.argv[2]
BUILD = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(HERE), "build")

wad = open(WAD, "rb").read()
assert hashlib.sha1(wad).hexdigest() == "5b2e249b9c5133ec987b3ea77596381dc0d6bc1d", "not the shareware v1.9 DOOM1.WAD"
binary = {
    "/doom.wasm": open(os.path.join(BUILD, "out/doom.wasm"), "rb").read(),
    "/doom1.wad": wad,
}
text = {"/doom.js": open(os.path.join(BUILD, "out/doom.js")).read()}  # Emscripten's loader, as built
for name in ["index.html", "main.js", "touch.js", "README.md"]:
    text["/" + name] = open(os.path.join(HERE, "web", name)).read()

project = os.path.join(OUT, "project")
shutil.rmtree(project, ignore_errors=True)
os.makedirs(project)
for path, t in text.items():
    open(os.path.join(project, path.lstrip("/")), "w").write(t)
for path, b in binary.items():
    open(os.path.join(project, path.lstrip("/")), "wb").write(b)


def pack(b):
    c = zlib.compressobj(9, zlib.DEFLATED, -15)  # raw DEFLATE
    return base64.b64encode(c.compress(b) + c.flush()).decode()


packed = {path: pack(b) for path, b in binary.items()}
stored = json.dumps({"amberApp": 1, "files": dict(sorted(text.items())), "compiled": {}, "binary": dict(sorted(packed.items()))},
                    separators=(",", ":"), ensure_ascii=False)
open(os.path.join(OUT, "doom.project.json"), "w").write(stored)
biggest = max([len(t.encode()) for t in text.values()] + [len(p) for p in packed.values()])
print(f"text {len(text)}  binary {len(binary)}  stored {len(stored.encode()):,} bytes  biggest file {biggest:,}  limits: total 16,777,216, file 8,388,608")
for path, p in sorted(packed.items()):
    print(f"  {path}: {len(binary[path]):,} bytes, packed {len(p):,}")
