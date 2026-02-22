(function () {
  "use strict";

  let fingerprintLoaderPromise = null;

  function loadFingerprintLibrary(serviceUrl) {
    if (window.CaptchaFingerprint) {
      return Promise.resolve(window.CaptchaFingerprint);
    }

    if (fingerprintLoaderPromise) {
      return fingerprintLoaderPromise;
    }

    fingerprintLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${serviceUrl}/static/fp-captcha.js`;
      script.onload = () => {
        if (window.CaptchaFingerprint) {
          resolve(window.CaptchaFingerprint);
        } else {
          reject(new Error("Fingerprint library unavailable after load"));
        }
      };
      script.onerror = () => reject(new Error("Fingerprint library failed to load"));
      document.head.appendChild(script);
    });

    return fingerprintLoaderPromise;
  }

  function createNoopTrajectoryTracker() {
    return {
      start() {},
      record() {},
      getData() {
        return [];
      },
    };
  }

  function createNoopBehaviorTracker() {
    return {
      start() {},
      recordEvent() {},
      end() {},
      getData() {
        return null;
      },
    };
  }

  async function createSession(serviceUrl) {
    try {
      const lib = await loadFingerprintLibrary(serviceUrl);
      const fingerprint = lib.collectBrowserFingerprint();
      const trajectoryTracker = lib.createTrajectoryTracker();
      const behaviorTracker = lib.createBehaviorTracker();

      return {
        available: true,
        fingerprint,
        trajectoryTracker,
        behaviorTracker,
      };
    } catch (_) {
      return {
        available: false,
        fingerprint: null,
        trajectoryTracker: createNoopTrajectoryTracker(),
        behaviorTracker: createNoopBehaviorTracker(),
      };
    }
  }

  window.CaptchaFingerprintClient = {
    createSession,
  };
})();
