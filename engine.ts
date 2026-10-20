import type { PurchaseRecord, DeadlineRules, DossierExport, IcsExportInput } from './schema.js';
import { dossierExportSchema } from './schema.js';

/**
 * Deterministic, dependency-free engine for the Purchase Management Collection.
 * All date arithmetic is calendar-day exact via UTC day numbers; all computed
 * deadlines are explicitly qualified model dates, never legal advice.
 */

export const QUALIFICATION =
  'Every deadline is a model date computed from the recorded facts and the selected window length. It is not legal advice, and the actual statutory withdrawal period depends on the contract, the delivery facts and the applicable national law.';

/* ------------------------------------------------------------------ dates -- */

/** Parse an ISO date (YYYY-MM-DD) to a UTC day number. Throws on malformed input. */
export function isoToDayNumber(isoDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Not an ISO calendar date: ${isoDate}`);
  const utc = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(utc)) throw new Error(`Not a valid calendar date: ${isoDate}`);
  return Math.floor(utc / 86_400_000);
}

/** Render a UTC day number back to ISO YYYY-MM-DD. */
export function dayNumberToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return dayNumberToIso(isoToDayNumber(isoDate) + days);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return isoToDayNumber(toIso) - isoToDayNumber(fromIso);
}

/* ------------------------------------------------------------- deadlines -- */

export type DeadlineStatus = 'ok' | 'warn_soon' | 'urgent' | 'expired' | 'withdrawn';

export interface PurchaseDeadline {
  id: string;
  merchant: string;
  orderRef: string | null;
  itemDescription: string | null;
  purchaseDate: string;
  deliveryDate: string | null;
  windowBasis: 'delivery_date' | 'order_date';
  windowDays: number;
  deadlineDate: string;
  daysRemaining: number;
  status: DeadlineStatus;
  assumptions: Array<{ id: string; note: string }>;
  parcelLinks: ParcelLink[];
}

export interface DeadlineReport {
  tool: 'pmc_deadline_tracker';
  generatedAt: string;
  referenceDate: string;
  rules: DeadlineRules;
  qualification: string;
  deadlines: PurchaseDeadline[];
  summary: { total: number; active: number; urgent: number; expired: number; withdrawn: number };
  receipts: Record<string, string>;
}

export function computePurchaseDeadline(
  purchase: PurchaseRecord,
  rules: DeadlineRules,
  referenceDay: number
): PurchaseDeadline {
  if (purchase.deliveryDate && daysBetween(purchase.purchaseDate, purchase.deliveryDate) < 0) {
    throw new Error(`Delivery date ${purchase.deliveryDate} is before purchase date ${purchase.purchaseDate}`);
  }
  const hasDelivery = Boolean(purchase.deliveryDate);
  const basis: PurchaseDeadline['windowBasis'] = hasDelivery ? 'delivery_date' : 'order_date';
  const startDay = isoToDayNumber(hasDelivery ? (purchase.deliveryDate as string) : purchase.purchaseDate);
  const deadlineDay = startDay + rules.windowDays;
  const daysRemaining = deadlineDay - referenceDay;

  let status: DeadlineStatus;
  if (purchase.withdrawn) status = 'withdrawn';
  else if (daysRemaining < 0) status = 'expired';
  else if (daysRemaining <= rules.urgentDays) status = 'urgent';
  else if (daysRemaining <= rules.warnDays) status = 'warn_soon';
  else status = 'ok';

  return {
    id: purchase.id,
    merchant: purchase.merchant,
    orderRef: purchase.orderRef ?? null,
    itemDescription: purchase.itemDescription ?? null,
    purchaseDate: purchase.purchaseDate,
    deliveryDate: purchase.deliveryDate ?? null,
    windowBasis: basis,
    windowDays: rules.windowDays,
    deadlineDate: dayNumberToIso(deadlineDay),
    daysRemaining,
    status,
    assumptions: hasDelivery
      ? [{ id: 'window_basis', note: `Window starts at the recorded delivery date ${purchase.deliveryDate}.` }]
      : [{ id: 'window_basis', note: 'Delivery date unknown: the window is modeled from the order date, which the statutory rule does not use. Record the delivery date for a usable model date.' }],
    parcelLinks: purchase.parcels.map(p => parcelTrackingLink(p))
  };
}

/** Deterministic short receipt per purchase for export provenance. */
function receiptHex(value: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h1 ^= value.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0');
}

export function computeDeadlines(
  purchases: PurchaseRecord[],
  rules: DeadlineRules,
  referenceDate?: string
): DeadlineReport {
  const referenceDay = isoToDayNumber(referenceDate ?? dayNumberToIso(Math.floor(Date.now() / 86_400_000)));
  const ids = new Set<string>();
  for (const purchase of purchases) {
    if (ids.has(purchase.id)) throw new Error(`Duplicate purchase id: ${purchase.id}`);
    ids.add(purchase.id);
  }
  const deadlines = purchases.map(p => computePurchaseDeadline(p, rules, referenceDay));
  const summary = {
    total: deadlines.length,
    active: deadlines.filter(d => d.status !== 'withdrawn' && d.status !== 'expired').length,
    urgent: deadlines.filter(d => d.status === 'urgent').length,
    expired: deadlines.filter(d => d.status === 'expired').length,
    withdrawn: deadlines.filter(d => d.status === 'withdrawn').length
  };
  const receipts: Record<string, string> = {};
  for (const d of deadlines) receipts[d.id] = receiptHex(`${d.id}|${d.deadlineDate}|${d.daysRemaining}`);
  return {
    tool: 'pmc_deadline_tracker',
    generatedAt: new Date().toISOString(),
    referenceDate: dayNumberToIso(referenceDay),
    rules,
    qualification: QUALIFICATION,
    deadlines,
    summary,
    receipts
  };
}

/* ---------------------------------------------------------- parcel links -- */

/**
 * Public carrier tracking URL templates. These are the carriers' own public
 * track-and-trace pages; this engine only formats links, it never scrapes or
 * queries carriers. Unknown carriers require a user-supplied URL.
 */
export const CARRIER_REGISTRY: Record<string, (code: string) => string> = {
  POSTNL: code => `https://postnl.nl/tracktrace/?B=${encodeURIComponent(code)}`,
  DHL: code => `https://www.dhl.com/nl-en/home/tracking.html?tracking-id=${encodeURIComponent(code)}`,
  DHL_FOR_YOU: code => `https://www.dhl.com/nl-en/home/tracking.html?tracking-id=${encodeURIComponent(code)}`,
  DPD: code => `https://tracking.dpd.de/parcelStatus?query=${encodeURIComponent(code)}`,
  GLS: code => `https://gls-group.com/NL/en/parcel-tracking?match=${encodeURIComponent(code)}`,
  UPS: code => `https://www.ups.com/track?tracknum=${encodeURIComponent(code)}`,
  BPOST: code => `https://track.bpost.cloud/tr?key=${encodeURIComponent(code)}`,
  FEDEX: code => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(code)}`,
  AMAZON_LOGISTICS: code => `https://track.amazon.com/tracking/${encodeURIComponent(code)}`,
  KIALA_INPOST: code => `https://www.inpost.eu/track-and-trace?parcel_id=${encodeURIComponent(code)}`
};

