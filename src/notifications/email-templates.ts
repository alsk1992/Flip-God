/**
 * Email Templates - HTML templates for alert and digest emails
 *
 * Simple inline CSS, mobile-responsive, no external dependencies.
 */

import type { Alert } from './types.js';

// =============================================================================
// SHARED STYLES
// =============================================================================

const COLORS = {
  primary: '#1a73e8',
  success: '#34a853',
  warning: '#f9ab00',
  danger: '#ea4335',
  info: '#4285f4',
  text: '#202124',
  textSecondary: '#5f6368',
  border: '#dadce0',
  bgLight: '#f8f9fa',
  bgHighlight: '#f0f7ff',
  white: '#ffffff',
} as const;

function alertTypeColor(type: string): string {
  switch (type) {
    case 'price_drop': return COLORS.success;
    case 'price_increase': return COLORS.warning;
    case 'stock_low': return COLORS.warning;
    case 'stock_out': return COLORS.danger;
    case 'back_in_stock': return COLORS.success;
    case 'new_opportunity': return COLORS.info;
    default: return COLORS.primary;
  }
}

function alertTypeLabel(type: string): string {
  switch (type) {
    case 'price_drop': return 'Price Drop';
    case 'price_increase': return 'Price Increase';
    case 'stock_low': return 'Low Stock';
    case 'stock_out': return 'Out of Stock';
    case 'back_in_stock': return 'Back in Stock';
    case 'new_opportunity': return 'New Opportunity';
    default: return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function wrapLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.bgLight}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: ${COLORS.bgLight};">
    <tr>
      <td style="padding: 24px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background-color: ${COLORS.primary}; border-radius: 8px 8px 0 0; padding: 20px 24px;">
              <h1 style="margin: 0; color: ${COLORS.white}; font-size: 20px; font-weight: 600;">FlipGod</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color: ${COLORS.white}; padding: 24px; border-left: 1px solid ${COLORS.border}; border-right: 1px solid ${COLORS.border};">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: ${COLORS.bgLight}; border-radius: 0 0 8px 8px; padding: 16px 24px; border: 1px solid ${COLORS.border}; border-top: none;">
              <p style="margin: 0; font-size: 12px; color: ${COLORS.textSecondary}; text-align: center;">
                This email was sent by FlipGod. Manage your notification settings in the app.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// =============================================================================
// ALERT EMAIL
// =============================================================================

/**
 * Render a single alert as an HTML email.
 */
export function renderAlertEmail(alert: Alert): { subject: string; html: string } {
  const typeLabel = alertTypeLabel(alert.type);
  const typeColor = alertTypeColor(alert.type);
  const timestamp = new Date(alert.createdAt).toLocaleString();

  const subject = `FlipGod Alert: ${typeLabel}${alert.platform ? ` on ${alert.platform}` : ''}`;

  const detailRows: string[] = [];
  if (alert.platform) {
    detailRows.push(`<tr><td style="padding: 6px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Platform</td><td style="padding: 6px 12px; font-size: 14px; font-weight: 500;">${escapeHtml(alert.platform)}</td></tr>`);
  }
  if (alert.productId) {
    detailRows.push(`<tr><td style="padding: 6px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Product</td><td style="padding: 6px 12px; font-size: 14px; font-weight: 500;">${escapeHtml(alert.productId)}</td></tr>`);
  }
  if (alert.oldValue != null && Number.isFinite(alert.oldValue)) {
    detailRows.push(`<tr><td style="padding: 6px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Previous</td><td style="padding: 6px 12px; font-size: 14px; font-weight: 500;">$${alert.oldValue.toFixed(2)}</td></tr>`);
  }
  if (alert.newValue != null && Number.isFinite(alert.newValue)) {
    detailRows.push(`<tr><td style="padding: 6px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Current</td><td style="padding: 6px 12px; font-size: 14px; font-weight: 500;">$${alert.newValue.toFixed(2)}</td></tr>`);
  }
  if (alert.threshold != null && Number.isFinite(alert.threshold)) {
    detailRows.push(`<tr><td style="padding: 6px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Threshold</td><td style="padding: 6px 12px; font-size: 14px; font-weight: 500;">${alert.threshold}</td></tr>`);
  }

  const bodyContent = `
    <div style="margin-bottom: 16px;">
      <span style="display: inline-block; background-color: ${typeColor}; color: ${COLORS.white}; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 600; text-transform: uppercase;">${escapeHtml(typeLabel)}</span>
    </div>
    <p style="margin: 0 0 16px; font-size: 16px; color: ${COLORS.text}; line-height: 1.5;">${escapeHtml(alert.message)}</p>
    ${detailRows.length > 0 ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: ${COLORS.bgHighlight}; border-radius: 8px; margin-bottom: 16px;">
      ${detailRows.join('\n')}
    </table>
    ` : ''}
    <p style="margin: 0; font-size: 12px; color: ${COLORS.textSecondary};">
      Alert ID: ${escapeHtml(alert.id)} | ${escapeHtml(timestamp)}
    </p>
  `;

  return { subject, html: wrapLayout(subject, bodyContent) };
}

// =============================================================================
// DAILY DIGEST
// =============================================================================

export interface DigestData {
  alerts: Alert[];
  totalProfit?: number;
  totalOrders?: number;
  activeListings?: number;
  period?: string;
}

/**
 * Render a daily digest email aggregating multiple alerts and stats.
 */
export function renderDailyDigestEmail(data: DigestData): { subject: string; html: string } {
  const { alerts, totalProfit, totalOrders, activeListings, period } = data;
  const dateStr = period ?? new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `FlipGod Daily Digest - ${dateStr}`;

  // Summary stats
  const statsHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin-bottom: 24px;">
      <tr>
        ${totalOrders != null ? `
        <td style="text-align: center; padding: 12px; background-color: ${COLORS.bgHighlight}; border-radius: 8px; width: 33%;">
          <div style="font-size: 24px; font-weight: 700; color: ${COLORS.primary};">${totalOrders}</div>
          <div style="font-size: 12px; color: ${COLORS.textSecondary}; margin-top: 4px;">Orders</div>
        </td>
        ` : ''}
        ${totalProfit != null ? `
        <td style="text-align: center; padding: 12px; background-color: ${COLORS.bgHighlight}; border-radius: 8px; width: 33%;">
          <div style="font-size: 24px; font-weight: 700; color: ${totalProfit >= 0 ? COLORS.success : COLORS.danger};">$${totalProfit.toFixed(2)}</div>
          <div style="font-size: 12px; color: ${COLORS.textSecondary}; margin-top: 4px;">Profit</div>
        </td>
        ` : ''}
        ${activeListings != null ? `
        <td style="text-align: center; padding: 12px; background-color: ${COLORS.bgHighlight}; border-radius: 8px; width: 33%;">
          <div style="font-size: 24px; font-weight: 700; color: ${COLORS.primary};">${activeListings}</div>
          <div style="font-size: 12px; color: ${COLORS.textSecondary}; margin-top: 4px;">Active Listings</div>
        </td>
        ` : ''}
      </tr>
    </table>
  `;

  // Group alerts by type
  const groupedAlerts = new Map<string, Alert[]>();
  for (const alert of alerts) {
    const existing = groupedAlerts.get(alert.type) ?? [];
    existing.push(alert);
    groupedAlerts.set(alert.type, existing);
  }

  let alertsHtml = '';
  if (alerts.length === 0) {
    alertsHtml = `<p style="color: ${COLORS.textSecondary}; font-size: 14px; text-align: center; padding: 16px 0;">No alerts triggered today.</p>`;
  } else {
    for (const [type, typeAlerts] of groupedAlerts) {
      const color = alertTypeColor(type);
      const label = alertTypeLabel(type);
      alertsHtml += `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${color}; margin-right: 8px;"></span>
            <span style="font-size: 14px; font-weight: 600; color: ${COLORS.text};">${escapeHtml(label)} (${typeAlerts.length})</span>
          </div>
          ${typeAlerts.slice(0, 10).map((a) => `
            <div style="padding: 8px 12px; background-color: ${COLORS.bgLight}; border-radius: 4px; margin-bottom: 4px; font-size: 13px; color: ${COLORS.text};">
              ${escapeHtml(a.message)}
            </div>
          `).join('')}
          ${typeAlerts.length > 10 ? `<p style="font-size: 12px; color: ${COLORS.textSecondary}; margin: 4px 0 0 12px;">... and ${typeAlerts.length - 10} more</p>` : ''}
        </div>
      `;
    }
  }

  const bodyContent = `
    <h2 style="margin: 0 0 8px; font-size: 18px; color: ${COLORS.text};">Daily Digest</h2>
    <p style="margin: 0 0 20px; font-size: 14px; color: ${COLORS.textSecondary};">${escapeHtml(dateStr)}</p>
    ${statsHtml}
    <h3 style="margin: 0 0 12px; font-size: 16px; color: ${COLORS.text}; border-bottom: 1px solid ${COLORS.border}; padding-bottom: 8px;">Alerts Summary (${alerts.length})</h3>
    ${alertsHtml}
  `;

  return { subject, html: wrapLayout(subject, bodyContent) };
}

