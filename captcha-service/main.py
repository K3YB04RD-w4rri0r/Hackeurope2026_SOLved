"""
Slider CAPTCHA Service
======================
A FastAPI service that generates a slider-based CAPTCHA puzzle.

Designed to be embedded on third-party websites via a single <script> tag:

  <div id="my-captcha"></div>
  <script
    src="http://YOUR_HOST:8000/static/captcha-widget.js"
    data-captcha-container="my-captcha"
    data-on-success="onCaptchaSolved"
  ></script>

API:
  GET  /generate-captcha  ->  CAPTCHA payload (pieces + keyframes)
  POST /verify-captcha    ->  { success: true/false }

Security:
  - Pieces are identified by random UUIDs, not sequential indices.
  - The solved slider value is stored server-side and never exposed.
"""

from __future__ import annotations

import base64
import ctypes
import hashlib
import hmac
import io
import math
import os
import random
import time
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageDraw
import json
from fingerprint import (
    CaptchaSession,
    analyze_bot_risk,
    compute_pow_difficulty,
    parse_behavior,
    parse_trajectory,
)


# ──────────────────────────────────────────────
# App & CORS
# ──────────────────────────────────────────────
app = FastAPI(
    title="Slider CAPTCHA",
    description="Generates a 3×3 slider CAPTCHA puzzle.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Static files & root page
# ──────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"

# Mount the static directory for any extra assets.
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    """Service info page with integration instructions."""
    return (
        "<!DOCTYPE html>"
        '<html lang="en"><head>'
        '<meta charset="UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        "<title>Solved - CAPTCHA Service</title>"
        "<style>"
        "body { font-family: system-ui, sans-serif; max-width: 640px;"
        "       margin: 60px auto; padding: 0 20px; color: #333; }"
        "h1 { font-size: 24px; }"
        "code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px; }"
        "pre  { background: #f3f4f6; padding: 16px; border-radius: 8px;"
        "       overflow-x: auto; font-size: 13px; line-height: 1.5; }"
        "a { color: #4a6cf7; }"
        "</style>"
        "</head><body>"
        "<h1>Solved - CAPTCHA Service</h1>"
        "<p>This service is running. Embed the widget on any page:</p>"
        "<pre>"
        '&lt;div id="my-captcha"&gt;&lt;/div&gt;\n'
        "&lt;script\n"
        '  src="/static/captcha-widget.js"\n'
        '  data-captcha-container="my-captcha"\n'
        '  data-on-success="onCaptchaSolved"\n'
        "&gt;&lt;/script&gt;"
        "</pre>"
        "<p><strong>API endpoints:</strong></p>"
        "<ul>"
        "<li><code>GET /generate-captcha</code> - generate a new puzzle</li>"
        "<li><code>POST /verify-captcha</code> - verify the answer</li>"
        '<li><a href="/demo">Live Demo</a></li>'
        "</ul>"
        "</body></html>"
    )


DEMO_DIR = Path(__file__).parent / "demo"


@app.get("/demo", response_class=HTMLResponse)
async def demo():
    """Serve the demo sign-up page that embeds the CAPTCHA widget."""
    return (DEMO_DIR / "index.html").read_text(encoding="utf-8")


# ──────────────────────────────────────────────
# In-memory session store
# ──────────────────────────────────────────────
# Maps captcha_id → solved slider value (int).
# In production, replace with Redis / DB + TTL.
captcha_sessions: dict[str, CaptchaSession] = {}

# ──────────────────────────────────────────────
# PoW — secret key & replay protection
# ──────────────────────────────────────────────
# 32-byte hex key; override via env-var in production.
POW_SERVER_SECRET: str = os.environ.get(
    "POW_SECRET_KEY",
    "c3ab8ff13720e8ad9047dd39466b3c89" +
    "74e592c2fa383d4a3960714caef0c4f2",
)

# Nonces that have already been redeemed.
# Keyed by nonce hex → expiry timestamp.
# In production, replace with Redis SETEX.
pow_used_nonces: dict[str, float] = {}

# How long a challenge stays valid (seconds).
POW_CHALLENGE_TTL: int = 300  # 5 minutes
video_captcha_sessions: dict[str, dict[str, Any]] = {}

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
GRID_SIZE = 3  # 3×3 grid
CAPTCHA_SIZE = 300  # output image is 300×300
PIECE_SIZE = CAPTCHA_SIZE // GRID_SIZE  # 100×100 per piece
# Default sample image bundled with the project.
IMAGES_DIR = Path(__file__).parent / "images"
VIDEO_ASSET_PATH = Path(__file__).parent / "video" / "ad2.mp4"


def _bounce_pos(value: float, minimum: int, maximum: int) -> int:
    """Reflect *value* between [minimum, maximum] like a bouncing ball."""
    span = maximum - minimum
    if span <= 0:
        return int(minimum)
    normalized = (value - minimum) % (2 * span)
    if normalized > span:
        normalized = 2 * span - normalized
    return int(minimum + normalized)


def _generate_keyframe_positions() -> list[int]:
    """
    Generate 5–7 random keyframe positions in [0, 100].

    Rules:
      • 0 and 100 are always included.
      • The remaining 3–5 interior points are chosen randomly
        with a minimum gap of 8 between any two consecutive
        positions (after sorting) to keep segments generous.
    """
    MIN_GAP = 8
    num_interior = random.randint(3, 5)  # total will be 5–7

    for _ in range(200):  # retry until we get a valid spread
        interior = sorted(random.sample(range(1, 100), num_interior))
        positions = [0] + interior + [100]
        # Check minimum gap between every consecutive pair.
        if all(
            positions[i + 1] - positions[i] >= MIN_GAP
            for i in range(len(positions) - 1)
        ):
            return positions

    # Fallback: evenly spaced if randomisation keeps failing.
    step = 100 // (num_interior + 1)
    return [0] + [step * i for i in range(1, num_interior + 1)] + [100]


# ──────────────────────────────────────────────
# Helper: crop to centre square
# ──────────────────────────────────────────────
def _crop_centre_square(img: Image.Image, target: int = CAPTCHA_SIZE) -> Image.Image:
    """Crop the largest centred square, then resize to *target*×*target*."""
    width, height = img.size
    side = min(width, height)

    left = (width - side) // 2
    top = (height - side) // 2
    right = left + side
    bottom = top + side

    return img.crop((left, top, right, bottom)).resize(
        (target, target), Image.Resampling.LANCZOS
    )


# ──────────────────────────────────────────────
# Jigsaw Bezier edge generation
# ──────────────────────────────────────────────

# Tab protrusion size as a fraction of the cell side length.
TAB_SIZE = 0.20  # 20% of PIECE_SIZE


def _cubic_bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 30,
) -> list[tuple[float, float]]:
    """Evaluate a cubic Bezier curve and return *steps+1* points."""
    pts: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _jitter(value: float, amount: float = 0.04) -> float:
    """Add a small random offset (fraction of PIECE_SIZE)."""
    return value + random.uniform(-amount, amount) * PIECE_SIZE


