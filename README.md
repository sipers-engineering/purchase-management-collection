# Purchase Management Collection

Local-first purchase, return-deadline and parcel tracker. A strict-TypeScript web application that helps EU consumers record what they bought, see a clearly-labeled model of their statutory right-of-withdrawal window, and follow parcels via public carrier tracking pages. Everything runs on the user's own device: no account, no analytics, no server persistence.

The app models the EU-wide 14-day right of withdrawal (Consumer Rights Directive 2011/83/EU, extended by Directive (EU) 2023/2673 — in the Netherlands in force since 19 June 2026, when the mandatory webshop withdrawal-button rule took effect). Every computed date is a **model date with explicit assumptions — never legal advice and never a guaranteed statutory deadline.**

## Features

- **Purchase records** — merchant, reference, order and delivery dates, stored in the browser's local storage.
- **Model withdrawal deadlines** — deterministic UTC-exact calendar-day engine; configurable window (default 14 days), warn/urgent status bands, explicit delivery-vs-order-date assumptions.
- **RFC 5545 calendar export** — `.ics` download with correct line folding/escaping and two reminder alarms; the user imports it into their own calendar (no reminder delivery).
- **Public parcel tracking links** — registry of 10 carriers (PostNL, DHL, DPD, GLS, UPS, FedEx, DHL Parcel, Mondial Relay, bpost, Colissimo) built from public tracking pages only; unknown carriers get a graceful fallback. No carrier APIs, no scraping.
- **Portable dossiers** — versioned JSON export/import so records survive a browser or device change.
- **Read-only MCP integration** — a Model Context Protocol server exposes the user's records to local assistants for read access; the app never uploads personal purchase data to remote models.

## Getting started

Requires Node.js 22 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Open `http://127.0.0.1:4326/`. `PMC_PORT` overrides the port. The service binds only to `127.0.0.1`, accepts only loopback hostnames, enforces a 64 KiB JSON body limit and same-origin checks, and sends strict no-store security headers. Server input is handled in memory per request; nothing is written to disk.

## Architecture

| File | Role |
| --- | --- |
| `schema.ts` | Zod input/output schemas — the public data contract |
| `engine.ts` | Deterministic deadline math, carrier-link registry, RFC 5545 ICS generation, dossier validation |
| `http.ts` | Loopback web/API server (`/api/*` endpoints) |
| `mcp.ts` | Streamable-HTTP MCP server with read-only tools + embedded widget resource |
| `server.ts` | Entrypoint: serves the widget, API and MCP on one loopback port |
| `widget.html` | Self-contained browser UI (localStorage persistence) |
| `tests/` | Vitest suites: engine, HTTP, MCP, widget |

## Boundaries

- No email access, no order-account connections, no parcel-API integrations, no remote reminders, no analytics, no accounts.
- Deadline output is a labeled model based on the recorded delivery date; real statutory deadlines depend on verified facts and current law — consult the competent authority or a legal professional for a binding answer.
- Not affiliated with any carrier; tracking links point to the carriers' own public pages.

## License

MIT — see [LICENSE](LICENSE).
