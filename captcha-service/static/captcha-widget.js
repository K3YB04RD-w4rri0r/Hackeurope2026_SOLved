(function () {
  "use strict";

  // ── Discover our own <script> tag to read config ──────────────
  const currentScript = document.currentScript;
  const SERVICE_URL   = new URL(currentScript.src).origin;
  const API_URL       = currentScript.getAttribute("data-api-url") || SERVICE_URL;
  const containerId   = currentScript.getAttribute("data-captcha-container");
  const successCbName = currentScript.getAttribute("data-on-success");
  const siteKey       = currentScript.getAttribute("data-site-key") || "";
  const theme         = currentScript.getAttribute("data-theme") || "light";
  const initialMode   = currentScript.getAttribute("data-captcha-type") === "video" ? "video" : "image";

  if (!containerId) {
    console.error("[CaptchaWidget] Missing data-captcha-container attribute.");
    return;
  }

  // ── Load fingerprint client module ─────────────────────────────
  let fingerprintClient = null;
  async function loadFingerprintClient() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${SERVICE_URL}/static/fingerprint-client.js`;
      script.onload = () => {
        fingerprintClient = window.CaptchaFingerprintClient;
        resolve(fingerprintClient);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ── Theme colours ───────────────────────────────────────────────
  const dk = theme === "dark";
  const C = {
    bg:         dk ? "#1e1e2e" : "#ffffff",
    text:       dk ? "#e0e0e0" : "#1a1a2e",
    muted:      dk ? "#888"    : "#999",
    border:     dk ? "#333"    : "#e0e0e0",
    trackBg:    dk ? "#3a3a4a" : "#e2e5ea",
    overlayBg:  dk ? "rgba(30,30,46,.8)" : "rgba(255,255,255,.75)",
    spinBorder: dk ? "#3a3a4a" : "#dde1e7",
    puzzleBg:   dk ? "#2a2a3a" : "#e8e8e8",
    footerText: dk ? "#555"    : "#bbb",
    footerLink: dk ? "#666"    : "#aaa",
    cbBorder:   dk ? "#555"    : "#ccc",
    cbBg:       dk ? "#2a2a3a" : "#fafafa",
    cbHover:    dk ? "#3a3a4a" : "#f0f0f5",
  };

  // ── Inject scoped styles (once) ─────────────────────────────────
  const W = "uw-captcha";

  {
    const existing = document.getElementById("uw-captcha-styles");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "uw-captcha-styles";
    style.textContent = `
      .${W} { font-family: "Inter","Segoe UI",system-ui,-apple-system,sans-serif; box-sizing: border-box; }
      .${W} *,.${W} *::before,.${W} *::after { box-sizing: border-box; margin: 0; padding: 0; }

      /* ── Card ── */
      .${W} .uw-card {
        background: ${dk ? "#1e1e2e" : "#f9f9f9"}; border-radius: 4px; padding: 0;
        box-shadow: 0 2px 6px rgba(0,0,0,.08);
        display: flex; flex-direction: column; align-items: stretch; gap: 0;
        width: 400px; min-width: 400px; color: ${C.text};
        border: 1px solid ${dk ? "rgba(255,255,255,.12)" : "#d3d3d3"};
      }

      /* ── Checkbox gate ── */
      .${W} .uw-gate {
        display: flex; align-items: center; width: 100%;
        padding: 16px 20px; cursor: pointer;
        border: none; background: none;
        transition: opacity .2s;
        user-select: none; -webkit-user-select: none;
        min-height: 74px;
      }
      .${W} .uw-gate:hover .uw-cb { border-color: ${dk ? "#888" : "#999"}; box-shadow: 0 0 0 3px ${dk ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)"}; }
      .${W} .uw-gate.checking { pointer-events: none; }

      .${W} .uw-gate-left {
        display: flex; align-items: center; gap: 14px; flex: 1;
      }

      .${W} .uw-gate-right {
        display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0;
      }

      .${W} .uw-gate-logo {
        width: 40px; height: 40px; object-fit: contain;
      }

      .${W} .uw-gate-links {
        display: flex; gap: 6px; font-size: 9px;
      }
      .${W} .uw-gate-links a {
        color: ${dk ? "#666" : "#999"}; text-decoration: none; font-weight: 500;
      }
      .${W} .uw-gate-links a:hover { text-decoration: underline; }

      .${W} .uw-cb {
        width: 28px; height: 28px; border-radius: 4px; flex-shrink: 0;
        border: 2px solid ${dk ? "#555" : "#c0c0c0"}; position: relative;
        transition: border-color .2s, box-shadow .2s;
        display: flex; align-items: center; justify-content: center;
        background: ${dk ? "transparent" : "#fafafa"};
      }

      .${W} .uw-cb-check {
        width: 18px; height: 18px; opacity: 0; transform: scale(0);
        transition: opacity .25s, transform .25s cubic-bezier(.34,1.56,.64,1);
      }
      .${W} .uw-cb-check.visible { opacity: 1; transform: scale(1); }

      .${W} .uw-cb-spin {
        width: 18px; height: 18px; position: absolute;
        border: 2px solid ${C.spinBorder}; border-top-color: #4a6cf7;
        border-radius: 50%; animation: uw-spin .65s linear infinite;
        display: none;
      }
      .${W} .uw-gate.checking .uw-cb-spin { display: block; }
      .${W} .uw-gate.checking .uw-cb { border-color: transparent; background: transparent; }

      .${W} .uw-gate-label {
        font-size: 15px; font-weight: 500; color: ${dk ? "#ccc" : "#333"}; line-height: 1.3;
      }

      /* ── Puzzle area ── */
      .${W} .uw-puzzle-area { display: none; width: 100%; flex-direction: column; align-items: center; gap: 16px; }
      .${W} .uw-puzzle-area.active { display: flex; }

      .${W} .uw-puzzle {
        position: relative; width: 300px; height: 300px;
        border: 2px solid ${C.border}; border-radius: 10px; overflow: hidden;
        background: ${C.puzzleBg};
      }
      .${W} .uw-pieces-layer { position: absolute; top: 0; left: 0; width: 300px; height: 300px; }
      .${W} .uw-video-frame { display: none; width: 100%; height: 100%; object-fit: cover; background: #000; }
      .${W} .uw-piece {
        position: absolute; top: 0; left: 0; will-change: transform;
        transition: none; image-rendering: crisp-edges; pointer-events: none;
      }
      .${W} .uw-piece.solved { filter: drop-shadow(0 0 4px rgba(34,197,94,.7)); transition: filter .3s ease; }

      .${W} .uw-overlay {
        position: absolute; inset: 0; display: flex; justify-content: center; align-items: center;
        background: ${C.overlayBg}; border-radius: 10px; z-index: 10;
        opacity: 0; pointer-events: none; transition: opacity .25s;
      }
      .${W} .uw-overlay.visible { opacity: 1; pointer-events: auto; }
      .${W} .uw-spinner {
        width: 36px; height: 36px; border: 4px solid ${C.spinBorder};
        border-top-color: #4a6cf7; border-radius: 50%; animation: uw-spin .7s linear infinite;
      }
      @keyframes uw-spin { to { transform: rotate(360deg); } }

      /* ── Slider ── */
      .${W} .uw-slider-wrap {
        width: 300px; position: relative; display: flex; flex-direction: column; gap: 4px;
      }
      .${W} .uw-slider-track {
        position: relative; width: 100%; height: 40px; border-radius: 10px;
        background: ${C.trackBg}; overflow: hidden;
        border: 2px solid ${C.border};
      }
      .${W} .uw-slider-fill {
        position: absolute; top: 0; left: 0; bottom: 0; width: 0%;
        background: linear-gradient(90deg, rgba(74,108,247,.15), rgba(74,108,247,.25));
        transition: width 30ms linear;
        pointer-events: none;
      }
      .${W} .uw-slider-hint {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase;
        color: ${dk ? "#666" : "#b0b5bd"}; pointer-events: none;
        transition: opacity .3s;
      }
      .${W} .uw-slider-hint.hidden { opacity: 0; }

      .${W} .uw-slider-track input[type="range"] {
        -webkit-appearance: none; appearance: none;
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: transparent; outline: none; margin: 0; cursor: grab;
        touch-action: none; z-index: 2;
      }
      .${W} .uw-slider-track input[type="range"]:active { cursor: grabbing; }

      .${W} .uw-slider-track input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 40px; height: 36px; border-radius: 8px;
        background: #4a6cf7; border: 2px solid rgba(255,255,255,.9);
        box-shadow: 0 2px 10px rgba(74,108,247,.4), 0 0 0 1px rgba(74,108,247,.15);
        cursor: grab; transition: background .2s, box-shadow .2s;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 4l5 5-5 5'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: center; background-size: 18px;
      }
      .${W} .uw-slider-track input[type="range"]::-moz-range-thumb {
        width: 40px; height: 36px; border-radius: 8px;
        background: #4a6cf7; border: 2px solid rgba(255,255,255,.9);
        box-shadow: 0 2px 10px rgba(74,108,247,.4), 0 0 0 1px rgba(74,108,247,.15);
        cursor: grab; transition: background .2s, box-shadow .2s;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 4l5 5-5 5'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: center; background-size: 18px;
      }
      .${W} .uw-slider-track input[type="range"]:active::-webkit-slider-thumb { cursor: grabbing; box-shadow: 0 2px 14px rgba(74,108,247,.55), 0 0 0 2px rgba(74,108,247,.2); }
      .${W} .uw-slider-track input[type="range"]:active::-moz-range-thumb { cursor: grabbing; box-shadow: 0 2px 14px rgba(74,108,247,.55), 0 0 0 2px rgba(74,108,247,.2); }

      /* success / failure slider states */
      .${W} .uw-slider-track.success { border-color: #22c55e; }
      .${W} .uw-slider-track.success .uw-slider-fill { background: linear-gradient(90deg, rgba(34,197,94,.15), rgba(34,197,94,.3)); }
      .${W} .uw-slider-track.success input::-webkit-slider-thumb { background-color: #22c55e; box-shadow: 0 2px 10px rgba(34,197,94,.5); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 9l3.5 3.5L14 5'/%3E%3C/svg%3E"); }
      .${W} .uw-slider-track.success input::-moz-range-thumb { background-color: #22c55e; box-shadow: 0 2px 10px rgba(34,197,94,.5); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 9l3.5 3.5L14 5'/%3E%3C/svg%3E"); }

      .${W} .uw-slider-track.failure { border-color: #ef4444; }
      .${W} .uw-slider-track.failure .uw-slider-fill { background: linear-gradient(90deg, rgba(239,68,68,.1), rgba(239,68,68,.25)); }
      .${W} .uw-slider-track.failure input::-webkit-slider-thumb { background-color: #ef4444; box-shadow: 0 2px 10px rgba(239,68,68,.5); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M5 5l8 8M13 5l-8 8'/%3E%3C/svg%3E"); }
      .${W} .uw-slider-track.failure input::-moz-range-thumb { background-color: #ef4444; box-shadow: 0 2px 10px rgba(239,68,68,.5); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M5 5l8 8M13 5l-8 8'/%3E%3C/svg%3E"); }

      /* ── Status & Footer ── */
      .${W} .uw-status {
        font-size: 13px; font-weight: 600; min-height: 20px; text-align: center;
        transition: opacity .3s; color: ${C.muted};
      }
      .${W} .uw-status.success { color: #16a34a; }
      .${W} .uw-status.failure { color: #dc2626; }

      /* footer removed — branding now inside gate-right */

      /* ── Solved tick on puzzle ── */
      .${W} .uw-solved-tick {
        position: absolute; inset: 0; z-index: 11;
        display: flex; align-items: center; justify-content: center;
        background: rgba(34,197,94,.12); border-radius: 10px;
        opacity: 0; transition: opacity .4s;
      }
      .${W} .uw-solved-tick.visible { opacity: 1; }
      .${W} .uw-solved-tick svg {
        width: 64px; height: 64px; filter: drop-shadow(0 2px 8px rgba(34,197,94,.4));
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build DOM ─────────────────────────────────────────────────
  async function initWidget() {
    try {
      await loadFingerprintClient();
    } catch (e) {
      console.error("[CaptchaWidget] Failed to load fingerprint client:", e);
    }

    const host = document.getElementById(containerId);
    if (!host) {
      console.error(`[CaptchaWidget] Container #${containerId} not found.`);
      return;
    }

    host.classList.add(W);
    host.innerHTML = `
      <div class="uw-card">
        <!-- Checkbox gate -->
        <div class="uw-gate" data-ref="gate">
          <div class="uw-gate-left">
            <div class="uw-cb">
              <svg class="uw-cb-check" data-ref="cbCheck" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
              <div class="uw-cb-spin" data-ref="cbSpin"></div>
            </div>
            <span class="uw-gate-label">I'm not a robot</span>
          </div>
          <div class="uw-gate-right">
            <img class="uw-gate-logo" src="${SERVICE_URL}/static/logo.png" alt="SOLved" />
            <div class="uw-gate-links">
              <a href="https://solved.ad" target="_blank" rel="noopener">Privacy</a>
              <span style="color:${dk ? "#555" : "#ccc"}">·</span>
              <a href="https://solved.ad" target="_blank" rel="noopener">Terms</a>
            </div>
          </div>
        </div>

        <!-- Puzzle view (hidden until gate clicked) -->
        <div class="uw-puzzle-area" data-ref="puzzleArea">
          <div class="uw-puzzle" data-ref="puzzle">
            <div class="uw-pieces-layer" data-ref="piecesLayer"></div>
            <img class="uw-video-frame" data-ref="videoFrame" alt="video captcha" />
            <div class="uw-overlay visible" data-ref="overlay">
              <div class="uw-spinner"></div>
            </div>
            <div class="uw-solved-tick" data-ref="solvedTick">
              <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
            </div>
          </div>
          <div class="uw-slider-wrap">
            <div class="uw-slider-track" data-ref="sliderTrack">
              <div class="uw-slider-fill" data-ref="sliderFill"></div>
              <div class="uw-slider-hint" data-ref="sliderHint">Slide to solve</div>
              <input type="range" min="0" max="100" value="0" disabled data-ref="slider" />
            </div>
          </div>
          <div class="uw-status loading" data-ref="status">Loading...</div>
        </div>
      </div>
    `;

    // ── Refs ──
    const $ = (sel) => host.querySelector(`[data-ref="${sel}"]`);
    const gate        = $("gate");
    const cbCheck     = $("cbCheck");
    const puzzleArea  = $("puzzleArea");
    const puzzle      = $("puzzle");
    const piecesLayer = $("piecesLayer");
    const videoFrame  = $("videoFrame");
    const slider      = $("slider");
    const sliderTrack = $("sliderTrack");
    const sliderFill  = $("sliderFill");
    const sliderHint  = $("sliderHint");
    const status      = $("status");
    const overlay     = $("overlay");
    const solvedTick  = $("solvedTick");

    // ── Initialize tracking ──
    const fallbackTracker = { start() {}, record() {}, getData() { return []; } };
    const fallbackBehavior = { start() {}, recordEvent() {}, end() {}, getData() { return null; } };

    const fpSession = fingerprintClient && typeof fingerprintClient.createSession === "function"
      ? await fingerprintClient.createSession(SERVICE_URL)
      : { available: false, fingerprint: null, trajectoryTracker: fallbackTracker, behaviorTracker: fallbackBehavior };

    const trajectoryTracker = fpSession.trajectoryTracker || fallbackTracker;
    const behaviorTracker = fpSession.behaviorTracker || fallbackBehavior;

    // ── State ──
    let captchaId = null;
    let keyframes = {};
    let pieceEls  = {};
    let locked    = false;
    let rafId     = null;
    let pending   = null;
    let KF_POSITIONS = [];
    let mode = initialMode;
    let lastVideoPush = 0;

    // ── Helpers ──
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function indexKeyframes(raw) {
      const indexed = {};
      for (const [kf, pieces] of Object.entries(raw)) {
        const map = {};
        for (const p of pieces) map[p.piece_id] = { x: p.x, y: p.y };
        indexed[Number(kf)] = map;
      }
      return indexed;
    }

    function getSegment(value) {
      value = Math.max(0, Math.min(100, value));
      let lo = KF_POSITIONS[0], hi = KF_POSITIONS[KF_POSITIONS.length - 1];
      for (let i = 0; i < KF_POSITIONS.length - 1; i++) {
        if (value >= KF_POSITIONS[i] && value <= KF_POSITIONS[i + 1]) {
          lo = KF_POSITIONS[i]; hi = KF_POSITIONS[i + 1]; break;
        }
      }
      const span = hi - lo;
      return { lo, hi, t: span === 0 ? 0 : (value - lo) / span };
    }

    function getPositionsAtValue(value) {
      const { lo, hi, t } = getSegment(value);
      const eased = smoothstep(t);
      const loMap = keyframes[lo], hiMap = keyframes[hi];
      const pos = {};
      for (const id of Object.keys(loMap)) {
        pos[id] = {
          x: lerp(loMap[id].x, hiMap[id].x, eased),
          y: lerp(loMap[id].y, hiMap[id].y, eased),
        };
      }
      return pos;
    }

    function applyPositions(positions) {
      for (const [id, { x, y }] of Object.entries(positions)) {
        const el = pieceEls[id];
        if (el) el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }

    function scheduleRender() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pending === null) return;
        const v = pending; pending = null;
        applyPositions(getPositionsAtValue(v));
      });
    }

    function updateSliderFill() {
      const min = Number(slider.min);
      const max = Number(slider.max);
      const val = Number(slider.value);
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      sliderFill.style.width = pct + "%";
    }

    // ── Checkbox gate click ──
    gate.addEventListener("click", () => {
      if (gate.classList.contains("checking")) return;
      gate.classList.add("checking");
      // Short delay to show spinner, then transition to puzzle
      setTimeout(() => {
        gate.style.display = "none";
        puzzleArea.classList.add("active");
        loadCaptcha();
      }, 600);
    });

    // ── PoW solver manager ──────────────────────────────────────
    function solvePoW() {
      return new Promise((resolve, reject) => {
        Promise.all([
          fetch(`${SERVICE_URL}/pow-challenge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fingerprint: fpSession.fingerprint || null,
              trajectory: trajectoryTracker.getData(),
              behavior: behaviorTracker.getData(),
            }),
          }).then((res) => {
            if (!res.ok) throw new Error(`PoW challenge HTTP ${res.status}`);
            return res.json();
          }),
          fetch(`${SERVICE_URL}/static/powWorker.js`).then((res) => {
            if (!res.ok) throw new Error(`Worker fetch HTTP ${res.status}`);
            return res.text();
          }),
        ])
          .then(([challenge, workerSrc]) => {
            const { salt, difficulty } = challenge;
            const workerBlob = new Blob([workerSrc], { type: "application/javascript" });
            const workerUrl  = URL.createObjectURL(workerBlob);
            const numWorkers = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
            const TOTAL_RANGE = 0x10000000;
            const chunkSize   = Math.ceil(TOTAL_RANGE / numWorkers);

            const workers = [];
            let settled = false;
            let exhaustedCount = 0;

            function cleanup() {
              for (const w of workers) { try { w.terminate(); } catch (_) {} }
              workers.length = 0;
              URL.revokeObjectURL(workerUrl);
            }

            for (let i = 0; i < numWorkers; i++) {
              const w = new Worker(workerUrl);
              workers.push(w);
              w.postMessage({ type: "init", serviceUrl: SERVICE_URL });

              w.onmessage = (e) => {
                if (settled) return;
                const msg = e.data;
                if (msg.error) {
                  exhaustedCount++;
                  if (exhaustedCount >= numWorkers) { settled = true; cleanup(); reject(new Error("All PoW workers failed.")); }
                  return;
                }
                if (msg.found) {
                  settled = true; cleanup();
                  resolve({ salt: challenge.salt, difficulty: challenge.difficulty, timestamp: challenge.timestamp, signature: challenge.signature, nonce: msg.nonce, elapsed: msg.elapsed });
                  return;
                }
                exhaustedCount++;
                if (exhaustedCount >= numWorkers) { settled = true; cleanup(); reject(new Error("PoW: no nonce found.")); }
              };

              w.onerror = () => {
                exhaustedCount++;
                if (!settled && exhaustedCount >= numWorkers) { settled = true; cleanup(); reject(new Error("All PoW workers crashed.")); }
              };

              w.postMessage({ salt, difficulty, startNonce: i * chunkSize, iterations: chunkSize });
            }
          })
          .catch(reject);
      });
    }

    async function pushVideoSliderValue(force = false) {
      if (!captchaId) return;
      const now = Date.now();
      if (!force && now - lastVideoPush < 50) return;
      lastVideoPush = now;
      try {
        await fetch(`${SERVICE_URL}/video-captcha-slider`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captcha_id: captchaId, slider_value: Number(slider.value) }),
        });
      } catch {}
    }

    // ── Load CAPTCHA ──
    async function loadCaptcha() {
      locked = false;
      slider.value = 0;
      slider.disabled = true;
      sliderTrack.className = "uw-slider-track";
      sliderFill.style.width = "0%";
      sliderHint.classList.remove("hidden");
      status.textContent = "Loading...";
      status.className = "uw-status loading";
      overlay.classList.add("visible");
      solvedTick.classList.remove("visible");

      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      pending = null;
      lastVideoPush = 0;

      for (const el of Object.values(pieceEls)) el.remove();
      pieceEls = {};
      piecesLayer.innerHTML = "";
      videoFrame.removeAttribute("src");
      videoFrame.style.display = "none";
      piecesLayer.style.display = "block";
      puzzle.style.width = "300px";
      puzzle.style.height = "300px";
      piecesLayer.style.width = "300px";
      piecesLayer.style.height = "300px";

      try {
        const res = await fetch(`${SERVICE_URL}/generate-captcha?mode=${encodeURIComponent(mode)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        captchaId = data.captcha_id;
        mode = data.mode === "video" ? "video" : "image";

        if (mode === "video") {
          const width = Number(data.width) || 640;
          const height = Number(data.height) || 360;
          const streamUrl = String(data.stream_url || "");
          const resolvedStreamUrl = streamUrl.startsWith("http") ? streamUrl : `${SERVICE_URL}${streamUrl}`;

          const maxDisplayWidth = 300;
          const displayWidth = Math.min(maxDisplayWidth, width);
          const displayHeight = Math.max(160, Math.round((displayWidth * height) / width));

          puzzle.style.width = `${displayWidth}px`;
          puzzle.style.height = `${displayHeight}px`;
          piecesLayer.style.width = `${displayWidth}px`;
          piecesLayer.style.height = `${displayHeight}px`;
          piecesLayer.style.display = "none";
          videoFrame.style.display = "block";
          videoFrame.src = resolvedStreamUrl;

          slider.min = String(data.slider_min ?? 0);
          slider.max = String(data.slider_max ?? 1000);
          slider.value = String(data.slider_start ?? 0);
          updateSliderFill();

          overlay.classList.remove("visible");
          slider.disabled = false;
          status.textContent = "Drag the slider to align the patch";
          status.className = "uw-status";
          await pushVideoSliderValue(true);

        } else {
          keyframes = indexKeyframes(data.keyframes);
          KF_POSITIONS = Object.keys(keyframes).map(Number).sort((a, b) => a - b);

          const frag = document.createDocumentFragment();
          for (const [pid, info] of Object.entries(data.pieces)) {
            const img = document.createElement("img");
            img.className  = "uw-piece";
            img.draggable  = false;
            img.src        = `data:image/png;base64,${info.data}`;
            img.dataset.id = pid;
            img.width      = info.w;
            img.height     = info.h;
            img.alt        = "puzzle piece";
            frag.appendChild(img);
            pieceEls[pid] = img;
          }
          piecesLayer.appendChild(frag);

          await Promise.all(
            Object.values(pieceEls).map(img =>
              img.decode ? img.decode().catch(() => {}) : Promise.resolve()
            )
          );

          applyPositions(getPositionsAtValue(KF_POSITIONS[0]));
          overlay.classList.remove("visible");

          slider.min = "0";
          slider.max = "100";
          slider.value = "0";
          updateSliderFill();
          slider.disabled = false;
          status.textContent = "Drag the slider to unscramble the image";
          status.className = "uw-status";
        }
      } catch (err) {
        console.error("[CaptchaWidget] Load failed:", err);
        overlay.classList.remove("visible");
        status.textContent = "Failed to load — click to retry";
        status.className = "uw-status failure";
        status.style.cursor = "pointer";
        status.onclick = () => { status.style.cursor = ""; status.onclick = null; loadCaptcha(); };
      }
    }

    // ── Slider events ──
    let hasMoved = false;

    slider.addEventListener("mousedown", (e) => {
      trajectoryTracker.start();
      behaviorTracker.start();
      behaviorTracker.recordEvent('mousedown', e.clientX, e.clientY);
    });

    slider.addEventListener("touchstart", (e) => {
      trajectoryTracker.start();
      behaviorTracker.start();
      const t = e.touches[0];
      if (t) behaviorTracker.recordEvent('touchstart', t.clientX, t.clientY);
    });

    slider.addEventListener("mousemove", (e) => {
      if (behaviorTracker) behaviorTracker.recordEvent('mousemove', e.clientX, e.clientY);
    });

    slider.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      if (t && behaviorTracker) behaviorTracker.recordEvent('touchmove', t.clientX, t.clientY);
    });

    slider.addEventListener("input", () => {
      if (locked) return;
      hasMoved = true;
      sliderHint.classList.add("hidden");
      updateSliderFill();
      trajectoryTracker.record(Number(slider.value));
      if (mode === "video") {
        pushVideoSliderValue();
        return;
      }
      pending = Number(slider.value);
      scheduleRender();
    });

    async function submitSlider() {
      if (locked) return;
      locked = true;
      slider.disabled = true;

      const val = Number(slider.value);
      if (mode === "video") {
        await pushVideoSliderValue(true);
      } else {
        applyPositions(getPositionsAtValue(val));
      }

      status.textContent = "Verifying...";
      status.className = "uw-status loading";

      try {
        const pow = await solvePoW();

        const res = await fetch(`${SERVICE_URL}/verify-captcha`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captcha_id:    captchaId,
            slider_value:  val,
            pow_salt:      pow.salt,
            pow_nonce:     pow.nonce,
            pow_difficulty: pow.difficulty,
            pow_timestamp: pow.timestamp,
            pow_signature: pow.signature,
            mode: mode,
            site_key: siteKey || null,
            fingerprint: fpSession.fingerprint || null,
            trajectory: trajectoryTracker.getData(),
            behavior: behaviorTracker.getData()
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.success) {
          sliderTrack.classList.add("success");
          for (const el of Object.values(pieceEls)) el.classList.add("solved");
          solvedTick.classList.add("visible");
          status.textContent = "Verified!";
          status.className = "uw-status success";

          if (successCbName && typeof window[successCbName] === "function") {
            window[successCbName]({
              captcha_id: captchaId, slider_value: val, mode,
              site_key: siteKey || null, solved: true,
            });
          }

          host.dispatchEvent(new CustomEvent("captcha-success", {
            bubbles: true,
            detail: { captcha_id: captchaId, slider_value: val, mode },
          }));

          if (siteKey) {
            fetch(`${API_URL}/api/solve/record`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ captcha_id: captchaId, site_key: siteKey, slider_value: val }),
            }).catch(function() {});
          }
        } else {
          sliderTrack.classList.add("failure");
          status.textContent = "Incorrect — reloading...";
          status.className = "uw-status failure";
          setTimeout(loadCaptcha, 1800);
        }
      } catch (err) {
        console.error("[CaptchaWidget] Verify error:", err);
        sliderTrack.classList.add("failure");
        status.textContent = "Network error — reloading...";
        status.className = "uw-status failure";
        setTimeout(loadCaptcha, 2000);
      }
    }

    slider.addEventListener("change", submitSlider);
    slider.addEventListener("pointerup", () => {
      if (behaviorTracker) behaviorTracker.end();
      setTimeout(() => { if (!hasMoved) submitSlider(); hasMoved = false; }, 0);
    });
    slider.addEventListener("touchend", () => {
      if (behaviorTracker) behaviorTracker.end();
    });
  }

  // Run when DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initWidget().catch(console.error));
  } else {
    initWidget().catch(console.error);
  }
})();
