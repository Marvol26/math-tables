#!/usr/bin/env python3
"""Generates icon-180.png and icon-512.png: a solid primary-color background
with a geometric white "x" mark. Stdlib only (struct + zlib), no external
dependencies or image libraries (PA-3) -- placeholder art; real artwork is a
follow-up in NEXT-ACTIONS.
"""
import os
import struct
import sys
import zlib

BG = (0x4F, 0x7C, 0xFF)  # DESIGN §10 primary
FG = (0xFF, 0xFF, 0xFF)


def make_raw_scanlines(size):
    thickness = max(size // 10, 4)
    margin = size // 6
    inner = size - 2 * margin
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter type 0 (None) for this scanline
        for x in range(size):
            color = BG
            if margin <= x < size - margin and margin <= y < size - margin:
                lx = x - margin
                ly = y - margin
                d1 = abs(lx - ly)
                d2 = abs(lx - (inner - 1 - ly))
                if d1 < thickness or d2 < thickness:
                    color = FG
            raw += bytes(color)
    return bytes(raw)


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size):
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit depth, RGB (color type 2)
    raw = make_raw_scanlines(size)
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(signature)
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", idat))
        f.write(png_chunk(b"IEND", b""))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    write_png(os.path.join(root, "icon-180.png"), 180)
    write_png(os.path.join(root, "icon-512.png"), 512)
    print("wrote icon-180.png, icon-512.png")


if __name__ == "__main__":
    sys.exit(main())
