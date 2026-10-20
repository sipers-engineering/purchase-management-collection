import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { handleRequest } from './http.js';

export async function createLocalServer() {
  const html = await readFile(new URL('./widget.html', import.meta.url), 'utf8');
  return createServer(async (req, res) => {
    const host = req.headers.host;
    if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) { res.writeHead(403); res.end('Host not allowed'); return; }
    try {
      const request = new Request(`http://${host}${req.url ?? '/'}`, {
        method: req.method, headers: req.headers as HeadersInit,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {})
      } as RequestInit);
      const response = await handleRequest(request, html);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)) res.write(chunk);
      res.end();
    } catch { res.writeHead(500); res.end('Service request failed'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PMC_PORT ?? 4326);
  (await createLocalServer()).listen(port, '127.0.0.1', () => console.log(`Purchase Management Collection listening on http://127.0.0.1:${port}`));
}