def _generate_edge_points(
    start: tuple[float, float], end: tuple[float, float], direction: int
) -> list[tuple[float, float]]:
    """
    Generate a classic jigsaw edge (tab or socket) between *start* and *end*.

    *direction*: +1 means the tab protrudes outward; -1 means it pushes inward (socket).
    """
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)

    if length == 0:
        return [start, end]

    # Unit tangent vectors
    tx, ty = dx / length, dy / length
    # Normal vectors. Direction determines if the tab goes outward or inward.
    nx, ny = -ty * direction, tx * direction

    def local_to_global(u: float, v: float) -> tuple[float, float]:
        """Map local (tangent, normal) proportions to global image coordinates."""
        return (
            start[0] + u * dx + v * length * nx,
            start[1] + u * dy + v * length * ny,
        )

    pts = []

    # Segment 1: Straight line from start to the left side of the neck
    pts.append(local_to_global(0.0, 0.0))
    pts.append(local_to_global(0.38, 0.0))

    # Segment 2: Left side of the bulb (pinches in, then flares out left)
    c2_p0 = local_to_global(0.38, 0.0)
    c2_p1 = local_to_global(0.43, 0.06)  # Pinch inwards to form the neck
    c2_p2 = local_to_global(0.32, 0.10)  # Flare outwards
    c2_p3 = local_to_global(0.32, 0.16)  # Left-most point of the bulb
    pts.extend(_cubic_bezier(c2_p0, c2_p1, c2_p2, c2_p3)[1:])

    # Segment 3: Round top of the bulb (semi-circle over the top)
    c3_p0 = local_to_global(0.32, 0.16)
    c3_p1 = local_to_global(0.32, 0.28)  # Pull up
    c3_p2 = local_to_global(0.68, 0.28)  # Pull up
    c3_p3 = local_to_global(0.68, 0.16)  # Right-most point of the bulb
    pts.extend(_cubic_bezier(c3_p0, c3_p1, c3_p2, c3_p3)[1:])

    # Segment 4: Right side of the bulb (flares right, then pinches back to neck)
    c4_p0 = local_to_global(0.68, 0.16)
    c4_p1 = local_to_global(0.68, 0.10)  # Flare right
    c4_p2 = local_to_global(0.57, 0.06)  # Pinch inwards to form the neck
    c4_p3 = local_to_global(0.62, 0.0)  # Back to base edge
    pts.extend(_cubic_bezier(c4_p0, c4_p1, c4_p2, c4_p3)[1:])

    # Segment 5: Straight line from the right side of the neck to the end
    pts.append(local_to_global(1.0, 0.0))

    return pts


