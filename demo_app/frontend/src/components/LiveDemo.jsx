import { useState, useEffect, useRef } from 'react';

export default function LiveDemo({ siteKey, onNavigateToOwner }) {
  const [solved, setSolved] = useState(false);
  const [reward, setReward] = useState(null);
  const captchaRef = useRef(null);

  useEffect(() => {
    window.onCaptchaSolved = () => {
      setReward('0.0050');
      setSolved(true);
    };
    return () => { delete window.onCaptchaSolved; };
  }, []);

  useEffect(() => {
    if (solved || !captchaRef.current) return;

    const el = captchaRef.current;
    el.innerHTML = '';

    const container = document.createElement('div');
    container.id = 'demo-captcha-' + Date.now();
    el.appendChild(container);

    const captchaType = Math.random() < 0.5 ? 'video' : 'image';

    const script = document.createElement('script');
    script.src = '/static/captcha-widget.js?t=' + Date.now();
    script.setAttribute('data-captcha-container', container.id);
    script.setAttribute('data-site-key', siteKey || 'demo');
    script.setAttribute('data-api-url', window.location.origin);
    script.setAttribute('data-on-success', 'onCaptchaSolved');
    script.setAttribute('data-captcha-type', captchaType);
    el.appendChild(script);
  }, [solved, siteKey]);

  const handleRetry = () => {
    setSolved(false);
    setReward(null);
  };

  return (
    <div className="demo-section">
      <div className="demo-header">
        <h1>Live Demo</h1>
        <p className="demo-subtitle">This simulates what a user sees on a website using SOLved</p>
      </div>

      <div className="demo-container">
        <div className="demo-glass-wrapper" style={{ display: solved ? 'none' : undefined }}>
          <div ref={captchaRef} className="captcha-area" />
        </div>

        {solved && (
          <div className="solved-state">
            <div className="solved-glass-card">
              <div className="solved-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2>Verified</h2>
              <p className="solved-reward">+{reward} SOL sent to the owner</p>
              <p>Check out the owner page and your balance.</p>
              <div className="solved-buttons">
                <button className="btn-glass" onClick={handleRetry}>
                  Try Again
                </button>
                <button className="btn-glass btn-glow" onClick={onNavigateToOwner}>
                  View Owner Page
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