export interface ParcelLink {
  carrier: string;
  trackingCode: string;
  trackingUrl: string;
  knownCarrier: boolean;
}

export function parcelTrackingLink(
  parcel: { carrier: string; trackingCode: string; customTrackingUrl?: string },
  origin = 'http://127.0.0.1:4326'
): ParcelLink {
  const known = CARRIER_REGISTRY[parcel.carrier.toUpperCase()];
  if (known) {
    return { carrier: parcel.carrier, trackingCode: parcel.trackingCode, trackingUrl: known(parcel.trackingCode), knownCarrier: true };
  }
  if (parcel.customTrackingUrl) {
    return { carrier: parcel.carrier, trackingCode: parcel.trackingCode, trackingUrl: parcel.customTrackingUrl, knownCarrier: false };
  }
  return {
    carrier: parcel.carrier,
    trackingCode: parcel.trackingCode,
    trackingUrl: `${origin}/carrier-search?carrier=${encodeURIComponent(parcel.carrier)}&code=${encodeURIComponent(parcel.trackingCode)}`,
    knownCarrier: false
  };
}

export const CARRIER_NAMES = Object.keys(CARRIER_REGISTRY);

/* ------------------------------------------------------------------- ICS -- */

const escapeIcsText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line: escape the value portion (after the first colon — property names and parameters are not escaped), then fold to ≤74 octets with CRLF + space continuation. Never splits a character. */
export function foldIcsLine(text: string): string {
  const colon = text.indexOf(':');
  const line = colon === -1 ? text : text.slice(0, colon + 1) + escapeIcsText(text.slice(colon + 1));
  const lines: string[] = [];
  let current = '', length = 0;
  for (const char of line) {
    const byteLen = Buffer.byteLength(char, 'utf8');
    if (length + byteLen > 74) { lines.push(current); current = ''; length = 0; }
    current += char;
    length += byteLen;
  }
  if (current) lines.push(current);
  return lines.join('\r\n ');
}

