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
function watch(p) {
  p.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  p.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
}
watch(page);
page.context().on('page', watch);
const openedTabFor = new Set();

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

async function passAgeGate(confirm, which = 'x18') {
  const xx = which === 'xx';
  const gate = page.locator(xx ? '[data-act="gate-xx"]' : '[data-act="gate"]');
  await gate.scrollIntoViewIfNeeded();
  await gate.click();
  const yes = page.locator(xx ? '[data-act="xx-yes"]' : '[data-act="age-yes"]');
  await yes.waitFor();
  const box = await yes.boundingBox();
  const vh = page.viewportSize().height;
  if (!box || box.height < 40 || box.y < 0 || box.y + box.height > vh + 1) {
    fail(which + ' confirmation is not visible in the viewport: ' + JSON.stringify(box));
  }
  const position = await page.locator('#modal').evaluate((el) => getComputedStyle(el).position);
  if (position !== 'fixed') fail(which + ' confirmation is not an overlay (position: ' + position + ')');
  if (xx) {
    const text = await page.locator('#modal').innerText();
    if (!text.includes('Extreme') || !text.includes('Красный')) fail('extreme gate text missing');
  }
  await (confirm ? yes : page.locator(xx ? '[data-act="xx-no"]' : '[data-act="age-no"]')).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  drain('age gate ' + which);
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
      const howLabel = (PARTY.cards[ids[2]] && PARTY.cards[ids[2]].d.includes('сколько')) ? 'Как и сколько' : 'Как';
      const expect = bits.length === 4 ? ['Кто → кому', 'Что', 'Где', howLabel] : ['Что', 'Где', howLabel];
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
  if (game.sec === 'xx') {
    const foot = await page.locator('.foot').innerText();
    if (!foot.includes('Красный')) fail(game.id + ' card missing stop-word Красный');
  }
  drain('deep link ' + game.id);
}

