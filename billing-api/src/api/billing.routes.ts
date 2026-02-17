/**
 * Billing routes — usage stats (analytics only, no Stripe)
 */
import { Router, Request, Response } from 'express';
import type { UsageService } from '../billing/usage';

export function createBillingRoutes(usageService: UsageService): Router {
  const router = Router();

  // GET /billing/usage — Usage stats for current period
  router.get('/usage', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    try {
      const stats = await usageService.getUsageStats(userId);
      res.json({
        period: 'current_month',
        totalGmvCents: stats.totalGmvCents,
        totalGmvDollars: (stats.totalGmvCents / 100).toFixed(2),
        eventCount: stats.eventCount,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch usage stats' });
    }
  });

  return router;
}