/** All-day ISO date to ICS DATE value. */
export function icsDateValue(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

export function buildDeadlineCalendar(input: IcsExportInput): string {
  const rules = input.rules;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Purchase Management Collection//Deadline Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  const report = computeDeadlines(input.purchases, rules);
  for (const deadline of report.deadlines) {
    const title = deadline.status === 'withdrawn'
      ? `Withdrawn: ${deadline.merchant}`
      : `Withdrawal deadline: ${deadline.merchant}${deadline.orderRef ? ` (${deadline.orderRef})` : ''}`;
    const description = [
      deadline.itemDescription ? `Item: ${deadline.itemDescription}` : null,
      `Ordered: ${deadline.purchaseDate}`,
      deadline.deliveryDate ? `Delivered: ${deadline.deliveryDate}` : 'Delivery date unknown (window modeled from order date)',
      `Model window: ${deadline.windowDays} days from ${deadline.windowBasis === 'delivery_date' ? 'delivery date' : 'order date'}`,
      deadline.orderRef ? `Order ref: ${deadline.orderRef}` : null,
      `Model date, not legal advice.`
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${foldable(deadline.id)}@pmc.local`,
      `DTSTAMP:${icsStampNow()}`,
      `DTSTART;VALUE=DATE:${icsDateValue(deadline.deadlineDate)}`,
      `DTEND;VALUE=DATE:${icsDateValue(addDays(deadline.deadlineDate, 1))}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      'BEGIN:VALARM',
      'TRIGGER:-P2D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title}`,
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P0D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title} (today)`,
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

const foldable = (id: string): string => /^[A-Za-z0-9._-]+$/.test(id) ? id : 'purchase';

function icsStampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* -------------------------------------------------------------- dossiers -- */

export function buildDossierExport(purchases: PurchaseRecord[], savedAt: string): DossierExport {
  if (purchases.length === 0) throw new Error('Cannot export an empty dossier');
  const seen = new Set<string>();
  for (const p of purchases) {
    if (seen.has(p.id)) throw new Error(`Duplicate purchase id: ${p.id}`);
    seen.add(p.id);
  }
  return {
    format: 'purchase-management-collection',
    version: 1,
    savedAt,
    purchases
  };
}

export function importDossierExport(raw: unknown): { ok: boolean; error?: string; dossier?: DossierExport } {
  const parsed = dossierExportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `Invalid dossier: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }
  const seen = new Set<string>();
  for (const p of parsed.data.purchases) {
    if (seen.has(p.id)) return { ok: false, error: `Duplicate purchase id in dossier: ${p.id}` };
    seen.add(p.id);
    if (p.deliveryDate && daysBetween(p.purchaseDate, p.deliveryDate) < 0) {
      return { ok: false, error: `Purchase ${p.id}: delivery date is before purchase date` };
    }
  }
  return { ok: true, dossier: parsed.data };
}