def _generate_edge_grid() -> dict:
    """
    Pre-generate all 12 internal edges for a 3×3 grid.

    Returns a dict with two sub-dicts:
      "h": horizontal internal edges keyed by (row, col)
          — row in {1,2}, col in {0,1,2}
      "v": vertical internal edges keyed by (row, col)
          — row in {0,1,2}, col in {1,2}

    Each value is a list of (x, y) points describing the edge
    from left→right (horizontal) or top→bottom (vertical).
    """
    edges: dict[str, dict[tuple[int, int], list[tuple[float, float]]]] = {
        "h": {},
        "v": {},
    }

    # Horizontal internal edges (between row-1 and row)
    for row in range(1, GRID_SIZE):
        for col in range(GRID_SIZE):
            x0 = col * PIECE_SIZE
            y0 = row * PIECE_SIZE
            start = (float(x0), float(y0))
            end = (float(x0 + PIECE_SIZE), float(y0))
            direction = random.choice([-1, 1])
            edges["h"][(row, col)] = _generate_edge_points(start, end, direction)

    # Vertical internal edges (between col-1 and col)
    for row in range(GRID_SIZE):
        for col in range(1, GRID_SIZE):
            x0 = col * PIECE_SIZE
            y0 = row * PIECE_SIZE
            start = (float(x0), float(y0))
            end = (float(x0), float(y0 + PIECE_SIZE))
            direction = random.choice([-1, 1])
            edges["v"][(row, col)] = _generate_edge_points(start, end, direction)

    return edges


def _build_piece_polygon(row: int, col: int, edges: dict) -> list[tuple[float, float]]:
    """
    Assemble the closed polygon for the piece at (row, col).

    Edges are combined in clockwise order: top → right → bottom → left.
    Flat edges are used for the outer border of the puzzle.
    """
    poly: list[tuple[float, float]] = []
    x0 = col * PIECE_SIZE
    y0 = row * PIECE_SIZE

    # ── TOP edge (left → right) ──────────────────────────────────
    if row == 0:
        poly.append((float(x0), float(y0)))
        poly.append((float(x0 + PIECE_SIZE), float(y0)))
    else:
        pts = edges["h"][(row, col)]
        poly.extend(pts)

    # ── RIGHT edge (top → bottom) ────────────────────────────────
    if col == GRID_SIZE - 1:
        poly.append((float(x0 + PIECE_SIZE), float(y0)))
        poly.append((float(x0 + PIECE_SIZE), float(y0 + PIECE_SIZE)))
    else:
        pts = edges["v"][(row, col + 1)]
        poly.extend(pts)

    # ── BOTTOM edge (right → left, so reverse) ───────────────────
    if row == GRID_SIZE - 1:
        poly.append((float(x0 + PIECE_SIZE), float(y0 + PIECE_SIZE)))
        poly.append((float(x0), float(y0 + PIECE_SIZE)))
    else:
        pts = edges["h"][(row + 1, col)]
        poly.extend(list(reversed(pts)))

    # ── LEFT edge (bottom → top, so reverse) ─────────────────────
    if col == 0:
        poly.append((float(x0), float(y0 + PIECE_SIZE)))
        poly.append((float(x0), float(y0)))
    else:
        pts = edges["v"][(row, col)]
        poly.extend(list(reversed(pts)))

    return poly


