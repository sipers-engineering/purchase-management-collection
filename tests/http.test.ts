import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { handleRequest } from '../http.js';

const html = '<html><body>pmc</body></html>';
const req = (path: string, init: RequestInit = {}) => new Request(`http://127.0.0.1:4326${path}`, init);
const post = (path: string, body: unknown, extra: RequestInit = {}) => {
  const { headers: extraHeaders, ...rest } = extra;
  return req(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(extraHeaders as Record<string, string> | undefined) }, body: JSON.stringify(body), ...rest });
};
const purchase = { id: 'p1', merchant: 'bol.com', purchaseDate: '2026-10-01', deliveryDate: '2026-10-03', parcels: [], withdrawn: false };

describe('static and health routes', () => {
  it('serves the widget with a strict CSP and no-store', async () => {
    const res = await handleRequest(req('/'), html);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('pmc');
  });
  it('answers both health routes', async () => {
    expect((await (await handleRequest(req('/healthz'), html)).json()).ok).toBe(true);
    const h = await (await handleRequest(req('/api/health'), html)).json();
    expect(h.status).toBe('ok');
    expect(h.service).toBe('purchase-management-collection');
    expect(h.carriers).toBeGreaterThanOrEqual(8);
  });
  it('lists the carrier registry', async () => {
    const res = await handleRequest(req('/api/carriers'), html);
    const body = await res.json();
    expect(body.carriers).toContain('POSTNL');
  });
  it('rejects unknown paths, wrong methods and foreign origins', async () => {
    expect((await handleRequest(req('/nope'), html)).status).toBe(404);
    expect((await handleRequest(req('/api/deadlines'), html)).status).toBe(405);
    expect((await handleRequest(req('/', { headers: { origin: 'http://evil.example' } }), html)).status).toBe(403);
  });
});

describe('json api enforcement', () => {
  it('requires application/json', async () => {
    const res = await handleRequest(req('/api/deadlines', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }), html);
    expect(res.status).toBe(415);
  });
  it('rejects malformed JSON and oversized bodies', async () => {
    const bad = await handleRequest(req('/api/deadlines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }), html);
    expect(bad.status).toBe(400);
    const big = await handleRequest(req('/api/deadlines', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '70000' }, body: '{}' }), html);
    expect(big.status).toBe(400);
  });
});

describe('deadlines endpoint', () => {
  it('computes deadlines for valid input', async () => {
    const res = await handleRequest(post('/api/deadlines', { purchases: [purchase], referenceDate: '2026-10-10' }), html);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool).toBe('pmc_deadline_tracker');
    expect(body.deadlines[0].deadlineDate).toBe('2026-10-17');
    expect(body.deadlines[0].status).toBe('ok');
  });
  it('returns zod issues on invalid input', async () => {
    const res = await handleRequest(post('/api/deadlines', { purchases: [{ id: 'x' }] }), html);
    expect(res.status).toBe(400);
    expect((await res.json()).issues.length).toBeGreaterThan(0);
  });
  it('returns 400 on inconsistent dates', async () => {
    const res = await handleRequest(post('/api/deadlines', { purchases: [{ ...purchase, deliveryDate: '2026-09-01' }] }), html);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('before purchase');
  });
});

describe('ics endpoint', () => {
  it('returns JSON {ics} by default', async () => {
    const res = await handleRequest(post('/api/ics', { purchases: [purchase] }), html);
    const body = await res.json();
    expect(body.filename).toBe('purchase-deadlines.ics');
    expect(body.ics).toContain('BEGIN:VCALENDAR');
  });
  it('serves a text/calendar download when asked', async () => {
    const res = await handleRequest(post('/api/ics', { purchases: [purchase] }, { headers: { accept: 'text/calendar' } }), html);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('content-disposition')).toContain('purchase-deadlines.ics');
    expect(await res.text()).toContain('BEGIN:VEVENT');
  });
  it('validates the input', async () => {
    expect((await handleRequest(post('/api/ics', { purchases: [] }), html)).status).toBe(400);
  });
});

describe('dossier endpoint', () => {
  it('validates and regenerates a dossier', async () => {
    const res = await handleRequest(post('/api/dossier', { format: 'purchase-management-collection', version: 1, savedAt: '2026-10-20', purchases: [purchase] }), html);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dossier.purchases[0].merchant).toBe('bol.com');
  });
  it('rejects malformed dossiers', async () => {
    const res = await handleRequest(post('/api/dossier', { format: 'nope' }), html);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid dossier');
  });
});

describe('html asset', () => {
  it('widget file exists and stays self-contained', async () => {
    const file = await readFile(new URL('../widget.html', import.meta.url), 'utf8');
    expect(file).toContain('Purchase Management Collection');
    expect(file).not.toMatch(/src="http|href="http/);
  });
});
