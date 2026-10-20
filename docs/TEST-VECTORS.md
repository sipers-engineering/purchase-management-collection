# Test vectors — deadline engine

Deterministic vectors for re-implementing or auditing the deadline model
(see `SPEC.md` §3). All day arithmetic is UTC day numbers; `referenceDate`
fixes "today". These mirror `tests/engine.test.ts` — run `npm test` to
execute them.

## Date kernel

| Function | Input | Expected |
| --- | --- | --- |
| `isoToDayNumber` → `dayNumberToIso` | `2026-10-20` | `2026-10-20` (round-trip) |
| `addDays` | `2026-10-29, +5` | `2026-11-03` (month boundary) |
| `addDays` | `2026-12-30, +4` | `2027-01-03` (year boundary) |
| `addDays` | `2028-02-28, +1` | `2028-02-29` (leap day exists in 2028) |
| `daysBetween` | `2028-02-28` → `2028-03-01` | `2` |
| `isoDate` parse | `2026-02-30`, `2026-13-01`, `not-a-date` | rejected (invalid calendar date) |

## Window basis

| Purchase | Rules | Reference | Expected |
| --- | --- | --- | --- |
| `purchaseDate 2026-10-01`, `deliveryDate 2026-10-03` | default (14d) | `2026-10-10` | `windowBasis: delivery_date`, `deadlineDate: 2026-10-17`, `daysRemaining: 7`, `status: ok` |
| `purchaseDate 2026-10-01`, no `deliveryDate` | default | `2026-10-10` | `windowBasis: order_date`, `deadlineDate: 2026-10-15`, assumption note states order-date basis |
| `purchaseDate 2026-10-01`, `deliveryDate 2026-10-03` | `windowDays: 30` | — | `deadlineDate: 2026-11-02` |

## Status bands (delivery `2026-10-03`, window 14 → deadline `2026-10-17`, defaults warn 5 / urgent 2)

| `referenceDate` | `daysRemaining` | `status` |
| --- | --- | --- |
| `2026-10-11` | 6 | `ok` |
| `2026-10-12` | 5 | `warn_soon` |
| `2026-10-15` | 2 | `urgent` |
| `2026-10-17` | 0 | `urgent` (deadline day itself) |
| `2026-10-18` | −1 | `expired` |
| any, `withdrawn: true` | — | `withdrawn` |

## Parcel links

| Parcel | Expected `trackingUrl` |
| --- | --- |
| `{ carrier: "postnl", trackingCode: "3SABCD123" }` | `https://postnl.nl/tracktrace/?B=3SABCD123` (registry match is case-insensitive) |
| `{ carrier: "dhl", trackingCode: "JJD01 2345" }` | `https://www.dhl.com/nl-en/home/tracking.html?tracking-id=JJD01%202345` (code URL-encoded) |
| `{ carrier: "some-local-courier", trackingCode: "X1", customTrackingUrl: "https://courier.example/t/X1" }` | the supplied custom URL, `knownCarrier: false` |
| `{ carrier: "some-local-courier", trackingCode: "X1" }` | local `/carrier-search?carrier=...&code=X1` fallback, `knownCarrier: false` |

## ICS invariants

- `DTSTART;VALUE=DATE:` — parameter stays unescaped (a `DTSTART\;VALUE=`
  line is a regression).
- Lines fold at ≤74 octets with `CRLF`+space continuation and never split
  a multi-byte UTF-8 character.
- Every active deadline emits two `VALARM`s: `TRIGGER:-P2D`,
  `TRIGGER:-P0D`.
