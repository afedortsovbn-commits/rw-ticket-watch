import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'E:/ClaudeProj/avby-cars/discovery.log';
const log = (s) => { fs.appendFileSync(OUT, s + '\n'); console.log(s); };
fs.writeFileSync(OUT, '');

const USERDATA = 'E:/ClaudeProj/avby-cars/profile';
const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'ru-RU',
  viewport: { width: 1366, height: 900 },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
const page = ctx.pages()[0] || await ctx.newPage();

page.on('response', async (resp) => {
  const rt = resp.request().resourceType();
  if (rt === 'xhr' || rt === 'fetch') log(`[${rt}] ${resp.status()} ${resp.url()}`);
});

const url = 'https://cars.av.by/filter?brands[0][brand]=15';
log('GOTO ' + url);
try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { log('NAV ERR ' + e.message); }

// Try to solve the SafeLine "Confirm You Are Human" challenge
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1500);
  const t = await page.title();
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(()=>'');
  const blocked = txt.includes('Confirm') || txt.includes('безопасности') || txt.includes('Human');
  if (!blocked && !t.includes('купить, продать')) { log('PASSED after ' + (i*1.5) + 's, title=' + t); break; }
  // try clicking confirm-ish buttons
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, div[role=button], [class*=confirm i], [id*=confirm i]')];
    for (const e of els) {
      const s = (e.innerText || e.value || '').toLowerCase();
      if (s.includes('confirm') || s.includes('подтверд') || s.includes('human') || s.includes('я не робот')) { e.click(); return s; }
    }
    return null;
  }).catch(()=>null);
  if (clicked) log('clicked: ' + clicked);
  log('  waiting... t=' + t + ' blocked=' + blocked);
}

await page.waitForTimeout(4000);
log('FINAL TITLE: ' + await page.title());
const html = await page.content();
log('HTML len: ' + html.length + ' hasListing=' + html.includes('listing') + ' hasNext=' + html.includes('__NEXT_DATA__'));
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(()=>'');
log('BODY:\n' + bodyText);
fs.writeFileSync('E:/ClaudeProj/avby-cars/page.html', html);
await page.screenshot({ path: 'E:/ClaudeProj/avby-cars/page.png' }).catch(()=>{});

await ctx.close();
log('\nDONE');
