import { describe, expect, it } from 'vitest';
import {
  isoToDayNumber, dayNumberToIso, addDays, daysBetween,
  computePurchaseDeadline, computeDeadlines, parcelTrackingLink, CARRIER_REGISTRY,
  foldIcsLine, icsDateValue, buildDeadlineCalendar,
  buildDossierExport, importDossierExport, QUALIFICATION
} from '../engine.js';
import { purchaseRecordSchema, deadlineRulesSchema } from '../schema.js';
import type { PurchaseRecord } from '../schema.js';

const rec = (over: Partial<PurchaseRecord> = {}): PurchaseRecord =>
  purchaseRecordSchema.parse({ id: 'p1', merchant: 'bol.com', purchaseDate: '2026-10-01', deliveryDate: '2026-10-03', ...over });
const rules = () => deadlineRulesSchema.parse({});

describe('date arithmetic', () => {
  it('round-trips ISO to day number and back', () => {
    expect(dayNumberToIso(isoToDayNumber('2026-10-20'))).toBe('2026-10-20');
  });
  it('crosses a month boundary', () => {
    expect(addDays('2026-10-29', 5)).toBe('2026-11-03');
  });
  it('crosses a year boundary', () => {
    expect(addDays('2026-12-30', 4)).toBe('2027-01-03');
  });
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
  it('rejects malformed dates', () => {
    expect(() => isoToDayNumber('20-10-2026')).toThrow();
    expect(() => isoToDayNumber('2026-13-40')).toThrow();
  });
});

describe('deadline computation', () => {
  it('uses the delivery date as window basis when recorded', () => {
    const d = computePurchaseDeadline(rec(), rules(), isoToDayNumber('2026-10-10'));
    expect(d.windowBasis).toBe('delivery_date');
    expect(d.deadlineDate).toBe('2026-10-17');
    expect(d.daysRemaining).toBe(7);
    expect(d.status).toBe('ok');
    expect(d.assumptions[0]!.note).toContain('delivery date');
  });
  it('falls back to the order date with an explicit assumption when delivery is unknown', () => {
    const d = computePurchaseDeadline(rec({ deliveryDate: undefined }), rules(), isoToDayNumber('2026-10-10'));
    expect(d.windowBasis).toBe('order_date');
    expect(d.deadlineDate).toBe('2026-10-15');
    expect(d.assumptions[0]!.note).toContain('order date');
  });
  it('honours a custom window length', () => {
    const d = computePurchaseDeadline(rec(), { windowDays: 30, warnDays: 5, urgentDays: 2 }, isoToDayNumber('2026-10-10'));
    expect(d.deadlineDate).toBe('2026-11-02');
    expect(d.windowDays).toBe(30);
  });
  it('classifies status bands at exact boundaries', () => {
    const base = rec();
    const at = (ref: string) => computePurchaseDeadline(base, rules(), isoToDayNumber(ref)).status;
    expect(at('2026-10-11')).toBe('ok');          // 6 days left > warnDays(5)
    expect(at('2026-10-12')).toBe('warn_soon');   // 5 days left
    expect(at('2026-10-15')).toBe('urgent');      // 2 days left
    expect(at('2026-10-17')).toBe('urgent');      // deadline day itself
    expect(at('2026-10-18')).toBe('expired');     // day after deadline
  });
  it('marks withdrawn purchases regardless of remaining days', () => {
    const d = computePurchaseDeadline(rec({ withdrawn: true }), rules(), isoToDayNumber('2026-10-05'));
    expect(d.status).toBe('withdrawn');
  });
  it('rejects delivery dates before the purchase date', () => {
    expect(() => computePurchaseDeadline(rec({ deliveryDate: '2026-09-30' }), rules(), 0)).toThrow('before purchase date');
  });
});

describe('deadline report', () => {
  it('summarises mixed statuses deterministically for a fixed reference date', () => {
    const report = computeDeadlines(
      [rec({ id: 'a' }), rec({ id: 'b', purchaseDate: '2026-10-15', deliveryDate: '2026-10-19' }), rec({ id: 'c', withdrawn: true })],
      rules(), '2026-10-20');
    expect(report.referenceDate).toBe('2026-10-20');
    expect(report.summary).toEqual({ total: 3, active: 1, urgent: 0, expired: 1, withdrawn: 1 });
    expect(report.qualification).toBe(QUALIFICATION);
    expect(Object.keys(report.receipts)).toHaveLength(3);
  });
  it('rejects duplicate purchase ids', () => {
    expect(() => computeDeadlines([rec({ id: 'x' }), rec({ id: 'x' })], rules(), '2026-10-20')).toThrow('Duplicate');
  });
  it('includes parcel links in the report', () => {
    const report = computeDeadlines([rec({ parcels: [{ carrier: 'POSTNL', trackingCode: '3SABC123' }] })], rules(), '2026-10-10');
    expect(report.deadlines[0]!.parcelLinks[0]!.trackingUrl).toContain('postnl.nl');
    expect(report.deadlines[0]!.parcelLinks[0]!.knownCarrier).toBe(true);
  });
});

