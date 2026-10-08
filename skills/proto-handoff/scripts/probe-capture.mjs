// node probe-capture.mjs <url> <captureId> — sends one plain page (a 200×80 box) to a capture id:
// when even this stays "processing", Figma stopped converting captures for the file
import { chromium } from 'playwright-core';
import { chromePath } from './lib/browser.mjs';
const [url, id] = process.argv.slice(2);
const js = await (await fetch('https://mcp.figma.com/mcp/html-to-design/capture.js')).text();
const browser = await chromium.launch({ executablePath: chromePath() });
const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
await page.goto(url);
await page.evaluate((s) => { const el = document.createElement('script'); el.textContent = s; document.head.appendChild(el); }, js);
await page.waitForTimeout(400);
const endpoint = `https://mcp.figma.com/mcp/capture/${id}/submit?bindVariables=true`;
const req = page.waitForRequest((r) => r.url().startsWith(endpoint.split('?')[0]), { timeout: 60000 });
await page.evaluate(({ id, endpoint }) => { window.figma.captureForDesign({ captureId: id, endpoint, selector: 'body' }); }, { id, endpoint });
const r = await req;
const res = await Promise.race([r.response(), new Promise((ok) => setTimeout(() => ok(null), 45000))]);
console.log(JSON.stringify({ sent: true, status: res ? res.status() : 'no response in 45s' }));
await browser.close();