async function playGame(game) {
  await openHome();
  if ((game.sec === 'x18' || game.sec === 'xx') && await page.locator(game.sec === 'xx' ? '[data-act="gate-xx"]' : '[data-act="gate"]').count()) {
    if (await page.locator(`[data-go="g/${game.id}"]`).count()) fail(game.id + ' is visible before confirmation');
    await passAgeGate(true, game.sec);
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
  if (game.sec === 'xx' && !globalThis.__xxBefore) {
    await page.locator('[data-go="s/xx"]').click();
    await page.locator('[data-screen="section"]').waitFor();
    const prep = await page.locator('.md').innerText();
    if (!prep.includes('Красный') || !prep.includes('Забота')) fail('extreme before/aftercare page');
    await page.locator('.back').click();
    await page.locator('[data-screen="rules"]').waitFor();
    globalThis.__xxBefore = true;
  }
  drain(game.id + ' rules');

  await page.locator(`[data-go="p/${game.id}"], [data-go="game/${game.id}"]`).click();
  await page.locator('[data-screen="play"]').waitFor();
  assertBase(page.url(), game.id + ' play');
  if (game.mode === 'score') {
    await assertScore(game);
    console.log('OK', game.sec, game.id, game.short);
    return;
  }
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
  const openTab = page.locator('#openTab');
  const openHref = await openTab.getAttribute('href');
  if (openHref !== cardUrl) fail(game.id + ' open-tab href ' + openHref + ' != ' + cardUrl);
  if (await openTab.getAttribute('target') !== '_blank') fail(game.id + ' open-tab target');
  const rel = (await openTab.getAttribute('rel') || '').split(/\s+/);
  if (!rel.includes('noopener')) fail(game.id + ' open-tab rel');
  const wantTab = !openedTabFor.has(game.sec) || (cardUrl.includes('/m/') && !openedTabFor.has('m'));
  if (wantTab) {
    const popupPromise = page.context().waitForEvent('page');
    await openTab.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.locator('[data-screen="card"], [data-screen="combo"]').waitFor();
    const same = new URL(popup.url()).href.split('#')[0] === new URL(cardUrl).href.split('#')[0];
    if (!same) fail(game.id + ' new tab opened ' + popup.url() + ' instead of ' + cardUrl);
    const loaded = await popup.evaluate(() => {
      const screen = document.getElementById('app').dataset.screen;
      const path = location.pathname;
      if (screen === 'card') {
        const id = decodeURIComponent(path.split('/c/')[1] || '');
        return document.querySelector('.ctext')?.textContent === PARTY.cards[id]?.t;
      }
      if (screen === 'combo') {
        const ids = decodeURIComponent(path.split('/m/')[1] || '').split('~').slice(0, 3);
        const slots = [...document.querySelectorAll('.slot div')].map((el) => el.textContent);
        return ids.every((id) => PARTY.cards[id] && slots.includes(PARTY.cards[id].t));
      }
      return false;
    });
    if (!loaded) fail(game.id + ' new tab did not show the card');
    await popup.close();
    openedTabFor.add(game.sec);
    if (cardUrl.includes('/m/')) openedTabFor.add('m');
    drain(game.id + ' new tab');
  }
  drain(game.id + ' QR');

  await openCard(cardUrl, game);
  for (const id of sampleIds(game, 3)) {
    await openCard(new URL('c/' + id, ROOT).href, game);
  }
  if (game.id === 'x182') await assertBottleFinale();
  console.log('OK', game.sec, game.id, game.short);
}

async function assertBottleFinale() {
  const finaleId = await page.evaluate(() => {
    const g = PARTY.sections.flatMap((s) => s.games).find((x) => x.id === 'x182');
    const ids = g.decks.flatMap((d) => d.cards);
    const finale = ids.filter((id) => PARTY.cards[id].t.includes('**Финальная:**'));
    if (finale.length !== 1 || PARTY.cards[finale[0]].n !== 90) return '';
    const other = ids.find((id) => id !== finale[0]);
    localStorage.setItem('pc1_x182', JSON.stringify({
      drawn: ids.filter((id) => id !== finale[0] && id !== other),
      decks: [0],
      levels: null,
      last: null
    }));
    return finale[0];
  });
  if (!finaleId) fail('bottle finale card missing or renumbered');
  await page.goto(new URL('p/x182', ROOT).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen="play"]').waitFor();
  await page.locator('[data-act="draw"]').click();
  await page.locator('#sheet:not([hidden])').waitFor();
  const mid = await page.locator('#qr').getAttribute('data-card-url');
  if (mid.includes(finaleId)) fail('Финальная was drawn while another bottle card remained');
  await page.evaluate((fid) => {
    const ids = PARTY.sections.flatMap((s) => s.games).find((x) => x.id === 'x182').decks.flatMap((d) => d.cards);
    localStorage.setItem('pc1_x182', JSON.stringify({
      drawn: ids.filter((id) => id !== fid),
      decks: [0],
      levels: null,
      last: null
    }));
  }, finaleId);
  await page.goto(new URL('p/x182', ROOT).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-act="draw"]').click();
  await page.locator('#sheet:not([hidden])').waitFor();
  const last = await page.locator('#qr').getAttribute('data-card-url');
  if (!last.endsWith('/c/' + finaleId) && !last.includes('/c/' + finaleId)) fail('Финальная was not drawn when it was the last card');
  drain('bottle finale');
}

async function assertBanditLinks(game) {
  const links = await page.evaluate((gid) => {
    const g = PARTY.sections.flatMap((s) => s.games).find((x) => x.id === gid);
    const cards = (prefix) => g.decks.filter((d) => d.name.startsWith(prefix)).flatMap((d) => d.cards.map((id) => PARTY.cards[id]));
    const byN = (list) => list.slice().sort((a, b) => a.n - b.n);
    const what = byN(cards('Бандит — Что'));
    const where = byN(cards('Бандит — Где'));
    const how = byN(cards('Бандит — Как'));
    if (!what.length || !where.length || !how.length) return null;
    const pack = (w, d, h) => `m/${w.id}~${d.id}~${h.id}`;
    return {
      old: pack(what[0], where[0], how[0]),
      neu: pack(what[what.length - 1], where[where.length - 1], how[how.length - 1]) + '~2-5'
    };
  }, game.id);
  if (!links) fail('could not build bandit combination samples for ' + game.id);
  await openCard(new URL(links.old, ROOT).href, game);
  await openCard(new URL(links.neu, ROOT).href, game);
}

async function assertScore(game) {
  if (!await page.locator('[data-sum="open-set"]').count()) fail('score host has no sets');
  const sets = await page.locator('[data-sum="open-set"]').count();
  const weightsOk = await page.evaluate((shown) => {
    const sc = PARTY.score;
    if (shown !== sc.sets.length) return 'shown ' + shown + ' != ' + sc.sets.length;
    if (sc.sets.length < 13) return 'sets ' + sc.sets.length;
    if (sc.pool.length < 40) return 'pool ' + sc.pool.length;
    const tally = {1: 0, 2: 0, 3: 0};
    sc.pool.forEach((id) => { tally[sc.questions[id].w]++; });
    if (tally[1] < 2 || tally[2] < 2 || tally[3] < 2) return 'pool weights';
    for (const set of sc.sets) {
      const w = set.qs.map((id) => sc.questions[id].w);
      if (w.join() !== '1,1,2,2,3,3') return 'set ' + set.n;
    }
    return '';
  }, sets);
  if (weightsOk) fail(weightsOk);
  await page.locator('[data-sum="open-set"]').first().click();
  await page.locator('#sumQr').waitFor();
  const cardUrl = await page.locator('#sumQr').getAttribute('data-card-url');
  const openHref = await page.locator('#sumOpen').getAttribute('href');
  if (!cardUrl || openHref !== cardUrl) fail('set link ' + openHref + ' != ' + cardUrl);
  if (!cardUrl.includes('/s/')) fail('set url ' + cardUrl);
  assertBase(cardUrl, 'summa set');
  await page.evaluate(() => localStorage.removeItem('summa:consent'));
  await page.goto(cardUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen="score-consent"]').waitFor();
  if (await page.locator('[data-sum-total]').count()) fail('counter visible before consent');
  for (const id of ['c1', 'c2', 'c3']) await page.locator(`[data-sum="${id}"]`).check();
  await page.locator('[data-sum="consent"]').click();
  await page.locator('[data-screen="score-player"]').waitFor();
  await page.locator('[data-sum="yes"][data-w="1"]').first().click();
  await page.locator('[data-sum="yes"][data-w="2"]').first().click();
  const total = await page.locator('[data-sum-total]').innerText();
  if (total !== '3') fail('counter total ' + total);
  await page.locator('[data-sum="hide"]').click();
  const hidden = await page.locator('.summa-player').evaluate((el) => el.classList.contains('hide-answers'));
  if (!hidden) fail('hide did not blur answers');
  await page.locator('[data-sum="reset"]').click();
  await page.locator('[data-act="ask-yes"]').click();
  const cleared = await page.locator('[data-sum-total]').innerText();
  if (cleared !== '0') fail('reset total ' + cleared);

  await page.goto(new URL('game/summa', ROOT).href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-sum="random"]').click();
  await page.locator('#sumQr').waitFor();
  const randomUrl = await page.locator('#sumQr').getAttribute('data-card-url');
  const randomOk = await page.evaluate((url) => {
    const key = new URL(url).pathname.split('/s/')[1];
    if (!key || !key.startsWith('r.')) return 'not random';
    const ids = key.slice(2).split('.');
    if (ids.length !== 6) return 'count ' + ids.length;
    const ws = ids.map((id) => PARTY.score.questions[id].w).sort((a, b) => a - b);
    return ws.join() === '1,1,2,2,3,3' ? '' : 'weights ' + ws.join();
  }, randomUrl);
  if (randomOk) fail('random set ' + randomOk);

  await page.locator('[data-sum="list"]').click();
  await page.locator('[data-sum="open-set"]').first().click();
  await page.locator('[data-sum="bet"]').click();
  for (const name of ['Борис', 'Вера', 'Аня']) {
    await page.locator('[data-sum="new-name"]').fill(name);
    await page.locator('[data-sum="add-player"]').click();
  }
  await page.locator('[data-sum="hero"]').selectOption('Борис');
  await page.locator('[data-sum="announced"]').fill('3');
  async function bet(name, slot, q, yes) {
    const box = page.locator(`.bet-slot[data-better="${name}"][data-slot="${slot}"]`);
    await box.locator('[data-sum="bet-q"]').selectOption(String(q));
    await box.locator('[data-sum="bet-yes"]').selectOption(yes ? '1' : '0');
  }
  await bet('Вера', 0, 1, true);
  await bet('Вера', 1, 2, false);
  await bet('Вера', 2, 3, true);
  await bet('Аня', 0, 1, true);
  await page.locator('[data-sum="to-reveal"]').click();
  async function reveal(q, yes) {
    await page.locator(`[data-sum="rev"][data-q="${q}"][data-yes="${yes ? '1' : '0'}"]`).click();
  }
  await reveal(1, true);
  await reveal(2, false);
  await reveal(3, true);
  await page.locator('[data-sum="calc"]').click();
  await page.locator('[data-player-points="Вера"]').waitFor();
  const points = await page.evaluate(() => ({
    b: document.querySelector('[data-player-points="Борис"]').textContent,
    v: document.querySelector('[data-player-points="Вера"]').textContent,
    a: document.querySelector('[data-player-points="Аня"]').textContent
  }));
  if (points.b !== '0' || points.v !== '6' || points.a !== '2') fail('scores ' + JSON.stringify(points));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-sum="board"]').click();
  const again = await page.locator('[data-player-points="Вера"]').innerText();
  if (again !== '6') fail('scoreboard did not persist ' + again);
  drain('summa');
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
if (!party || party.sections.length !== 4) fail('expected 4 categories');
const games = gameList(party);
if (games.length !== 21) fail('expected 21 games, got ' + games.length);
const x18 = games.filter((g) => g.sec === 'x18');
const extreme = games.filter((g) => g.sec === 'xx');
const rest = games.filter((g) => g.sec !== 'x18' && g.sec !== 'xx');
if (x18.length !== 6) fail('expected 6 games in Финал 18+');
if (extreme.length !== 5) fail('expected 5 Extreme games, got ' + extreme.length);
if (await page.locator('[data-go="g/x181"]').count()) fail('18+ games are listed before confirmation');
if (await page.locator('[data-go="g/summa"]').count()) fail('Сумма и ставки is listed before confirmation');
if (await page.locator('[data-go="g/xx1"]').count()) fail('Extreme games are listed before confirmation');
if (!await page.locator('[data-act="gate-xx"]').count()) fail('Extreme gate tile missing');
if (!await page.locator('[data-go="g/deep1"]').count()) fail('first category did not render');
await passAgeGate(false);
if (await page.locator('[data-go="g/x181"]').count()) fail('declining 18+ revealed the category');

for (const game of rest) await playGame(game);
for (const game of x18) await playGame(game);
await openHome();
if (await page.locator('[data-go="g/xx1"]').count()) fail('Extreme opened with only the 18+ gate');
await passAgeGate(false, 'xx');
if (await page.locator('[data-go="g/xx1"]').count()) fail('declining Extreme revealed the category');
for (const game of extreme) await playGame(game);
await assertBanditLinks(x18.find((g) => g.id === 'x185'));
await assertBanditLinks(extreme.find((g) => g.mode === 'bandit'));

drain('end');
await browser.close();
console.log(`SMOKE OK base=${ROOT} categories=${party.sections.length} games=${games.length} x18=${x18.length} extreme=${extreme.length}`);
