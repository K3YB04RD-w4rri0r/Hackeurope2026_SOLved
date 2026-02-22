import { useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import StatsPanel from './StatsPanel';

export default function PublisherDashboard({ onSiteKey, siteKey, signed, onSigned, activeStep, onActiveStep }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const pendingSignRef = useRef(false);

  const signAndRegister = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    try {
      const messageText = 'Sign in to SOLved';
      const messageBytes = new TextEncoder().encode(messageText);
      const signatureBytes = await signMessage(messageBytes);

      const verifyResp = await fetch('/api/auth/verify-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          signature: bs58.encode(signatureBytes),
          message: messageText,
        }),
      });
      const verifyData = await verifyResp.json();
      if (!verifyData.success) return;

      onSigned(true);

      const regResp = await fetch('/api/publisher/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          site_url: window.location.origin,
          site_name: 'Demo Owner',
        }),
      });
      const regData = await regResp.json();
      if (regData.success && onSiteKey) {
        onSiteKey(regData.site_key);
      }

      onActiveStep(1);
    } catch (e) {
      console.error('Sign-up failed:', e);
    }
  }, [publicKey, signMessage, onSigned, onSiteKey, onActiveStep]);

  // Chain: wallet connects → auto-sign → register → go to dashboard
  useEffect(() => {
    if (!connected || !publicKey || !pendingSignRef.current) return;
    pendingSignRef.current = false;
    signAndRegister();
  }, [connected, publicKey, signAndRegister]);

  const handleSignUp = () => {
    if (connected && publicKey) {
      signAndRegister();
    } else {
      pendingSignRef.current = true;
      setVisible(true);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-content">
        {/* ── Sign Up (step 0) ── */}
        {activeStep === 0 && (
          <div className="onboarding">
            <div className="onboarding-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>
            </div>

            <h1 className="onboarding-title">Start earning SOL</h1>
            <p className="onboarding-sub">
              Connect your Phantom wallet to get started.
            </p>

            <button className="btn-primary" onClick={handleSignUp}>
              Sign Up
            </button>
          </div>
        )}

        {/* ── Dashboard (step 1) ── */}
        {activeStep === 1 && (
          <div className="dash-main">
            <h1 className="section-title">Dashboard</h1>
            {publicKey ? (
              <StatsPanel walletAddress={publicKey.toBase58()} />
            ) : (
              <div className="dash-block">
                <p className="dash-connect-msg">Connect your wallet to see your stats.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
