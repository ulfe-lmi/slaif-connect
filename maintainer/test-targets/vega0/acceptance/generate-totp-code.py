#!/usr/bin/env python3
"""Generate a six-digit RFC 6238 test code from a local base32 seed file."""

import base64
import hashlib
import hmac
import struct
import sys
import time


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} TOTP-SEED-FILE", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="ascii") as seed_file:
        seed = seed_file.read().strip()

    counter = int(time.time()) // 30
    digest = hmac.new(
        base64.b32decode(seed),
        struct.pack(">Q", counter),
        hashlib.sha1,
    ).digest()
    offset = digest[-1] & 0x0F
    value = (
        struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    ) % 1_000_000
    print(f"{value:06d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
