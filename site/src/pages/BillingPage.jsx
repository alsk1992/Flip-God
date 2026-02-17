import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

const FEATURE_TABLE = [
  { feature: 'Basic scanning', free: true, tokenHolder: true },
  { feature: 'Cross-platform compare', free: '3 platforms', tokenHolder: 'All 15+' },
  { feature: 'Auto-scout pipeline', free: false, tokenHolder: true },
  { feature: 'Smart repricing', free: 'Manual', tokenHolder: 'Automated' },
  { feature: 'Fulfillment automation', free: 'Manual', tokenHolder: 'Full auto' },
  { feature: 'AI listing optimization', free: false, tokenHolder: true },
  { feature: 'Demand scoring', free: 'Basic', tokenHolder: 'Full 6-signal' },
  { feature: 'Restriction checker', free: false, tokenHolder: true },
];

export default function BillingPage() {
  const { user, logout } = useAuth();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const usageData = await api.getUsage();
        setUsage(usageData);
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-xl font-bold text-green-400">FlipGod</Link>
          <span className="text-gray-500">|</span>
          <span className="text-gray-400">Billing</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-gray-400 hover:text-white">Dashboard</Link>
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button onClick={logout} className="text-sm text-red-400 hover:text-red-300">Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Current Plan */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
          <div>
            <h2 className="text-lg font-semibold">Token Holder Access</h2>
            <p className="text-sm text-gray-400 mt-1">
              Hold the FlipGod token on Solana to unlock all premium features for free.
            </p>
            <p className="text-xs text-purple-400 mt-1">
              No subscriptions, no fees — just hold the token.
            </p>
          </div>
        </div>

        {/* Usage This Month */}
        {usage && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-sm text-gray-400">GMV This Month</p>
              <p className="text-2xl font-bold text-white mt-1">${usage.totalGmvDollars}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-sm text-gray-400">Sales</p>
              <p className="text-2xl font-bold text-white mt-1">{usage.eventCount}</p>
            </div>
          </div>
        )}

        {/* Feature Comparison */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Feature Comparison</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2">Feature</th>
                <th className="text-center py-2">Free</th>
                <th className="text-center py-2">Token Holder</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_TABLE.map(({ feature, free, tokenHolder }) => (
                <tr key={feature} className="border-b border-gray-800/50">
                  <td className="py-2.5 text-gray-300">{feature}</td>
                  <td className="text-center py-2.5">
                    {free === true ? (
                      <span className="text-green-400">&#10003;</span>
                    ) : free === false ? (
                      <span className="text-gray-600">&#10007;</span>
                    ) : (
                      <span className="text-gray-400">{free}</span>
                    )}
                  </td>
                  <td className="text-center py-2.5">
                    {tokenHolder === true ? (
                      <span className="text-purple-400">&#10003;</span>
                    ) : (
                      <span className="text-purple-400">{tokenHolder}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            Link your Solana wallet on the Dashboard page.
          </p>
        </div>
      </main>
    </div>
  );
}
