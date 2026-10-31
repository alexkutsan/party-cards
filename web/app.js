/* Party Cards — host shows a QR code; the player opens the card on their own phone. */
(function () {
  const DATA = window.PARTY;
  if (!DATA) {
    document.getElementById('app').innerHTML = '<p class="noscript">Не удалось загрузить колоды.</p>';
    return;
  }

  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
  const LVORDER = '🟢🟡🔴🔥💞';
  const LVN = {
    deep: {'🟢': 'легко', '🟡': 'лично', '🔴': 'глубоко'},
    fun: {'🟢': 'для всех', '🟡': 'с перчинкой', '🔴': 'острее'},
    x18: {'🟡': 'чувственно', '🔴': 'тело', '🔥': 'откровенно', '💞': 'групповое'}
  };

  const GAMES = {};
  DATA.sections.forEach((section) => {
    section.games.forEach((game) => {
      game.sec = section.id;
      game.icon = section.icon;
      GAMES[game.id] = game;
    });
  });
  Object.keys(DATA.cards).forEach((id) => { DATA.cards[id].id = id; });

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  function plural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function inl(s) {
    s = esc(s);
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  }

  function md(src) {
    const L = String(src || '').split('\n');
    let h = '';
    let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      if (/^---+\s*$/.test(l)) { h += '<hr>'; i++; continue; }
      const hm = l.match(/^(#{1,6})\s+(.*)/);
      if (hm) {
        const n = Math.min(4, Math.max(3, hm[1].length));
        h += `<h${n}>${inl(hm[2])}</h${n}>`;
        i++;
        continue;
      }
      if (l.startsWith('>')) {
        const b = [];
        while (i < L.length && L[i].startsWith('>')) { b.push(L[i].replace(/^>\s?/, '')); i++; }
        h += '<blockquote>' + md(b.join('\n')) + '</blockquote>';
        continue;
      }
      if (l.startsWith('|')) {
        const r = [];
        while (i < L.length && L[i].startsWith('|')) { r.push(L[i]); i++; }
        const cells = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        let t = '<div class="tw"><table>';
        r.forEach((x, k) => {
          if (/^[\s|:-]+$/.test(x)) return;
          const tg = k === 0 ? 'th' : 'td';
          t += '<tr>' + cells(x).map((c) => `<${tg}>${inl(c)}</${tg}>`).join('') + '</tr>';
        });
        h += t + '</table></div>';
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s/.test(l)) {
        const b = [];
        while (i < L.length && (/^\s*([-*]|\d+\.)\s/.test(L[i]) || /^\s{2,}\S/.test(L[i]))) {
          b.push(L[i]);
          i++;
        }
        h += list(b);
        continue;
      }
      const p = [];
      while (i < L.length && L[i].trim() && !/^(#|>|\||---|\s*([-*]|\d+\.)\s)/.test(L[i])) {
        p.push(L[i]);
        i++;
      }
      h += '<p>' + inl(p.join(' ')) + '</p>';
    }
    return h;
  }

  function list(b) {
    const ind = b[0].match(/^\s*/)[0].length;
    const ol = /^\s*\d+\./.test(b[0]);
    let h = ol ? '<ol>' : '<ul>';
    let cur = null;
    let sub = [];
    const flush = () => {
      if (cur !== null) h += '<li>' + inl(cur) + (sub.length ? list(sub) : '') + '</li>';
      sub = [];
    };
    for (const l of b) {
      const n = l.match(/^\s*/)[0].length;
      if (n <= ind && /^\s*([-*]|\d+\.)\s/.test(l)) {
        flush();
        cur = l.replace(/^\s*([-*]|\d+\.)\s+/, '');
      } else if (/^\s*([-*]|\d+\.)\s/.test(l)) sub.push(l);
      else cur += ' ' + l.trim();
    }
    flush();
    if (ol) {
      const s = b[0].match(/\d+/)[0];
      if (s !== '1') h = h.replace('<ol>', `<ol start="${s}">`);
    }
    return h + (ol ? '</ol>' : '</ul>');
  }

  const LS = {
    get(k, d) {
      try {
        const v = JSON.parse(localStorage.getItem('pc1_' + k));
        return v == null ? d : v;
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('pc1_' + k, JSON.stringify(v)); } catch (e) {}
    }
  };
  const ageOK = () => sessionStorage.getItem('pc_age') === '1';

  function defaultState(g) {
    if (g.mode === 'bandit') return {drawn: [], bandit: 'bandit', levels: null, players: 0, last: null};
    return {drawn: [], decks: [0], levels: null, last: null};
  }
  function st(g) {
    const d = defaultState(g);
    const raw = LS.get(g.id, null);
    const s = (raw && typeof raw === 'object') ? Object.assign(d, raw) : d;
    if (!Array.isArray(s.drawn)) s.drawn = [];
    if (g.mode === 'bandit') {
      if (s.bandit !== 'wheel') s.bandit = 'bandit';
      s.players = Math.max(0, Math.min(40, parseInt(s.players, 10) || 0));
    } else {
      const decks = Array.isArray(s.decks) ? s.decks.map((n) => parseInt(n, 10)).filter((n) => g.decks[n]) : [];
      s.decks = decks.length ? [...new Set(decks)].sort((a, b) => a - b) : [0];
    }
    if (s.levels && !Array.isArray(s.levels)) s.levels = null;
    if (s.last && typeof s.last.url !== 'string') s.last = null;
    return s;
  }
  function save(g, s) { LS.set(g.id, s); }

  function levelsOf(cards) {
    return [...new Set(cards.map((c) => c.l).filter(Boolean))].sort((a, b) => LVORDER.indexOf(a) - LVORDER.indexOf(b));
  }
  function cardsBy(g, pred) {
    const ids = [];
    g.decks.forEach((d) => { if (pred(d)) ids.push(...d.cards); });
    return ids.map((id) => DATA.cards[id]).filter(Boolean);
  }
  function pool(g, s) {
    let cards;
    if (g.mode === 'bandit') {
      cards = s.bandit === 'wheel'
        ? cardsBy(g, (d) => d.name.startsWith('Колесо'))
        : cardsBy(g, (d) => d.name.startsWith('Бандит — Что'));
    } else {
      cards = s.decks.flatMap((i) => (g.decks[i] ? g.decks[i].cards : [])).map((id) => DATA.cards[id]).filter(Boolean);
    }
    const lv = levelsOf(cards);
    if (s.levels && lv.length > 1) cards = cards.filter((c) => !c.l || s.levels.includes(c.l));
    return {cards, lv};
  }
  function levelLabel(sectionId, emoji) {
    return (LVN[sectionId] && LVN[sectionId][emoji]) || '';
  }
  function chipName(name) {
    return name.replace(/^[^—]*—\s*/, '');
  }
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  // Card 90 of «Бутылочка 18+» ends the game. New cards were appended after it
  // in the source, so the draw holds it until every other card in the current
  // selection has been taken. The card's id stays the hash of deck + number 90.
  function isBottleFinale(card) {
    return !!(card && card.d === 'Бутылочка 18+' && String(card.t).includes('**Финальная:**'));
  }
  function cardsForDraw(left) {
    if (left.length <= 1) return left;
    const open = left.filter((c) => !isBottleFinale(c));
    return open.length ? open : left;
  }

  function baseHref() { return document.querySelector('base').href; }
  function routeUrl(route) {
    if (!route) return new URL(baseHref()).pathname;
    return new URL(route, baseHref()).pathname;
  }
  function publicUrl(route) { return new URL(route, baseHref()).href; }

  function parse() {
    const basePath = new URL(baseHref()).pathname.replace(/\/$/, '');
    let p = location.pathname;
    if (basePath && (p === basePath || p.startsWith(basePath + '/'))) p = p.slice(basePath.length);
    p = dec(p).replace(/^\/+|\/+$/g, '');
    if (p === 'index.html') p = '';
    const parts = p.split('/').filter(Boolean);
    const head = parts[0] || '';
    if (!head) return {name: 'home'};
    if (head === 's' && parts[1]) return {name: 'section', id: dec(parts[1])};
    if (head === 'g' && parts[1]) return {name: 'rules', id: dec(parts[1])};
    if (head === 'p' && parts[1]) return {name: 'play', id: dec(parts[1])};
    if (head === 'c' && parts[1]) return {name: 'card', id: dec(parts[1])};
    if (head === 'm' && parts[1]) return {name: 'combo', combo: dec(parts.slice(1).join('/'))};
    return {name: 'missing'};
  }
  function needsAge(route) {
    if (route.name === 'section' && route.id === 'x18') return true;
    if ((route.name === 'rules' || route.name === 'play') && GAMES[route.id] && GAMES[route.id].sec === 'x18') return true;
    return false;
  }

  function go(route) {
    const url = routeUrl(route);
    closeSheet();
    if (location.pathname !== url) history.pushState({app: 1}, '', url);
    render();
    window.scrollTo(0, 0);
  }

  function toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    $('#toasts').appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }

  let askResolve = null;
  function closeModal() {
    const m = $('#modal');
    m.hidden = true;
    m.dataset.kind = '';
    m.innerHTML = '';
  }
  function showGate() {
    const m = $('#modal');
    if (!m.hidden && m.dataset.kind === 'gate') return;
    m.hidden = false;
    m.dataset.kind = 'gate';
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="gateTitle">
      <h3 id="gateTitle">Вам есть 18?</h3>
      <p>Раздел для взрослых, которые заранее и добровольно договорились об откровенной игре.</p>
      <button type="button" class="btn" data-act="age-yes">Да, мне есть 18 и я в игре</button>
      <button type="button" class="btn ghost" data-act="age-no">Нет, назад</button>
    </div>`;
    m.querySelector('[data-act="age-yes"]').focus();
  }
  function ask(title, text, ok, cancel) {
    return new Promise((resolve) => {
      askResolve = resolve;
      const m = $('#modal');
      m.hidden = false;
      m.dataset.kind = 'ask';
      m.innerHTML = `<div class="box" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <button type="button" class="btn" data-act="ask-yes">${esc(ok)}</button>
        <button type="button" class="btn ghost" data-act="ask-no">${esc(cancel)}</button>
      </div>`;
    });
  }
  function resolveAsk(v) {
    closeModal();
    const r = askResolve;
    askResolve = null;
    if (r) r(v);
  }

  let sheetUrl = null;
  let wakeLock = null;
  function openSheet(url, meta) {
    sheetUrl = url;
    const sheet = $('#sheet');
    sheet.hidden = false;
    $('#sheetGame').textContent = meta.game || '';
    $('#sheetCount').textContent = `Осталось ${meta.left} из ${meta.total}`;
    const qr = $('#qr');
    qr.innerHTML = qrSvg(url);
    qr.dataset.cardUrl = url;
    $('#openTab').href = url;
    document.body.classList.add('noscroll');
    app.inert = true;
    lockWake();
  }
  function closeSheet() {
    sheetUrl = null;
    const sheet = $('#sheet');
    sheet.hidden = true;
    $('#qr').innerHTML = '';
    $('#qr').dataset.cardUrl = '';
    $('#openTab').removeAttribute('href');
    document.body.classList.remove('noscroll');
    app.inert = false;
    unlockWake();
  }
  async function lockWake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {}
  }
  function unlockWake() {
    try { wakeLock && wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sheetUrl) lockWake();
  });

  function qrSvg(text) {
    if (typeof qrcode === 'undefined') return '<p class="hint">Не удалось построить код</p>';
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const size = n + quiet * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) { c++; continue; }
        let c2 = c;
        while (c2 < n && qr.isDark(r, c2)) c2++;
        const w = c2 - c;
        d += `M${c + quiet} ${r + quiet}h${w}v1h-${w}z`;
        c = c2;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-код карточки"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#111" d="${d}"/></svg>`;
  }

  async function copyLink() {
    if (!sheetUrl) return;
    const url = sheetUrl;
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
      return;
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать');
    } catch (e) {
      toast('Не удалось скопировать');
    }
  }

  function clearLast(gid) {
    const g = GAMES[gid];
    if (!g) return;
    const s = st(g);
    if (!s.last) return;
    s.last = null;
    save(g, s);
  }
  function confirmCloseSheet() {
    if (closingSheet || !sheetUrl) return;
    closingSheet = true;
    const gid = (history.state && history.state.meta && history.state.meta.gameId) || null;
    if (gid) clearLast(gid);
    if (history.state && history.state.sheet) history.back();
    else { closingSheet = false; closeSheet(); render(); }
  }

  function bar(title, fallback) {
    return `<div class="top"><button type="button" class="back" data-act="back" data-fallback="${esc(fallback)}" aria-label="Назад">‹</button><h1>${esc(title)}</h1></div>`;
  }

  function renderHome() {
    document.title = 'Игры для компании';
    let h = `<div class="top"><h1>Игры для компании</h1></div><div class="wrap"><div class="hero"><p class="eyebrow">Ведущий</p><h2>Во что играем?</h2><p>Телефон ведущего показывает QR-код. Карточку читает только тот, кто её отсканировал.</p></div>`;
    DATA.sections.forEach((s) => {
      const x = s.id === 'x18';
      h += `<div class="sec">${s.icon} ${esc(s.title)} <small>${s.games.length} ${plural(s.games.length, 'игра', 'игры', 'игр')}</small></div>`;
      if (x && !ageOK()) {
        h += `<button type="button" class="tile lock" data-act="gate"><div class="ic">🔞</div><div><b>Только для взрослых</b><span>Нажмите, чтобы подтвердить 18+</span></div></button>`;
        return;
      }
      if (s.intro || (s.info && s.info.length) || s.before) {
        h += `<button type="button" class="tile info" data-act="go" data-go="s/${s.id}"><div class="ic">${x ? '⚠️' : '📖'}</div><div><b>${x ? 'Перед игрой' : 'Как пользоваться'}</b><span>${x ? 'согласие, калибровка, сигналы' : 'вступление и сценарий вечера'}</span></div></button>`;
      }
      s.games.forEach((g) => {
        const n = g.decks.reduce((a, d) => a + d.cards.length, 0);
        h += `<button type="button" class="tile ${x ? 'x18' : ''}" data-act="go" data-go="g/${g.id}"><div class="ic">${s.icon}</div><div><b>${esc(g.short)}</b><span>${n ? n + ' ' + plural(n, 'карточка', 'карточки', 'карточек') : 'только правила'}</span></div></button>`;
      });
    });
    app.innerHTML = h + '</div>';
    app.dataset.screen = 'home';
  }

  function renderSection(s) {
    document.title = s.id === 'x18' ? 'Перед игрой' : s.title;
    let h = bar(s.id === 'x18' ? 'Перед игрой' : s.title, '') + '<div class="wrap md">';
    h += `<h3>${esc(s.full)}</h3>` + md(s.intro);
    if (s.before) h += `<h3>${esc(s.before.title)}</h3>` + md(s.before.md);
    (s.info || []).forEach((i) => { h += `<hr><h3>${esc(i.title)}</h3>` + md(i.md); });
    app.innerHTML = h + '</div>';
    app.dataset.screen = 'section';
  }

  function renderRules(g) {
    document.title = g.short;
    const n = g.decks.reduce((a, d) => a + d.cards.length, 0);
    let h = bar(g.short, '') + `<div class="wrap md"><h3 style="margin-top:4px">${esc(g.title)}</h3>` + md(g.rules);
    if (g.sec === 'x18') {
      h += `<p><button type="button" class="chip" data-act="go" data-go="s/x18">⚠️ Перед игрой: согласие и сигналы</button></p>`;
    }
    if (n) h += `<p class="muted">Колоды: ${g.decks.map((d) => esc(d.name) + ' (' + d.cards.length + ')').join(' · ')}</p>`;
    else h += '<p class="muted">В этой игре нет колоды — только правила.</p>';
    h += '</div>';
    if (n) h += `<div class="cta"><button type="button" class="btn" data-act="go" data-go="p/${g.id}">К карточкам</button></div>`;
    app.innerHTML = h;
    app.dataset.screen = 'rules';
  }

  function renderPlay(g) {
    document.title = g.short;
    const s = st(g);
    const p = pool(g, s);
    const left = p.cards.filter((c) => !s.drawn.includes(c.id));
    let h = bar(g.short, 'g/' + g.id) + '<div class="wrap">';
    if (g.mode === 'bandit') {
      h += '<div class="lbl">Режим</div><div class="chips">';
      [['bandit', 'Однорукий бандит'], ['wheel', 'Колесо желаний']].forEach(([k, t]) => {
        h += `<button type="button" class="chip ${s.bandit === k ? 'on' : ''}" data-act="mode" data-id="${g.id}" data-mode="${k}" aria-pressed="${s.bandit === k}">${k === 'bandit' ? '🎰' : '🎡'} ${t}</button>`;
      });
      h += '</div>';
      h += s.bandit === 'bandit'
        ? '<p class="help">Один код собирает «что», «где» и «как». Игрок видит всё сразу у себя.</p>'
        : '<p class="help">Одно желание — одна карточка на телефоне игрока.</p>';
      if (s.bandit === 'bandit') {
        h += `<div class="lbl">Кто → кому</div><div class="stepper"><button type="button" class="chip" data-act="players" data-id="${g.id}" data-d="-1" aria-label="Меньше игроков">−</button><input class="num" inputmode="numeric" type="number" min="0" max="40" value="${s.players || ''}" placeholder="выкл" data-act="players-input" data-id="${g.id}" aria-label="Число игроков"><button type="button" class="chip" data-act="players" data-id="${g.id}" data-d="1" aria-label="Больше игроков">+</button></div><p class="help">0 или пусто — без номеров. От двух игроков в код попадёт пара «кто → кому».</p>`;
      }
    } else if (g.decks.length > 1) {
      h += '<div class="lbl">Колоды</div><div class="chips">';
      g.decks.forEach((d, i) => {
        const on = s.decks.includes(i);
        h += `<button type="button" class="chip ${on ? 'on' : ''}" data-act="deck" data-id="${g.id}" data-i="${i}" aria-pressed="${on}">${esc(chipName(d.name))} · ${d.cards.length}</button>`;
      });
      h += '</div><p class="help">Можно включить несколько. Для разных ролей колоды лучше не смешивать.</p>';
    }
    if (p.lv.length > 1) {
      const on = s.levels || p.lv;
      h += '<div class="lbl">Уровни</div><div class="chips">';
      p.lv.forEach((l) => {
        const name = levelLabel(g.sec, l);
        h += `<button type="button" class="chip ${on.includes(l) ? 'on' : ''}" data-act="lv" data-id="${g.id}" data-lv="${l}" aria-pressed="${on.includes(l)}">${l}${name ? ' ' + esc(name) : ''}</button>`;
      });
      h += '</div>';
    }
    const finaleHeld = left.some(isBottleFinale) && left.some((c) => !isBottleFinale(c));
    h += `<div class="drawzone"><div class="deckpile" aria-hidden="true"><i></i><i></i><i>${g.icon || '🂠'}</i></div><div class="count">Осталось <b>${left.length}</b> из ${p.cards.length}</div><p class="help">Ведущий не видит текст — только код.</p>${finaleHeld ? '<p class="help">«Финальная» выпадает последней: по ней эта игра заканчивается.</p>' : ''}</div>`;
    h += `<div class="row"><button type="button" class="btn sec2" data-act="reset" data-id="${g.id}">Сбросить колоду</button><button type="button" class="btn sec2" data-act="go" data-go="g/${g.id}">Правила</button></div></div>`;
    let cta = '';
    if (s.last && s.last.url) {
      cta += `<button type="button" class="btn big" data-act="reshow" data-id="${g.id}">Показать QR ещё раз</button>`;
    }
    if (!left.length && p.cards.length) {
      cta += `<button type="button" class="btn big" data-act="draw" data-id="${g.id}">Перемешать и начать заново</button>`;
    } else {
      const label = s.last && s.last.url ? 'Взять следующую' : 'Взять карточку';
      const cls = s.last && s.last.url ? 'btn ghost big' : 'btn big';
      cta += `<button type="button" class="${cls}" data-act="draw" data-id="${g.id}">${label}</button>`;
    }
    h += `<div class="cta">${cta}</div>`;
    app.innerHTML = h;
    app.dataset.screen = 'play';
  }

  function playerShell(gameName, inner, foot) {
    return `<div class="player"><div class="player-top"><div class="gname">${esc(gameName || 'Карточка')}</div></div><div class="player-body">${inner}</div>${foot || ''}</div>`;
  }
  function renderCard(card) {
    const g = GAMES[card.g];
    document.title = g ? g.short : 'Карточка';
    const meta = [card.d, card.n ? '№' + card.n : ''].filter(Boolean).join(' · ');
    const body = `<div class="submeta">${esc(meta)}</div><div class="ctext ${card.t.length > 110 ? 'long' : ''}">${esc(card.t)}</div>`;
    const foot = g && g.sec === 'x18' ? '<p class="foot">Можно сказать «нет». Стоп-слово — «Ананас».</p>' : '';
    app.innerHTML = playerShell(g && g.short, body, foot);
    app.dataset.screen = 'card';
  }
  function renderCombo(parts) {
    const what = DATA.cards[parts.what];
    const where = DATA.cards[parts.where];
    const how = DATA.cards[parts.how];
    const g = GAMES[what.g] || GAMES[where.g];
    document.title = g ? g.short : 'Карточка';
    let body = '';
    if (parts.who) {
      body += `<div class="slot"><small>Кто → кому</small><div>Игрок ${parts.who[0]} → игрок ${parts.who[1]}</div></div>`;
    }
    body += `<div class="slot"><small>Что</small><div>${esc(what.t)}</div></div>`;
    body += `<div class="slot"><small>Где</small><div>${esc(where.t)}</div></div>`;
    body += `<div class="slot"><small>Как и сколько</small><div>${esc(how.t)}</div></div>`;
    const foot = '<p class="foot">Только после «да» обоих. Стоп-слово — «Ананас».</p>';
    app.innerHTML = playerShell(g && g.short, body, foot);
    app.dataset.screen = 'combo';
  }
  function renderMissing(title, text) {
    document.title = 'Игры для компании';
    app.innerHTML = `<div class="miss"><p class="eyebrow">Карточки</p><h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><button type="button" class="quiet" data-act="go" data-go="">На главную</button></div>`;
    app.dataset.screen = 'missing';
  }
  function parseCombo(combo) {
    const bits = combo.split('~');
    if (bits.length !== 3 && bits.length !== 4) return null;
    const [what, where, how] = bits;
    if (!DATA.cards[what] || !DATA.cards[where] || !DATA.cards[how]) return null;
    let who = null;
    if (bits.length === 4) {
      const m = bits[3].match(/^(\d{1,2})-(\d{1,2})$/);
      if (!m) return null;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a < 1 || b < 1 || a > 40 || b > 40 || a === b) return null;
      who = [a, b];
    }
    return {what, where, how, who};
  }

  function render() {
    app.inert = false;
    const route = parse();
    if (needsAge(route) && !ageOK()) {
      renderHome();
      showGate();
      return;
    }
    if (route.name === 'home') return renderHome();
    if (route.name === 'section') {
      const s = DATA.sections.find((x) => x.id === route.id);
      if (s) return renderSection(s);
    }
    if (route.name === 'rules' && GAMES[route.id]) return renderRules(GAMES[route.id]);
    if (route.name === 'play' && GAMES[route.id]) return renderPlay(GAMES[route.id]);
    if (route.name === 'card') {
      const c = DATA.cards[route.id];
      if (c) return renderCard(c);
      return renderMissing('Такой карточки нет', 'Ссылка не похожа на карточку из этой колоды.');
    }
    if (route.name === 'combo') {
      const parts = parseCombo(route.combo);
      if (parts) return renderCombo(parts);
      return renderMissing('Ссылка повреждена', 'В коде не хватает части комбинации.');
    }
    renderMissing('Страница не найдена', 'Вернитесь к списку игр.');
  }

  let busy = false;
  let closingSheet = false;
  function upd(id, fn) {
    const g = GAMES[id];
    if (!g) return;
    const s = st(g);
    fn(s, g);
    save(g, s);
    renderPlay(g);
  }
  async function draw(id) {
    if (busy || sheetUrl) return;
    const g = GAMES[id];
    if (!g) return;
    const s = st(g);
    const p = pool(g, s);
    if (!p.cards.length) { toast('Выберите колоду'); return; }
    let left = p.cards.filter((c) => !s.drawn.includes(c.id));
    if (!left.length) {
      busy = true;
      const yes = await ask('Колода закончилась', 'Перемешать и начать заново? Уже выпавшие карточки этой выборки вернутся.', 'Перемешать', 'Не сейчас');
      busy = false;
      if (!yes) return;
      const ids = new Set(p.cards.map((c) => c.id));
      s.drawn = s.drawn.filter((uid) => !ids.has(uid));
      s.last = null;
      save(g, s);
      renderPlay(g);
      toast('Колода перемешана');
      return;
    }
    const card = rnd(cardsForDraw(left));
    s.drawn.push(card.id);
    let route;
    if (g.mode === 'bandit' && s.bandit === 'bandit') {
      const wherePool = cardsBy(g, (d) => d.name.startsWith('Бандит — Где'));
      const howPool = cardsBy(g, (d) => d.name.startsWith('Бандит — Как'));
      if (!wherePool.length || !howPool.length) { toast('В колоде не хватает части'); s.drawn.pop(); return; }
      const where = rnd(wherePool);
      const how = rnd(howPool);
      let who = '';
      if (s.players >= 2) {
        const a = 1 + Math.floor(Math.random() * s.players);
        let b = a;
        while (b === a) b = 1 + Math.floor(Math.random() * s.players);
        who = `~${a}-${b}`;
      }
      route = `m/${card.id}~${where.id}~${how.id}${who}`;
    } else {
      route = `c/${card.id}`;
    }
    const url = publicUrl(route);
    const meta = {gameId: g.id, game: g.short, left: left.length - 1, total: p.cards.length};
    s.last = {url};
    save(g, s);
    history.pushState({sheet: url, meta}, '');
    renderPlay(g);
    openSheet(url, meta);
  }
  function reshow(id) {
    const g = GAMES[id];
    if (!g) return;
    const s = st(g);
    if (!s.last || !s.last.url) return;
    const p = pool(g, s);
    const left = p.cards.filter((c) => !s.drawn.includes(c.id)).length;
    const meta = {gameId: g.id, game: g.short, left, total: p.cards.length};
    history.pushState({sheet: s.last.url, meta}, '');
    openSheet(s.last.url, meta);
  }
  async function resetG(id) {
    if (busy) return;
    busy = true;
    const yes = await ask('Сбросить колоду?', 'Все карточки этой игры снова будут в колоде.', 'Сбросить', 'Отмена');
    busy = false;
    if (!yes) return;
    upd(id, (s) => { s.drawn = []; s.last = null; });
    toast('Колода снова полная');
  }
  function setPlayers(id, value) {
    upd(id, (s) => { s.players = Math.max(0, Math.min(40, parseInt(value, 10) || 0)); });
  }

  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (e.target.id === 'modal') {
      const kind = e.target.dataset.kind;
      if (kind === 'ask') resolveAsk(false);
      if (kind === 'gate') { closeModal(); if (needsAge(parse())) go(''); }
      return;
    }
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'go') return go(el.dataset.go || '');
    if (act === 'back') {
      if (history.state && history.state.app) history.back();
      else go(el.dataset.fallback || '');
      return;
    }
    if (act === 'gate') return showGate();
    if (act === 'age-yes') { sessionStorage.setItem('pc_age', '1'); closeModal(); render(); return; }
    if (act === 'age-no') { closeModal(); if (needsAge(parse())) go(''); return; }
    if (act === 'ask-yes') return resolveAsk(true);
    if (act === 'ask-no') return resolveAsk(false);
    if (act === 'draw') return draw(el.dataset.id);
    if (act === 'reshow') return reshow(el.dataset.id);
    if (act === 'reset') return resetG(el.dataset.id);
    if (act === 'mode') return upd(el.dataset.id, (s) => { s.bandit = el.dataset.mode === 'wheel' ? 'wheel' : 'bandit'; s.levels = null; });
    if (act === 'deck') {
      return upd(el.dataset.id, (s, g) => {
        const i = parseInt(el.dataset.i, 10);
        if (s.decks.includes(i)) { if (s.decks.length > 1) s.decks = s.decks.filter((x) => x !== i); }
        else s.decks.push(i);
        s.decks.sort((a, b) => a - b);
        s.levels = null;
      });
    }
    if (act === 'lv') {
      return upd(el.dataset.id, (s, g) => {
        const p = pool(g, Object.assign({}, s, {levels: null}));
        let on = (s.levels || p.lv).slice();
        const l = el.dataset.lv;
        if (on.includes(l)) { if (on.length > 1) on = on.filter((x) => x !== l); }
        else on.push(l);
        s.levels = on;
      });
    }
    if (act === 'players') {
      const g = GAMES[el.dataset.id];
      if (!g) return;
      const s = st(g);
      const d = parseInt(el.dataset.d, 10) || 0;
      setPlayers(g.id, (s.players || 0) + d);
    }
  });
  document.body.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act="players-input"]');
    if (!el) return;
    setPlayers(el.dataset.id, el.value);
  });

  $('#closeSheet').addEventListener('click', confirmCloseSheet);
  $('#copyLink').addEventListener('click', copyLink);

  window.addEventListener('popstate', () => {
    closingSheet = false;
    const stt = history.state || {};
    render();
    if (stt.sheet) openSheet(stt.sheet, stt.meta || {});
    else closeSheet();
  });

  render();
})();
