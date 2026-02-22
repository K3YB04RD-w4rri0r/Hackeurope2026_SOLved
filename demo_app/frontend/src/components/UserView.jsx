import { useState, useEffect, useRef } from 'react';

export default function UserView() {
  const [solved, setSolved] = useState(false);
  const captchaRef = useRef(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    window.onCaptchaSolved = () => {
      setSolved(true);
    };

    if (captchaRef.current && !scriptLoaded.current) {
      scriptLoaded.current = true;

      captchaRef.current.innerHTML = '';
      const container = document.createElement('div');
      container.id = 'demo-captcha';
      captchaRef.current.appendChild(container);

      const script = document.createElement('script');
      script.src = '/static/captcha-widget.js';
      script.setAttribute('data-captcha-container', 'demo-captcha');
      script.setAttribute('data-site-key', 'DEMO_SITE_KEY');
      script.setAttribute('data-on-success', 'onCaptchaSolved');
      captchaRef.current.appendChild(script);
    }

    return () => {
      delete window.onCaptchaSolved;
    };
  }, []);

  const handleReset = () => {
    setSolved(false);
    scriptLoaded.current = false;

    if (captchaRef.current) {
      captchaRef.current.innerHTML = '';
      const container = document.createElement('div');
      container.id = 'demo-captcha';
      captchaRef.current.appendChild(container);

      const script = document.createElement('script');
      script.src = '/static/captcha-widget.js?t=' + Date.now();
      script.setAttribute('data-captcha-container', 'demo-captcha');
      script.setAttribute('data-site-key', 'DEMO_SITE_KEY');
      script.setAttribute('data-on-success', 'onCaptchaSolved');
      captchaRef.current.appendChild(script);
      scriptLoaded.current = true;
    }
  };

  return (
    <div className="demo-view">
      <div className="section-header">
        <div className="section-eyebrow">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Live Demo
        </div>
        <h1 className="section-title">See It In Action</h1>
        <p className="section-desc">
          Experience Ad-CAPTCHA as an end user would see it on a publisher's website.
        </p>
      </div>

      <div className="browser-frame">
        <div className="browser-chrome">
          <div className="browser-dots">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="browser-url">
            <svg className="url-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span className="url-text">https://examplesite.com/premium</span>
          </div>
          <div className="browser-actions" />
        </div>

        <div className="browser-content">
          <div className="site-header">
            <div className="site-logo">ExampleSite.com</div>
            <nav className="site-nav">
              <span>Home</span>
              <span>About</span>
              <span>Contact</span>
            </nav>
          </div>

          <div className="site-content">
            {!solved ? (
              <div className="captcha-gate">
                <div style={{ marginBottom: '1.5rem' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--purple-light)', opacity: 0.7 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <h2>Verify you are human</h2>
                <p>Complete the ad-powered CAPTCHA below to access premium content.</p>
                <div className="captcha-wrapper" ref={captchaRef}></div>
              </div>
            ) : (
              <div className="access-granted">
                <div className="granted-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h2>Access Granted</h2>
                <p>You've been verified. The publisher just earned SOL for this solve.</p>
                <div className="page-content">
                  <h3>Premium Content Unlocked</h3>
                  <p>
                    This is the protected content that was behind the CAPTCHA wall.
                    The publisher earns SOL each time a user verifies through Ad-CAPTCHA.
                  </p>
                  <div className="content-cards">
                    <div className="content-card">
                      <h4>Exclusive Report</h4>
                      <p>Market analysis and insights available only to verified users.</p>
                    </div>
                    <div className="content-card">
                      <h4>Members Area</h4>
                      <p>Premium tools and resources unlocked after verification.</p>
                    </div>
                  </div>
                </div>
                <button className="reset-btn" onClick={handleReset}>
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Behind the scenes */}
      <div className="demo-info">
        <div className="demo-info-card">
          <div className="demo-info-num">1</div>
          <div>
            <h4>Ad Served</h4>
            <p>Sponsored content is displayed as the CAPTCHA puzzle image.</p>
          </div>
        </div>
        <div className="demo-info-card">
          <div className="demo-info-num">2</div>
          <div>
            <h4>User Verifies</h4>
            <p>Human solves the puzzle — bot protection and ad engagement in one.</p>
          </div>
        </div>
        <div className="demo-info-card">
          <div className="demo-info-num">3</div>
          <div>
            <h4>SOL Earned</h4>
            <p>Publisher gets instant micropayment via Solana smart contract.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
