import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deadlineComputeInputSchema, icsExportInputSchema, parcelSchema } from './schema.js';
import { z } from 'zod';
import { computeDeadlines, buildDeadlineCalendar, parcelTrackingLink, CARRIER_NAMES } from './engine.js';

export const WIDGET_URI = 'ui://pmc/purchases.html';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const parcelLinkInput = z.object({ parcel: parcelSchema });
const sc = <T extends object>(value: T) => value as unknown as Record<string, unknown>;

export function createMcpServer(html: string) {
  const server = new McpServer({ name: 'purchase-management-collection', version: '0.1.0' });

  server.registerTool('compute_purchase_deadlines', {
    title: 'Compute purchase withdrawal deadlines',
    description: 'Compute model withdrawal/return deadline dates for supplied purchase records. Every result is a qualified model date based on the recorded delivery or order date plus a configurable window (default 14 days) — not legal advice, and no external account is accessed.',
    inputSchema: deadlineComputeInputSchema,
    annotations,
    _meta: { ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI }
  }, async input => {
    try {
      const result = computeDeadlines(input.purchases, input.rules, input.referenceDate);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: sc(result) };
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Invalid or inconsistent purchase input.' }] };
    }
  });

  server.registerTool('export_deadline_calendar', {
    title: 'Export deadlines as iCalendar',
    description: 'Produce an RFC 5545 iCalendar feed with one all-day event per purchase deadline and display alarms two days before and on the day. Nothing is delivered; the caller imports the .ics into their own calendar. Model dates only — not legal advice.',
    inputSchema: icsExportInputSchema,
    annotations,
    _meta: { ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI }
  }, async input => {
    try {
      const ics = buildDeadlineCalendar(input);
      return { content: [{ type: 'text' as const, text: ics }], structuredContent: sc({ filename: 'purchase-deadlines.ics', ics }) };
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Invalid purchase input for calendar export.' }] };
    }
  });

  server.registerTool('resolve_parcel_tracking_link', {
    title: 'Resolve a public carrier tracking link',
    description: `Format a public track-and-trace URL for a known carrier (${CARRIER_NAMES.join(', ')}) or pass through a user-supplied tracking URL for unknown carriers. Only formats links — it never queries or scrapes the carrier.`,
    inputSchema: parcelLinkInput,
    annotations
  }, async input => {
    try {
      const link = parcelTrackingLink(input.parcel);
      return { content: [{ type: 'text' as const, text: JSON.stringify(link) }], structuredContent: sc(link) };
    } catch {
      return { isError: true, content: [{ type: 'text' as const, text: 'Invalid parcel input.' }] };
    }
  });

  server.registerResource('pmc-purchases', WIDGET_URI, { title: 'Purchase Management Collection tracker', mimeType: 'text/html;profile=mcp-app' },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: html }] }));
  return server;
}
