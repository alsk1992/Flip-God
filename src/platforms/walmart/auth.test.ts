import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWalmartMarketplaceToken, clearWalmartMarketplaceTokenCache } from './auth';

// =============================================================================
// Mock fetch globally
// =============================================================================

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  clearWalmartMarketplaceTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockSuccessResponse(accessToken: string, expiresIn: number = 900) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      access_token: accessToken,
      token_type: 'Bearer',
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

describe('Walmart Auth - getWalmartMarketplaceToken', () => {
  it('fetches a new token on first call', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('walmart-token-1'));

    const token = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    expect(token).toBe('walmart-token-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached token on second call', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('walmart-token-1', 900));

    const token1 = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    const token2 = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    expect(token1).toBe('walmart-token-1');
    expect(token2).toBe('walmart-token-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-requests token when within 30-second expiry buffer', async () => {
    // Token expires in 20 seconds (less than 30s buffer)
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('old-token', 20));

    const token1 = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });
    expect(token1).toBe('old-token');

    // Token is within buffer, so should re-request
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('new-token', 900));

    const token2 = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });
    expect(token2).toBe('new-token');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends correct headers', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token'));

    await getWalmartMarketplaceToken({
      clientId: 'my-wm-id',
      clientSecret: 'my-wm-secret',
    });

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;

    // Basic auth
    const expectedAuth = Buffer.from('my-wm-id:my-wm-secret').toString('base64');
    expect(headers['Authorization']).toBe(`Basic ${expectedAuth}`);

    // Content type
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Walmart-specific headers
    expect(headers['WM_SVC.NAME']).toBe('Walmart Marketplace');
    expect(headers['WM_QOS.CORRELATION_ID']).toBeDefined();
    expect(headers['Accept']).toBe('application/json');
  });

  it('sends client_credentials grant type in body', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token'));

    await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    const body = mockFetch.mock.calls[0][1]?.body as string;
    expect(body).toBe('grant_type=client_credentials');
  });

  it('calls the correct Walmart token URL', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token'));

    await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe('https://marketplace.walmartapis.com/v3/token');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(401, 'Invalid credentials'));

    await expect(
      getWalmartMarketplaceToken({
        clientId: 'bad-client',
        clientSecret: 'bad-secret',
      }),
    ).rejects.toThrow('Walmart Marketplace OAuth failed');
  });

  it('uses separate cache keys for different client IDs', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-a'));
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-b'));

    const tokenA = await getWalmartMarketplaceToken({
      clientId: 'client-a',
      clientSecret: 'secret-a',
    });

    const tokenB = await getWalmartMarketplaceToken({
      clientId: 'client-b',
      clientSecret: 'secret-b',
    });

    expect(tokenA).toBe('token-a');
    expect(tokenB).toBe('token-b');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('clears cache properly', async () => {
    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-1'));

    await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    clearWalmartMarketplaceTokenCache();

    mockFetch.mockResolvedValueOnce(mockSuccessResponse('token-2'));

    const token = await getWalmartMarketplaceToken({
      clientId: 'wm-client',
      clientSecret: 'wm-secret',
    });

    expect(token).toBe('token-2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
