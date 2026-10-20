import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, WIDGET_URI } from '../mcp.js';

async function connected(html = '<html>pmc</html>') {
  const server = createMcpServer(html);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.1' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

const purchase = { id: 'p1', merchant: 'bol.com', purchaseDate: '2026-10-01', deliveryDate: '2026-10-03', parcels: [], withdrawn: false };

describe('mcp tools', () => {
  it('lists the three PMC tools plus the widget resource', async () => {
    const { client, server } = await connected();
    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name).sort()).toEqual(['compute_purchase_deadlines', 'export_deadline_calendar', 'resolve_parcel_tracking_link']);
    const resources = await client.listResources();
    expect(resources.resources.map(r => r.uri)).toContain(WIDGET_URI);
    await client.close(); await server.close();
  });

  it('compute_purchase_deadlines returns structured model dates', async () => {
    const { client, server } = await connected();
    const res = await client.callTool({ name: 'compute_purchase_deadlines', arguments: { purchases: [purchase], referenceDate: '2026-10-10' } });
    const sc = res.structuredContent as { deadlines: Array<{ deadlineDate: string; status: string }> };
    expect(sc.deadlines[0]!.deadlineDate).toBe('2026-10-17');
    expect(sc.deadlines[0]!.status).toBe('ok');
    await client.close(); await server.close();
  });

  it('export_deadline_calendar returns an ics payload', async () => {
    const { client, server } = await connected();
    const res = await client.callTool({ name: 'export_deadline_calendar', arguments: { purchases: [purchase] } });
    const sc = res.structuredContent as { filename: string; ics: string };
    expect(sc.filename).toBe('purchase-deadlines.ics');
    expect(sc.ics).toContain('BEGIN:VCALENDAR');
    await client.close(); await server.close();
  });

  it('resolve_parcel_tracking_link formats a public URL', async () => {
    const { client, server } = await connected();
    const res = await client.callTool({ name: 'resolve_parcel_tracking_link', arguments: { parcel: { carrier: 'DHL', trackingCode: 'JD01460000341234' } } });
    const sc = res.structuredContent as { trackingUrl: string; knownCarrier: boolean };
    expect(sc.trackingUrl).toContain('dhl.com');
    expect(sc.knownCarrier).toBe(true);
    await client.close(); await server.close();
  });

  it('flags inconsistent input as isError without throwing', async () => {
    const { client, server } = await connected();
    const res = await client.callTool({ name: 'compute_purchase_deadlines', arguments: { purchases: [{ ...purchase, deliveryDate: '2026-09-01' }] } });
    expect(res.isError).toBe(true);
    await client.close(); await server.close();
  });

  it('serves the widget html as an mcp-app resource', async () => {
    const { client, server } = await connected();
    const res = await client.readResource({ uri: WIDGET_URI });
    expect(res.contents[0]!.mimeType).toContain('mcp-app');
    const content = res.contents[0]!;
    expect('text' in content ? content.text : '').toContain('pmc');
    await client.close(); await server.close();
  });
});
