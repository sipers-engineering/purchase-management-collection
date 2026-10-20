import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { deadlineComputeInputSchema, icsExportInputSchema } from './schema.js';
import { computeDeadlines, buildDeadlineCalendar, importDossierExport, buildDossierExport, CARRIER_NAMES } from './engine.js';
import { createMcpServer } from './mcp.js';

const MAX_BYTES = 64 * 1024;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw Error('Request exceeds 64 KiB');
  const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel().catch(() => {}); throw Error('Request exceeds 64 KiB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Error('Malformed JSON'); }
}

const issues = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
  error.issues.map(i => ({ path: i.path, message: i.message }));

export async function handleRequest(request: Request, html: string): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'Origin not allowed' }, 403);
  if (path === '/healthz') return request.method === 'GET' ? json({ ok: true, product: 'Purchase Management Collection' }) : json({ error: 'Method not allowed' }, 405);
  if (path === '/api/health') return request.method === 'GET' ? json({ status: 'ok', service: 'purchase-management-collection', uptimeSec: Math.floor(process.uptime()), carriers: CARRIER_NAMES.length }) : json({ error: 'Method not allowed' }, 405);
  if (path === '/api/carriers') return request.method === 'GET' ? json({ carriers: CARRIER_NAMES, note: 'Public carrier track-and-trace link patterns. Unknown carriers need a user-supplied tracking URL.' }) : json({ error: 'Method not allowed' }, 405);
  if (path === '/carrier-search') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const carrier = url.searchParams.get('carrier') ?? 'this carrier';
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unknown carrier</title></head><body><p><strong>${carrier.replace(/[<>&"]/g, '')}</strong> is not in the built-in carrier registry. Check the carrier's own website for tracking, or store its tracking URL as a custom tracking URL on the purchase.</p></body></html>`,
      { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" } });
  }
  if (path === '/' || path === '/widget.html') return request.method === 'GET' ? new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } }) : json({ error: 'Method not allowed' }, 405);
  if (!['/api/deadlines', '/api/ics', '/api/dossier', '/mcp'].includes(path)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if ((request.headers.get('content-type')?.split(';')[0] ?? '').trim().toLowerCase() !== 'application/json') return json({ error: 'Expected application/json' }, 415);
  let body: unknown;
  try { body = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400); }

  if (path === '/api/deadlines') {
    const parsed = deadlineComputeInputSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid input', issues: issues(parsed.error) }, 400);
    try { return json(computeDeadlines(parsed.data.purchases, parsed.data.rules, parsed.data.referenceDate)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Computation failed' }, 400); }
  }

  if (path === '/api/ics') {
    const parsed = icsExportInputSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid input', issues: issues(parsed.error) }, 400);
    try {
      const ics = buildDeadlineCalendar(parsed.data);
      if (request.headers.get('accept')?.includes('text/calendar')) {
        return new Response(ics, { headers: { ...headers, 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="purchase-deadlines.ics"' } });
      }
      return json({ ok: true, ics, filename: 'purchase-deadlines.ics' });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Calendar build failed' }, 400); }
  }

  if (path === '/api/dossier') {
    const result = importDossierExport(body);
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ ok: true, dossier: buildDossierExport(result.dossier!.purchases, result.dossier!.savedAt) });
  }

  const server = createMcpServer(html);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BYTES });
  await server.connect(transport);
  try { return await transport.handleRequest(request, { parsedBody: body }); }
  finally { await server.close(); }
}
