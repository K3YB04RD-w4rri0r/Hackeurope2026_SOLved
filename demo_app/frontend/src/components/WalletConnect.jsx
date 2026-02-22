import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useEffect, useState } from 'react';
import { getBalance, truncateAddress } from '../utils/solana';
import bs58 from 'bs58';

export default function WalletConnect({ onSiteKey, onSigned }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState(null);
  const [signed, setSigned] = useState(false);
  const [signing, setSigning] = useState(false);
  const [siteKey, setSiteKey] = useState(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalance(null);
      setSigned(false);
      setSiteKey(null);
      if (onSiteKey) onSiteKey(null);
      if (onSigned) onSigned(false);
      return;
    }

    const fetchBalance = async () => {
      try {
        const bal = await getBalance(publicKey);
        setBalance(bal);
      } catch (e) {
        console.error('Failed to fetch balance:', e);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [connected, publicKey]);

  const handleSign = async () => {
    if (!signMessage || !publicKey) return;
    setSigning(true);
    try {
      const messageText = 'Sign in to SOLved';
      const messageBytes = new TextEncoder().encode(messageText);
      const signatureBytes = await signMessage(messageBytes);

      const resp = await fetch('/api/auth/verify-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          signature: bs58.encode(signatureBytes),
          message: messageText,
        }),
      });
      const data = await resp.json();

      if (data.success) {
        setSigned(true);
        if (onSigned) onSigned(true);
        await registerPublisher();
      } else {
        console.error('Wallet verification failed:', data.error);
      }
    } catch (e) {
      console.error('Signing failed:', e);
    }
    setSigning(false);
  };

  const registerPublisher = async () => {
    if (!publicKey) return;
    setRegistering(true);
    try {
      const resp = await fetch('/api/publisher/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          site_url: window.location.origin,
          site_name: 'Demo Owner',
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setSiteKey(data.site_key);
        if (onSiteKey) onSiteKey(data.site_key);
      }
    } catch (e) {
      console.error('Registration failed:', e);
    }
    setRegistering(false);
  };

  // Not connected yet — just the connect button
  if (!connected || !publicKey) {
    return (
      <div className="wallet-connect-inner">
        <div className="wallet-button-wrapper">
          <WalletMultiButton />
        </div>
      </div>
    );
  }

  // Connected but not signed — show wallet card + sign button
  if (!signed) {
    return (
      <div className="wallet-connect-inner">
        <div className="wallet-card">
          <div className="wallet-card-top">
            <div className="wallet-card-addr">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a1 1 0 0 0 0 4h4v-4h-4z"/></svg>
              <span className="mono">{truncateAddress(publicKey)}</span>
            </div>
            <span className="badge badge-green">Devnet</span>
          </div>
          <div className="wallet-card-balance">
            <span className="wallet-card-bal-value">{balance !== null ? balance.toFixed(4) : '...'}</span>
            <span className="wallet-card-bal-unit">SOL</span>
          </div>
        </div>
        <button
          className="btn-primary btn-full"
          onClick={handleSign}
          disabled={signing}
        >
          {signing ? 'Signing...' : 'Sign In to SOLved'}
        </button>
      </div>
    );
  }

  // Signed — compact success
  return (
    <div className="wallet-connect-inner">
      <div className="wallet-card wallet-card-signed">
        <div className="wallet-card-top">
          <div className="wallet-card-addr">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span className="mono">{truncateAddress(publicKey)}</span>
          </div>
          <span className="badge badge-green">Devnet</span>
        </div>
        <div className="wallet-card-balance">
          <span className="wallet-card-bal-value">{balance !== null ? balance.toFixed(4) : '...'}</span>
          <span className="wallet-card-bal-unit">SOL</span>
        </div>
      </div>
    </div>
  );
}
