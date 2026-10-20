import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../widget.html', import.meta.url), 'utf8');

describe('widget structure', () => {
  it('declares a strict content security policy', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'self'");
    expect(html).toContain("frame-ancestors 'none'");
  });
  it('is self-contained: no external scripts, styles or images', () => {
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).not.toMatch(/<img[^>]+src="http/);
  });
  it('persists purchases under the versioned localStorage key', () => {
    expect(html).toContain("pmc.purchases.v1");
    expect(html).toContain('localStorage.setItem');
  });
  it('offers the four core workflows', () => {
    expect(html).toContain('b-add');       // add purchase
    expect(html).toContain('b-ics');       // ics download
    expect(html).toContain('b-export');    // dossier export
    expect(html).toContain('b-import');    // dossier import
  });
  it('states the model-date qualification up front', () => {
    expect(html).toContain('not legal advice');
    expect(html).toContain('herroepingsrecht');
  });
  it('only calls same-origin api routes', () => {
    for (const m of html.matchAll(/fetch\('([^']+)'/g)) {
      expect(m[1]).toMatch(/^\/api\//);
    }
  });
  it('renders status badges for every deadline status', () => {
    for (const s of ['b-ok', 'b-warn_soon', 'b-urgent', 'b-expired', 'b-withdrawn']) expect(html).toContain(s);
  });
});
