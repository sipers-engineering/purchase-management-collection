import { z } from 'zod';

/**
 * Purchase Management Collection — local-first purchase records, model
 * withdrawal/return deadlines and public carrier parcel links.
 *
 * Every computed deadline is a MODEL DATE with visible assumptions. Nothing in
 * this engine is legal advice; the statutory withdrawal period depends on the
 * specific contract, delivery facts and applicable national law.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected ISO date YYYY-MM-DD').refine(
  value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  'invalid calendar date'
);

export const parcelSchema = z.object({
  carrier: z.string().min(1).max(80),
  trackingCode: z.string().min(3).max(120),
  customTrackingUrl: z.string().url().optional()
});
export type Parcel = z.infer<typeof parcelSchema>;

export const purchaseRecordSchema = z.object({
  id: z.string().min(1).max(80),
  merchant: z.string().min(1).max(160),
  orderRef: z.string().max(160).optional(),
  itemDescription: z.string().max(500).optional(),
  purchaseDate: isoDate,
  deliveryDate: isoDate.optional(),
  amountMinor: z.number().int().min(0).max(999_999_999).optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(2000).optional(),
  parcels: z.array(parcelSchema).max(10).default([]),
  withdrawn: z.boolean().default(false)
});
export type PurchaseRecord = z.infer<typeof purchaseRecordSchema>;

export const deadlineRulesSchema = z.object({
  windowDays: z.number().int().min(1).max(60).default(14),
  warnDays: z.number().int().min(1).max(30).default(5),
  urgentDays: z.number().int().min(0).max(14).default(2)
});
export type DeadlineRules = z.infer<typeof deadlineRulesSchema>;

export const deadlineComputeInputSchema = z.object({
  purchases: z.array(purchaseRecordSchema).min(1).max(200),
  rules: deadlineRulesSchema.default({ windowDays: 14, warnDays: 5, urgentDays: 2 }),
  referenceDate: isoDate.optional()
});
export type DeadlineComputeInput = z.infer<typeof deadlineComputeInputSchema>;

export const dossierExportSchema = z.object({
  format: z.literal('purchase-management-collection'),
  version: z.literal(1),
  savedAt: isoDate,
  purchases: z.array(purchaseRecordSchema).min(1).max(200)
});
export type DossierExport = z.infer<typeof dossierExportSchema>;

export const icsExportInputSchema = z.object({
  purchases: z.array(purchaseRecordSchema).min(1).max(200),
  rules: deadlineRulesSchema.default({ windowDays: 14, warnDays: 5, urgentDays: 2 }),
  producerName: z.string().min(1).max(120).default('Purchase Management Collection')
});
export type IcsExportInput = z.infer<typeof icsExportInputSchema>;
