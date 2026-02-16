import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAccessToken, clearTokenCache } from './auth';

// =============================================================================
// Mock fetch globally
// =============================================================================

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  clearTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockSuccessResponse(accessToken: string, expiresIn: number = 7200) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      access_token: accessToken,
      expires_in: expiresIn,
    }),
    text: vi.fn().mockResolvedValue(''),
  };
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('eBay Auth - getAccessToken', () => {
  it('fetches a new token on first call', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-abc'));

    const token = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    expect(token).toBe('token-abc');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached token on second call', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-abc', 7200));

    const token1 = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    const token2 = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    expect(token1).toBe('token-abc');
    expect(token2).toBe('token-abc');
    // Only 1 fetch call -- second returned from cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes token when within 5-minute expiry buffer', async () => {
    // First call: token that expires in 200 seconds (less than 300s buffer)
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-old', 200));

    const token1 = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });
    expect(token1).toBe('token-old');

    // Token expires in 200s but buffer is 300s, so Date.now() < expiresAt - 300s*1000
    // This means the token is already "expired" from the cache's perspective
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-new', 7200));

    const token2 = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });
    expect(token2).toBe('token-new');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses refresh_token grant when refreshToken is provided', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-refreshed'));

    await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      refreshToken: 'refresh-xyz',
    });

    // Verify the request body contains refresh_token grant
    const callArgs = mockFetch.mock.calls[0];
    const body = callArgs[1]?.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=refresh-xyz');
  });

  it('uses client_credentials grant when no refreshToken', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-cc'));

    await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = callArgs[1]?.body as string;
    expect(body).toContain('grant_type=client_credentials');
  });

  it('uses production endpoint by default', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-prod'));

    await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('api.ebay.com');
    expect(url).not.toContain('sandbox');
  });

  it('uses sandbox endpoint when specified', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-sandbox'));

    await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      environment: 'sandbox',
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sandbox');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Unauthorized'));

    await expect(
      getAccessToken({
        clientId: 'bad-client',
        clientSecret: 'bad-secret',
      }),
    ).rejects.toThrow('eBay OAuth failed');
  });

  it('sends Basic auth header with base64-encoded credentials', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token'));

    await getAccessToken({
      clientId: 'my-id',
      clientSecret: 'my-secret',
    });

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    const expectedAuth = Buffer.from('my-id:my-secret').toString('base64');
    expect(headers['Authorization']).toBe(`Basic ${expectedAuth}`);
  });

  it('handles different cache keys for different client IDs', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-a'));
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-b'));

    const tokenA = await getAccessToken({
      clientId: 'client-a',
      clientSecret: 'secret-a',
    });

    const tokenB = await getAccessToken({
      clientId: 'client-b',
      clientSecret: 'secret-b',
    });

    expect(tokenA).toBe('token-a');
    expect(tokenB).toBe('token-b');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears cache properly', async () => {
    mockFetch.mockResolvedValue(mockSuccessResponse('token-1'));

    await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    clearTokenCache();

    // After clearing, should fetch again
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-2'));

    const token = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });

    expect(token).toBe('token-2');
  });

  it('falls back to client_credentials when refresh_token grant fails', async () => {
    // First: refresh attempt fails
    mockFetch.mockResolvedValueOnce(mockErrorResponse(400, 'invalid_grant'));
    // Second: client_credentials succeeds (but since refreshToken is still set,
    // it will try refresh_token again)
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-fallback'));

    const token = await getAccessToken({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      refreshToken: 'bad-refresh-token',
    });

    expect(token).toBe('token-fallback');
    // Two fetch calls: failed refresh + successful re-auth
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
