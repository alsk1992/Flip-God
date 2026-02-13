/**
 * Monitoring & Alerting - health checks + error notifications.
 *
 * This module provides:
 * - Prometheus-compatible metrics (metrics.ts)
 * - Health check endpoints (health.ts)
 * - Alert thresholds and webhooks (alerts.ts)
 */

// Re-export monitoring modules
export * from './metrics';
export * from './health';
export * from './alerts';
