/* «Сумма и ставки»: host picks a set, each player tallies on their own phone. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
  const $ = (s) => document.querySelector(s);
  const app = () => document.getElementById('app');

  function data() { return window.PARTY && window.PARTY.score; }
  function question(id) { return data().questions[id]; }
  function allSets() { return data().sets; }
  function setById(id) { return allSets().find((s) => s.id === id) || null; }

  function questionsForKey(key) {
    if (!key) return null;
    if (key.startsWith('r.')) {
      const ids = key.slice(2).split('.').filter(Boolean);
      if (ids.length !== 6 || ids.some((id) => !question(id))) return null;
      return ids.map((id) => question(id));
    }
    const set = setById(key);
    if (!set) return null;
    return set.qs.map((id) => question(id));
  }
  function sumOf(qs, yes) {
    return qs.reduce((a, q, i) => a + (yes[i] ? q.w : 0), 0);
  }
  function toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    document.getElementById('toasts').appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }
  function lsGet(k, d) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v == null ? d : v;
    } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function players() { return lsGet('summa:players', []); }
  function savePlayers(list) { lsSet('summa:players', list); }
  function played() { return lsGet('summa:played', []); }
  function stops() { return lsGet('summa:stops', {levels: [], qids: []}); }
  function scores() {
    return lsGet('summa:scores', {points: {}, heroRounds: {}, history: [], heroBySet: {}});
  }
  function saveScores(s) { lsSet('summa:scores', s); }

  function subsetHint(weights, target) {
    const yes = [0, 0, 0, 0, 0, 0];
    let total = 0;
    for (let mask = 0; mask < 64; mask++) {
      let sum = 0;
      for (let i = 0; i < 6; i++) if (mask & (1 << i)) sum += weights[i];
      if (sum !== target) continue;
      total++;
      for (let i = 0; i < 6; i++) if (mask & (1 << i)) yes[i]++;
    }
    return {total, yes};
  }

  const host = {view: 'list', key: '', poolOnly: false, round: null};

  function markPlayed(qs) {
    const have = new Set(played());
    qs.forEach((q) => have.add(q.id));
    lsSet('summa:played', [...have]);
  }

  function generateRandom() {
    const st = stops();
    const skip = new Set(played().concat(st.qids || []));
    const levels = new Set(st.levels || []);
    let source = data().pool.map((id) => question(id));
    if (!host.poolOnly) {
      allSets().forEach((s) => s.qs.forEach((id) => source.push(question(id))));
    }
    source = source.filter((q) => q && !skip.has(q.id) && !levels.has(q.l));
    const by = {1: [], 2: [], 3: []};
    source.forEach((q) => by[q.w].push(q));
    if (by[1].length < 2 || by[2].length < 2 || by[3].length < 2) return null;
    const pick = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, 2);
    };
    const chosen = [...pick(by[1]), ...pick(by[2]), ...pick(by[3])];
    return 'r.' + chosen.map((q) => q.id).join('.');
  }

  function setUrl(key) { return window.partyPublicUrl('s/' + key); }

  function paintHost() {
    const root = app();
    const qs = questionsForKey(host.key);
    let body = '';
    if (host.view === 'list') body = viewList();
    else if (host.view === 'stops') body = viewStops();
    else if (host.view === 'board') body = viewBoard();
    else if (host.view === 'bet') body = viewBet(qs);
    else if (host.view === 'reveal') body = viewReveal(qs);
    else body = viewSet(qs);
    root.innerHTML = `<div class="top"><button type="button" class="back" data-act="back" data-fallback="g/summa" aria-label="Назад">‹</button><h1>Сумма и ставки</h1></div><div class="wrap summa-host">${body}</div>`;
    root.dataset.screen = 'play';
    const box = document.getElementById('sumQr');
    if (box && host.key) {
      const url = setUrl(host.key);
      box.innerHTML = window.partyQrSvg(url);
      box.dataset.cardUrl = url;
      const link = document.getElementById('sumOpen');
      if (link) link.href = url;
      const shown = document.getElementById('sumLink');
      if (shown) shown.textContent = url.replace(/^https?:\/\/[^/]+/, '');
    }
  }

  function viewList() {
    const sets = allSets().map((s) => `<button type="button" class="tile x18" data-sum="open-set" data-key="${esc(s.id)}"><div class="ic">${esc(s.level || '∑')}</div><div><b>${s.n}. ${esc(s.name)}</b><span>веса 1+1+2+2+3+3</span></div></button>`).join('');
    return `<p class="eyebrow">Ведущий</p><h2 class="sum-h">Какой набор?</h2><p class="help">Вопросы видны всем. Ответы каждый считает у себя.</p><div class="row"><button type="button" class="btn" data-sum="random">Случайный набор</button></div><p class="help"><label class="checkline"><input type="checkbox" data-sum="pool-only" ${host.poolOnly ? 'checked' : ''}> Только из пула, без готовых наборов</label></p><button type="button" class="chip" data-sum="stops">Стоп-темы</button> <button type="button" class="chip" data-sum="clear-played">Сбросить сыгранные</button><div class="sec">Наборы <small>10</small></div>${sets}<div class="row"><button type="button" class="btn ghost" data-sum="board">Табло</button><button type="button" class="btn ghost" data-sum="bet">Ставки</button></div>`;
  }

  function viewStops() {
    const st = stops();
    const levels = ['🔴', '🔥', '💞'].map((l) => {
      const on = !(st.levels || []).includes(l);
      return `<button type="button" class="chip ${on ? 'on' : ''}" data-sum="stop-level" data-level="${l}" aria-pressed="${on}">${l} ${on ? 'в игре' : 'убрано'}</button>`;
    }).join('');
    const items = Object.values(data().questions).map((q) => {
      const off = (st.qids || []).includes(q.id);
      return `<label class="checkline"><input type="checkbox" data-sum="stop-q" data-qid="${esc(q.id)}" ${off ? 'checked' : ''}> <span>${q.l} [${q.w}] ${esc(q.t)}</span></label>`;
    }).join('');
    return `<button type="button" class="chip" data-sum="list">Все наборы</button><h2 class="sum-h">Стоп-темы</h2><p class="help">Убранные уровни и вопросы не попадают в случайный набор. Имена не записываются.</p><div class="chips">${levels}</div><div class="stop-list">${items}</div>`;
  }

  function viewSet(qs) {
    if (!qs) return `<p>Набор не найден.</p><button type="button" class="chip" data-sum="list">К наборам</button>`;
    const set = setById(host.key);
    const title = set ? `${set.n}. ${set.name}` : 'Случайный набор';
    const lines = qs.map((q, i) => `<div class="sum-q"><b class="wbadge">+${q.w}</b><span>${i + 1}. ${q.l} ${esc(q.t)}</span></div>`).join('');
    return `<button type="button" class="chip" data-sum="list">Все наборы</button><h2 class="sum-h">${esc(title)}</h2><p class="count">Максимум <b>12</b></p>${lines}<div class="qrframe" id="sumQr"></div><p class="hint">Игрок открывает счётчик у себя. Здесь только вопросы.</p><p class="sum-link" id="sumLink"></p><div class="sheet-actions"><button type="button" class="btn ghost" id="copySet">Скопировать ссылку</button><a class="btn ghost" id="sumOpen" target="_blank" rel="noopener">Открыть в новой вкладке</a></div><div class="row"><button type="button" class="btn ghost" data-sum="next">Следующий набор</button><button type="button" class="btn" data-sum="bet">Ставки</button></div>`;
  }

  function viewBoard() {
    const sc = scores();
    const names = players();
    const rows = names.map((name) => ({
      name,
      points: sc.points[name] || 0,
      hero: sc.heroRounds[name] || 0
    })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ru'));
    const body = rows.map((r) => `<tr><td>${esc(r.name)}</td><td data-player-points="${esc(r.name)}">${r.points}</td><td>${r.hero}</td></tr>`).join('') || '<tr><td colspan="3">Пока никого</td></tr>';
    const suggested = nextHero();
    return `<button type="button" class="chip" data-sum="list">К наборам</button><h2 class="sum-h">Табло</h2>${suggested ? `<p class="help">Дальше героем: <b>${esc(suggested)}</b></p>` : ''}<div class="tw"><table><tr><th>Имя</th><th>Очки</th><th>Раундов героем</th></tr>${body}</table></div><div class="row"><button type="button" class="btn ghost" data-sum="undo">Отменить раунд</button><button type="button" class="btn ghost" data-sum="new-game">Новая игра</button></div>`;
  }

  function nextHero() {
    const names = players();
    const done = (scores().heroBySet || {})[host.key] || [];
    return names.find((n) => !done.includes(n)) || names[0] || '';
  }

  function blankRound() {
    return {hero: nextHero(), announced: 0, bets: {}, reveal: {}, phase: 'bet'};
  }
  function ensureRound() {
    if (!host.round) host.round = blankRound();
    return host.round;
  }

  function viewBet(qs) {
    if (!qs) return `<p>Сначала откройте набор.</p><button type="button" class="chip" data-sum="list">К наборам</button>`;
    const names = players();
    const round = ensureRound();
    if (!names.includes(round.hero)) round.hero = names[0] || '';
    const list = names.map((name, i) => `<div class="player-row"><b>${esc(name)}</b><span><button type="button" class="chip" data-sum="up" data-i="${i}" aria-label="Выше">↑</button><button type="button" class="chip" data-sum="down" data-i="${i}" aria-label="Ниже">↓</button><button type="button" class="chip" data-sum="del" data-i="${i}">Удалить</button></span></div>`).join('');
    const heroOpts = names.map((n) => `<option value="${esc(n)}" ${n === round.hero ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const betters = names.filter((n) => n !== round.hero).map((name) => {
      const slots = (round.bets[name] || [{q: 0, yes: true}, {q: 0, yes: true}, {q: 0, yes: true}]);
      const fields = [0, 1, 2].map((s) => {
        const slot = slots[s] || {q: 0, yes: true};
        const qopts = `<option value="0">—</option>` + qs.map((q, i) => `<option value="${i + 1}" ${slot.q === i + 1 ? 'selected' : ''}>${i + 1} · +${q.w}</option>`).join('');
        return `<div class="bet-slot" data-better="${esc(name)}" data-slot="${s}"><select data-sum="bet-q" aria-label="Вопрос">${qopts}</select><select data-sum="bet-yes" aria-label="Да или нет"><option value="1" ${slot.yes ? 'selected' : ''}>да</option><option value="0" ${slot.yes ? '' : 'selected'}>нет</option></select></div>`;
      }).join('');
      return `<div class="better" data-name="${esc(name)}"><b>${esc(name)}</b>${fields}</div>`;
    }).join('');
    return `<button type="button" class="chip" data-sum="back-set">К набору</button><h2 class="sum-h">Ставки</h2><div class="stepper"><input class="num" data-sum="new-name" placeholder="Имя" aria-label="Имя игрока"><button type="button" class="btn" data-sum="add-player">Добавить</button></div><div class="player-list">${list}</div><div class="lbl">Герой</div><select class="num wide" data-sum="hero">${heroOpts}</select><div class="lbl">Названная сумма</div><input class="num" data-sum="announced" type="number" min="0" max="12" inputmode="numeric" value="${round.announced}"><button type="button" class="chip" data-sum="hint">Сколько раскладов сходится</button><div id="hintBox"></div>${betters}<div class="row"><button type="button" class="btn ghost" data-sum="pass-hero">Герой пасует</button><button type="button" class="btn" data-sum="to-reveal">К раскрытию</button></div><button type="button" class="chip" data-sum="board">Табло</button>`;
  }

  function viewReveal(qs) {
    const round = ensureRound();
    const used = new Set();
    Object.values(round.bets).forEach((slots) => (slots || []).forEach((s) => { if (s.q) used.add(s.q); }));
    const blocks = [...used].sort((a, b) => a - b).map((n) => {
      const q = qs[n - 1];
      const yes = !!round.reveal[n];
      return `<div class="sum-q"><b class="wbadge">+${q.w}</b><span>${n}. ${esc(q.t)}</span><div class="yn"><button type="button" class="chip ${yes ? 'on' : ''}" data-sum="rev" data-q="${n}" data-yes="1">Да</button><button type="button" class="chip ${yes ? '' : 'on'}" data-sum="rev" data-q="${n}" data-yes="0">Нет·Пас</button></div></div>`;
    }).join('') || '<p class="help">Ставок нет.</p>';
    return `<button type="button" class="chip" data-sum="bet">Назад к ставкам</button><h2 class="sum-h">Ответы героя</h2><p class="help">${esc(round.hero)} назвал(а) сумму ${round.announced}. Отмечайте только вопросы, на которые ставили.</p>${blocks}<p class="help" id="sumWarn" hidden>Сумма отмеченных ответов не сходится с названной. Штрафа нет.</p><button type="button" class="btn" data-sum="calc">Посчитать</button>`;
  }

  function readBetsFromDom() {
    const round = ensureRound();
    document.querySelectorAll('.better').forEach((block) => {
      const name = block.querySelector('.bet-slot')?.dataset.better;
      if (!name) return;
      const slots = [0, 1, 2].map((s) => {
        const slot = block.querySelector(`[data-slot="${s}"]`);
        return {
          q: parseInt(slot.querySelector('[data-sum="bet-q"]').value, 10) || 0,
          yes: slot.querySelector('[data-sum="bet-yes"]').value === '1'
        };
      });
      const seen = new Set();
      slots.forEach((slot) => {
        if (!slot.q) return;
        if (seen.has(slot.q)) slot.q = 0;
        else seen.add(slot.q);
      });
      round.bets[name] = slots;
    });
  }

  function scoreRound(qs) {
    const round = ensureRound();
    const deltas = {};
    let wrong = 0;
    const used = new Set();
    Object.entries(round.bets).forEach(([name, slots]) => {
      (slots || []).forEach((slot) => {
        if (!slot.q) return;
        used.add(slot.q);
        const actual = !!round.reveal[slot.q];
        const ok = actual === !!slot.yes;
        deltas[name] = (deltas[name] || 0) + (ok ? 2 : -1);
        if (!ok) wrong++;
      });
    });
    deltas[round.hero] = (deltas[round.hero] || 0) + Math.min(4, wrong);
    let warn = false;
    if (used.size === 6) {
      let sum = 0;
      for (let n = 1; n <= 6; n++) if (round.reveal[n]) sum += qs[n - 1].w;
      warn = sum !== Number(round.announced);
    }
    return {deltas, wrong, warn};
  }

  function commitRound(deltas, skipped) {
    const sc = scores();
    const round = ensureRound();
    if (!skipped) {
      Object.entries(deltas).forEach(([name, d]) => { sc.points[name] = (sc.points[name] || 0) + d; });
    } else {
      deltas = {};
    }
    sc.heroRounds[round.hero] = (sc.heroRounds[round.hero] || 0) + (round.hero ? 1 : 0);
    sc.history.push({hero: round.hero, deltas, set: host.key, skipped: !!skipped});
    if (!sc.heroBySet[host.key]) sc.heroBySet[host.key] = [];
    if (round.hero) sc.heroBySet[host.key].push(round.hero);
    saveScores(sc);
  }

  function paintPlayer(key) {
    const root = app();
    const qs = questionsForKey(key);
    if (!qs) {
      root.innerHTML = `<div class="miss"><h2>Набор не найден</h2><p class="lead">Попросите ведущего показать код ещё раз.</p></div>`;
      root.dataset.screen = 'score-missing';
      return;
    }
    if (localStorage.getItem('summa:consent') !== '1') {
      root.innerHTML = `<div class="wrap summa-consent"><p class="eyebrow">18+</p><h2 class="sum-h">Перед счётчиком</h2><p class="help">Вопросы про ваш собственный опыт. «Пас» равен «нет» и ничего не объясняет.</p><label class="checkline"><input type="checkbox" data-sum="c1"> Мне есть 18</label><label class="checkline"><input type="checkbox" data-sum="c2"> Я играю добровольно</label><label class="checkline"><input type="checkbox" data-sum="c3"> Я знаю, что можно сказать пас</label><button type="button" class="btn" data-sum="consent" disabled>Открыть счётчик</button></div>`;
      root.dataset.screen = 'score-consent';
      root.dataset.scoreKey = key;
      return;
    }
    const state = loadAnswers(key, qs.length);
    const total = sumOf(qs, state.yes);
    const cards = qs.map((q, i) => `<article class="sum-card"><div class="sum-q"><b class="wbadge">+${q.w}</b><p>${q.l} ${esc(q.t)}</p></div><div class="yn ans"><button type="button" class="chip ${state.yes[i] ? 'on' : ''}" data-sum="yes" data-i="${i}" data-w="${q.w}">Да</button><button type="button" class="chip ${state.yes[i] ? '' : 'on'}" data-sum="no" data-i="${i}">Нет·Пас</button></div></article>`).join('');
    const hideClass = state.hide === 2 ? 'hide-answers hide-sum' : (state.hide === 1 ? 'hide-answers' : '');
    root.innerHTML = `<div class="summa-player ${hideClass}" data-key="${esc(key)}"><div class="sumhead" id="sumHead"><span>Сумма</span><b data-sum-total>${total}</b><small>/ 12</small></div><div class="sum-scroll">${cards}<p class="foot">Назови только сумму.</p></div><div class="sum-actions"><button type="button" class="btn ghost" data-sum="hide">🙈 Скрыть</button><button type="button" class="btn ghost" data-sum="reset">Сбросить</button></div></div>`;
    root.dataset.screen = 'score-player';
    root.dataset.scoreKey = key;
  }

  function loadAnswers(key, n) {
    let state = null;
    try { state = JSON.parse(sessionStorage.getItem('summa:' + key)); } catch (e) { state = null; }
    if (!state || !Array.isArray(state.yes) || state.yes.length !== n) state = {yes: Array(n).fill(false), hide: 0};
    return state;
  }
  function saveAnswers(key, state) {
    try { sessionStorage.setItem('summa:' + key, JSON.stringify(state)); } catch (e) {}
  }
  function playerKey() { return app().dataset.scoreKey || ''; }

  function refreshPlayerBits() {
    const key = playerKey();
    const qs = questionsForKey(key);
    if (!qs) return;
    const state = loadAnswers(key, qs.length);
    const total = sumOf(qs, state.yes);
    const node = document.querySelector('[data-sum-total]');
    if (node) node.textContent = String(total);
    document.querySelectorAll('.sum-card').forEach((card, i) => {
      const yes = card.querySelector('[data-sum="yes"]');
      const no = card.querySelector('[data-sum="no"]');
      if (yes) yes.classList.toggle('on', !!state.yes[i]);
      if (no) no.classList.toggle('on', !state.yes[i]);
    });
    const root = document.querySelector('.summa-player');
    if (root) {
      root.classList.toggle('hide-answers', state.hide >= 1);
      root.classList.toggle('hide-sum', state.hide >= 2);
    }
  }

  let hideHold = 0;
  let hideLong = false;

  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-sum]');
    if (!el) return;
    const act = el.dataset.sum;
    if (act === 'open-set') {
      host.view = 'set';
      host.key = el.dataset.key;
      const qs = questionsForKey(host.key);
      if (qs) markPlayed(qs);
      host.round = null;
      paintHost();
      return;
    }
    if (act === 'list') { host.view = 'list'; paintHost(); return; }
    if (act === 'stops') { host.view = 'stops'; paintHost(); return; }
    if (act === 'board') { host.view = 'board'; paintHost(); return; }
    if (act === 'back-set') { host.view = 'set'; paintHost(); return; }
    if (act === 'bet') {
      if (!questionsForKey(host.key)) { toast('Сначала откройте набор'); return; }
      host.view = 'bet';
      paintHost();
      return;
    }
    if (act === 'random') {
      const key = generateRandom();
      if (!key) { toast('Не хватает вопросов. Сбросьте сыгранные или стоп-темы.'); return; }
      host.key = key;
      host.view = 'set';
      markPlayed(questionsForKey(key));
      host.round = null;
      paintHost();
      return;
    }
    if (act === 'clear-played') { lsSet('summa:played', []); toast('Сыгранные вопросы снова в пуле'); return; }
    if (act === 'next') {
      const sets = allSets();
      const cur = setById(host.key);
      const i = cur ? sets.findIndex((s) => s.id === cur.id) : -1;
      const nxt = sets[(i + 1) % sets.length];
      host.key = nxt.id;
      host.view = 'set';
      markPlayed(questionsForKey(host.key));
      host.round = null;
      paintHost();
      return;
    }
    if (act === 'pool-only') { host.poolOnly = el.checked; return; }
    if (act === 'stop-level') {
      const st = stops();
      const l = el.dataset.level;
      const has = (st.levels || []).includes(l);
      st.levels = has ? st.levels.filter((x) => x !== l) : (st.levels || []).concat(l);
      lsSet('summa:stops', st);
      paintHost();
      return;
    }
    if (act === 'add-player') {
      const input = document.querySelector('[data-sum="new-name"]');
      const name = (input.value || '').trim();
      if (!name) return;
      const list = players();
      if (!list.includes(name)) list.push(name);
      savePlayers(list);
      input.value = '';
      paintHost();
      return;
    }
    if (act === 'del' || act === 'up' || act === 'down') {
      const list = players();
      const i = parseInt(el.dataset.i, 10);
      if (act === 'del') list.splice(i, 1);
      if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      savePlayers(list);
      paintHost();
      return;
    }
    if (act === 'hint') {
      const qs = questionsForKey(host.key);
      const target = parseInt(document.querySelector('[data-sum="announced"]').value, 10) || 0;
      const hint = subsetHint(qs.map((q) => q.w), target);
      const lines = qs.map((q, i) => {
        const pct = hint.total ? Math.round(100 * hint.yes[i] / hint.total) : 0;
        return `<p class="help">${i + 1}. «да» в ${pct}% раскладов</p>`;
      }).join('');
      document.getElementById('hintBox').innerHTML = `<p class="help">Раскладов с суммой ${target}: <b>${hint.total}</b></p>${lines}`;
      return;
    }
    if (act === 'pass-hero') {
      readBetsFromDom();
      const round = ensureRound();
      round.announced = parseInt(document.querySelector('[data-sum="announced"]').value, 10) || 0;
      round.hero = document.querySelector('[data-sum="hero"]').value;
      if (!round.hero) { toast('Выберите героя'); return; }
      commitRound({}, true);
      toast('Раунд без очков');
      host.round = blankRound();
      host.view = 'board';
      paintHost();
      return;
    }
    if (act === 'to-reveal') {
      readBetsFromDom();
      const round = ensureRound();
      round.announced = Math.max(0, Math.min(12, parseInt(document.querySelector('[data-sum="announced"]').value, 10) || 0));
      round.hero = document.querySelector('[data-sum="hero"]').value;
      if (!round.hero) { toast('Добавьте игроков и выберите героя'); return; }
      host.view = 'reveal';
      paintHost();
      return;
    }
    if (act === 'rev') {
      const round = ensureRound();
      round.reveal[el.dataset.q] = el.dataset.yes === '1';
      paintHost();
      return;
    }
    if (act === 'calc') {
      const qs = questionsForKey(host.key);
      const result = scoreRound(qs);
      const warn = document.getElementById('sumWarn');
      if (warn) warn.hidden = !result.warn;
      commitRound(result.deltas, false);
      host.round = blankRound();
      host.view = 'board';
      paintHost();
      if (result.warn) toast('Сумма ответов не сошлась с названной. Штрафа нет.');
      return;
    }
    if (act === 'undo') {
      const sc = scores();
      const last = sc.history.pop();
      if (!last) { toast('Нечего отменять'); return; }
      Object.entries(last.deltas || {}).forEach(([name, d]) => { sc.points[name] = (sc.points[name] || 0) - d; });
      if (last.hero) sc.heroRounds[last.hero] = Math.max(0, (sc.heroRounds[last.hero] || 1) - 1);
      const arr = (sc.heroBySet && sc.heroBySet[last.set]) || [];
      const idx = arr.lastIndexOf(last.hero);
      if (idx >= 0) arr.splice(idx, 1);
      saveScores(sc);
      paintHost();
      return;
    }
    if (act === 'new-game') {
      saveScores({points: {}, heroRounds: {}, history: [], heroBySet: {}});
      toast('Очки обнулены');
      paintHost();
      return;
    }
    if (act === 'consent') {
      const ok = ['c1', 'c2', 'c3'].every((id) => document.querySelector(`[data-sum="${id}"]`).checked);
      if (!ok) return;
      localStorage.setItem('summa:consent', '1');
      paintPlayer(playerKey());
      return;
    }
    if (act === 'yes' || act === 'no') {
      const key = playerKey();
      const qs = questionsForKey(key);
      const state = loadAnswers(key, qs.length);
      state.yes[parseInt(el.dataset.i, 10)] = act === 'yes';
      saveAnswers(key, state);
      refreshPlayerBits();
      return;
    }
    if (act === 'hide') {
      if (hideLong) { hideLong = false; return; }
      const key = playerKey();
      const qs = questionsForKey(key);
      const state = loadAnswers(key, qs.length);
      state.hide = (state.hide + 1) % 3;
      saveAnswers(key, state);
      refreshPlayerBits();
      return;
    }
    if (act === 'reset') {
      const key = playerKey();
      const run = () => {
        saveAnswers(key, {yes: questionsForKey(key).map(() => false), hide: 0});
        refreshPlayerBits();
        toast('Счётчик сброшен');
      };
      if (window.partyAsk) window.partyAsk('Сбросить счётчик?', 'Отметки на этом телефоне пропадут.', 'Сбросить', 'Отмена').then((ok) => { if (ok) run(); });
      else if (window.confirm('Сбросить счётчик?')) run();
    }
  });

  document.body.addEventListener('change', (e) => {
    const el = e.target.closest('[data-sum]');
    if (!el) return;
    if (el.dataset.sum === 'pool-only') { host.poolOnly = el.checked; return; }
    if (el.dataset.sum === 'stop-q') {
      const st = stops();
      const id = el.dataset.qid;
      const has = (st.qids || []).includes(id);
      if (el.checked && !has) st.qids = (st.qids || []).concat(id);
      if (!el.checked && has) st.qids = st.qids.filter((x) => x !== id);
      lsSet('summa:stops', st);
      return;
    }
    if (el.dataset.sum === 'c1' || el.dataset.sum === 'c2' || el.dataset.sum === 'c3') {
      const ok = ['c1', 'c2', 'c3'].every((id) => document.querySelector(`[data-sum="${id}"]`)?.checked);
      const btn = document.querySelector('[data-sum="consent"]');
      if (btn) btn.disabled = !ok;
      return;
    }
    if (el.dataset.sum === 'hero') { ensureRound().hero = el.value; return; }
    if (el.dataset.sum === 'announced') {
      ensureRound().announced = Math.max(0, Math.min(12, parseInt(el.value, 10) || 0));
      return;
    }
    if (el.dataset.sum === 'bet-q' || el.dataset.sum === 'bet-yes') {
      readBetsFromDom();
      const slot = el.closest('.bet-slot');
      const name = slot.dataset.better;
      const slots = ensureRound().bets[name] || [];
      const qs = slots.map((s) => s.q).filter(Boolean);
      if (new Set(qs).size !== qs.length) {
        toast('На один вопрос нельзя ставить дважды');
        el.value = '0';
        readBetsFromDom();
      }
    }
  });

  document.body.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-sum="hide"]');
    if (!el) return;
    hideHold = window.setTimeout(() => {
      hideLong = true;
      const key = playerKey();
      const qs = questionsForKey(key);
      if (!qs) return;
      const state = loadAnswers(key, qs.length);
      state.hide = 0;
      saveAnswers(key, state);
      refreshPlayerBits();
    }, 550);
  });
  document.body.addEventListener('pointerup', () => window.clearTimeout(hideHold));
  document.body.addEventListener('pointerleave', () => window.clearTimeout(hideHold));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const key = playerKey();
    const qs = questionsForKey(key);
    if (!qs || app().dataset.screen !== 'score-player') return;
    const state = loadAnswers(key, qs.length);
    if (state.hide < 1) {
      state.hide = 1;
      saveAnswers(key, state);
    }
  });

  document.body.addEventListener('click', async (e) => {
    if (e.target.id !== 'copySet') return;
    const url = document.getElementById('sumQr')?.dataset.cardUrl;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    catch (err) { toast('Не удалось скопировать'); }
  });

  window.renderScoreHost = paintHost;
  window.renderScorePlayer = paintPlayer;
})();
