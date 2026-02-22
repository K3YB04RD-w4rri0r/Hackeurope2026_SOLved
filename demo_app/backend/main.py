"""
Ad-CAPTCHA - Platform Backend
==============================
Handles publisher/user management, wallet authentication, solve tracking,
and Solana payment logic. Talks to the CAPTCHA microservice (port 8000)
for puzzle generation and verification.

API:
  POST /api/auth/verify-wallet       -> verify Solana wallet signature
  POST /api/publisher/register       -> register publisher (wallet + site)
  GET  /api/publisher/{wallet}/stats -> publisher statistics
  POST /api/solve/record             -> record a verified solve
  GET  /api/health                   -> { status: "ok" }
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
import base58

# ──────────────────────────────────────────────
# App & CORS
# ──────────────────────────────────────────────
app = FastAPI(
    title="Ad-CAPTCHA Platform",
    description="Publisher management, wallet auth, and Solana payment tracking.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
CAPTCHA_SERVICE_URL = "http://localhost:8000"
LAMPORTS_PER_SOLVE = 5_000_000  # 0.005 SOL per solve (demo)

# ──────────────────────────────────────────────
# In-memory stores
# ──────────────────────────────────────────────
# site_key -> publisher info
publishers: dict[str, dict[str, Any]] = {}

# wallet_address -> site_key
wallet_to_site_key: dict[str, str] = {}

# site_key -> list of solve records
solve_records: dict[str, list[dict[str, Any]]] = {}

# wallet_address -> auth session (for verified wallets)
auth_sessions: dict[str, dict[str, Any]] = {}


# ──────────────────────────────────────────────
# API Endpoints
# ──────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Health check for the platform backend."""
    # Also check if captcha service is reachable
    captcha_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{CAPTCHA_SERVICE_URL}/health")
            captcha_ok = resp.status_code == 200
    except Exception:
        pass

    return {
        "status": "ok",
        "captcha_service": "connected" if captcha_ok else "unreachable",
    }


# ──────────────────────────────────────────────
# Wallet Authentication
# ──────────────────────────────────────────────

@app.post("/api/auth/verify-wallet")
async def verify_wallet(body: dict[str, Any]):
    """
    Verify a Solana wallet signature for authentication.

    Body: {
        "wallet_address": "base58 public key",
        "signature": "base58 encoded signature",
        "message": "the message that was signed"
    }
    """
    wallet_address = body.get("wallet_address")
    signature_b58 = body.get("signature")
    message = body.get("message")

    if not wallet_address or not signature_b58 or not message:
        return {"success": False, "error": "wallet_address, signature, and message required."}

    try:
        # Decode the public key and signature from base58
        public_key_bytes = base58.b58decode(wallet_address)
        signature_bytes = base58.b58decode(signature_b58)
        message_bytes = message.encode("utf-8") if isinstance(message, str) else message

        # Verify the signature using ed25519
        verify_key = VerifyKey(public_key_bytes)
        verify_key.verify(message_bytes, signature_bytes)

        # Store auth session
        session_token = uuid.uuid4().hex
        auth_sessions[wallet_address] = {
            "session_token": session_token,
            "authenticated_at": time.time(),
            "wallet_address": wallet_address,
        }

        return {
            "success": True,
            "session_token": session_token,
            "wallet_address": wallet_address,
        }

    except (BadSignatureError, Exception) as e:
        return {"success": False, "error": f"Signature verification failed: {str(e)}"}


# ──────────────────────────────────────────────
# Publisher Management
# ──────────────────────────────────────────────

@app.post("/api/publisher/register")
async def register_publisher(body: dict[str, Any]):
    """
    Register a publisher with their Solana wallet address.

    Body: {
        "wallet_address": "base58 public key",
        "site_url": "https://example.com",
        "site_name": "My Website"
    }
    """
    wallet_address = body.get("wallet_address")
    site_url = body.get("site_url")
    site_name = body.get("site_name", "")

    if not wallet_address or not site_url:
        return {"success": False, "error": "wallet_address and site_url are required."}

    # If wallet already registered, return existing site_key
    if wallet_address in wallet_to_site_key:
        existing_key = wallet_to_site_key[wallet_address]
        return {"success": True, "site_key": existing_key}

    site_key = uuid.uuid4().hex
    publishers[site_key] = {
        "site_key": site_key,
        "wallet_address": wallet_address,
        "site_url": site_url,
        "site_name": site_name,
        "registered_at": time.time(),
    }
    wallet_to_site_key[wallet_address] = site_key

    return {"success": True, "site_key": site_key}


@app.get("/api/publisher/latest")
async def latest_publisher():
    """Get the most recently registered publisher's site key (for demo)."""
    if not wallet_to_site_key:
        return {"success": False, "error": "No publishers registered yet."}
    # Return the last registered wallet's site key
    wallet = list(wallet_to_site_key.keys())[-1]
    sk = wallet_to_site_key[wallet]
    return {"success": True, "site_key": sk, "wallet_address": wallet}


@app.get("/api/publisher/{wallet}/stats")
async def publisher_stats(wallet: str):
    """Get publisher statistics by wallet address."""
    site_key = wallet_to_site_key.get(wallet)
    if not site_key:
        return {"success": False, "error": "Publisher not found."}

    solves = solve_records.get(site_key, [])
    total_solves = len(solves)
    total_earned_lamports = total_solves * LAMPORTS_PER_SOLVE

    recent_solves = [
        {
            "captcha_id": s["captcha_id"],
            "timestamp": s["timestamp"],
            "reward_lamports": LAMPORTS_PER_SOLVE,
        }
        for s in solves[-20:]
    ]

    return {
        "success": True,
        "wallet_address": wallet,
        "site_key": site_key,
        "total_solves": total_solves,
        "total_earned_lamports": total_earned_lamports,
        "recent_solves": recent_solves,
    }


# ──────────────────────────────────────────────
# Solve Recording
# ──────────────────────────────────────────────

@app.post("/api/solve/record")
async def record_solve(body: dict[str, Any]):
    """
    Record a verified CAPTCHA solve for a publisher.
    Called by the frontend after a successful captcha verification.

    Body: {
        "captcha_id": "...",
        "site_key": "...",
        "slider_value": 75
    }
    """
    captcha_id = body.get("captcha_id")
    site_key = body.get("site_key")

    if not captcha_id or not site_key:
        return {"success": False, "error": "captcha_id and site_key required."}

    if site_key not in publishers:
        return {"success": False, "error": "Unknown site_key."}

    solve_record = {
        "captcha_id": captcha_id,
        "site_key": site_key,
        "timestamp": time.time(),
    }
    if site_key not in solve_records:
        solve_records[site_key] = []
    solve_records[site_key].append(solve_record)

    publisher = publishers[site_key]
    return {
        "success": True,
        "reward_lamports": LAMPORTS_PER_SOLVE,
        "publisher_wallet": publisher["wallet_address"],
    }


# ──────────────────────────────────────────────
# Run with: python main.py
# ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
