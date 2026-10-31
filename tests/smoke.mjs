/**
 * End-to-end smoke test for the static site.
 *
 * Usage: node tests/smoke.mjs <base-url>
 * Example: node tests/smoke.mjs http://127.0.0.1:8080/party-cards/
 *          node tests/smoke.mjs https://alexkutsan.github.io/party-cards/
 *
 * For every category and every game: home → rules → QR → several /c/ links.
 * The 18+ category must show an on-screen confirmation before its games appear.
 * At least one /m/ combination link is opened. Any console error fails the run.
 */
import { chromium } from 'playwright';

const rawBase = process.argv[2];
if (!rawBase) {
  console.error('Usage: node tests/smoke.mjs <base-url>');
  process.exit(1);
}
const ROOT = rawBase.endsWith('/') ? rawBase : rawBase + '/';
if (new URL(ROOT).pathname.replace(/\/$/, '') !== '/party-cards') {
  console.error('Refusing to run: base path must be /party-cards/, got ' + new URL(ROOT).pathname);
  process.exit(1);
}

const errors = [];
function fail(msg) {
  console.error('FAIL', msg);
  if (errors.length) console.error(errors.join('\n'));
  process.exit(1);
}
function drain(where) {
  if (!errors.length) return;
  const text = errors.splice(0).join('\n');
  fail(`console error during ${where}\n${text}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});
page.setDefaultTimeout(20000);
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});

function assertBase(url, where) {
  const path = new URL(url).pathname;
  if (path !== '/party-cards' && !path.startsWith('/party-cards/')) {
    fail(`${where} left /party-cards/: ${url}`);
  }
}

async function openHome() {
  await page.goto(ROOT, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen="home"]').waitFor();
  assertBase(page.url(), 'home');
  drain('home');
}

async function passAgeGate(confirm) {
  const gate = page.locator('[data-act="gate"]');
  await gate.scrollIntoViewIfNeeded();
  await gate.click();
  const yes = page.locator('[data-act="age-yes"]');
  await yes.waitFor();
  const box = await yes.boundingBox();
  const vh = page.viewportSize().height;
  if (!box || box.height < 40 || box.y < 0 || box.y + box.height > vh + 1) {
    fail('18+ confirmation is not visible in the viewport: ' + JSON.stringify(box));
  }
  const position = await page.locator('#modal').evaluate((el) => getComputedStyle(el).position);
  if (position !== 'fixed') fail('18+ confirmation is not an overlay (position: ' + position + ')');
  await (confirm ? yes : page.locator('[data-act="age-no"]')).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  drain('age gate');
}

function gameList(party) {
  const games = [];
  for (const section of party.sections) {
    for (const game of section.games) games.push({ ...game, sec: section.id, icon: section.icon });
  }
  return games;
}

function sampleIds(game, n) {
  const ids = game.decks.flatMap((d) => d.cards);
  if (!ids.length) return [];
  const picks = new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]]);
  return [...picks].slice(0, n);
}

async function openCard(url, game) {
  assertBase(url, 'card link');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  assertBase(page.url(), 'card page');
  const screen = page.locator('[data-screen="card"], [data-screen="combo"]');
  await screen.waitFor();
  const check = await page.evaluate((gid) => {
    const screenName = document.getElementById('app').dataset.screen;
    const gname = document.querySelector('.gname')?.textContent || '';
    if (!gname) return 'missing game name';
    if (screenName === 'card') {
      const id = location.pathname.split('/c/')[1];
      const card = PARTY.cards[id];
      if (!card) return 'unknown card';
      if (document.querySelector('.ctext')?.textContent !== card.t) return 'card text mismatch';
      if (card.g !== gid) return 'card belongs to ' + card.g;
    } else if (screenName === 'combo') {
      const bits = decodeURIComponent(location.pathname.split('/m/')[1] || '').split('~');
      const ids = bits.slice(0, 3);
      if (ids.length !== 3 || ids.some((id) => !PARTY.cards[id])) return 'combo parts missing';
      const slots = [...document.querySelectorAll('.slot')].map((el) => ({
        label: el.querySelector('small')?.textContent || '',
        text: el.querySelector('div')?.textContent || ''
      }));
      const labels = slots.map((s) => s.label);
      const expect = bits.length === 4 ? ['Кто → кому', 'Что', 'Где', 'Как и сколько'] : ['Что', 'Где', 'Как и сколько'];
      if (labels.join('|') !== expect.join('|')) return 'combo labels ' + labels.join('|');
      const offset = bits.length === 4 ? 1 : 0;
      for (let i = 0; i < 3; i++) {
        if (slots[offset + i].text !== PARTY.cards[ids[i]].t) return 'combo text mismatch';
      }
      if (bits.length === 4 && !/^Игрок \d+ → игрок \d+$/.test(slots[0].text)) return 'who line ' + slots[0].text;
    } else return 'unexpected screen ' + screenName;
    return '';
  }, game.id);
  if (check) fail(`${game.id} ${url}: ${check}`);
  drain('deep link ' + game.id);
}

async function playGame(game) {
  await openHome();
  if (game.sec === 'x18' && await page.locator('[data-act="gate"]').count()) {
    if (await page.locator(`[data-go="g/${game.id}"]`).count()) fail(game.id + ' is visible before 18+ confirmation');
    await passAgeGate(true);
  }
  const tile = page.locator(`[data-go="g/${game.id}"]`);
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await page.locator('[data-screen="rules"]').waitFor();
  assertBase(page.url(), game.id + ' rules');
  const rulesOk = await page.evaluate((id) => {
    const g = PARTY.sections.flatMap((s) => s.games).find((x) => x.id === id);
    const h1 = document.querySelector('h1')?.textContent || '';
    const body = document.querySelector('.md')?.innerText || '';
    return h1 === g.short && body.length > 40;
  }, game.id);
  if (!rulesOk) fail(game.id + ' rules screen is wrong');
  drain(game.id + ' rules');

  await page.locator(`[data-go="p/${game.id}"]`).click();
  await page.locator('[data-screen="play"]').waitFor();
  assertBase(page.url(), game.id + ' play');
  if (game.mode === 'bandit') {
    for (let i = 0; i < 4; i++) await page.locator('[data-act="players"][data-d="1"]').click();
  }
  await page.locator('[data-act="draw"]').click();
  await page.locator('#sheet:not([hidden])').waitFor();
  const sheet = await page.locator('#sheet').innerText();
  if (!sheet.includes('Покажите код игроку') || !sheet.includes('Закрыть / следующий')) {
    fail(game.id + ' QR screen missing host chrome');
  }
  const cardUrl = await page.locator('#qr').getAttribute('data-card-url');
  if (!cardUrl) fail(game.id + ' QR has no URL');
  assertBase(cardUrl, game.id + ' QR url');
  const leaked = await page.evaluate((u) => {
    const path = new URL(u).pathname;
    const body = document.body.innerText;
    if (path.includes('/m/')) {
      return decodeURIComponent(path.split('/m/')[1]).split('~').slice(0, 3)
        .some((id) => PARTY.cards[id] && body.includes(PARTY.cards[id].t));
    }
    const id = decodeURIComponent(path.split('/c/')[1] || '');
    return !!(PARTY.cards[id] && body.includes(PARTY.cards[id].t));
  }, cardUrl);
  if (leaked) fail(game.id + ' host screen shows card text');
  if (game.mode === 'bandit' && !cardUrl.includes('/m/')) fail(game.id + ' bandit QR is not a combination link');
  drain(game.id + ' QR');

  await openCard(cardUrl, game);
  for (const id of sampleIds(game, 3)) {
    await openCard(new URL('c/' + id, ROOT).href, game);
  }
  console.log('OK', game.sec, game.id, game.short);
}

await openHome();
const host = new URL(ROOT).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen="home"]').waitFor();
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) fail('service worker is not controlling the page');
  drain('service worker');
}
const party = await page.evaluate(() => window.PARTY);
if (!party || party.sections.length !== 3) fail('expected 3 categories');
const games = gameList(party);
if (games.length !== 15) fail('expected 15 games, got ' + games.length);
const adult = games.filter((g) => g.sec === 'x18');
const rest = games.filter((g) => g.sec !== 'x18');
if (adult.length !== 5) fail('expected 5 games in Финал 18+');
if (await page.locator('[data-go="g/x181"]').count()) fail('18+ games are listed before confirmation');
if (!await page.locator('[data-go="g/deep1"]').count()) fail('first category did not render');
await passAgeGate(false);
if (await page.locator('[data-go="g/x181"]').count()) fail('declining 18+ revealed the category');

for (const game of rest) await playGame(game);
for (const game of adult) await playGame(game);

drain('end');
await browser.close();
console.log(`SMOKE OK base=${ROOT} categories=3 games=${games.length} adult=${adult.length}`);
