# Specification — Purchase Management Collection engine

This document is the public contract for the deterministic deadline engine.
It exists so reviewers, contributors and integrations can verify outputs
without reading the implementation. Where this spec and the code disagree,
the code is wrong — please open an issue.

> **Qualification contract:** every computed deadline is a *model date*
> derived from the recorded facts and the configured window. It is never
> legal advice, and the real statutory period depends on the contract, the
> delivery facts and the applicable national law.

## 1. Purchase record (`schema.ts` → `purchaseRecordSchema`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string, 1–80 | yes | User-assigned, unique per dossier |
| `merchant` | string, 1–160 | yes | Free text |
| `orderRef` | string, ≤160 | no | Order number for the user's own reference |
| `itemDescription` | string, ≤500 | no | |
| `purchaseDate` | `YYYY-MM-DD` | yes | Order/contract date |
| `deliveryDate` | `YYYY-MM-DD` | no | See §3 for the assumption when absent |
| `amountMinor` | integer ≥0 | no | Minor units (cents) |
| `currency` | ISO-4217 (3 chars) | no | |
| `notes` | string, ≤2000 | no | |
| `parcels` | `Parcel[]`, ≤10 | no | See §4 |
| `withdrawn` | boolean | no | Marks the right exercised |

Dates must be real calendar dates (no `2026-02-30`). Input beyond the
limits above is rejected — there is no silent truncation.

## 2. Deadline rules (`deadlineRulesSchema`)

| Rule | Default | Range | Meaning |
| --- | --- | --- | --- |
| `windowDays` | 14 | 1–60 | Withdrawal window length in calendar days (EU default) |
| `warnDays` | 5 | 1–30 | `warn_soon` threshold (days remaining) |
| `urgentDays` | 2 | 0–14 | `urgent` threshold (days remaining) |

## 3. Deadline model (`computePurchaseDeadline`)

All arithmetic is on UTC day numbers — no timezone or DST can shift a
result by an hour into a neighbouring day.

```
startDay      = dayNumber(deliveryDate ?? purchaseDate)
deadlineDay   = startDay + windowDays
daysRemaining = deadlineDay - dayNumber(referenceDate)
```

- `deliveryDate` present → the window starts on the delivery day, matching
  the Consumer Rights Directive model.
- `deliveryDate` absent → the window starts on `purchaseDate`.
- Every deadline always carries a `window_basis` assumption entry stating
  which start date the model used — with delivery recorded it names the
  delivery date; without it, it says plainly that the order date was used
  and that the statutory rule does not use that. Assumptions are part of
  the output object, not a UI afterthought.

Status is derived from `daysRemaining`:

| Status | Condition |
| --- | --- |
| `withdrawn` | `purchase.withdrawn === true` |
| `expired` | `daysRemaining < 0` |
| `urgent` | `daysRemaining ≤ urgentDays` |
| `warn_soon` | `daysRemaining ≤ warnDays` |
| `ok` | otherwise |

Every deadline output includes `windowBasis` (`delivery_date` or
`order_date`) naming the start-date fact the model used, plus the
`windowDays`, `deadlineDate`, `daysRemaining`, `status`, `assumptions`
and resolved `parcelLinks` fields.

Every deadline also carries a deterministic receipt hash over
`id|deadlineDate|daysRemaining` so exports can be compared for drift.

## 4. Parcel links

`Parcel = { carrier, trackingCode, customTrackingUrl? }`. The carrier
registry keys are `POSTNL`, `DHL`, `DHL_FOR_YOU`, `DPD`, `GLS`, `UPS`,
`BPOST`, `FEDEX`, `AMAZON_LOGISTICS`, `KIALA_INPOST` — mapping to the
carriers' **public tracking-page URL patterns only** (matched
case-insensitively). `customTrackingUrl` overrides the registry for
unknown carriers; without one, the link falls back to a local
`/carrier-search` page on the user's own instance — never an error. No
carrier APIs, no scraping, no order data leaves the device.

## 5. Dossier exchange

Dossiers are versioned JSON (`version` field, currently `1`). Import
validates the whole package and rejects unknown versions/fields; a bad
import leaves existing records untouched.

## 6. ICS export (RFC 5545)

- All-day events (`DTSTART;VALUE=DATE`), one per active deadline.
- Proper line folding at ≤74 octets **without splitting multi-byte UTF-8
  characters**; escaping applies to the value only, never to property
  parameters (`;VALUE=DATE` stays intact).
- Two `VALARM`s: `TRIGGER:-P2D` and `TRIGGER:-P0D` — imported by the user
  into their own calendar; nothing is delivered remotely.
