import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [keys, setKeys] = useState([]);
  const [usage, setUsage] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [keysData, usageData, walletData] = await Promise.all([
        api.listKeys(),
        api.getUsage(),
        api.getWallet().catch(() => null),
      ]);
      setKeys(keysData.keys || []);
      setUsage(usageData);
      setWallet(walletData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const data = await api.createKey(newKeyName || 'Default');
      setNewKey(data.key);
      setNewKeyName('');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (id) => {
    if (!confirm('Revoke this API key? Any agents using it will lose premium access.')) return;
    try {
      await api.revokeKey(id);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRotateKey = async (id) => {
    if (!confirm('Rotate this key? The old key will stop working immediately.')) return;
    try {
      const data = await api.rotateKey(id);
      setNewKey(data.key);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-xl font-bold text-green-400">FlipGod</Link>
          <span className="text-gray-500">|</span>
          <span className="text-gray-400">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/billing" className="text-sm text-gray-400 hover:text-white">Billing</Link>
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300">Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-300">x</button>
          </div>
        )}

        {/* Usage Stats */}
        {usage && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-sm text-gray-400">Total GMV This Month</p>
              <p className="text-2xl font-bold text-white mt-1">${usage.totalGmvDollars}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-sm text-gray-400">Sales This Month</p>
              <p className="text-2xl font-bold text-white mt-1">{usage.eventCount}</p>
            </div>
          </div>
        )}

        {/* New Key Alert */}
        {newKey && (
          <div className="mb-6 p-4 bg-green-900/30 border border-green-700 rounded-xl">
            <p className="text-sm font-medium text-green-400 mb-2">New API Key Created — save it now!</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-800 px-3 py-2 rounded font-mono text-sm text-white break-all">
                {newKey}
              </code>
              <button
                onClick={() => copyToClipboard(newKey)}
                className="px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium"
              >
                Copy
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">This key will not be shown again.</p>
            <button onClick={() => setNewKey(null)} className="text-xs text-gray-500 mt-1 hover:text-gray-300">
              Dismiss
            </button>
          </div>
        )}

        {/* API Keys */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">API Keys</h2>
            <span className="text-xs text-gray-500">{keys.filter(k => k.status === 'active').length}/5 active</span>
          </div>

          <form onSubmit={handleCreateKey} className="flex gap-2 mb-4">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production)"
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 rounded-lg text-sm font-medium"
            >
              {creating ? '...' : 'Create Key'}
            </button>
          </form>

          {keys.length === 0 ? (
            <p className="text-gray-500 text-sm">No API keys yet. Create one to get started.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                  <div>
                    <span className="text-sm font-medium">{key.name}</span>
                    <code className="ml-2 text-xs text-gray-400 font-mono">{key.prefix}...</code>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${key.status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                      {key.status}
                    </span>
                  </div>
                  {key.status === 'active' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRotateKey(key.id)}
                        className="text-xs text-yellow-400 hover:text-yellow-300"
                      >
                        Rotate
                      </button>
                      <button
                        onClick={() => handleRevokeKey(key.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Solana Wallet — Token Gate */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold">Token Holder Access</h2>
              <p className="text-xs text-gray-500 mt-1">
                Link your Solana wallet to get premium features for free
              </p>
            </div>
            {wallet?.linked && wallet.isTokenHolder && (
              <span className="px-2 py-1 bg-purple-900/50 text-purple-400 text-xs rounded-full font-medium">
                Token Holder — Premium Active
              </span>
            )}
          </div>

          {wallet?.linked ? (
            <div>
              <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg mb-3">
                <div>
                  <code className="text-sm font-mono text-white">
                    {wallet.wallet.slice(0, 6)}...{wallet.wallet.slice(-4)}
                  </code>
                  <span className="ml-2 text-xs text-gray-400">
                    Balance: {wallet.tokenBalance?.toLocaleString() ?? '0'} tokens
                  </span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${wallet.isTokenHolder ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                    {wallet.isTokenHolder ? 'Premium Active' : 'Below threshold'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setWalletLoading(true);
                      try {
                        const data = await api.refreshWalletBalance();
                        setWallet({ ...wallet, ...data, linked: true });
                      } catch (err) { setError(err.message); }
                      finally { setWalletLoading(false); }
                    }}
                    disabled={walletLoading}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Unlink wallet? You will lose token holder benefits.')) return;
                      try {
                        await api.unlinkWallet();
                        setWallet({ linked: false });
                        await loadData();
                      } catch (err) { setError(err.message); }
                    }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Unlink
                  </button>
                </div>
              </div>
              {!wallet.isTokenHolder && (
                <p className="text-xs text-yellow-400">
                  Your balance is below the minimum threshold. Acquire more tokens to unlock premium access.
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">
                Hold the FlipGod token on Solana to unlock all premium features for <strong className="text-purple-400">free</strong>.
                Connect your wallet to verify your holdings.
              </p>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-500 mb-2">Wallet connection available after token launch</p>
                <p className="text-xs text-gray-600">
                  Sign a verification message from your Solana wallet to link it to your FlipGod account.
                  No transaction required — just a signature to prove ownership.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Setup Guide */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">Quick Setup</h2>
          <p className="text-sm text-gray-400 mb-3">
            Add your API key to your FlipGod agent configuration:
          </p>
          <div className="bg-gray-800 rounded-lg p-4 font-mono text-sm">
            <p className="text-green-400"># In your .env file</p>
            <p className="text-white">FLIPGOD_API_KEY=fg_live_your_key_here</p>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Premium features activate automatically when your linked wallet holds the FlipGod token.
          </p>
        </div>
      </main>
    </div>
  );
}
