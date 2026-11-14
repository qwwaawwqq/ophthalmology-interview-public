/* 蘇格拉底家教（scripts/tutor-server.py 的 /api/tutor/*）。回答來自使用者 Mac 上的 Claude Code（自己的 Claude 訂閱）。
   只有從 127.0.0.1 / localhost 打開時才會連本機伺服器；在 GitHub Pages 或 file:// 打開時只顯示啟動步驟，不送任何請求。
   對話存在伺服器那一端（~/.ophthalmology-tutor），不進入網站的進度檔與雲端同步。 */
(function () {
  'use strict';
  if (window.OphTutor) return;
  const SPEC = window.OphSpecialty || {id: 'oph', label: '眼科', storePrefix: 'oph-prep:'};
  const LOCAL = /^https?:$/.test(location.protocol) && ['127.0.0.1', 'localhost'].includes(location.hostname);
  const API = (() => { try { return new URL('api/tutor/', location.origin + '/').href; } catch (_) { return '/api/tutor/'; } })();
  const KEY = (SPEC.storePrefix || 'oph-prep:') + 'tutor-current';
  const REPO = 'https://github.com/qwwaawwqq/ophthalmology-interview-public.git';
  const PORT = 8002;
  const PHASES = ['intent', 'diagnostic', 'teaching', 'review', 'final', 'done'];
  const PHASE_LABEL = {intent: '確認', diagnostic: '診斷', teaching: '教學', review: '複習', final: '期末評量', done: '完成'};
  const CMDS = [['show progress', '看進度'], ['harder', '難一點'], ['easier', '簡單一點'], ['just tell me', '直接告訴我'], ['save state', '存檔碼']];
  const EXTRA_TOPICS = ['用歷屆考點考我一輪', '口試練習：急症的第一步'];
  const EXAMPLE = SPEC.id === 'oph'
    ? {topic: '急性隅角閉鎖（範例）', target: 4, phase: 'teaching', notes: ['把「眼壓高」直接等同「青光眼」'],
       subskills: [{name: '辨識急性發作', level: 3}, {name: '降眼壓藥物與禁忌', level: 2, focus: true}, {name: '雷射虹膜切開的時機', level: 1}, {name: '對側眼與後續追蹤', level: 0}]}
    : {topic: '範例主題', target: 4, phase: 'teaching', notes: ['常把兩個相近的診斷混在一起'],
       subskills: [{name: '核心機轉', level: 3}, {name: '鑑別診斷', level: 2, focus: true}, {name: '第一步處置', level: 1}, {name: '易混陷阱', level: 0}]};
  const st = {phase: LOCAL ? 'probing' : 'offline', status: null, sessions: [], current: null, pending: null, pendingChapter: '',
    busy: false, failed: null, t0: 0, timer: null, armArchive: false, draft: '', statusAt: 0, error: '', composing: false};
  let root = null;
  const bound = new WeakSet();

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const q = sel => root && root.querySelector(sel);

  function md(src) {
    const parts = [];
    String(src || '').split('```').forEach((chunk, i) => {
      if (i % 2 === 1) { parts.push({html: `<pre class="tutor-pre">${esc(chunk.replace(/^[A-Za-z0-9_-]*\n/, ''))}</pre>`}); return; }
      chunk.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).forEach(p => {
        const lines = p.split('\n');
        if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          parts.push({html: `<${ordered ? 'ol' : 'ul'}>` + lines.map(l => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('') + `</${ordered ? 'ol' : 'ul'}>`});
        } else if (/^#{1,4}\s/.test(p)) {
          parts.push({html: `<p class="tutor-h">${inline(p.replace(/^#{1,4}\s+/, ''))}</p>`});
        } else {
          parts.push({p: true, text: p, html: lines.map(inline).join('<br>')});
        }
      });
    });
    const last = parts.length ? parts[parts.length - 1] : null;
    return parts.map(x => x.p ? `<p${x === last && /[?？]\s*$/.test(x.text) ? ' class="tutor-q"' : ''}>${x.html}</p>` : x.html).join('');
  }

  const bar = lv => `<span class="bar" aria-hidden="true"><i style="width:${Number.isInteger(lv) ? lv * 20 : 0}%"></i></span>`;
  function pctOf(s) {
    const subs = ((s && s.subskills) || []).filter(x => Number.isInteger(x.level));
    return subs.length ? Math.round(100 * subs.reduce((a, x) => a + x.level, 0) / (5 * subs.length)) : null;
  }
  const claude = () => (st.status && st.status.claude) || {};
  const needLogin = () => !!(st.status && st.status.login === 'needed');
  function remember(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (_) { /* 私密瀏覽或關掉儲存：不記上次的課 */ } }
  function recall() { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } }

  async function api(method, path, body) {
    const opt = {method, cache: 'no-store', headers: {}};
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.headers['X-Tutor'] = '1'; opt.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(API + path, opt); }
    catch (_) { const e = new Error('連不上本機的家教伺服器。確認終端機裡的 tutor-server.py 還開著，再按「重新偵測」。'); e.code = 'offline'; throw e; }
    let j = null;
    try { j = await r.json(); } catch (_) { j = null; }
    if (!r.ok || !j || j.ok === false) {
      const e = new Error((j && j.error) || ('家教伺服器回應 HTTP ' + r.status));
      e.code = (j && j.code) || (r.status === 404 && !j ? 'no_api' : '');
      throw e;
    }
    return j;
  }

  // ------------------------------------------------------------ 讀取
  async function loadStatus() {
    if (!LOCAL) { st.phase = 'offline'; renderAll(); return; }
    if (!st.status) { st.phase = 'probing'; renderAll(); }
    try {
      const s = await api('GET', 'status?specialty=' + encodeURIComponent(SPEC.id));
      st.status = s; st.sessions = s.sessions || []; st.phase = 'ready'; st.statusAt = Date.now(); st.error = '';
      if (st.current && !st.sessions.some(x => x.id === st.current.id)) st.current = null;
      if (!st.current) { const id = recall(); if (id && st.sessions.some(x => x.id === id)) await openSession(id, true); }
    } catch (e) {
      st.phase = (e.code === 'offline' || e.code === 'no_api') ? 'offline' : 'error';
      st.error = e.message || String(e);
    }
    renderAll();
  }

  async function openSession(id, quiet) {
    try {
      const r = await api('GET', 'session?id=' + encodeURIComponent(id));
      st.current = r.session; st.failed = null; st.armArchive = false; remember(id);
    } catch (e) {
      remember('');
      if (!quiet) setStatus(e.message || String(e), 'bad');
    }
    if (!quiet) renderAll();
  }

  function summaryOf(sess) {
    const s = sess.state || {};
    return {id: sess.id, title: sess.title, topic: sess.topic, updated_at: sess.updated_at, turns: sess.turns, phase: s.phase, overall: pctOf(s)};
  }

  // ------------------------------------------------------------ 送出
  async function send(text, chapter) {
    const msg = String(text || '').trim();
    if (!msg || st.busy) return;
    if (st.phase !== 'ready') { setStatus('家教還沒連上本機伺服器。', 'bad'); return; }
    st.busy = true; st.pending = msg; st.pendingChapter = chapter || ''; st.failed = null; st.armArchive = false;
    st.draft = ''; const input = q('[data-t-input]'); if (input) input.value = '';
    st.t0 = Date.now(); startTimer(); renderAll();
    try {
      const body = {id: (st.current && st.current.id) || '', message: msg, specialty: SPEC.id};
      if (!st.current && chapter) body.chapter = chapter;
      const r = await api('POST', 'chat', body);
      st.current = r.session; remember(r.session.id);
      st.sessions = [summaryOf(r.session)].concat(st.sessions.filter(x => x.id !== r.session.id));
      if (st.status) st.status.login = 'ok';
    } catch (e) {
      st.failed = {text: msg, chapter: chapter || '', message: e.message || String(e), code: e.code || ''};
      if (e.code === 'auth' && st.status) st.status.login = 'needed';
      if (e.code === 'offline') st.phase = 'offline';
    } finally {
      st.busy = false; st.pending = null; stopTimer(); renderAll();
      const box = q('[data-t-input]'); if (box && st.phase === 'ready') box.focus({preventScroll: true});
    }
  }

  function startTimer() {
    stopTimer();
    st.timer = setInterval(() => {
      const el = q('[data-t-elapsed]');
      if (!root || !root.isConnected) return;
      if (el) el.textContent = String(Math.round((Date.now() - st.t0) / 1000));
    }, 1000);
  }
  function stopTimer() { if (st.timer) clearInterval(st.timer); st.timer = null; }
  function setStatus(text, tone) { const el = q('[data-t-status]'); if (el) { el.textContent = text || ''; el.dataset.tone = tone || ''; } }

  async function saveSettings(patch) {
    try {
      await api('POST', 'settings', patch);
      setStatus(patch.model !== undefined ? `家教改用 ${patch.model || '預設'} 模型` : `家教改用 ${patch.account_dir || 'claude 預設'} 這個帳號`);
      await loadStatus();
    } catch (e) { setStatus(e.message || String(e), 'bad'); }
  }

  async function checkLogin() {
    if (st.busy) return;
    setStatus('正在測試 Claude Code…');
    try {
      await api('POST', 'check', {});
      if (st.status) st.status.login = 'ok';
      setStatus('連上了，可以開始上課。', 'ok');
    } catch (e) {
      if (e.code === 'auth' && st.status) st.status.login = 'needed';
      setStatus(e.message || String(e), 'bad');
    }
    renderAll();
  }

  async function archive() {
    if (!st.current || st.busy) return;
    if (!st.armArchive) { st.armArchive = true; renderSessions(); return; }
    try {
      await api('POST', 'archive', {id: st.current.id});
      st.sessions = st.sessions.filter(x => x.id !== st.current.id);
      st.current = null; st.armArchive = false; remember('');
      setStatus('這堂課收起來了（檔案還在 ' + ((st.status && st.status.data_dir) || '~/.ophthalmology-tutor') + '）。');
    } catch (e) { setStatus(e.message || String(e), 'bad'); }
    renderAll();
  }

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); setStatus(okMsg || '已複製', 'ok'); }
    catch (_) { setStatus('這個瀏覽器不讓網頁寫入剪貼簿，請手動選取複製。', 'bad'); }
  }

  // ------------------------------------------------------------ 畫面
  function offlineHtml() {
    const local = LOCAL;
    const cmd1 = `git clone ${REPO}`;
    const cmd2 = 'python3 ophthalmology-interview-public/scripts/tutor-server.py';
    return `<div class="tutor-offline card card-pad">
      <h2>${local ? '連不上本機的家教伺服器' : '家教要在你的 Mac 上啟動'}</h2>
      <p>家教的回答來自你 Mac 上的 Claude Code，用你自己的 Claude 訂閱登入，不需要 API 金鑰。${local ? '' : '網頁版沒有後端，所以要先在 Mac 上開本機版：'}</p>
      ${local && st.error ? `<p class="tutor-err">${esc(st.error)}</p>` : ''}
      <ol class="tutor-steps">
        <li><b>第一次：</b>打開「終端機」，下載這個網站（已經有的話，到資料夾裡執行 <code>git pull</code>）
          <div class="tutor-cmdline"><code>${esc(cmd1)}</code><button type="button" class="btn small" data-t-act="copycmd" data-v="${esc(cmd1)}">複製</button></div></li>
        <li><b>啟動：</b>執行下面這行（或在 Finder 雙擊 <code>scripts/start-tutor.command</code>）
          <div class="tutor-cmdline"><code>${esc(cmd2)}</code><button type="button" class="btn small" data-t-act="copycmd" data-v="${esc(cmd2)}">複製</button></div></li>
        <li><b>打開：</b>瀏覽器會自動開 <code>http://127.0.0.1:${PORT}/#tutor</code>，進度、教材和這裡一樣，多了家教。</li>
      </ol>
      <p class="small">Mac 上要先裝好並登入 Claude Code（終端機打 <code>claude</code>，在裡面輸入 <code>/login</code>）。對話只存在你的 Mac（<code>~/.ophthalmology-tutor</code>），不會上傳到這個網站。</p>
      ${local ? `<button type="button" class="btn primary" data-t-act="reprobe">重新偵測</button>` : ''}
    </div>`;
  }

  function skeletonHtml() {
    return `<div class="tutor-bar">
        <span class="tutor-engine" data-t-engine>檢查 Claude Code…</span>
        <details class="tutor-set" data-t-settings>
          <summary class="btn small">設定</summary>
          <div class="tutor-set-body">
            <label class="small-label" for="tutor-account">用哪個 Claude 帳號</label>
            <select class="select" id="tutor-account" data-t-account></select>
            <label class="small-label" for="tutor-model">模型（sonnet 最省用量）</label>
            <select class="select" id="tutor-model" data-t-model></select>
            <button type="button" class="btn small" data-t-act="check">測試能不能連上</button>
            <p class="small tutor-dir" data-t-dir></p>
          </div>
        </details>
      </div>
      <div class="tutor-grid" data-t-grid>
        <aside class="tutor-side" aria-label="家教課程" data-t-side>
          <button type="button" class="btn small primary" data-t-act="new">＋ 新課程</button>
          <ul class="tutor-sessions" data-t-sessions></ul>
        </aside>
        <section class="tutor-main" aria-label="和家教的對話">
          <div class="tutor-thread" data-t-thread aria-live="polite"></div>
          <div class="tutor-cmds" role="group" aria-label="快捷指令" data-t-cmds hidden>
            ${CMDS.map(([c, l]) => `<button type="button" class="chip" data-t-act="cmd" data-v="${esc(c)}">${esc(l)}</button>`).join('')}
          </div>
          <form class="tutor-compose" data-t-form>
            <label class="vh" for="tutor-input">給家教的訊息</label>
            <textarea class="input tutor-input" id="tutor-input" rows="2" data-t-input placeholder="想學什麼？例如：教我急性隅角閉鎖的處置" aria-describedby="tutor-hint">${esc(st.draft)}</textarea>
            <button type="submit" class="btn primary" data-t-send>送出</button>
          </form>
          <div class="tutor-foot"><span class="small" id="tutor-hint">Enter 送出 · Shift+Enter 換行 · 中文選字時按 Enter 不會送出</span><span class="small tutor-status" role="status" aria-live="polite" data-t-status></span></div>
        </section>
        <aside class="tutor-map" aria-label="技能地圖" data-t-map></aside>
      </div>`;
  }

  function renderEngine() {
    const el = q('[data-t-engine]');
    if (!el) return;
    const c = claude(), s = st.status;
    let text = '檢查 Claude Code…', tone = '';
    if (st.phase === 'error') { text = '家教伺服器出錯'; tone = 'bad'; }
    else if (s && !s.available) { text = '找不到 Claude Code'; tone = 'bad'; }
    else if (s && needLogin()) { text = 'Claude 帳號需要登入'; tone = 'warn'; }
    else if (s) { text = `Claude Code ${c.version ? c.version.split(' ')[0] : ''} · ${c.model || 'sonnet'}`; tone = 'ok'; }
    el.textContent = text; el.dataset.tone = tone;
    const acct = q('[data-t-account]'), model = q('[data-t-model]'), dir = q('[data-t-dir]');
    if (acct && s) {
      const cur = c.account_dir || '';
      const opts = [['', `claude 預設（${c.default_account || '~/.claude'}）`]].concat((c.account_dirs || []).map(a => [a, a]));
      if (cur && !opts.some(o => o[0] === cur)) opts.push([cur, cur]);
      acct.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
    }
    if (model && s) model.innerHTML = (c.models || ['sonnet', 'opus', 'haiku']).map(m => `<option value="${esc(m)}"${m === c.model ? ' selected' : ''}>${esc(m)}</option>`).join('');
    if (dir && s) dir.textContent = `對話存在 ${s.data_dir || '~/.ophthalmology-tutor'}`;
  }

  function renderSessions() {
    const el = q('[data-t-sessions]'), side = q('[data-t-side]'), grid = q('[data-t-grid]');
    if (!el) return;
    const cur = st.current && st.current.id;
    const empty = !st.sessions.length && !cur;
    if (side) side.hidden = empty;
    if (grid) grid.classList.toggle('no-side', empty);
    const items = st.sessions.map(s => `<li><button type="button" class="tutor-sess" data-t-act="open" data-v="${esc(s.id)}"${s.id === cur ? ' aria-current="true"' : ''}>${esc(s.title || s.topic || '未命名課程')}<small>${s.overall == null ? '尚未定級' : s.overall + '%'} · ${esc(PHASE_LABEL[s.phase] || '—')} · ${esc(String(s.updated_at || '').slice(5, 16).replace('T', ' '))}</small></button></li>`);
    if (cur) items.push(`<li><button type="button" class="tutor-link" data-t-act="archive"${st.busy ? ' disabled' : ''}>${st.armArchive ? '再按一次確認收起' : '收起這堂課'}</button></li>`);
    el.innerHTML = items.join('');
  }

  function msgHtml(m, i) {
    if (m.role === 'user') return `<div class="tutor-msg user">${esc(m.text)}</div>`;
    const cp = i == null ? '' : `<button type="button" class="tutor-link" data-t-act="copy" data-v="${i}">複製</button>`;
    return `<div class="tutor-msg tutor"><div class="tutor-who">家教${cp}</div>${md(m.text)}</div>`;
  }

  function cardHtml() {
    const f = st.failed, c = claude(), s = st.status;
    if (st.phase === 'error') {
      return `<div class="tutor-card is-alert" role="alert"><div class="tutor-card-t">家教伺服器出錯</div><p>${esc(st.error)}</p>` +
        `<div class="tutor-card-acts"><button type="button" class="btn small primary" data-t-act="reprobe">重新偵測</button></div></div>`;
    }
    if (s && !s.available) {
      return `<div class="tutor-card is-alert" role="alert"><div class="tutor-card-t">找不到 Claude Code</div><p>${esc(s.reason || '')}</p>` +
        `<div class="tutor-card-acts"><button type="button" class="btn small primary" data-t-act="reprobe">重新偵測</button></div></div>`;
    }
    if (needLogin()) {
      const acct = c.account_dir || c.default_account || '~/.claude';
      return `<div class="tutor-card is-caution" role="alert"><div class="tutor-card-t">還差一步：登入 Claude 帳號</div>` +
        `<p>家教用的帳號 <code>${esc(acct)}</code> 還沒登入（或登入過期）。照下面三步做，大約一分鐘：</p>` +
        `<ol><li>打開 Mac 的「終端機」（按 ⌘ + 空白鍵，打 Terminal）</li>` +
        `<li>貼上這一行，按 Enter<div class="tutor-cmdline"><code>${esc(c.login_command || 'claude')}</code><button type="button" class="btn small" data-t-act="copycmd" data-v="${esc(c.login_command || 'claude')}">複製</button></div></li>` +
        `<li>在裡面打 <code>/login</code>，照畫面在瀏覽器登入</li></ol>` +
        `<div class="tutor-card-acts"><button type="button" class="btn small primary" data-t-act="retry">我登好了，再試一次</button>` +
        `<button type="button" class="btn small" data-t-act="opensettings">換別的帳號</button></div>` +
        (f && f.text ? `<p class="small">剛剛那則訊息還留著，登好後按「再試一次」會重送。</p>` : '') + `</div>`;
    }
    if (!f) return '';
    return `<div class="tutor-card is-alert" role="alert"><div class="tutor-card-t">這一則沒送成功</div><p>${esc(f.message)}</p>` +
      `<div class="tutor-card-acts">${f.text ? `<button type="button" class="btn small primary" data-t-act="retry">再送一次</button>` : ''}` +
      `<button type="button" class="btn small" data-t-act="dismiss">關掉</button></div></div>`;
  }

  function introHtml() {
    const chapters = (st.status && st.status.chapters) || [];
    const chips = chapters.map(c => `<button type="button" class="chip" data-t-act="topic" data-v="${esc(c.title)}" data-ch="${esc(c.id)}">${esc(String(c.chapter).padStart(2, '0'))} ${esc(c.title)}</button>`).join('') +
      EXTRA_TOPICS.map(t => `<button type="button" class="chip" data-t-act="topic" data-v="${esc(t)}">${esc(t)}</button>`).join('');
    return `<div class="tutor-intro"><h3>今天想學會什麼？</h3>` +
      `<ol class="tutor-how"><li><b>挑一個主題</b>點下面的章節，或在輸入框自己打</li><li><b>先回答幾題</b>家教用它摸清你的程度</li><li><b>一次一題往上爬</b>答錯不給答案，換一個更窄的問題；右邊的地圖會跟著升級</li></ol>` +
      `<p class="small">家教會參考${esc((st.status && st.status.specialty_label) || SPEC.label)}的章節、歷屆考點、筆試申論與臨床流程出題，照 app 的「共筆更正」教。一般問題直接問也可以，它會直接回答。</p>` +
      `<div class="tutor-topics"><span class="small">從這裡開始：</span>${chips}</div></div>`;
  }

  function renderThread() {
    const el = q('[data-t-thread]');
    if (!el) return;
    const msgs = (st.current && st.current.messages) || [];
    const card = st.pending ? '' : cardHtml();
    let html;
    if (!msgs.length && !st.pending) {
      html = card + introHtml();
    } else {
      html = msgs.map((m, i) => msgHtml(m, i)).join('');
      if (st.pending) html += msgHtml({role: 'user', text: st.pending}) + `<div class="tutor-msg tutor"><div class="tutor-who">家教</div><p class="tutor-typing">思考中 · <span data-t-elapsed>${Math.round((Date.now() - st.t0) / 1000)}</span> 秒（通常 10–60 秒）</p></div>`;
      html += card;
    }
    el.classList.toggle('has-msgs', !!(msgs.length || st.pending));
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    const cmds = q('[data-t-cmds]');
    if (cmds) cmds.hidden = !msgs.length;
    const send = q('[data-t-send]'), input = q('[data-t-input]');
    if (send) send.disabled = st.busy;
    if (input) input.disabled = st.busy;
  }

  function renderMap() {
    const el = q('[data-t-map]');
    if (!el) return;
    const real = st.current && st.current.state;
    const example = !real || !(real.subskills || []).length;
    const s = example ? EXAMPLE : real;
    const pct = pctOf(s), at = Math.max(0, PHASES.indexOf(s.phase || 'intent'));
    el.classList.toggle('is-example', example);
    el.innerHTML = (example ? `<span class="tutor-example">範例 · 開始上課後換成你的</span>` : '') +
      `<div><h3>${esc(s.topic || '技能地圖')}</h3><div class="small">目標 ${esc(s.target || 4)}/5</div></div>` +
      `<div class="tutor-overall" aria-label="整體進度">${pct == null ? '—' : pct + '%'}</div>` +
      `<div class="tutor-phases" aria-label="上課階段">${PHASES.map((p, i) => `<span class="tutor-phase${i === at ? ' on' : i < at ? ' past' : ''}">${PHASE_LABEL[p]}</span>`).join('')}</div>` +
      (s.subskills || []).map(x => `<div class="tutor-row${x.focus ? ' focus' : ''}"><span class="nm">${esc(x.name)}</span><span class="lv">${Number.isInteger(x.level) ? x.level : '?'}/5${x.level >= 4 ? ' ★' : ''}</span>${bar(x.level)}</div>`).join('') +
      ((s.notes || []).length ? `<div><div class="tutor-who">筆記 · 要再考的</div><ul class="tutor-notes">${s.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '') +
      `<details><summary>0–5 級是什麼意思</summary><ol class="tutor-legend" start="0"><li>未接觸</li><li>聽過</li><li>跟得上</li><li>有提示能做</li><li>能獨立做</li><li>能教人、能處理邊界情況</li></ol></details>`;
  }

  function renderAll() {
    if (!root || !root.isConnected) return;
    const mode = (st.phase === 'offline') ? 'offline' : 'chat';
    if (root.dataset.tMode !== mode) {
      root.dataset.tMode = mode;
      root.innerHTML = mode === 'offline' ? offlineHtml() : skeletonHtml();
    } else if (mode === 'offline') {
      root.innerHTML = offlineHtml();
    }
    if (mode === 'chat') { renderEngine(); renderSessions(); renderThread(); renderMap(); }
  }

  // ------------------------------------------------------------ 事件（只綁一次，用事件委派）
  function bind(el) {
    el.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-t-act]') : null;
      if (!b || !el.contains(b)) return;
      const act = b.getAttribute('data-t-act'), v = b.getAttribute('data-v') || '';
      if (act === 'new') { if (st.busy) return; st.current = null; st.failed = null; st.armArchive = false; remember(''); renderAll(); const i = q('[data-t-input]'); if (i) i.focus(); }
      else if (act === 'open') { if (!st.busy) openSession(v); }
      else if (act === 'topic') { const ch = b.getAttribute('data-ch') || ''; if (!st.current || !st.current.messages || !st.current.messages.length) { st.current = null; } send(ch ? `教我「${v}」` : v, ch); }
      else if (act === 'cmd') send(v);
      else if (act === 'retry') { const f = st.failed; st.failed = null; if (f && f.text) send(f.text, f.chapter); else checkLogin(); }
      else if (act === 'dismiss') { st.failed = null; renderThread(); }
      else if (act === 'archive') archive();
      else if (act === 'copy') { const m = st.current && st.current.messages && st.current.messages[Number(v)]; if (m) copy(m.text, '已複製家教這一則'); }
      else if (act === 'copycmd') copy(v, '已複製指令，貼到終端機按 Enter');
      else if (act === 'check') checkLogin();
      else if (act === 'reprobe') { st.status = null; st.phase = 'probing'; root.dataset.tMode = ''; loadStatus(); }
      else if (act === 'opensettings') { const d = q('[data-t-settings]'); if (d) { d.open = true; const a = q('[data-t-account]'); if (a) a.focus(); } }
    });
    el.addEventListener('submit', e => {
      if (!e.target || !e.target.matches || !e.target.matches('[data-t-form]')) return;
      e.preventDefault();
      const i = q('[data-t-input]');
      send(i ? i.value : '');
    });
    el.addEventListener('keydown', e => {
      if (!e.target || !e.target.matches || !e.target.matches('[data-t-input]')) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !st.composing && e.keyCode !== 229) { e.preventDefault(); send(e.target.value); }
    });
    el.addEventListener('compositionstart', () => { st.composing = true; });
    el.addEventListener('compositionend', () => { setTimeout(() => { st.composing = false; }, 0); });
    el.addEventListener('input', e => { if (e.target && e.target.matches && e.target.matches('[data-t-input]')) st.draft = e.target.value; });
    el.addEventListener('change', e => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-t-account]')) saveSettings({account_dir: t.value});
      else if (t.matches('[data-t-model]')) saveSettings({model: t.value});
    });
  }

  function mount(el) {
    if (!el) return;
    root = el;
    root.dataset.tMode = '';
    if (!bound.has(el)) { bind(el); bound.add(el); }
    renderAll();
    if (LOCAL && (!st.status || Date.now() - st.statusAt > 30000) && !st.busy) loadStatus();
  }

  // 「#tutor」是好記的網址；網站本身的路由是 #tab-tutor。
  function aliasHash(fire) {
    if (location.hash !== '#tutor') return;
    try { history.replaceState(null, '', '#tab-tutor'); } catch (_) { location.hash = '#tab-tutor'; return; }
    if (fire) {
      let ev;
      try { ev = new HashChangeEvent('hashchange'); } catch (_) { ev = new Event('hashchange'); }
      window.dispatchEvent(ev);
    }
  }
  aliasHash(false);
  window.addEventListener('hashchange', () => aliasHash(true));

  window.OphTutor = {mount, md, isLocal: () => LOCAL, _state: st, _send: send};  // _state/_send: for scripts/test-tutor.cjs
  const existing = document.getElementById('tutor-root');
  if (existing) mount(existing);
})();
