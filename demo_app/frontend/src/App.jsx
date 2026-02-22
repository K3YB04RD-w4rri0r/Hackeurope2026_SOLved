import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { SOLANA_ENDPOINT } from './utils/solana';
import ViewToggle from './components/ViewToggle';
import PublisherDashboard from './components/PublisherDashboard';
import LiveDemo from './components/LiveDemo';
import '@solana/wallet-adapter-react-ui/styles.css';
import './App.css';

export default function App() {
  const [activeView, setActiveView] = useState('publisher');
  const [siteKey, setSiteKey] = useState(null);
  const [ownerSigned, setOwnerSigned] = useState(false);
  const [ownerStep, setOwnerStep] = useState(0);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  const mainRef = useRef(null);
  const tracksRef = useRef(null);
  const [tracksVisible, setTracksVisible] = useState(false);

  // Fade main content out as user scrolls toward the tracks section
  useEffect(() => {
    const onScroll = () => {
      const main = mainRef.current;
      const tracks = tracksRef.current;
      if (!main || !tracks) return;

      const tracksTop = tracks.getBoundingClientRect().top;
      const windowH = window.innerHeight;

      const fadeStart = windowH * 0.5;
      const fadeEnd = windowH * 0.1;
      const t = Math.max(0, Math.min(1, (fadeStart - tracksTop) / (fadeStart - fadeEnd)));

      if (t <= 0) {
        main.style.opacity = '';
        main.style.transform = '';
        main.style.filter = '';
      } else {
        main.style.opacity = String(1 - t * 0.85);
        main.style.transform = `scale(${1 - t * 0.04})`;
        main.style.filter = `blur(${t * 4}px)`;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // IntersectionObserver for staggered card reveal
  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTracksVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <ConnectionProvider endpoint={SOLANA_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="app">
            <div className="ambient-glow">
              <div className="ambient-blob-3" />
            </div>

            <nav className="navbar">
              <div className="nav-brand">
                <div className="nav-logo-icon">
                  <img src="/logo.png" alt="SOLved" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                </div>
                <span className="nav-logo-text">
                  <span className="nav-logo-sol">SOL</span>ved
                </span>
              </div>

              <ViewToggle activeView={activeView} onToggle={setActiveView} />

              <div className="nav-right">
                <div className="nav-badge">
                  <span className="nav-badge-dot" />
                  Devnet
                </div>
              </div>
            </nav>

            <main className="main" ref={mainRef}>
              {activeView === 'publisher' && (
                <PublisherDashboard
                  onSiteKey={setSiteKey}
                  siteKey={siteKey}
                  signed={ownerSigned}
                  onSigned={setOwnerSigned}
                  activeStep={ownerStep}
                  onActiveStep={setOwnerStep}
                />
              )}
              {activeView === 'demo' && (
                <LiveDemo
                  siteKey={siteKey}
                  onNavigateToOwner={() => setActiveView('publisher')}
                />
              )}
              <div className="scroll-hint" onClick={() => tracksRef.current?.scrollIntoView({ behavior: 'smooth' })}>
                <span>Scroll to explore</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </main>

            {/* Hackathon track cards */}
            <section
              ref={tracksRef}
              className={`tracks-section ${tracksVisible ? 'visible' : ''}`}
            >
              <h2 className="tracks-heading">Built for Three Challenges</h2>
              <p className="tracks-sub">SOLved was designed to address multiple hackathon tracks in a single product</p>

              <div className="tracks-grid">
                <div className="track-card" style={{ transitionDelay: '0ms' }}>
                  <div className="track-icon track-icon-security">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                  <div className="track-label">Security Track</div>
                  <h3 className="track-title">Anti-Bot Defence</h3>
                  <p className="track-desc">
                    A multi-layered CAPTCHA combining jigsaw puzzles, video challenges, browser fingerprinting,
                    trajectory analysis, and memory-hard proof-of-work to stop bots while keeping humans flowing.
                  </p>
                  <div className="track-tags">
                    <span className="track-tag">Proof-of-Work</span>
                    <span className="track-tag">Fingerprinting</span>
                    <span className="track-tag">Behavior Analysis</span>
                  </div>
                </div>

                <div className="track-card track-card-accent" style={{ transitionDelay: '140ms' }}>
                  <div className="track-icon track-icon-solana">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/>
                    </svg>
                  </div>
                  <div className="track-label">Best Built on Solana</div>
                  <h3 className="track-title">On-Chain Micropayments</h3>
                  <p className="track-desc">
                    Every CAPTCHA solve triggers a SOL micropayment to the website owner.
                    Wallet-based sign-up, ed25519 signature auth, and instant transfers on Solana devnet.
                  </p>
                  <div className="track-tags">
                    <span className="track-tag">Solana</span>
                    <span className="track-tag">Phantom Wallet</span>
                    <span className="track-tag">Micropayments</span>
                  </div>
                </div>

                <div className="track-card" style={{ transitionDelay: '280ms' }}>
                  <div className="track-icon track-icon-data">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
                      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
                    </svg>
                  </div>
                  <div className="track-label">Best Use of Data</div>
                  <h3 className="track-title">Ad-Funded Revenue</h3>
                  <p className="track-desc">
                    Captchas double as ad impressions — brands sponsor the puzzles, funding the SOL rewards.
                    Real-time analytics track solves, earnings, and conversion for publishers.
                  </p>
                  <div className="track-tags">
                    <span className="track-tag">Ad Impressions</span>
                    <span className="track-tag">Analytics</span>
                    <span className="track-tag">Publisher Dashboard</span>
                  </div>
                </div>
              </div>
            </section>

            <footer className="footer">
              <span className="footer-brand">
                <span className="nav-logo-sol">SOL</span>ved
              </span>
              <span className="footer-sep">{'\u2014'}</span>
              <span>Built on Solana</span>
              <span className="footer-sep">{'\u2014'}</span>
              <span>HackEurope 2026</span>
            </footer>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
