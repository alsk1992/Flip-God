/**
 * Wallet routes — link/unlink Solana wallet for token-gated access
 */
import { Router, Request, Response } from 'express';
import type { SolanaTokenGate } from '../billing/solana';
import type { Db } from '../db';

export function createWalletRoutes(tokenGate: SolanaTokenGate, db: Db): Router {
  const router = Router();

  // GET /wallet — Get linked wallet info + token balance
  router.get('/', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    const user = await db.queryOne<{
      solana_wallet: string | null;
      token_balance: number | null;
      token_verified_at: string | null;
      plan: string;
    }>(
      'SELECT solana_wallet, token_balance, token_verified_at, plan FROM billing_users WHERE id = $1',
      [userId],
    );

    if (!user?.solana_wallet) {
      res.json({
        linked: false,
        message: tokenGate.generateLinkMessage(userId),
      });
      return;
    }

    // Refresh balance
    const balance = await tokenGate.checkBalance(user.solana_wallet);
    const effectivePlan = await tokenGate.getEffectivePlan(userId);

    res.json({
      linked: true,
      wallet: user.solana_wallet,
      tokenBalance: balance,
      isTokenHolder: effectivePlan.source === 'token',
      plan: effectivePlan.plan,
      planSource: effectivePlan.source,
      verifiedAt: user.token_verified_at,
    });
  });

  // POST /wallet/link — Link wallet with signed message
  router.post('/link', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    const { walletAddress, message, signature } = req.body as {
      walletAddress?: string;
      message?: string;
      signature?: string;
    };

    if (!walletAddress || !message || !signature) {
      res.status(400).json({ error: 'walletAddress, message, and signature are required' });
      return;
    }

    try {
      await tokenGate.linkWallet(userId, walletAddress, message, signature);
      const effectivePlan = await tokenGate.getEffectivePlan(userId);

      res.json({
        linked: true,
        wallet: walletAddress,
        plan: effectivePlan.plan,
        planSource: effectivePlan.source,
        tokenBalance: effectivePlan.tokenBalance,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to link wallet' });
    }
  });

  // POST /wallet/unlink — Unlink wallet
  router.post('/unlink', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    try {
      await tokenGate.unlinkWallet(userId);
      res.json({ linked: false });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to unlink wallet' });
    }
  });

  // GET /wallet/message — Get the message to sign for linking
  router.get('/message', (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    res.json({ message: tokenGate.generateLinkMessage(userId) });
  });

  // POST /wallet/refresh — Force-refresh token balance
  router.post('/refresh', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    const user = await db.queryOne<{ solana_wallet: string | null }>(
      'SELECT solana_wallet FROM billing_users WHERE id = $1',
      [userId],
    );

    if (!user?.solana_wallet) {
      res.status(400).json({ error: 'No wallet linked' });
      return;
    }

    const effectivePlan = await tokenGate.getEffectivePlan(userId);
    res.json({
      wallet: user.solana_wallet,
      tokenBalance: effectivePlan.tokenBalance,
      plan: effectivePlan.plan,
      planSource: effectivePlan.source,
    });
  });

  return router;
}
