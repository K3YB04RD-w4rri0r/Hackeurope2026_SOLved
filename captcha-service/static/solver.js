/*
 * solver.js — Pure JavaScript fallback PoW solver
 * ================================================
 *
 * This is a JS implementation of the same memory-hard hash used by
 * solver.c / solver.wasm.  It is loaded by powWorker.js when WASM
 * is not available or as the default solver module.
 *
 * It exports a global `SolverModule` factory function that returns
 * a Promise resolving to an object with a `ccall` method, matching
 * the Emscripten module interface expected by the worker.
 */

/* eslint-disable no-unused-vars */
/* global self */

var SolverModule = function () {
  "use strict";

  // ── SHA-256 ────────────────────────────────────────────────────

  var K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function ror32(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function sha256_transform(state, block, offset) {
    var W = new Uint32Array(64);
    var i, t1, t2;
    var a, b, c, d, e, f, g, h;

    for (i = 0; i < 16; i++) {
      W[i] = ((block[offset + i * 4] << 24) |
               (block[offset + i * 4 + 1] << 16) |
               (block[offset + i * 4 + 2] << 8) |
               (block[offset + i * 4 + 3])) >>> 0;
    }
    for (i = 16; i < 64; i++) {
      var s0 = ror32(W[i-15], 7) ^ ror32(W[i-15], 18) ^ (W[i-15] >>> 3);
      var s1 = ror32(W[i-2], 17) ^ ror32(W[i-2], 19) ^ (W[i-2] >>> 10);
      W[i] = (s1 + W[i-7] + s0 + W[i-16]) >>> 0;
    }

    a = state[0]; b = state[1]; c = state[2]; d = state[3];
    e = state[4]; f = state[5]; g = state[6]; h = state[7];

    for (i = 0; i < 64; i++) {
      var ep1 = (ror32(e, 6) ^ ror32(e, 11) ^ ror32(e, 25)) >>> 0;
      var ch  = ((e & f) ^ (~e & g)) >>> 0;
      t1 = (h + ep1 + ch + K256[i] + W[i]) >>> 0;
      var ep0 = (ror32(a, 2) ^ ror32(a, 13) ^ ror32(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      t2 = (ep0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  function sha256(data) {
    // data is a Uint8Array
    var state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);

    var len = data.length;
    var bitLen = len * 8;

    // Padding: message + 0x80 + zeros + 8-byte big-endian length
    var padLen = len + 1;
    while (padLen % 64 !== 56) padLen++;
    padLen += 8;

    var padded = new Uint8Array(padLen);
    padded.set(data);
    padded[len] = 0x80;

    // 64-bit big-endian bit length (JS only handles up to 2^53 safely)
    // For our use case, messages are small so we only need the low 32 bits
    // of the high word and the low 32 bits.
    var hiLen = Math.floor(bitLen / 0x100000000);
    var loLen = bitLen >>> 0;
    padded[padLen - 8] = (hiLen >>> 24) & 0xFF;
    padded[padLen - 7] = (hiLen >>> 16) & 0xFF;
    padded[padLen - 6] = (hiLen >>> 8) & 0xFF;
    padded[padLen - 5] = hiLen & 0xFF;
    padded[padLen - 4] = (loLen >>> 24) & 0xFF;
    padded[padLen - 3] = (loLen >>> 16) & 0xFF;
    padded[padLen - 2] = (loLen >>> 8) & 0xFF;
    padded[padLen - 1] = loLen & 0xFF;

    // Process 64-byte blocks
    for (var off = 0; off < padLen; off += 64) {
      sha256_transform(state, padded, off);
    }

    // Produce 32-byte digest
    var out = new Uint8Array(32);
    for (var i = 0; i < 8; i++) {
      out[i * 4 + 0] = (state[i] >>> 24) & 0xFF;
      out[i * 4 + 1] = (state[i] >>> 16) & 0xFF;
      out[i * 4 + 2] = (state[i] >>> 8) & 0xFF;
      out[i * 4 + 3] = state[i] & 0xFF;
    }
    return out;
  }

  // ── xoshiro128** PRNG ──────────────────────────────────────────

  function rotl32(x, k) {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  // ── Memory-hard hash ──────────────────────────────────────────

  var SCRATCH_WORDS = 4096;  // 16 KB / 4 = 4096 uint32
  var MIX_ROUNDS = 3;

  function memoryHardHash(inputBytes) {
    // Phase 1: SHA-256 the input to get a 32-byte seed
    var seed = sha256(inputBytes);

    // Phase 2: Seed xoshiro128** from the first 16 bytes
    var s = new Uint32Array(4);
    s[0] = (seed[0] | (seed[1] << 8) | (seed[2] << 16) | (seed[3] << 24)) >>> 0;
    s[1] = (seed[4] | (seed[5] << 8) | (seed[6] << 16) | (seed[7] << 24)) >>> 0;
    s[2] = (seed[8] | (seed[9] << 8) | (seed[10] << 16) | (seed[11] << 24)) >>> 0;
    s[3] = (seed[12] | (seed[13] << 8) | (seed[14] << 16) | (seed[15] << 24)) >>> 0;

    if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
      s[0] = 1;
    }

    // Phase 3: Fill scratchpad with PRNG output
    var scratch = new Uint32Array(SCRATCH_WORDS);
    for (var i = 0; i < SCRATCH_WORDS; i++) {
      // xoshiro128** output
      scratch[i] = (rotl32((s[1] * 5) >>> 0, 7) * 9) >>> 0;

      // xoshiro128** state advance
      var t = (s[1] << 9) >>> 0;
      s[2] = (s[2] ^ s[0]) >>> 0;
      s[3] = (s[3] ^ s[1]) >>> 0;
      s[1] = (s[1] ^ s[2]) >>> 0;
      s[0] = (s[0] ^ s[3]) >>> 0;
      s[2] = (s[2] ^ t) >>> 0;
      s[3] = rotl32(s[3], 11);
    }

    // Phase 4: Data-dependent mixing
    var acc = ((seed[16] << 24) | (seed[17] << 16) | (seed[18] << 8) | seed[19]) >>> 0;

    for (var r = 0; r < MIX_ROUNDS; r++) {
      for (var ii = 0; ii < SCRATCH_WORDS; ii++) {
        var j = acc & (SCRATCH_WORDS - 1);
        scratch[ii] = (scratch[ii] ^ scratch[j]) >>> 0;
        acc = (Math.imul(scratch[ii], 0x9e3779b9) + rotl32(acc, 7)) >>> 0;
      }
    }

    // Phase 5: SHA-256 the last 32 bytes of the scratchpad
    var tailBytes = new Uint8Array(32);
    var tailStart = SCRATCH_WORDS - 8;
    for (var ti = 0; ti < 8; ti++) {
      var w = scratch[tailStart + ti];
      // Must match C's memory layout: little-endian on x86,
      // but memcpy from uint32_t array => native byte order.
      // The C code casts uint32_t* to uint8_t*, so on little-endian:
      tailBytes[ti * 4 + 0] = w & 0xFF;
      tailBytes[ti * 4 + 1] = (w >>> 8) & 0xFF;
      tailBytes[ti * 4 + 2] = (w >>> 16) & 0xFF;
      tailBytes[ti * 4 + 3] = (w >>> 24) & 0xFF;
    }

    return sha256(tailBytes);
  }

  // ── Leading zero-bit check ────────────────────────────────────

  function hasLeadingZeroBits(hash, bits) {
    var fullBytes = Math.floor(bits / 8);
    var remaining = bits % 8;

    for (var i = 0; i < fullBytes; i++) {
      if (hash[i] !== 0) return false;
    }
    if (remaining > 0) {
      var mask = (0xFF << (8 - remaining)) & 0xFF;
      if ((hash[fullBytes] & mask) !== 0) return false;
    }
    return true;
  }

  // ── solve_challenge ───────────────────────────────────────────

  function solve_challenge(salt, difficulty, startNonce, iterations) {
    var hexChars = "0123456789abcdef";

    for (var i = 0; i < iterations; i++) {
      var nonce = startNonce + i;

      // Build message: "salt.XXXXXXXX" where X is 8-char hex nonce
      var nonceHex = "";
      for (var d = 7; d >= 0; d--) {
        nonceHex += hexChars[(nonce >>> (d * 4)) & 0xF];
      }
      var msg = salt + "." + nonceHex;

      // Convert to Uint8Array
      var msgBytes = new Uint8Array(msg.length);
      for (var c = 0; c < msg.length; c++) {
        msgBytes[c] = msg.charCodeAt(c);
      }

      var hash = memoryHardHash(msgBytes);

      if (hasLeadingZeroBits(hash, difficulty)) {
        return nonce;
      }
    }
    return -1;
  }

  // ── Module factory (returns a Promise like Emscripten) ────────

  return Promise.resolve({
    ccall: function (name, returnType, argTypes, args) {
      if (name === "solve_challenge") {
        return solve_challenge(args[0], args[1], args[2], args[3]);
      }
      throw new Error("Unknown function: " + name);
    }
  });
};
