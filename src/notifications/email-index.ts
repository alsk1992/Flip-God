/**
 * Email Notification Tools - Tool definitions and handler for email delivery
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import { sendEmail, sendTestEmail, sendAlertEmail } from './email.js';
import type { EmailConfig } from './email.js';
import { renderDailyDigestEmail } from './email-templates.js';
import type { DigestData } from './email-templates.js';
import { getAlerts } from './alert-engine.js';

const logger = createLogger('email-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const emailTools = [
  {
    name: 'setup_email',
    description: 'Configure email notification delivery (SendGrid or Mailgun)',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string' as const, enum: ['sendgrid', 'mailgun'], description: 'Email provider to use' },
        api_key: { type: 'string' as const, description: 'API key for the email provider' },
        from_email: { type: 'string' as const, description: 'Sender email address' },
        from_name: { type: 'string' as const, description: 'Sender display name' },
        domain: { type: 'string' as const, description: 'Mailgun domain (required for Mailgun)' },
      },
      required: ['provider', 'api_key', 'from_email'] as const,
    },
  },
  {
    name: 'send_test_email',
    description: 'Send a test email to verify configuration',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const, description: 'Recipient email address' },
      },
      required: ['to'] as const,
    },
  },
  {
    name: 'send_daily_digest',
    description: 'Send a daily digest email with alerts summary',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string' as const, description: 'Recipient email' },
        include_orders: { type: 'boolean' as const, description: 'Include order stats (default: true)' },
        include_alerts: { type: 'boolean' as const, description: 'Include alerts summary (default: true)' },
        include_profit: { type: 'boolean' as const, description: 'Include profit stats (default: true)' },
      },
      required: ['to'] as const,
    },
  },
];

// =============================================================================
// HELPERS
// =============================================================================

function getEmailConfig(db: Database, userId: string): EmailConfig | null {
  try {
    const rows = db.query<Record<string, unknown>>(
      "SELECT encrypted_data FROM trading_credentials WHERE user_id = ? AND platform = 'email'",
      [userId],
    );
    if (rows.length === 0) return null;

    const data = JSON.parse(rows[0].encrypted_data as string) as Record<string, unknown>;
    return {
      provider: data.provider as 'sendgrid' | 'mailgun',
      apiKey: data.apiKey as string,
      fromEmail: data.fromEmail as string,
      fromName: (data.fromName as string) ?? undefined,
      domain: (data.domain as string) ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to read email config');
    return null;
  }
}

function saveEmailConfig(db: Database, userId: string, config: EmailConfig): void {
  const encrypted = JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    domain: config.domain,
  });

  const existing = db.query<Record<string, unknown>>(
    "SELECT user_id FROM trading_credentials WHERE user_id = ? AND platform = 'email'",
    [userId],
  );

  if (existing.length > 0) {
    db.run(
      "UPDATE trading_credentials SET encrypted_data = ?, updated_at = ? WHERE user_id = ? AND platform = 'email'",
      [encrypted, Date.now(), userId],
    );
  } else {
    db.run(
      "INSERT INTO trading_credentials (user_id, platform, mode, encrypted_data, enabled, failed_attempts, created_at, updated_at) VALUES (?, 'email', 'api_key', ?, 1, 0, ?, ?)",
      [userId, encrypted, Date.now(), Date.now()],
    );
  }
}

// =============================================================================
// TOOL HANDLER
// =============================================================================

export async function handleEmailTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'setup_email': {
      const provider = input.provider as 'sendgrid' | 'mailgun';
      const apiKey = input.api_key as string;
      const fromEmail = input.from_email as string;
      const fromName = (input.from_name as string) ?? undefined;
      const domain = (input.domain as string) ?? undefined;

      if (!provider || !apiKey || !fromEmail) {
        return { error: 'provider, api_key, and from_email are required' };
      }

      if (provider === 'mailgun' && !domain) {
        return { error: 'domain is required for Mailgun provider' };
      }

      const config: EmailConfig = { provider, apiKey, fromEmail, fromName, domain };
      saveEmailConfig(db, userId, config);

      logger.info({ userId, provider, fromEmail }, 'Email configuration saved');
      return {
        success: true,
        message: `Email configured with ${provider}. Use send_test_email to verify.`,
        provider,
        fromEmail,
      };
    }

    case 'send_test_email': {
      const to = input.to as string;
      if (!to) {
        return { error: 'Recipient email (to) is required' };
      }

      const config = getEmailConfig(db, userId);
      if (!config) {
        return { error: 'Email not configured. Use setup_email first.' };
      }

      const result = await sendTestEmail(config, to);
      return {
        success: result.success,
        provider: result.provider,
        messageId: result.messageId,
        error: result.error,
        message: result.success
          ? `Test email sent to ${to} via ${result.provider}`
          : `Failed to send test email: ${result.error}`,
      };
    }

    case 'send_daily_digest': {
      const to = input.to as string;
      if (!to) {
        return { error: 'Recipient email (to) is required' };
      }

      const config = getEmailConfig(db, userId);
      if (!config) {
        return { error: 'Email not configured. Use setup_email first.' };
      }

      const includeAlerts = input.include_alerts !== false;
      const includeOrders = input.include_orders !== false;
      const includeProfit = input.include_profit !== false;

      // Gather digest data
      const digestData: DigestData = {
        alerts: [],
      };

      if (includeAlerts) {
        digestData.alerts = getAlerts(db, userId, { limit: 100 });
      }

      if (includeOrders) {
        try {
          const orderRows = db.query<Record<string, unknown>>(
            "SELECT COUNT(*) as cnt FROM orders WHERE ordered_at > ?",
            [Date.now() - 86_400_000],
          );
          digestData.totalOrders = (orderRows[0]?.cnt as number) ?? 0;
        } catch {
          digestData.totalOrders = 0;
        }
      }

      if (includeProfit) {
        try {
          const profitRows = db.query<Record<string, unknown>>(
            "SELECT COALESCE(SUM(profit), 0) as total FROM orders WHERE profit IS NOT NULL AND ordered_at > ?",
            [Date.now() - 86_400_000],
          );
          const total = profitRows[0]?.total as number;
          digestData.totalProfit = Number.isFinite(total) ? total : 0;
        } catch {
          digestData.totalProfit = 0;
        }
      }

      try {
        const listingRows = db.query<Record<string, unknown>>(
          "SELECT COUNT(*) as cnt FROM listings WHERE status = 'active'",
        );
        digestData.activeListings = (listingRows[0]?.cnt as number) ?? 0;
      } catch {
        digestData.activeListings = 0;
      }

      const { subject, html } = renderDailyDigestEmail(digestData);
      const result = await sendEmail(config, { to, subject, html });

      return {
        success: result.success,
        message: result.success
          ? `Daily digest sent to ${to}`
          : `Failed to send digest: ${result.error}`,
        stats: {
          alerts: digestData.alerts.length,
          orders: digestData.totalOrders,
          profit: digestData.totalProfit,
          activeListings: digestData.activeListings,
        },
      };
    }

    default:
      return { error: `Unknown email tool: ${toolName}` };
  }
}
