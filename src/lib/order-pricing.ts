// Retail pricing for the done-for-you email-accounts order flow.
//
// These are the CUSTOMER-FACING prices (our cost from Instantly + 20% markup):
//   Instantly DFY base: $15/domain/year, $5/mailbox/month.
//   +20% markup        : $18/domain (one-time, first year), $6/mailbox/month.
// Setup fee is $0 by default (Instantly bundles setup; the markup is the margin).
//
// Edit these to change what customers pay. Amounts are in CENTS (USD).

export const ORDER_PRICING = {
  domainCents: 1800, // $18.00 one-time, per domain (first year)
  mailboxMonthlyCents: 600, // $6.00 / month, per mailbox
  setupFeeCents: 0, // one-time setup fee (0 = none)
  currency: "usd",
} as const;

export type OrderPricing = typeof ORDER_PRICING;

export type OrderTotals = {
  domainCount: number;
  mailboxCount: number;
  domainsCents: number; // one-time
  setupCents: number; // one-time
  oneTimeCents: number; // domains + setup
  monthlyCents: number; // recurring mailbox cost
};

// Single source of truth for computing an order's totals from counts.
export function computeOrderTotals(
  domainCount: number,
  mailboxCount: number,
  pricing: OrderPricing = ORDER_PRICING,
): OrderTotals {
  const dc = Math.max(0, Math.floor(domainCount));
  const mc = Math.max(0, Math.floor(mailboxCount));
  const domainsCents = dc * pricing.domainCents;
  const setupCents = pricing.setupFeeCents;
  return {
    domainCount: dc,
    mailboxCount: mc,
    domainsCents,
    setupCents,
    oneTimeCents: domainsCents + setupCents,
    monthlyCents: mc * pricing.mailboxMonthlyCents,
  };
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
