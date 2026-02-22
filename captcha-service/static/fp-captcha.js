(function() {
  'use strict';

  function collectBrowserFingerprint() {
    const fingerprint = {
      user_agent: navigator.userAgent,
      platform: navigator.platform,
      screen_resolution: `${screen.width}x${screen.height}`,
      available_screen: `${screen.availWidth}x${screen.availHeight}`,
      color_depth: screen.colorDepth,
      pixel_ratio: window.devicePixelRatio || 1,
      language: navigator.language,
      languages: navigator.languages ? Array.from(navigator.languages) : [],
      timezone_offset: new Date().getTimezoneOffset(),
      timezone_name: null,
      cookies_enabled: navigator.cookieEnabled,
      do_not_track: navigator.doNotTrack,
      hardware_concurrency: navigator.hardwareConcurrency || null,
      max_touch_points: navigator.maxTouchPoints || 0,
      webdriver: !!navigator.webdriver,
      plugins_count: navigator.plugins ? navigator.plugins.length : 0,
      webgl_vendor: null,
      webgl_renderer: null,
      canvas_fingerprint: null
    };

    try {
      fingerprint.timezone_name = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {}

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          fingerprint.webgl_vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          fingerprint.webgl_renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {}

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 200;
      canvas.height = 50;
      ctx.fillStyle = '#f60';
      ctx.fillRect(100, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.font = '14px Arial';
      ctx.fillText('fingerprint', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('fingerprint', 4, 17);
      const dataUrl = canvas.toDataURL();
      fingerprint.canvas_fingerprint = simpleHash(dataUrl);
    } catch (e) {}

    return fingerprint;
  }

  function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString(16);
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return (hash >>> 0).toString(16);
  }

  function createTrajectoryTracker() {
    let startTime = null;
    let lastTimestamp = null;
    let lastValue = null;
    const trajectory = [];
    const throttleMs = 50;

    return {
      start: function() {
        startTime = Date.now();
        lastTimestamp = null;
        lastValue = null;
        trajectory.length = 0;
      },

      record: function(value) {
        const now = Date.now();
        if (lastTimestamp === null || now - lastTimestamp >= throttleMs) {
          const timeDelta = lastTimestamp !== null ? now - lastTimestamp : 0;
          const delta = lastValue !== null ? value - lastValue : 0;
          const velocity = timeDelta > 0 ? delta / timeDelta : 0;

          trajectory.push({
            timestamp: now,
            value: value,
            delta: delta,
            velocity: velocity,
            time_delta_ms: timeDelta
          });

          lastTimestamp = now;
          lastValue = value;
        }
      },

      getData: function() {
        return trajectory.slice();
      }
    };
  }

  function createBehaviorTracker() {
    let startTime = null;
    let endTime = null;
    const events = [];
    let mouseDownCount = 0;
    let mouseMoveCount = 0;

    return {
      start: function() {
        startTime = Date.now();
        endTime = null;
        events.length = 0;
        mouseDownCount = 0;
        mouseMoveCount = 0;
      },

      recordEvent: function(type, x, y) {
        events.push({
          timestamp: Date.now(),
          type: type,
          x: x,
          y: y
        });
        if (type === 'mousedown' || type === 'touchstart') {
          mouseDownCount++;
        } else if (type === 'mousemove' || type === 'touchmove') {
          mouseMoveCount++;
        }
      },

      end: function() {
        endTime = Date.now();
      },

      getData: function() {
        const totalDurationMs = endTime !== null && startTime !== null ? endTime - startTime : 0;
        return {
          start_time: startTime,
          end_time: endTime,
          total_duration_ms: totalDurationMs,
          event_count: events.length,
          mouse_down_count: mouseDownCount,
          mouse_move_count: mouseMoveCount,
          events: events.slice()
        };
      }
    };
  }

  window.CaptchaFingerprint = {
    collectBrowserFingerprint: collectBrowserFingerprint,
    createTrajectoryTracker: createTrajectoryTracker,
    createBehaviorTracker: createBehaviorTracker
  };
})();
