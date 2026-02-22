/*
 * powWorker.js — Web Worker for Proof-of-Work solving
 * ====================================================
 *
 * Runs inside a dedicated Web Worker thread so the main thread
 * (and its canvas/rendering loop) stays completely unblocked.
 *
 * Protocol
 * --------
 * Main → Worker  postMessage({
 *   salt:        string,   // hex salt from the server challenge
 *   difficulty:  number,   // leading zero-bits required
 *   startNonce:  number,   // first nonce this worker should try
 *   iterations:  number,   // how many nonces to scan
 * })
 *
 * Worker → Main  postMessage({
 *   found:      boolean,   // true if a valid nonce was discovered
 *   nonce:      number,    // the winning nonce (-1 if not found)
 *   startNonce: number,    // echo back for bookkeeping
 *   iterations: number,    // echo back for bookkeeping
 *   elapsed:    number,    // wall-clock ms spent solving
 *   error:      string|null
 * })
 */

/* global SolverModule, importScripts, self */

// The service base URL is injected by the first "init" message from
// the main thread.  We must wait for it before calling importScripts
// because, when running from a blob: URL, relative paths don't work.
let _serviceUrl = null;
let _modulePromise = null;
let _pendingMessages = [];

function getModule() {
  if (!_modulePromise) {
    importScripts(_serviceUrl + "/static/solver.js");
    _modulePromise = SolverModule().catch(function (err) {
      _modulePromise = null;
      throw err;
    });
  }
  return _modulePromise;
}

async function handleSolve(data) {
  var salt       = data.salt;
  var difficulty  = data.difficulty;
  var startNonce  = data.startNonce;
  var iterations  = data.iterations;

  try {
    var mod = await getModule();

    var t0 = performance.now();

    // Call the C function exported from solver.wasm.
    //   int solve_challenge(const char *salt,
    //                       int         difficulty,
    //                       int         start_nonce,
    //                       int         iterations);
    var nonce = mod.ccall(
      "solve_challenge",                          // C function name
      "number",                                   // return type
      ["string", "number", "number", "number"],   // arg types
      [salt, difficulty, startNonce, iterations]   // arg values
    );

    var elapsed = performance.now() - t0;

    self.postMessage({
      found:      nonce >= 0,
      nonce:      nonce,
      startNonce: startNonce,
      iterations: iterations,
      elapsed:    elapsed,
      error:      null,
    });
  } catch (err) {
    self.postMessage({
      found:      false,
      nonce:      -1,
      startNonce: startNonce,
      iterations: iterations,
      elapsed:    0,
      error:      err.message || String(err),
    });
  }
}

// ── Message handler ─────────────────────────────────────────────
self.onmessage = function (e) {
  var data = e.data;

  // First message must carry the service base URL.
  if (data.type === "init") {
    _serviceUrl = data.serviceUrl;
    // Flush any solve messages that arrived before init.
    var queued = _pendingMessages;
    _pendingMessages = [];
    for (var i = 0; i < queued.length; i++) {
      handleSolve(queued[i]);
    }
    return;
  }

  // If we haven't received init yet, queue the message.
  if (!_serviceUrl) {
    _pendingMessages.push(data);
    return;
  }

  handleSolve(data);
};