# ──────────────────────────────────────────────
# Helper: slice image into 3×3 jigsaw pieces
# ──────────────────────────────────────────────
def _slice_image(
    img: Image.Image,
) -> list[tuple[str, Image.Image, tuple[int, int]]]:
    """
    Split *img* into a 3×3 grid of interlocking jigsaw pieces.

    Returns a list of 9 tuples:
        (piece_uuid, piece_image, (offset_x, offset_y))

    Each piece is masked with a Bezier-curved polygon, cropped to
    its bounding box, and assigned a random UUID.  The offset is
    the top-left corner of the cropped piece relative to the
    original 300×300 image.
    """
    edges = _generate_edge_grid()

    # We need the source image with an alpha channel.
    src = img.convert("RGBA")

    pieces: list[tuple[str, Image.Image, tuple[int, int]]] = []

    for row in range(GRID_SIZE):
        for col in range(GRID_SIZE):
            polygon = _build_piece_polygon(row, col, edges)

            # --- Determine the bounding box of the polygon ----------
            xs = [p[0] for p in polygon]
            ys = [p[1] for p in polygon]
            bbox_x0 = max(int(math.floor(min(xs))), 0)
            bbox_y0 = max(int(math.floor(min(ys))), 0)
            bbox_x1 = min(int(math.ceil(max(xs))) + 1, CAPTCHA_SIZE)
            bbox_y1 = min(int(math.ceil(max(ys))) + 1, CAPTCHA_SIZE)

            bbox_w = bbox_x1 - bbox_x0
            bbox_h = bbox_y1 - bbox_y0

            # --- Draw the mask on a bbox-sized canvas ---------------
            # Shift polygon coordinates to the local bbox origin.
            local_poly = [(x - bbox_x0, y - bbox_y0) for x, y in polygon]

            mask = Image.new("L", (bbox_w, bbox_h), 0)
            draw = ImageDraw.Draw(mask)
            draw.polygon(local_poly, fill=255)
            # Draw a thin transparent border so assembled pieces
            # show a faint gap revealing the jigsaw cuts.
            draw.line(local_poly + [local_poly[0]], fill=0, width=1)

            # --- Extract the piece ----------------------------------
            region = src.crop((bbox_x0, bbox_y0, bbox_x1, bbox_y1)).copy()
            # Apply the mask to the alpha channel.
            region.putalpha(mask)

            piece_id = uuid.uuid4().hex
            pieces.append((piece_id, region, (bbox_x0, bbox_y0)))

    # Shuffle so iteration order leaks nothing.
    random.shuffle(pieces)
    return pieces


