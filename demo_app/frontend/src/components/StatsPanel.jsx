import { useState, useEffect, useCallback } from 'react';

function getTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const t = typeof timestamp === 'number' ? timestamp * 1000 : new Date(timestamp).getTime();
  const diff = Math.floor((now - t) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function StatsPanel({ walletAddress }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!walletAddress) {
      setStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/publisher/${walletAddress}/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Could not load stats.');
        setStats(null);
        return;
      }

      setStats({
        totalSolved: data.total_solves || 0,
        solEarned: (data.total_earned_lamports || 0) / 1_000_000_000,
        recentSolves: (data.recent_solves || []).map((s, i) => ({
          id: i,
          event: 'CAPTCHA solved',
          reward: `+${(s.reward_lamports / 1_000_000_000).toFixed(4)} SOL`,
          time: getTimeAgo(s.timestamp),
        })),
      });
    } catch {
      setError('Failed to connect to server.');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchStats();
    if (!walletAddress) return;
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats, walletAddress]);

  if (!walletAddress) {
    return (
      <div className="stats-section">
        <div className="stats-row stagger">
          <div className="stat-card">
            <div className="stat-icon stat-icon-solved">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">—</span>
              <span className="stat-label">CAPTCHAs Solved</span>
            </div>
          </div>
          <div className="stat-card stat-card-accent">
            <div className="stat-icon stat-icon-earned">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M12 18V6"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">— <small>SOL</small></span>
              <span className="stat-label">Total Earned</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon-active">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">—</span>
              <span className="stat-label">Active Today</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon-failed">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">—</span>
              <span className="stat-label">Failed Attempts</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon-suspicious">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div className="stat-info">
              <span className="stat-value">—</span>
              <span className="stat-label">Suspicious</span>
            </div>
          </div>
        </div>
        <div className="activity-section">
          <div className="activity-header">
            <h3>Recent Activity</h3>
          </div>
          <div className="activity-list">
            <div className="activity-row" style={{ justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              Connect your wallet to view stats
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-section">
      <div className="stats-row stagger">
        <div className="stat-card">
          <div className="stat-icon stat-icon-solved">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{loading && !stats ? '...' : (stats?.totalSolved ?? 0).toLocaleString()}</span>
            <span className="stat-label">CAPTCHAs Solved</span>
          </div>
        </div>

        <div className="stat-card stat-card-accent">
          <div className="stat-icon stat-icon-earned">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M12 18V6"/></svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{loading && !stats ? '...' : (stats?.solEarned ?? 0).toFixed(4)} <small>SOL</small></span>
            <span className="stat-label">Total Earned</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-active">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.recentSolves?.length ?? 0}</span>
            <span className="stat-label">Recent Solves</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-failed">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">47</span>
            <span className="stat-label">Failed Attempts</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-suspicious">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div className="stat-info">
            <span className="stat-value">12</span>
            <span className="stat-label">Suspicious</span>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <div className="activity-section">
        <div className="activity-header">
          <h3>Recent Activity</h3>
          {stats && !error && (
            <span className="live-indicator">
              <span className="live-dot" />
              Live
            </span>
          )}
        </div>
        <div className="activity-list">
          {(!stats || stats.recentSolves.length === 0) ? (
            <div className="activity-row" style={{ justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              {error ? 'Could not load activity' : 'No solves recorded yet'}
            </div>
          ) : (
            stats.recentSolves.map((item) => (
              <div key={item.id} className="activity-row">
                <div className="activity-dot" />
                <span className="activity-event">{item.event}</span>
                <span className="activity-reward">{item.reward}</span>
                <span className="activity-time">{item.time}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
