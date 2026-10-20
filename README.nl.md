# Purchase Management Collection

Local-first aankoop-, herroepings- en pakketvolger. Een strikt getypeerde TypeScript-webapp die EU-consumenten helpt bij te houden wat ze kochten, een duidelijk gelabeld model van hun wettelijke herroepingstermijn te zien, en pakketten te volgen via publieke trackingpagina's van vervoerders. Alles draait op het eigen apparaat van de gebruiker: geen account, geen analytics, geen serveropslag.

De app modelleert de EU-brede herroepingstermijn van 14 dagen (Consumentenrechtenrichtlijn 2011/83/EU, aangescherpt door Richtlijn (EU) 2023/2673 — in Nederland van kracht sinds 19 juni 2026, toen de verplichte herroepingsknop voor webshops inging). Elke berekende datum is een **modeldatum met expliciete aannames — nooit juridisch advies en nooit een gegarandeerde wettelijke termijn.**

## Functies

- **Aankooprecords** — winkel, referentie, bestel- en leverdatum, opgeslagen in de lokale opslag van de browser.
- **Model-herroepingstermijnen** — deterministische kalenderdag-engine op UTC; instelbare termijn (standaard 14 dagen), waarschuwings- en urgente statusbanden, expliciete leverings- versus besteldatum-aannames.
- **RFC 5545 kalenderexport** — `.ics`-download met correcte regelvouw/escaping en twee herinneringsalarmen; de gebruiker importeert het zelf in de eigen kalender (geen herinneringen worden verzonden).
- **Publieke track-en-tracelinks** — register van 10 vervoerders (PostNL, DHL, DHL for You, DPD, GLS, UPS, bpost, FedEx, Amazon Logistics, InPost/Kiala) op basis van uitsluitend publieke trackingpagina's; onbekende vervoerders krijgen een nette lokale fallback. Geen vervoerder-API's, geen scraping.
- **Draagbare dossiers** — versieerde JSON-export/-import zodat gegevens een browser- of apparaatwissel overleven.
- **Alleen-lezen MCP-integratie** — een Model Context Protocol-server stelt de records beschikbaar aan lokale assistenten voor leestoegang; de app uploadt nooit persoonlijke aankoopgegevens naar externe modellen.

## Aan de slag

Vereist Node.js 22 of nieuwer.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Open `http://127.0.0.1:4326/`. `PMC_PORT` overschrijft de poort. De service bindt alleen aan `127.0.0.1`, accepteert alleen loopback-hostnamen, handhaaft een JSON-bodylimiet van 64 KiB en same-origin-controles, en verzendt strikte no-store beveiligingsheaders. Invoer wordt per request in het geheugen verwerkt; er wordt niets naar schijf geschreven.

## Architectuur

| Bestand | Rol |
| --- | --- |
| `schema.ts` | Zod in-/uitvoerschema's — het publieke datacontract |
| `engine.ts` | Deterministische deadline-rekenkunde, vervoerderlinks, RFC 5545 ICS-generatie, dossiervalidatie |
| `http.ts` | Loopback web-/API-server (`/api/*`) |
| `mcp.ts` | Streamable-HTTP MCP-server met alleen-lezen tools + ingebedde widget-resource |
| `server.ts` | Entrypoint: serveert widget, API en MCP op één loopback-poort |
| `widget.html` | Zelfstandige browser-UI (localStorage) |
| `tests/` | Vitest-suites: engine, HTTP, MCP, widget |
| `docs/` | `SPEC.md` (publieke contract) en `TEST-VECTORS.md` |

## Grenzen

- Geen e-mailtoegang, geen accountkoppelingen aan shops of vervoerders, geen pakket-API's, geen herinneringen op afstand, geen analytics, geen accounts.
- Deadline-uitvoer is een gelabeld model op basis van de vastgelegde leverdatum; echte wettelijke termijnen hangen af van geverifieerde feiten en het geldende recht — raadpleeg de bevoegde instantie of een jurist voor een bindend antwoord.
- Niet gelieerd aan vervoerders; trackinglinks wijzen naar de eigen publieke pagina's van de vervoerders.

## Licentie

MIT — zie [LICENSE](LICENSE).