describe('parcel tracking links', () => {
  it('formats known carrier URLs', () => {
    for (const [carrier, needle] of [['POSTNL', 'postnl.nl'], ['DHL', 'dhl.com'], ['DPD', 'dpd.de'], ['GLS', 'gls-group.com'], ['UPS', 'ups.com'], ['BPOST', 'bpost'], ['FEDEX', 'fedex.com']] as const) {
      expect(parcelTrackingLink({ carrier, trackingCode: 'XYZ1' }).trackingUrl).toContain(needle);
    }
  });
  it('matches carriers case-insensitively and URL-encodes codes', () => {
    const link = parcelTrackingLink({ carrier: 'postnl', trackingCode: 'A B/1' });
    expect(link.knownCarrier).toBe(true);
    expect(link.trackingUrl).toContain('A%20B%2F1');
  });
  it('passes through a custom URL for unknown carriers', () => {
    const link = parcelTrackingLink({ carrier: 'BUDGETSHIP', trackingCode: 'X1', customTrackingUrl: 'https://budgetship.example/track?c=X1' });
    expect(link.knownCarrier).toBe(false);
    expect(link.trackingUrl).toBe('https://budgetship.example/track?c=X1');
  });
  it('falls back to a local carrier-search route for unknown carriers without a URL', () => {
    const link = parcelTrackingLink({ carrier: 'BUDGETSHIP', trackingCode: 'X1' });
    expect(link.knownCarrier).toBe(false);
    expect(link.trackingUrl).toContain('/carrier-search');
  });
  it('exposes a registry of at least eight carriers', () => {
    expect(Object.keys(CARRIER_REGISTRY).length).toBeGreaterThanOrEqual(8);
  });
});

describe('ICS generation', () => {
  it('produces a valid VCALENDAR skeleton with CRLF line endings', () => {
    const ics = buildDeadlineCalendar({ purchases: [rec()], rules: rules(), producerName: 'PMC' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('\r\n');
    expect(ics.endsWith('\r\n')).toBe(true);
  });
  it('emits one all-day VEVENT per purchase with two VALARMs', () => {
    const ics = buildDeadlineCalendar({ purchases: [rec({ id: 'a' }), rec({ id: 'b', deliveryDate: '2026-10-20' })], rules: rules(), producerName: 'PMC' });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(4);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261017');
    expect(ics).toContain('TRIGGER:-P2D');
    expect(ics).toContain('TRIGGER:-P0D');
  });
  it('marks withdrawn purchases in the summary line', () => {
    const ics = buildDeadlineCalendar({ purchases: [rec({ withdrawn: true })], rules: rules(), producerName: 'PMC' });
    expect(ics).toContain('SUMMARY:Withdrawn: bol.com');
  });
  it('escapes commas, semicolons, backslashes and newlines in text fields', () => {
    const ics = buildDeadlineCalendar({ purchases: [rec({ merchant: 'A,B;C\\D\nE' })], rules: rules(), producerName: 'PMC' });
    expect(ics).toContain('A\\,B\\;C\\\\D\\nE');
  });
  it('folds lines longer than 75 octets with CRLF-space continuations', () => {
    const folded = foldIcsLine('DESCRIPTION:' + 'x'.repeat(200));
    const segments = folded.split('\r\n ');
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(Buffer.byteLength(s, 'latin1')).toBeLessThanOrEqual(74);
  });
  it('does not split a multi-byte UTF-8 sequence across folds', () => {
    const folded = foldIcsLine('SUMMARY:' + '€'.repeat(60));
    for (const s of folded.split('\r\n ')) {
      expect(Buffer.byteLength(s, 'utf8')).toBeLessThanOrEqual(74);
      expect(Buffer.from(s, 'utf8').toString('utf8')).toBe(s);
    }
  });
  it('formats ICS DATE values without dashes', () => {
    expect(icsDateValue('2026-10-17')).toBe('20261017');
  });
});

describe('dossier export/import', () => {
  it('round-trips a dossier', () => {
    const dossier = buildDossierExport([rec()], '2026-10-20');
    expect(dossier.format).toBe('purchase-management-collection');
    const result = importDossierExport(dossier);
    expect(result.ok).toBe(true);
    expect(result.dossier!.purchases).toHaveLength(1);
  });
  it('rejects empty exports and duplicate ids', () => {
    expect(() => buildDossierExport([], '2026-10-20')).toThrow('empty');
    expect(() => buildDossierExport([rec({ id: 'x' }), rec({ id: 'x' })], '2026-10-20')).toThrow('Duplicate');
  });
  it('rejects malformed imports with field details', () => {
    expect(importDossierExport({ format: 'other' }).ok).toBe(false);
    const bad = importDossierExport({ format: 'purchase-management-collection', version: 1, savedAt: '2026-10-20', purchases: [{ id: 'x', merchant: 'm', purchaseDate: 'nope' }] });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('purchaseDate');
  });
  it('rejects imports with delivery before purchase or duplicate ids', () => {
    const base = { format: 'purchase-management-collection', version: 1, savedAt: '2026-10-20' };
    expect(importDossierExport({ ...base, purchases: [{ id: 'x', merchant: 'm', purchaseDate: '2026-10-05', deliveryDate: '2026-10-01', parcels: [], withdrawn: false }] }).error).toContain('before purchase');
    expect(importDossierExport({ ...base, purchases: [{ id: 'x', merchant: 'm', purchaseDate: '2026-10-05' }, { id: 'x', merchant: 'n', purchaseDate: '2026-10-06' }] }).error).toContain('Duplicate');
  });
});
