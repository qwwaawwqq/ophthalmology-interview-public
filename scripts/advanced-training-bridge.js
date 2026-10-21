/* advanced-training-bridge:start */
function advancedPage(){return heading('HARD / CLINICAL REASONING','Hard｜臨床推理','整合線索、辨別最接近的選項，再決定下一步。')+'<section id="advanced-root" aria-label="進階臨床推理訓練"><p role="status">正在載入已審核的進階題…</p></section>';}
function advancedHomeLink(){return '<section class="tb-extra-entry"><h2>Hard｜臨床推理</h2><p>以多步整合與接近正解的干擾選項深練；可選不計時，或12題／18分鐘混合訓練。這是作者設定，尚未以實際甄試校準。</p>'+btn('進入Hard臨床推理','tab','advanced','primary')+'</section>';}
window.OphAdvancedBridge={
 state(){return {entries,meta};},
 read(key){return entries[key]||null;},
 save(key,value){return window.OphProjectBridge.save(key,value);},
 open(id){window.OphStudyBridge.open('extra',id);},
 show(){switchTab('advanced');},
 standard(){switchTab('project');window.OphProject?.action('project-written','');},
 apply(item,displayChoice){const q=window.OphAdvancedCatalog?.get(item.id),choice=item.sourceOrder[displayChoice];if(!q||!window.OphAdvancedCore.eligible(q)||q.correctIndex!==item.sourceCorrectIndex||JSON.stringify(q.options.map(o=>o.text))!==JSON.stringify(item.sourceOptions))return false;if(!window.OphStudy?.sessionCommit('extra',q.id,choice===q.correctIndex))return false;window.OphTextbookBridge.write('extra-question',q.id,{choice,revealed:true,edition:window.OphAdvancedCore.PACK});return true;},
 completed(){projectAward('written');},
 notify:toast
};
/* advanced-training-bridge:end */