# ──────────────────────────────────────────────
# Helper: encode a PIL Image → Base64 PNG string
# ──────────────────────────────────────────────
def _image_to_base64(img: Image.Image) -> str:
    """Return a data-URI-ready Base64 string of the image (PNG)."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ──────────────────────────────────────────────
# Helper: generate a random shuffled arrangement
# ──────────────────────────────────────────────
def _random_grid_positions(count: int = GRID_SIZE * GRID_SIZE) -> list[tuple[int, int]]:
    """
    Return *count* random (x, y) positions snapped to the 3×3 grid.

    Positions are sampled as a permutation of all 9 grid slots so
    every cell is occupied exactly once — no overlaps, no gaps.

    Each position is the top-left of the grid cell, so pieces with
    tabs that protrude outside will simply overlap neighbours — which
    is fine visually while scrambled.
    """
    slots = [
        (col * PIECE_SIZE, row * PIECE_SIZE)
        for row in range(GRID_SIZE)
        for col in range(GRID_SIZE)
    ]
    random.shuffle(slots)
    return slots[:count]


# ──────────────────────────────────────────────
# Core: build the full CAPTCHA payload
# ──────────────────────────────────────────────
def generate_captcha(image_path: Path | str | None = None) -> dict[str, Any]:
    """
    Orchestrates the entire CAPTCHA generation pipeline.

    1. Load & crop the source image.
    2. Slice into 3×3 pieces with random UUIDs.
    3. Pick a random solved keyframe.
    4. Build keyframe coordinate maps.
    5. Store session server-side.
    6. Return the JSON-ready payload.
    """

    # --- 1. Load image ------------------------------------------------
    if image_path:
        path = Path(image_path)
    else:
        candidates = list(IMAGES_DIR.glob("*.png")) + list(IMAGES_DIR.glob("*.jpg")) + list(IMAGES_DIR.glob("*.jpeg"))
        path = random.choice(candidates) if candidates else None

    if path is None or not path.exists():
        # Fallback: generate a colourful gradient so the app still works
        # without real photos.
        img = _generate_placeholder_image()
    else:
        img = Image.open(path).convert("RGB")

    img = _crop_centre_square(img)

    # --- 2. Slice into jigsaw pieces ------------------------------------
    pieces = _slice_image(img)  # list[(id, image, (offset_x, offset_y))]

    # --- 3. Choose keyframe positions & solved slot -------------------
    kf_positions = _generate_keyframe_positions()
    # Never place the solved state at position 0 (the slider's starting
    # value) — otherwise the puzzle appears already assembled on load.
    non_start = [p for p in kf_positions if p != 0]
    solved_position: int = random.choice(non_start)

    # --- 4. Build keyframes -------------------------------------------
    keyframes: dict[str, list[dict[str, Any]]] = {}

    for kf in kf_positions:
        if kf == solved_position:
            # ✅ Solved state: correct coordinates (the piece offsets)
            keyframes[str(kf)] = [
                {"piece_id": pid, "x": off_x, "y": off_y}
                for pid, _, (off_x, off_y) in pieces
            ]
        else:
            # ❌ Shuffled state: random grid-snapped positions
            shuffled_positions = _random_grid_positions(len(pieces))
            keyframes[str(kf)] = [
                {"piece_id": pid, "x": sx, "y": sy}
                for (pid, _, _), (sx, sy) in zip(pieces, shuffled_positions)
            ]

    # --- 5. Encode pieces as Base64 + metadata -------------------------
    pieces_payload: dict[str, dict[str, Any]] = {}
    for pid, piece_img, (off_x, off_y) in pieces:
        pieces_payload[pid] = {
            "data": _image_to_base64(piece_img),
            "w": piece_img.width,
            "h": piece_img.height,
            "ox": off_x,  # solved-state offset (x) in the 300×300 image
            "oy": off_y,  # solved-state offset (y)
        }

    # --- 6. Create session --------------------------------------------
    captcha_id = str(uuid.uuid4())
    captcha_sessions[captcha_id] = CaptchaSession(solved_value=solved_position)

    # --- 7. Assemble payload ------------------------------------------
    return {
        "captcha_id": captcha_id,
        "pieces": pieces_payload,
        "keyframes": keyframes,
    }


# ──────────────────────────────────────────────
# Placeholder image (used when no sample.jpg)
# ──────────────────────────────────────────────
def _generate_placeholder_image() -> Image.Image:
    """Create a 300×300 gradient image with coloured quadrants."""
    img = Image.new("RGB", (CAPTCHA_SIZE, CAPTCHA_SIZE))
    pixels = img.load()
    for y in range(CAPTCHA_SIZE):
        for x in range(CAPTCHA_SIZE):
            r = int(255 * x / CAPTCHA_SIZE)
            g = int(255 * y / CAPTCHA_SIZE)
            b = 128
            pixels[x, y] = (r, g, b)  # type: ignore[index]
    return img


# ──────────────────────────────────────────────
# PoW challenge generation
# ──────────────────────────────────────────────

def generate_pow_challenge(difficulty: int = 20) -> dict[str, Any]:
    """
    Build a Proof-of-Work challenge for the client.

    Steps:
      1. Generate a cryptographically-secure 16-byte random salt.
      2. Capture the current Unix timestamp (integer seconds).
      3. Assemble a canonical payload string:
             ``<salt_hex>.<difficulty>.<timestamp>``
      4. Compute an HMAC-SHA256 signature of that payload using
         the server's secret key so the client cannot forge or
         tamper with the challenge parameters.
      5. Return the full challenge as a JSON-ready dict.

    The client must find a nonce such that:
        SHA-256( salt_hex + "." + nonce_hex )  has *difficulty*
        leading zero-bits.

    Parameters
    ----------
    difficulty : int
        Number of leading zero-bits required in the hash.
        Higher values = more work.  ``20`` ≈ ~1 M hashes on
        average (~200-400 ms on a modern browser with WASM).

    Returns
    -------
    dict
        ``{ salt, difficulty, timestamp, signature }``
    """
    # 1. Secure random salt (16 bytes → 32 hex chars).
    salt: str = os.urandom(16).hex()

    # 2. Current Unix timestamp (integer precision is fine).
    timestamp: int = int(time.time())

    # 3. Canonical payload — order matters for HMAC verification.
    payload: str = f"{salt}.{difficulty}.{timestamp}"

    # 4. HMAC-SHA256 signature.
    signature: str = hmac.new(
        POW_SERVER_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    # 5. Return the complete challenge.
    return {
        "salt":       salt,
        "difficulty":  difficulty,
        "timestamp":   timestamp,
        "signature":   signature,
    }


# ──────────────────────────────────────────────
# PoW server-side verification (native C solver)
# ──────────────────────────────────────────────

def _load_native_solver() -> ctypes.CDLL | None:
    """
    Load the native solver shared library (compiled from wasm/solver.c).

    Returns a ctypes CDLL handle with ``solve_challenge`` ready to
    call, or ``None`` if the library hasn't been built yet.
    """
    base = Path(__file__).parent
    for name in ("solver_native.dylib", "solver_native.so"):
        lib_path = base / name
        if lib_path.exists():
            try:
                lib = ctypes.CDLL(str(lib_path))
                lib.solve_challenge.argtypes = [
                    ctypes.c_char_p,  # salt
                    ctypes.c_int,     # difficulty
                    ctypes.c_int,     # start_nonce
                    ctypes.c_int,     # iterations
                ]
                lib.solve_challenge.restype = ctypes.c_int
                return lib
            except OSError:
                continue
    return None


# Loaded once at import time; stays for the process lifetime.
_native_solver = _load_native_solver()


def _verify_pow_nonce(salt: str, difficulty: int, nonce: int) -> bool:
    """
    Verify that *nonce* satisfies the PoW difficulty target for *salt*.

    Calls the **same C code** the WASM solver uses (compiled as a native
    shared library) — guarantees byte-identical hash evaluation.

    The trick: ``solve_challenge(salt, difficulty, nonce, 1)`` tries
    exactly one nonce.  If it returns that nonce, the hash passed.
    """
    if _native_solver is None:
        raise RuntimeError(
            "Native solver library not found. "
            "Run `bash wasm/build.sh` to compile it."
        )
    result: int = _native_solver.solve_challenge(
        salt.encode("ascii"), difficulty, nonce, 1,
    )
    return result == nonce


def _purge_expired_nonces() -> None:
    """Remove nonces whose TTL has elapsed from the replay cache."""
    now = time.time()
    expired = [k for k, exp in pow_used_nonces.items() if exp <= now]
    for k in expired:
        del pow_used_nonces[k]


def verify_pow(
    salt: str,
    difficulty: int,
    timestamp: int,
    signature: str,
    nonce: int,
) -> str | None:
    """
    Full server-side Proof-of-Work verification.

    Returns ``None`` on success, or an error string explaining the
    rejection reason.

    Steps
    -----
    1. **HMAC check** — reconstruct the canonical payload and verify
       the signature.  Rejects forged or tampered challenges.
    2. **Timestamp check** — reject if the challenge is older than
       ``POW_CHALLENGE_TTL`` seconds.
    3. **Replay check** — reject if this salt+nonce combination has
       already been redeemed (burns nonces on first use).
    4. **Hash check** — call the native C solver to verify the nonce
       actually satisfies the difficulty target.
    5. **Burn nonce** — store salt+nonce in the replay cache with a
       TTL so it cannot be reused.
    """
    # 1. Verify HMAC signature.
    payload = f"{salt}.{difficulty}.{timestamp}"
    expected_sig = hmac.new(
        POW_SERVER_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_sig):
        return "Invalid PoW signature."

    # 2. Check timestamp freshness.
    age = int(time.time()) - timestamp
    if age < 0 or age > POW_CHALLENGE_TTL:
        return "PoW challenge expired."

    # 3. Replay protection — check + lazy purge.
    _purge_expired_nonces()
    replay_key = f"{salt}:{nonce}"
    if replay_key in pow_used_nonces:
        return "PoW nonce already used."

    # 4. Verify hash.
    if not _verify_pow_nonce(salt, difficulty, nonce):
        return "PoW nonce does not satisfy difficulty target."

    # 5. Burn the nonce (TTL = remaining challenge lifetime).
    pow_used_nonces[replay_key] = time.time() + POW_CHALLENGE_TTL

    return None  # ✅ success


def generate_video_captcha() -> dict[str, Any]:
    """Create a video-based captcha challenge session and return client payload."""
    if not VIDEO_ASSET_PATH.exists():
        raise FileNotFoundError(f"Video file not found: {VIDEO_ASSET_PATH}")

    cap = cv2.VideoCapture(str(VIDEO_ASSET_PATH))
    if not cap.isOpened():
        raise RuntimeError("Unable to open video asset for captcha generation.")

    video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    if video_width <= 0 or video_height <= 0:
        raise RuntimeError("Video dimensions could not be determined.")

    secret_target = random.uniform(0.4, 0.8)
    roi_size = max(24, int(min(video_width, video_height) * 0.45))
    roi_size = min(roi_size, video_width, video_height)

    pad = max(1, int(roi_size * 0.15))
    mask = np.zeros((roi_size, roi_size, 3), dtype=np.float32)
    mask[pad:-pad, pad:-pad] = 1.0
    feather_mask = cv2.GaussianBlur(mask, (31, 31), 0)

    roi = {
        "true_x": random.randint(0, video_width - roi_size),
        "true_y": random.randint(0, video_height - roi_size),
        "start_x": random.randint(0, video_width - roi_size),
        "start_y": random.randint(0, video_height - roi_size),
    }

    captcha_id = uuid.uuid4().hex
    video_captcha_sessions[captcha_id] = {
        "roi": roi,
        "roi_size": roi_size,
        "secret_target": secret_target,
        "current_slider": 0.0,
        "feather_mask": feather_mask,
    }

    return {
        "captcha_id": captcha_id,
        "stream_url": f"/video-captcha-stream/{captcha_id}",
        "width": video_width,
        "height": video_height,
        "slider_min": 0,
        "slider_max": 1000,
        "slider_start": 0,
    }


def _generate_video_stream(captcha_id: str):
    """Yield MJPEG frames for one video captcha challenge."""
    cap = cv2.VideoCapture(str(VIDEO_ASSET_PATH))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_delay = 1.0 / fps

    try:
        while True:
            challenge = video_captcha_sessions.get(captcha_id)
            if challenge is None:
                break

            loop_start = time.time()
            ok, frame = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            roi = challenge["roi"]
            roi_size = int(challenge["roi_size"])
            slider_val = float(challenge["current_slider"])
            secret_target = float(challenge["secret_target"])
            feather_mask = challenge["feather_mask"]

            max_y, max_x, _ = frame.shape

            tx = int(roi["true_x"])
            ty = int(roi["true_y"])
            sx = int(roi["start_x"])
            sy = int(roi["start_y"])

            patch = frame[ty : ty + roi_size, tx : tx + roi_size].astype(np.float32)

            bg_target = frame[ty : ty + roi_size, tx : tx + roi_size].astype(np.float32)
            blurred = cv2.GaussianBlur(bg_target, (51, 51), 0)
            darkened = blurred * 0.6
            receptacle = (darkened * feather_mask) + (bg_target * (1.0 - feather_mask))
            frame[ty : ty + roi_size, tx : tx + roi_size] = receptacle.astype(np.uint8)

            t = slider_val / secret_target if secret_target > 0 else 0.0
            osc = math.sin(t * 2 * math.pi)
            amp_x = max_x * 0.15
            amp_y = max_y * 0.15

            raw_cx = sx + (tx - sx) * t + amp_x * osc
            raw_cy = sy + (ty - sy) * t + amp_y * osc

            cx = _bounce_pos(raw_cx, 0, max_x - roi_size)
            cy = _bounce_pos(raw_cy, 0, max_y - roi_size)

            bg_slice = frame[cy : cy + roi_size, cx : cx + roi_size].astype(np.float32)
            blended = (patch * feather_mask) + (bg_slice * (1.0 - feather_mask))
            frame[cy : cy + roi_size, cx : cx + roi_size] = blended.astype(np.uint8)

            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
            )

            elapsed = time.time() - loop_start
            if elapsed < frame_delay:
                time.sleep(frame_delay - elapsed)
    finally:
        cap.release()


# ──────────────────────────────────────────────
# API Endpoints
# ──────────────────────────────────────────────


@app.get("/generate-captcha", response_class=JSONResponse)
async def get_captcha(mode: str = "image") -> dict[str, Any]:
    """
    **GET /generate-captcha**

    Returns a full CAPTCHA payload:

    ```json
    {
      "captcha_id": "...",
      "pieces": { "<uuid>": "<base64 png>", ... },
      "keyframes": {
        "0":   [{ "piece_id": "...", "x": 0, "y": 0 }, ...],
        "25":  [...],
        "50":  [...],
        "75":  [...],
        "100": [...]
      }
    }
    ```
    """
    if mode.lower() == "video":
        payload = generate_video_captcha()
        payload["mode"] = "video"
        return payload

    payload = generate_captcha()
    payload["mode"] = "image"
    return payload


@app.post("/pow-challenge", response_class=JSONResponse)
async def pow_challenge(body: dict[str, Any] = {}) -> dict[str, Any]:
    """
    **POST /pow-challenge**

    Accepts post-solve session data (fingerprint, trajectory, behavior)
    and returns a Proof-of-Work challenge whose difficulty is scaled to
    the assessed risk level:

      - Low risk (human-like)  → difficulty 15  (~32K hashes)
      - Medium risk            → difficulty 20  (~1M hashes)
      - High risk (bot-like)   → difficulty 26  (~67M hashes)

    ```json
    {
      "salt":        "<32-char hex>",
      "difficulty":   20,
      "timestamp":    1740000000,
      "signature":    "<64-char HMAC-SHA256 hex>",
      "risk_level":   "low"
    }
    ```
    """
    if not isinstance(body, dict):
        body = {}

    fingerprint = body.get("fingerprint") if isinstance(body.get("fingerprint"), dict) else None
    parsed_trajectory = parse_trajectory(body.get("trajectory"))
    parsed_behavior = parse_behavior(body.get("behavior"))

    risk = compute_pow_difficulty(
        fingerprint=fingerprint,
        trajectory=parsed_trajectory or None,
        behavior=parsed_behavior,
    )

    challenge = generate_pow_challenge(difficulty=risk["difficulty"])
    challenge["risk_level"] = risk["risk_level"]
    return challenge


@app.get("/video-captcha-stream/{captcha_id}")
async def video_captcha_stream(captcha_id: str):
    """Stream the video captcha frames as multipart MJPEG."""
    if captcha_id not in video_captcha_sessions:
        return JSONResponse(
            {"error": "Invalid or expired captcha_id."}, status_code=404
        )

    return StreamingResponse(
        _generate_video_stream(captcha_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.post("/video-captcha-slider")
async def update_video_slider(body: dict[str, Any]) -> dict[str, Any]:
    """Receive live slider position updates for video captcha rendering."""
    captcha_id: str | None = body.get("captcha_id")
    slider_value: int | None = body.get("slider_value")

    if captcha_id is None or slider_value is None:
        return {"success": False, "error": "Missing captcha_id or slider_value."}

    challenge = video_captcha_sessions.get(captcha_id)
    if challenge is None:
        return {"success": False, "error": "Invalid or expired captcha_id."}

    normalized = max(0.0, min(1.0, float(slider_value) / 1000.0))
    challenge["current_slider"] = normalized
    return {"success": True}


@app.post("/verify-captcha")
async def verify_captcha(body: dict[str, Any]) -> dict[str, Any]:
    """
    **POST /verify-captcha**

    Accepts JSON:

    ```json
    {
      "captcha_id":      "...",
      "slider_value":    75,
      "pow_salt":        "<hex>",
      "pow_nonce":       12345,
      "pow_difficulty":   20,
      "pow_timestamp":   1740000000,
      "pow_signature":   "<HMAC hex>"
    }
    ```

    Verification order:
      1. Validate the Proof-of-Work (HMAC, timestamp, replay, hash).
      2. Validate the slider answer.

    Returns `{ "success": true/false }`.
    """
    # ── Extract common fields ──
    captcha_id: str | None = body.get("captcha_id")
    slider_value: int | None = body.get("slider_value")
    mode = str(body.get("mode", "image")).lower()
    trajectory = body.get("trajectory")
    behavior = body.get("behavior")
    fingerprint: dict | None = body.get("fingerprint")
    if not isinstance(fingerprint, dict):
        fingerprint = None

    parsed_trajectory = parse_trajectory(trajectory)
    parsed_behavior = parse_behavior(behavior)

    if captcha_id is None or slider_value is None:
        return {"success": False, "error": "Missing captcha_id or slider_value."}

    # ── 1. Proof-of-Work gate ──
    pow_fields = ("pow_salt", "pow_nonce", "pow_difficulty",
                  "pow_timestamp", "pow_signature")
    if any(body.get(k) is None for k in pow_fields):
        return {"success": False, "error": "Missing PoW fields."}

    pow_error = verify_pow(
        salt=body["pow_salt"],
        difficulty=int(body["pow_difficulty"]),
        timestamp=int(body["pow_timestamp"]),
        signature=body["pow_signature"],
        nonce=int(body["pow_nonce"]),
    )
    if pow_error is not None:
        return {"success": False, "error": pow_error}

    # ── 2. Slider answer check ──
    if mode == "video":
        challenge = video_captcha_sessions.get(captcha_id)
        if challenge is None:
            return {"success": False, "error": "Invalid or expired captcha_id."}

        submitted_val = max(0.0, min(1.0, float(slider_value) / 1000.0))
        target = float(challenge["secret_target"])
        temp_session = CaptchaSession(
            solved_value=int(target * 1000),
            fingerprint=fingerprint,
            trajectory=parsed_trajectory,
            behavior=parsed_behavior,
        )
        bot_analysis = analyze_bot_risk(temp_session)
        slider_ok = abs(target - submitted_val) <= 0.03
        success = slider_ok and not bot_analysis["is_bot"]
        if success:
            del video_captcha_sessions[captcha_id]
        return {"success": success, "analysis": bot_analysis}

    session = captcha_sessions.pop(captcha_id, None)
    if session is None:
        return {"success": False, "error": "Invalid or expired captcha_id."}

    session.fingerprint = fingerprint
    if parsed_trajectory:
        session.trajectory = parsed_trajectory
    if parsed_behavior is not None:
        session.behavior = parsed_behavior

    TOLERANCE = 3
    puzzle_solved = abs(slider_value - session.solved_value) <= TOLERANCE
    bot_analysis = analyze_bot_risk(session)
    success = puzzle_solved and not bot_analysis["is_bot"]

    return {"success": success, "analysis": bot_analysis}


# ──────────────────────────────────────────────
# Run with: uvicorn main:app --reload
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
