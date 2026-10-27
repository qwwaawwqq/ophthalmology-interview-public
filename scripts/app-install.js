(function (g) {
  'use strict';
  if (g.OphInstall) return;
  const doc = g.document, nav = g.navigator || {}, media = g.matchMedia?.('(display-mode: standalone)');
  let deferred = null, busy = false, installedHere = false, dialog = null, opener = null, message = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const standalone = () => installedHere || !!media?.matches || nav.standalone === true;
  function platform() {
    const ua = nav.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Chrome|Chromium/.test(ua)) return 'chrome';
    if (/Macintosh|Mac OS X/.test(ua) && /Safari/.test(ua) && !/Firefox|FxiOS/.test(ua)) return 'mac-safari';
    return 'other';
  }
  function guidance() {
    switch (platform()) {
      case 'ios': return {steps:['開啟瀏覽器的分享選單，選擇「加入主畫面」。','若出現「以網頁App打開」，請啟用，再點「加入」。','若目前瀏覽器沒有這個選項，可用Safari開啟本頁再操作。'],url:'https://support.apple.com/guide/iphone/iphea86e5236/ios',label:'Apple：將網站加入主畫面'};
      case 'mac-safari': return {steps:['macOS Sonoma 14或更新版本：在Safari選「檔案」→「加入Dock」，也可查看分享選單。','確認名稱後加入，再從Dock或應用程式開啟。較舊版本可能沒有此功能。'],url:'https://support.apple.com/104996',label:'Apple：使用Safari網頁App'};
      case 'edge': return {steps:['開啟右上方「…」選單，找到「Apps／應用程式」（部分版本在「更多工具」內）。','若顯示「將此網站安裝為應用程式」，選取後依提示完成安裝。'],url:'https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge',label:'Microsoft：安裝與管理網頁App'};
      case 'chrome': return {steps:['開啟右上方「⋮」→「投放、儲存及分享」。','若顯示「將網頁安裝為應用程式」，選取後完成安裝；也可查看網址列的安裝圖示。'],url:'https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=zh-Hant',label:'Chrome：使用網頁App'};
      case 'android': return {steps:['開啟瀏覽器的「⋮」選單，尋找「安裝及建立捷徑」、「安裝應用程式」或「新增至主畫面」。','選擇安裝並依提示完成。若只提供建立捷徑，會以該瀏覽器支援的方式開啟。'],url:'https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=zh-Hant',label:'Chrome：在Android安裝網頁App'};
      default: return {steps:['查看瀏覽器選單是否提供安裝、加入主畫面或建立應用程式。不同平台與版本的功能可能不同。','如果沒有安裝選項，仍可用書籤或捷徑繼續使用網頁版。'],url:'https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing',label:'了解網頁App安裝方式'};
    }
  }
  function renderDialog() {
    if (!dialog) return;
    const help = guidance(), ready = !!deferred && !busy && !standalone();
    dialog.innerHTML = '<div class="app-install-heading"><h2 id="app-install-title">'+(standalone()?'App已就緒':'安裝眼科練習室')+'</h2><button type="button" class="btn small subtle" data-app-install-close aria-label="關閉安裝說明">關閉</button></div>'+
      '<p class="app-install-message" role="status">'+esc(message || (standalone()?(installedHere?'瀏覽器已回報安裝完成，可從App圖示開啟。':'目前正以App模式開啟，不需要重複安裝。'):ready?'瀏覽器已提供安裝視窗，點擊下方按鈕繼續。':'此瀏覽器目前尚未提供直接安裝視窗，可依下列方式操作。'))+'</p>'+
      (ready?'<button type="button" class="btn primary" data-app-install-confirm>開啟安裝視窗</button>':'')+
      (!standalone()?'<ol class="app-install-steps">'+help.steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol><p class="small">選單名稱可能隨版本不同；沒有看到安裝選項不代表以後都不支援。</p>':'')+
      '<div class="app-install-note"><p>安裝後仍需要網路。不同瀏覽器或Safari網頁App的資料可能分開；首次開啟請確認學習進度。</p><button type="button" class="btn small" data-action="tab" data-value="sync" data-app-install-close>查看保存與同步</button></div>'+
      '<p class="app-install-help"><a href="'+help.url+'" target="_blank" rel="noopener noreferrer">'+help.label+'</a></p>';
  }
  function update() {
    const installed = standalone();
    doc.querySelectorAll('[data-app-install-open]').forEach(button => {
      button.textContent = installed ? '已安裝' : busy ? '等待安裝選擇…' : '安裝App';
      button.disabled = busy;
      button.setAttribute('aria-label',installed?'查看App安裝狀態':'安裝App或查看安裝方式');
      button.setAttribute('aria-busy',busy?'true':'false');
      button.setAttribute('data-installed',installed?'true':'false');
    });
    renderDialog();
  }
  function close() { if (!dialog) return; if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); opener?.focus?.(); }
  function open(button) {
    opener = button || opener;
    if (!dialog) {
      dialog = doc.createElement('dialog'); dialog.id = 'app-install-dialog'; dialog.className = 'app-install-dialog';
      dialog.setAttribute('aria-labelledby','app-install-title'); dialog.addEventListener('close',()=>opener?.focus?.()); doc.body.appendChild(dialog);
    }
    renderDialog();
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open',''); }
  }
  async function prompt(event, button) {
    // The browser prompt is consumed once and only from a trusted user click.
    if (!event?.isTrusted || !deferred || busy || standalone()) { open(button); return; }
    const pending = deferred; deferred = null; busy = true; message = ''; update();
    try {
      await pending.prompt(); const choice = await pending.userChoice;
      if (!standalone()) message = choice?.outcome === 'accepted' ? '已送出安裝要求；完成後可從App圖示開啟。' : '這次未安裝。之後仍可從瀏覽器選單開啟安裝。';
    } catch (_) { message = '未能開啟安裝視窗，可依下方瀏覽器步驟操作。'; }
    finally { busy = false; update(); if (!standalone()) open(button); }
  }
  g.addEventListener('beforeinstallprompt',event=>{ if (typeof event.prompt !== 'function' || standalone()) return; event.preventDefault(); deferred=event; message=''; update(); });
  g.addEventListener('appinstalled',()=>{ installedHere=true; deferred=null; busy=false; message=''; update(); });
  media?.addEventListener?.('change',()=>{message='';update();});
  doc.addEventListener('click',event=>{
    const openButton=event.target.closest?.('[data-app-install-open]'),confirm=event.target.closest?.('[data-app-install-confirm]');
    if (event.target.closest?.('[data-app-install-close]')) { close(); return; }
    if (confirm || openButton) { if (deferred && !standalone()) void prompt(event,openButton||opener); else open(openButton||opener); }
  });
  g.OphInstall={open,close,state:()=>({installed:standalone(),ready:!!deferred,busy,platform:platform()})}; update();
})(window);
