/**
 * Email Notification Delivery - SendGrid and Mailgun HTTP API integration
 *
 * Sends emails via HTTP APIs (no SMTP dependencies). SendGrid is primary,
 * Mailgun is fallback.
 */

import { createLogger } from '../utils/logger.js';
import type { Alert } from './types.js';
import { renderAlertEmail } from './email-templates.js';

const logger = createLogger('email-delivery');

// =============================================================================
// TYPES
// =============================================================================

export interface EmailConfig {
  provider: 'sendgrid' | 'mailgun';
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  /** Required for Mailgun */
  domain?: string;
}

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

// =============================================================================
// SENDGRID
// =============================================================================

async function sendViaSendGrid(config: EmailConfig, params: EmailParams): Promise<EmailResult> {
  const { apiKey, fromEmail, fromName } = config;
  const { to, subject, html, text } = params;

  const body = {
    personalizations: [
      {
        to: [{ email: to }],
      },
    ],
    from: {
      email: fromEmail,
      ...(fromName ? { name: fromName } : {}),
    },
    subject,
    content: [
      ...(text ? [{ type: 'text/plain', value: text }] : []),
      { type: 'text/html', value: html },
    ],
  };

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn({ status: response.status, to }, 'SendGrid delivery failed');
      return {
        success: false,
        provider: 'sendgrid',
        error: `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      };
    }

    const messageId = response.headers.get('x-message-id') ?? undefined;
    logger.info({ to, messageId }, 'Email sent via SendGrid');
    return { success: true, provider: 'sendgrid', messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, to }, 'SendGrid delivery error');
    return { success: false, provider: 'sendgrid', error: errorMsg };
  }
}

// =============================================================================
// MAILGUN
// =============================================================================

async function sendViaMailgun(config: EmailConfig, params: EmailParams): Promise<EmailResult> {
  const { apiKey, fromEmail, fromName, domain } = config;
  const { to, subject, html, text } = params;

  if (!domain) {
    return {
      success: false,
      provider: 'mailgun',
      error: 'Mailgun domain is required',
    };
  }

  const fromStr = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const formData = new URLSearchParams();
  formData.set('from', fromStr);
  formData.set('to', to);
  formData.set('subject', subject);
  formData.set('html', html);
  if (text) {
    formData.set('text', text);
  }

  const authToken = Buffer.from(`api:${apiKey}`).toString('base64');

  try {
    const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn({ status: response.status, to, domain }, 'Mailgun delivery failed');
      return {
        success: false,
        provider: 'mailgun',
        error: `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      };
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const messageId = (data.id as string) ?? undefined;
    logger.info({ to, messageId }, 'Email sent via Mailgun');
    return { success: true, provider: 'mailgun', messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, to, domain }, 'Mailgun delivery error');
    return { success: false, provider: 'mailgun', error: errorMsg };
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Send an email using the configured provider (SendGrid or Mailgun).
 */
export async function sendEmail(config: EmailConfig, params: EmailParams): Promise<EmailResult> {
  if (!config.apiKey) {
    return { success: false, provider: config.provider, error: 'API key is required' };
  }
  if (!config.fromEmail) {
    return { success: false, provider: config.provider, error: 'From email is required' };
  }
  if (!params.to) {
    return { success: false, provider: config.provider, error: 'Recipient email is required' };
  }
  if (!params.subject) {
    return { success: false, provider: config.provider, error: 'Subject is required' };
  }
  if (!params.html) {
    return { success: false, provider: config.provider, error: 'HTML body is required' };
  }

  switch (config.provider) {
    case 'sendgrid':
      return sendViaSendGrid(config, params);
    case 'mailgun':
      return sendViaMailgun(config, params);
    default:
      return {
        success: false,
        provider: String(config.provider),
        error: `Unknown email provider: ${String(config.provider)}`,
      };
  }
}

/**
 * Send an alert as an email.
 */
export async function sendAlertEmail(config: EmailConfig, alert: Alert, to: string): Promise<EmailResult> {
  const { subject, html } = renderAlertEmail(alert);
  return sendEmail(config, { to, subject, html });
}

/**
 * Send a test email to verify configuration.
 */
export async function sendTestEmail(config: EmailConfig, to: string): Promise<EmailResult> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a73e8;">FlipAgent Email Test</h2>
      <p>This is a test email from FlipAgent to verify your email notification configuration.</p>
      <div style="background: #f0f7ff; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0;"><strong>Provider:</strong> ${config.provider}</p>
        <p style="margin: 4px 0 0;"><strong>From:</strong> ${config.fromName ?? ''} &lt;${config.fromEmail}&gt;</p>
        <p style="margin: 4px 0 0;"><strong>Time:</strong> ${new Date().toISOString()}</p>
      </div>
      <p style="color: #666; font-size: 14px;">If you received this email, your configuration is working correctly.</p>
    </div>
  `;

  return sendEmail(config, {
    to,
    subject: 'FlipAgent - Email Configuration Test',
    html,
    text: `FlipAgent Email Test\n\nProvider: ${config.provider}\nFrom: ${config.fromEmail}\nTime: ${new Date().toISOString()}\n\nIf you received this email, your configuration is working correctly.`,
  });
}
