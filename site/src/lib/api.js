/**
 * Fetch client for billing API at compute.flip-god.com
 */

const API_BASE = import.meta.env.VITE_API_URL || 'https://compute.flip-god.com';

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE;
  }

  getAccessToken() {
    return localStorage.getItem('fg_access_token');
  }

  setTokens(accessToken, refreshToken) {
    localStorage.setItem('fg_access_token', accessToken);
    localStorage.setItem('fg_refresh_token', refreshToken);
  }

  clearTokens() {
    localStorage.removeItem('fg_access_token');
    localStorage.removeItem('fg_refresh_token');
  }

  async fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });

    // Auto-refresh on 401
    if (res.status === 401 && !options._retried) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        return this.fetch(path, { ...options, _retried: true });
      }
      this.clearTokens();
      window.dispatchEvent(new Event('auth:logout'));
      throw new Error('Session expired');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  async refreshToken() {
    const refreshToken = localStorage.getItem('fg_refresh_token');
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  // --- Auth ---
  async register(email, password, displayName) {
    const data = await this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
    this.setTokens(data.tokens.accessToken, data.tokens.refreshToken);
    return data;
  }

  async login(email, password) {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setTokens(data.tokens.accessToken, data.tokens.refreshToken);
    return data;
  }

  logout() {
    this.clearTokens();
    window.dispatchEvent(new Event('auth:logout'));
  }

  // --- API Keys ---
  async createKey(name) {
    return this.fetch('/keys', { method: 'POST', body: JSON.stringify({ name }) });
  }

  async listKeys() {
    return this.fetch('/keys');
  }

  async revokeKey(id) {
    return this.fetch(`/keys/${id}`, { method: 'DELETE' });
  }

  async rotateKey(id) {
    return this.fetch(`/keys/${id}/rotate`, { method: 'POST' });
  }

  // --- Usage ---
  async getUsage() {
    return this.fetch('/billing/usage');
  }

  // --- Wallet (Solana token gate) ---
  async getWallet() {
    return this.fetch('/wallet');
  }

  async linkWallet(walletAddress, message, signature) {
    return this.fetch('/wallet/link', {
      method: 'POST',
      body: JSON.stringify({ walletAddress, message, signature }),
    });
  }

  async unlinkWallet() {
    return this.fetch('/wallet/unlink', { method: 'POST' });
  }

  async getWalletMessage() {
    return this.fetch('/wallet/message');
  }

  async refreshWalletBalance() {
    return this.fetch('/wallet/refresh', { method: 'POST' });
  }
}

export const api = new ApiClient();
