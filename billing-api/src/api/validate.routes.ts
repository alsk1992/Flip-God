/**
 * Validate route — API key validation (hot path, <50ms target)
 *
 * Called by self-hosted agents on startup and periodically.
 * The requireApiKey middleware handles caching and validation.
 */
import { Router, Request, Response } from 'express';

export function createValidateRoutes(): Router {
  const router = Router();

  // POST /validate — validate API key and return plan level
  router.post('/', (req: Request, res: Response) => {
    // If we reach here, requireApiKey middleware already validated the key
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const plan = (req as unknown as Record<string, unknown>).userPlan as string;
    const planSource = (req as unknown as Record<string, unknown>).userPlanSource as string | undefined;

    res.json({
      valid: true,
      plan,
      userId,
      tokenHolder: planSource === 'token',
    });
  });

  return router;
}