// =============================================================================
// ORDER NOTIFICATION
// =============================================================================

export interface OrderEmailData {
  orderId: string;
  sellPlatform: string;
  sellPrice: number;
  buyPlatform: string;
  buyPrice?: number;
  profit?: number;
  productTitle?: string;
  buyerAddress?: string;
  status: string;
}

/**
 * Render an order notification email.
 */
export function renderOrderNotificationEmail(order: OrderEmailData): { subject: string; html: string } {
  const subject = `FlipGod: New Order ${order.orderId} on ${order.sellPlatform}`;

  const statusColor = order.status === 'shipped' ? COLORS.success
    : order.status === 'pending' ? COLORS.warning
    : order.status === 'cancelled' ? COLORS.danger
    : COLORS.info;

  const rows: string[] = [];
  rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px; border-bottom: 1px solid ${COLORS.border};">Order ID</td><td style="padding: 8px 12px; font-size: 14px; font-weight: 500; border-bottom: 1px solid ${COLORS.border};">${escapeHtml(order.orderId)}</td></tr>`);
  rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px; border-bottom: 1px solid ${COLORS.border};">Status</td><td style="padding: 8px 12px; font-size: 14px;"><span style="background-color: ${statusColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${escapeHtml(order.status.toUpperCase())}</span></td></tr>`);
  if (order.productTitle) {
    rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px; border-bottom: 1px solid ${COLORS.border};">Product</td><td style="padding: 8px 12px; font-size: 14px; font-weight: 500; border-bottom: 1px solid ${COLORS.border};">${escapeHtml(order.productTitle)}</td></tr>`);
  }
  rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px; border-bottom: 1px solid ${COLORS.border};">Sell Platform</td><td style="padding: 8px 12px; font-size: 14px; font-weight: 500; border-bottom: 1px solid ${COLORS.border};">${escapeHtml(order.sellPlatform)} - $${order.sellPrice.toFixed(2)}</td></tr>`);
  rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px; border-bottom: 1px solid ${COLORS.border};">Buy Platform</td><td style="padding: 8px 12px; font-size: 14px; font-weight: 500; border-bottom: 1px solid ${COLORS.border};">${escapeHtml(order.buyPlatform)}${order.buyPrice != null && Number.isFinite(order.buyPrice) ? ` - $${order.buyPrice.toFixed(2)}` : ''}</td></tr>`);
  if (order.profit != null && Number.isFinite(order.profit)) {
    const profitColor = order.profit >= 0 ? COLORS.success : COLORS.danger;
    rows.push(`<tr><td style="padding: 8px 12px; color: ${COLORS.textSecondary}; font-size: 14px;">Estimated Profit</td><td style="padding: 8px 12px; font-size: 14px; font-weight: 700; color: ${profitColor};">$${order.profit.toFixed(2)}</td></tr>`);
  }

  const bodyContent = `
    <h2 style="margin: 0 0 16px; font-size: 18px; color: ${COLORS.text};">New Order Received</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: ${COLORS.bgLight}; border-radius: 8px; margin-bottom: 16px;">
      ${rows.join('\n')}
    </table>
    ${order.buyerAddress ? `
    <div style="background-color: ${COLORS.bgHighlight}; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
      <p style="margin: 0 0 4px; font-size: 13px; color: ${COLORS.textSecondary}; font-weight: 600;">Ship To:</p>
      <p style="margin: 0; font-size: 14px; color: ${COLORS.text}; white-space: pre-line;">${escapeHtml(order.buyerAddress)}</p>
    </div>
    ` : ''}
  `;

  return { subject, html: wrapLayout(subject, bodyContent) };
}
