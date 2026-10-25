(function (g) {
  'use strict';
  if (g.OphSchedule) return;
  const DAY = 86400000, OFFSET = 8 * 3600000;
  const labels = {deadline:'報名截止',written:'筆試',interview:'面試',exam:'甄試',checkin:'報到',result:'放榜'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = now => new Date(now + OFFSET).toISOString().slice(0,10);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
  const delta = (date, now) => validDate(date) ? Math.round((Date.parse(date+'T00:00:00Z') - Date.parse(day(now)+'T00:00:00Z')) / DAY) : null;
  const timeValid = value => value === null || value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  function safeUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || data.timezone !== 'Asia/Taipei' || !validDate(data.updatedAt) || !Array.isArray(data.hospitals)) throw Error('時程資料格式不符，請稍後重試。');
    const ids = new Set();
    for (const h of data.hospitals) {
      if (!h.id || !h.name || !Array.isArray(h.events)) throw Error('院所時程資料不完整。');
      for (const e of h.events) {
        if (!e.id || ids.has(e.id) || !labels[e.type] || !e.title || !(e.date === null || validDate(e.date)) || !timeValid(e.time) || !timeValid(e.endTime) || !validDate(e.verifiedAt) || (e.sourceUrl && !safeUrl(e.sourceUrl)) || (e.time && !e.date)) throw Error('時程日期或來源格式不符。');
        ids.add(e.id);
      }
    }
    return data;
  }
  const flatten = data => data.hospitals.flatMap(h => h.events.map(e => ({...e,hospitalId:h.id,hospitalName:h.name})));
  function filtered(data, hospital, mode, now) {
    return flatten(data).filter(e => (!hospital || e.hospitalId === hospital) && (mode === 'all' || (mode === 'pending' ? !e.date : e.date && delta(e.date,now) >= 0))).sort((a,b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99:99').localeCompare(b.time || '99:99') || a.hospitalName.localeCompare(b.hospitalName,'zh-Hant'));
  }
  function status(e, now) { const n = delta(e.date,now); return n === null ? '日期待確認' : n < 0 ? '日期已過' : n === 0 ? '今天' : '還有 '+n+' 天'; }
  function conflicts(data, now) {
    const groups = new Map();
    for (const e of flatten(data)) if (e.date && delta(e.date,now) >= 0 && ['written','interview','exam'].includes(e.type)) { if (!groups.has(e.date)) groups.set(e.date,new Set()); groups.get(e.date).add(e.hospitalName); }
    return [...groups].filter(([,names]) => names.size > 1).map(([date,names]) => ({date,names:[...names]}));
  }
  const formatDate = date => date ? date.replaceAll('-','/')+'（'+['日','一','二','三','四','五','六'][new Date(date+'T00:00:00Z').getUTCDay()]+'）' : '待確認';
  function row(e, now) {
    const n = delta(e.date,now), url = safeUrl(e.sourceUrl);
    return '<li data-event-id="'+esc(e.id)+'" class="schedule-row'+(n !== null && n < 0 ? ' is-past' : '')+'"><div class="schedule-date"><time'+(e.date?' datetime="'+e.date+'"':'')+'>'+esc(formatDate(e.date))+'</time><span class="schedule-status'+(n === 0?' is-today':'')+'">'+status(e,now)+'</span></div><div class="schedule-detail"><p class="schedule-kind">'+esc(labels[e.type])+'</p><h3>'+esc(e.hospitalName)+' · '+esc(e.title)+'</h3><p>'+ (e.time ? '<strong>'+esc(e.time)+(e.endTime?'–'+esc(e.endTime):'')+'</strong>（台北時間）' : '時刻未確認，請依公告或個別通知核對。')+'</p>'+(e.location?'<p>地點：'+esc(e.location)+'</p>':'')+(e.note?'<p class="schedule-note">'+esc(e.note)+'</p>':'')+'<p class="schedule-source">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(e.sourceLabel||'官方來源')+'</a>':esc(e.sourceLabel||'來源待補'))+'<span>'+(e.sourceRetrievedAt?'擷取 '+esc(e.sourceRetrievedAt.replaceAll('-','/'))+' · ':'')+'核對 '+esc(e.verifiedAt.replaceAll('-','/'))+'</span></p></div></li>';
  }
  let root = null, data = null, pending = null, hospital = '', mode = 'upcoming', clock = () => Date.now(), renderedDay = null;
  const active = () => root?.isConnected;
  function render() {
    if (!active() || !data) return;
    const now = clock(), rows = filtered(data,hospital,mode,now), collision = conflicts(data,now); renderedDay = day(now);
    root.innerHTML = '<div class="schedule-intro"><p>核對報名截止、筆試與面試日期，保留時間安排給筆試準備。</p><p class="small">資料更新 '+esc(data.updatedAt.replaceAll('-','/'))+' · 今天 '+day(now).replaceAll('-','/')+' · 台北時間。日期已過僅代表日曆狀態，不表示已報名、已應試或已錄取。</p></div>'+(collision.length?'<aside class="schedule-alert" aria-label="同日甄試提醒"><strong>同日甄試提醒</strong>'+collision.map(c=>'<p>'+formatDate(c.date)+'：'+esc(c.names.join('、'))+'。請核對各院通知與實際時段。</p>').join('')+'</aside>':'')+'<div class="schedule-controls"><label>院所 <select class="select" data-schedule-hospital><option value="">全部院所</option>'+data.hospitals.map(h=>'<option value="'+esc(h.id)+'"'+(hospital===h.id?' selected':'')+'>'+esc(h.name)+'</option>').join('')+'</select></label><label>顯示 <select class="select" data-schedule-mode>'+[['upcoming','即將到來'],['pending','日期待確認'],['all','全部時程（含已過）']].map(([v,t])=>'<option value="'+v+'"'+(mode===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label><span class="small" aria-live="polite">'+rows.length+' 項</span></div>'+(rows.length?'<ol class="schedule-list" aria-label="考試與報名時程">'+rows.map(e=>row(e,now)).join('')+'</ol>':'<div class="schedule-empty"><p>這個篩選下沒有時程。</p><p>可切換「日期待確認」或「全部時程」查看其他資訊。</p></div>')+'<p class="schedule-footnote">日期確定才顯示倒數；未載明的時間不設為午夜或當日截止。後續異動請以院方最新公告與個別通知為準。</p>';
  }
  async function mount(target) {
    root = target;
    if (!active()) return;
    if (data) { render(); return; }
    try {
      pending ||= fetch(new URL('../content/exam-schedule.json',document.currentScript?.src || new URL('scripts/exam-schedule.js',document.baseURI))).then(r => { if (!r.ok) throw Error('目前無法讀取考試時程。'); return r.json(); }).then(validate).catch(e => { pending = null; throw e; });
      data = await pending; render();
    } catch (e) { if (active()) root.innerHTML = '<p role="alert">'+esc(e.message)+'</p><button type="button" class="btn" data-schedule-retry>重新讀取時程</button>'; }
  }
  document.addEventListener('change', event => { if (!active()) return; const el = event.target; if (el.hasAttribute?.('data-schedule-hospital')) { hospital = el.value; render(); } if (el.hasAttribute?.('data-schedule-mode')) { mode = el.value; render(); } });
  document.addEventListener('click', event => { if (event.target.closest?.('[data-schedule-retry]') && active()) void mount(root); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (active() && day(clock()) !== renderedDay) render(); }, 60000);
  g.OphSchedule = {mount,day,validDate,delta,status,filtered,conflicts,validate,setClock(fn){clock=fn;render();}};
  const initial = document.getElementById('schedule-root'); if (initial) void mount(initial);
})(window);
