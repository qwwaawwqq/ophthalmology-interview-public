/* specialty-registry:start */
// Specialty registry. Picks the active specialty from ?s= (missing or unknown means oph) and exposes
// window.OphSpecialty before the app boots. Injected inline by scripts/apply-enrichment.py as the
// script element with id specialty-boot; it must keep that attribute because the build rewrites
// every attribute-less script element. Never write a literal script tag in this file.
// The oph entry keeps the original storage keys, sync file, formats and export name byte-identical.
(function(w){
  'use strict';
  const other=(id,label,exportName)=>({id,label,appTitle:label+'甄選練習室',storePrefix:id+'-prep:',stateKey:id+'-prep:progress-v1',syncFile:'progress-'+id+'.json',formats:[id+'-prep-progress-v1'],exportFormat:id+'-prep-progress-v1',defaultRepo:'ophthalmology-progress',exportName,dataId:'course-data-'+id,contentBase:'content/'+id+'/',query:'?s='+id});
  const list=[
    {id:'oph',label:'眼科',appTitle:'眼科甄選練習室',storePrefix:'oph-prep:',stateKey:'oph-prep:progress-v3',syncFile:'progress.json',formats:['ophthalmology-prep-progress-v1','ophthalmology-prep-progress-v2','ophthalmology-prep-progress-v3'],exportFormat:'ophthalmology-prep-progress-v3',defaultRepo:'ophthalmology-progress',exportName:'Ophthalmology_Progress_',dataId:'course-data',contentBase:'content/',query:''},
    other('ent','耳鼻喉科','ENT_Progress_'),
    other('rad','放射診斷科','Radiology_Progress_'),
    other('radonc','放射腫瘤科','RadiationOncology_Progress_'),
    other('nm','核子醫學科','NuclearMedicine_Progress_'),
    other('neuro','神經內科','Neurology_Progress_')
  ];
  const REG=Object.create(null);
  for(const s of list){Object.freeze(s.formats);REG[s.id]=Object.freeze(s);}
  let key='oph';
  try{const q=new URLSearchParams(w.location&&w.location.search||'').get('s');if(q&&Object.prototype.hasOwnProperty.call(REG,q))key=q;}catch(_){key='oph';}
  w.OphSpecialties=Object.freeze(REG);
  w.OphSpecialty=REG[key];
})(typeof window!=='undefined'?window:globalThis);
/* specialty-registry:end */
