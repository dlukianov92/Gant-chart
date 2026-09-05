
(function(){
  "use strict";
  var WEEKS=53, DAYS=WEEKS*7;
  var ZOOMS=[5,8,12,18], zi=2;
  var DAYW=ZOOMS[zi], WEEKW=DAYW*7, ROWH=36, BARH=28, GHEAD=24, HEADERH=46;
  // ---- проекты ----
  var projects=[], curId=null;
  function curProj(){ for(var i=0;i<projects.length;i++) if(projects[i].id===curId) return projects[i]; return projects[0]||null; }
  function loadProjects(cb){
    function done(raw){ var o=null; try{ o=JSON.parse(raw); }catch(e){}
      if(o&&o.projects&&o.projects.length){ projects=o.projects; curId=o.cur||projects[0].id; }
      else { projects=[{id:"__default",name:"Блок Б",loc:"пос. Тургояк, Миасс",lat:55.147,lng:60.138,key:"gantt_board_v1",stats:{},wx:""}]; curId="__default"; persistProjects(); }
      cb();
    }
    // StorageAdapter may not be defined yet at parse time — use late binding via getAsync after init
    if(typeof StorageAdapter!=="undefined") StorageAdapter.getAsync(KEY_PROJECTS||"gantt_projects", done);
    else {
      var raw=null; try{ raw=localStorage.getItem("gantt_projects"); }catch(e){}
      done(raw);
    }
  }
  function resetState(){ state={bars:[], types:[], elemRes:{}, detail:{}}; typesById={}; stateRev++; }

  var DISCIPLINES=["Общестроительные работы","Архитектура","Трубопроводы","Электрика","Механика"];
  // Элемент: {id, short(имя), color, ink, disc(дисциплина), unit(ед.изм.), projVol(проектный объём)}
  var BUILTIN=[];  // встроенные элементы убраны — только из справочника
  var NONE={id:null, short:"Без вида", color:"#9aa0a6", ink:"#fff", disc:"", unit:"", projVol:0};
  var PALETTE=["#8E44AD","#2980B9","#16A085","#27AE60","#F39C12","#E74C3C","#D81B60","#00838F","#5D4037","#546E7A"];
  var DPAL=["#8E44AD","#2980B9","#27AE60","#E67E22","#C0392B","#16A085","#D81B60","#00838F","#7F8C8D","#F39C12","#2C3E50","#6D4C41"];
  var DISC_ORDER=DISCIPLINES.slice();
  function discColor(disc){ disc=(disc||"").trim(); if(!disc||disc==="Без дисциплины") return "#9aa0a6";
    var i=DISC_ORDER.indexOf(disc); if(i<0){ DISC_ORDER.push(disc); i=DISC_ORDER.length-1; } return DPAL[i%DPAL.length]; }
  function inkFor(hex){ var c=(hex||"#888").replace("#",""); if(c.length===3)c=c.split("").map(function(x){return x+x;}).join("");
    var r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);
    return (0.2126*r+0.7152*g+0.0722*b)/255 > 0.62 ? "#1b2430" : "#ffffff"; }
  function allTypes(){ return BUILTIN.concat(state.types); }
  function groupOrder(){ return allTypes().concat([NONE]); }
  function knownIdSet(){ var s={}; allTypes().forEach(function(t){ s[t.id]=1; }); return s; }
  function effTypeId(b, known){ return (b.typeId!==null && known[b.typeId]) ? b.typeId : null; }
  function rebuildTypeIndex(){ typesById={}; allTypes().forEach(function(t){ if(t&&t.id!=null) typesById[t.id]=t; }); }
  function typeById(id){ if(id==null) return NONE; var t=typesById[id]; if(t) return t; var a=allTypes(); for(var i=0;i<a.length;i++) if(a[i].id===id){ typesById[id]=a[i]; return a[i]; } return NONE; }
  function norm(s){ return (s||"").toString().toLowerCase().replace(/\s+/g," ").trim(); }
  function elemByName(name){ var n=norm(name); var a=allTypes(); for(var i=0;i<a.length;i++) if(norm(a[i].short)===n) return a[i]; return null; }
  function num(x){ if(x===""||x==null) return null; var v=parseFloat((""+x).replace(",",".")); return isNaN(v)?null:v; }
  // ресурсы элемента (уровень планирования): state.elemRes[elemId] = [{rtype, name(категория), unit, total(объём категории на элемент)}]
  function elemRes(id){ return (state.elemRes && state.elemRes[id]) ? state.elemRes[id] : []; }
  function pkgShare(b){ var el=typeById(b.typeId); var pv=num(el.projVol)||0; var v=num(b.pkgVol)||0; return pv>0? v/pv : 0; }
  // категории пакета: объём категории × доля пакета, с ручной правкой b.resOv[i] + ручные b.mats
  function pkgResources(b){
    var share=pkgShare(b);
    var list=elemRes(b.typeId).map(function(r,i){
      var ov=(b.resOv && b.resOv[i]!=null)?num(b.resOv[i]):null;
      var qty=(ov!=null?ov:(num(r.total)||0)*share);
      return {rtype:r.rtype, name:r.name, unit:r.unit, qty:qty, price:num(r.price), cost:(num(r.price)||0)*qty, idx:i, over:(ov!=null)};
    });
    (b.mats||[]).forEach(function(m,j){ list.push({rtype:m.rtype||"Материал", name:m.name, unit:m.unit, qty:(num(m.qty)||0), price:(num(m.price)!=null?num(m.price):null), cost:((num(m.price)||0)*(num(m.qty)||0)), manual:j, over:false}); });
    return list;
  }
  function pkgCost(b){ return pkgResources(b).reduce(function(s,r){return s+(r.cost||0);},0); }
  function elemBudget(id){ return elemRes(id).reduce(function(s,r){ return s+((num(r.price)||0)*(num(r.total)||0)); },0); }
  function objBudget(){ return allTypes().reduce(function(s,t){ return s+elemBudget(t.id); },0); }
  // суммарные чел-ч работ пакета (универсальный «рабочий», без специальностей)
  function pkgTotalWorkMH(b){
    var share=pkgShare(b), mh=0;
    elemRes(b.typeId).forEach(function(r,i){
      if(r.rtype!=="Работа") return;
      var ov=(b.resOv && b.resOv[i]!=null)?num(b.resOv[i]):null;
      var qty=(ov!=null?ov:(num(r.total)||0)*share);
      mh+=(num(r.chh)||0)*qty;
    });
    (b.mats||[]).forEach(function(m){ if((m.rtype||"")==="Работа"){ mh+=(num(m.chh)||0)*(num(m.qty)||0); } });
    return mh;
  }
  var WORKWEEK=40; // 5 дней × 8 ч
  var DEFCONTR="Подрядчик";
  function computeLabor(){
    var weeks=[]; for(var w=0;w<WEEKS;w++) weeks.push({});
    var contrs={}, corder=[];
    state.bars.forEach(function(b){
      if(b.typeId===null) return; var span=b.end-b.start; if(span<=0) return;
      var mh=pkgTotalWorkMH(b); if(mh<=0) return;
      var c=(b.contr&&b.contr.trim())?b.contr.trim():DEFCONTR;
      var per=mh/span;
      for(var d=b.start; d<b.end; d++){ var w=Math.floor(d/7); if(w<0||w>=WEEKS) continue; weeks[w][c]=(weeks[w][c]||0)+per; }
      if(!contrs[c]){ contrs[c]=1; corder.push(c); }
    });
    return {weeks:weeks, contrs:corder};
  }
  function pkgDonePct(b){ var pv=num(b.pkgVol)||0, f=num(b.fact)||0; return pv>0?Math.max(0,Math.min(100,f/pv*100)):0; }
  // трудоёмкость: сумма по категориям-работам (чел-ч/ед × объём категории на элемент)
  function elemTotalMH(id){ return elemRes(id).reduce(function(s,r){ return s + (r.rtype==="Работа"?((num(r.chh)||0)*(num(r.total)||0)):0); },0); }
  // освоенные чел-ч элемента = общий чел-ч × (сумма факта пакетов / проектный объём)
  function elemFactVol(id){ var s=0; state.bars.forEach(function(b){ if(b.typeId===id) s+=(num(b.fact)||0); }); return s; }
  function readiness(){
    var byEl=[], disc={}, dorder=[], objT=0, objE=0;
    allTypes().forEach(function(t){
      var tot=elemTotalMH(t.id); if(tot<=0) return;
      var pv=num(t.projVol)||0; var fact=elemFactVol(t.id);
      var earned=pv>0?tot*Math.min(fact,pv)/pv:0;
      byEl.push({name:t.short, disc:t.disc||"—", tot:tot, earned:earned, pct:(tot>0?earned/tot*100:0), fact:fact, proj:pv, unit:t.unit});
      objT+=tot; objE+=earned;
      if(!disc[t.disc]){ disc[t.disc]={name:t.disc||"—",tot:0,earned:0}; dorder.push(t.disc); }
      disc[t.disc].tot+=tot; disc[t.disc].earned+=earned;
    });
    var byDisc=dorder.map(function(d){ var x=disc[d]; x.pct=(x.tot>0?x.earned/x.tot*100:0); return x; });
    return {byEl:byEl, byDisc:byDisc, objTot:objT, objEarned:objE, objPct:(objT>0?objE/objT*100:0)};
  }
  var typeSeq=1;

  var MONTHS=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  function startOfDay(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
  var today=startOfDay(new Date());
  var dow=(today.getDay()+6)%7;
  var anchor=new Date(today); anchor.setDate(anchor.getDate()-dow-26*7);
  function addDays(d,n){ var x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function dayToDate(i){ return addDays(anchor,i); }
  function dateToDay(d){ return Math.round((startOfDay(d)-anchor)/86400000); }
  function pad(n){ return n<10?"0"+n:""+n; }
  function iso(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function parseIso(s){ var p=(""+s).split("-"); return new Date(+p[0],+p[1]-1,+p[2]); }
  function ddmm(d){ return pad(d.getDate())+"."+pad(d.getMonth()+1); }
  var todayDay=dateToDay(today);

  var state={bars:[], types:[], elemRes:{}, detail:{}}; var seq=1; var typesById={}; var stateRev=0;
  function clampDay(x){ return Math.max(0,Math.min(DAYS,x)); }
  function defaultBars(){
    var arr=[]; for(var i=0;i<20;i++){ arr.push({id:"b"+(seq++),order:i,typeId:null,start:i,end:i+5,note:"",contr:"",pkgVol:"",fact:"",resOv:{},mats:[]}); } return arr;
  }
  function hydrate(raw){
    try{
      var o=JSON.parse(raw);
      o=migrateBoard(o);
      if(!o) return false;
      // bars may be empty for new project; types optional
      state.types=(o.types||[]).map(function(t){ var col=discColor(t.disc||""); return {id:t.id, short:t.short||t.name||"Элемент", color:col, ink:inkFor(col), disc:t.disc||"", unit:t.unit||"", projVol:(t.projVol!=null?t.projVol:0)}; });
      var tmx=0; state.types.forEach(function(t){ var n=parseInt((t.id||"u0").replace(/\D/g,""))||0; if(n>tmx)tmx=n; }); typeSeq=tmx+1;
      // catalog may still be embedded (pre-split) — take it, loadKey will also load catalog key
      if(o.elemRes) state.elemRes=o.elemRes;
      if(o.detail) state.detail=o.detail;
      state.bars=(o.bars||[]).map(function(b,idx){
        return {id:b.id||("b"+(seq++)),order:(b.order==null?idx:b.order),typeId:(b.typeId||null),
          start:clampDay(dateToDay(parseIso(b.s))),end:clampDay(dateToDay(parseIso(b.e))),
          note:b.note||"",contr:b.contr||"",
          pkgVol:(b.pkgVol!=null?b.pkgVol:""), fact:(b.fact!=null?b.fact:""), resOv:(b.resOv||{}),
          mats:(b.mats||[]).map(function(m){ return {name:m.n||m.name||"", unit:m.u||m.unit||"", qty:(m.q!=null?m.q:(m.qty!=null?m.qty:1)), rtype:(m.rt||m.rtype||"Материал"), price:(m.pr!=null?m.pr:(m.price!=null?m.price:null)), chh:(m.ch!=null?m.ch:(m.chh!=null?m.chh:null))}; })};
      });
      state.bars.forEach(function(b){ if(b.end<=b.start) b.end=b.start+1; });
      var mx=0; state.bars.forEach(function(b){ var n=parseInt((b.id||"b0").replace(/\D/g,""))||0; if(n>mx)mx=n; }); seq=mx+1;
      rebuildTypeIndex();
      stateRev++;
      return true;
    }catch(e){ return false; }
  }

  // ---- core: schema + StorageAdapter (LS + IndexedDB) + keys ----
  var SCHEMA_VERSION = 8;
  var KEY_PROJECTS = "gantt_projects";
  var IDB_NAME = "plan_rabot_db";
  var IDB_STORE = "kv";
  var IDB_VER = 1;
  function boardKey(){ var p=curProj(); return p?(p.key||("gantt_board_"+p.id)):"gantt_board_v1"; }
  function catalogKey(){ var p=curProj(); return "gantt_catalog_"+(p?p.id:"__default"); }
  function requestsKey(){ var p=curProj(); return "gantt_requests_"+(p?p.id:"__default"); }
  function lastGoodKey(){ return boardKey()+"__lastGood"; }

  // ---- IndexedDB thin layer ----
  var _idb = null;
  var _idbOpening = null;
  function idbAvailable(){ return typeof indexedDB !== "undefined"; }
  function idbOpen(){
    if(_idb) return Promise.resolve(_idb);
    if(_idbOpening) return _idbOpening;
    if(!idbAvailable()) return Promise.reject(new Error("no_idb"));
    _idbOpening = new Promise(function(resolve, reject){
      try{
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function(e){
          var db = e.target.result;
          if(!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function(e){ _idb = e.target.result; _idbOpening = null; resolve(_idb); };
        req.onerror = function(){ _idbOpening = null; reject(req.error||new Error("idb_open")); };
      }catch(err){ _idbOpening = null; reject(err); }
    });
    return _idbOpening;
  }
  function idbGet(k){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        try{
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get(k);
          req.onsuccess = function(){ resolve(req.result != null ? req.result : null); };
          req.onerror = function(){ reject(req.error); };
        }catch(e){ reject(e); }
      });
    });
  }
  function idbSet(k, v){
    return idbOpen().then(function(db){
      return new Promise(function(resolve, reject){
        try{
          var tx = db.transaction(IDB_STORE, "readwrite");
          var req = tx.objectStore(IDB_STORE).put(v, k);
          req.onsuccess = function(){ resolve(true); };
          req.onerror = function(){ reject(req.error); };
        }catch(e){ reject(e); }
      });
    });
  }
  function idbDel(k){
    return idbOpen().then(function(db){
      return new Promise(function(resolve){
        try{
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(k);
          tx.oncomplete = function(){ resolve(true); };
          tx.onerror = function(){ resolve(false); };
        }catch(e){ resolve(false); }
      });
    });
  }

  // StorageAdapter: IDB primary for large values, LS mirror for small + fallback
  function hasWinStore(){ return typeof window!=="undefined" && window.storage && typeof window.storage.set==="function"; }
  function StorageAdapter(){}
  StorageAdapter.getSync = function(k){
    try{ return window.localStorage?window.localStorage.getItem(k):null; }catch(e){ return null; }
  };
  StorageAdapter.setSync = function(k,v){
    try{
      if(!window.localStorage) return {ok:false, error:"no_ls"};
      window.localStorage.setItem(k,v);
      return {ok:true};
    }catch(e){
      var name=(e&&e.name)||"";
      if(name==="QuotaExceededError"||name==="NS_ERROR_DOM_QUOTA_REACHED"||(e&&e.code===22)){
        return {ok:false, error:"quota", message:e.message||""};
      }
      return {ok:false, error:"write", message:(e&&e.message)||""};
    }
  };
  StorageAdapter.removeSync = function(k){
    try{ if(window.localStorage) window.localStorage.removeItem(k); }catch(e){}
    if(idbAvailable()) idbDel(k).catch(function(){});
    return true;
  };
  // Prefer IDB value if present, else LS (migration path)
  StorageAdapter.getAsync = function(k, cb){
    var lsVal = StorageAdapter.getSync(k);
    var finished = false;
    function done(v){ if(finished) return; finished = true; cb(v); }
    if(idbAvailable()){
      idbGet(k).then(function(v){
        if(v != null && v !== "") done(typeof v === "string" ? v : String(v));
        else done(lsVal);
      }).catch(function(){ done(lsVal); });
      setTimeout(function(){ done(lsVal); }, 2000);
    } else if(hasWinStore()){
      var guard=setTimeout(function(){ done(lsVal); }, 1200);
      try{
        Promise.resolve(window.storage.get(k,false)).then(function(res){
          clearTimeout(guard);
          done((res&&res.value!=null)?res.value:lsVal);
        }).catch(function(){ clearTimeout(guard); done(lsVal); });
      }catch(e){ clearTimeout(guard); done(lsVal); }
    } else {
      done(lsVal);
    }
  };
  StorageAdapter.setAsync = function(k,v){
    // Always try IDB for durability + size
    if(idbAvailable()){
      idbSet(k, v).catch(function(){});
    }
    if(hasWinStore()){
      try{ window.storage.set(k,v,false); }catch(e){}
    }
  };
  // Write: LS for small keys / mirror; IDB always for board/catalog/requests
  StorageAdapter.setBoth = function(k, v, opts){
    opts = opts || {};
    var preferIdb = !!opts.preferIdb || (v && v.length > 50000);
    var r = {ok:true};
    if(!preferIdb || !idbAvailable()){
      r = StorageAdapter.setSync(k, v);
      if(!r.ok && r.error==="quota" && idbAvailable()){
        // fallback: only IDB
        preferIdb = true;
        r = {ok:true, via:"idb_only"};
      }
    } else {
      // still try mirror small head for offline first paint — skip if huge
      if(v.length < 2e6){
        var m = StorageAdapter.setSync(k, v);
        if(!m.ok && m.error==="quota"){
          // remove LS copy if any, keep IDB only
          try{ window.localStorage.removeItem(k); }catch(e){}
        }
      }
    }
    StorageAdapter.setAsync(k, v);
    return r;
  };

  function lsGet(k){ return StorageAdapter.getSync(k); }
  function lsSet(k,v){
    var r=StorageAdapter.setSync(k,v);
    if(!r.ok && r.error==="quota"){
      try{ toast("Память заполнена. Экспортируйте проект или удалите старый."); }catch(e){}
    }
    StorageAdapter.setAsync(k,v);
    return r.ok;
  }

  function migrateBoard(o){
    if(!o || typeof o!=="object") return null;
    var v = o.v||1;
    if(v < 6){ o.v = 6; }
    if((o.v||6) < 7){
      o.v = 7;
      if(!o.types) o.types = [];
      if(!o.elemRes) o.elemRes = {};
      if(!o.detail) o.detail = {};
      if(!o.bars) o.bars = [];
    }
    // v7 → v8: catalog split marker (actual split done in loadBoardAndCatalog)
    if((o.v||7) < 8){
      o.v = 8;
      o._needsCatalogSplit = !!(o.elemRes || o.detail);
    }
    o.v = SCHEMA_VERSION;
    return o;
  }

  function validateImportPayload(o){
    if(!o || typeof o!=="object") return "Файл не распознан";
    if(!Array.isArray(o.bars)) return "Нет массива bars";
    if(o.bars.length > 5000) return "Слишком много полос (>"+5000+")";
    if(o.types && o.types.length > 2000) return "Слишком много элементов";
    return null;
  }

  function persistProjects(){
    var s=JSON.stringify({v:1, projects:projects, cur:curId});
    var r=StorageAdapter.setBoth(KEY_PROJECTS, s, {preferIdb:false});
    if(!r.ok && r.error==="quota") try{ toast("Память заполнена (проекты)"); }catch(e){}
  }

  var saveTimer=null, saveTimerLS=null;
  var catalogDirty = false;
  function markCatalogDirty(){ catalogDirty = true; }
  function updateProjStats(){ var p=curProj(); if(!p) return; try{ p.stats={budget:objBudget(), pct:readiness().objPct}; }catch(e){} }

  function serializeBoard(){
    // v8 board: operational data only (types needed for Gantt labels)
    return JSON.stringify({
      v: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      types: state.types.map(function(t){ return {id:t.id, short:t.short, color:t.color, disc:t.disc||"", unit:t.unit||"", projVol:t.projVol||0}; }),
      bars: state.bars.map(function(b){
        return {id:b.id,order:b.order,typeId:b.typeId,s:iso(dayToDate(b.start)),e:iso(dayToDate(b.end)),note:b.note,contr:b.contr,
          pkgVol:(b.pkgVol!=null?b.pkgVol:""), fact:(b.fact!=null?b.fact:""), resOv:(b.resOv||{}),
          mats:(b.mats||[]).map(function(m){ return {n:m.name,u:m.unit,q:m.qty,rt:m.rtype,pr:m.price,ch:m.chh}; })};
      })
    });
  }
  function serializeCatalog(){
    return JSON.stringify({
      v: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      elemRes: state.elemRes || {},
      detail: state.detail || {}
    });
  }
  // backward-compatible full dump for export
  function serialize(){
    return JSON.stringify({
      v: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      types: state.types.map(function(t){ return {id:t.id, short:t.short, color:t.color, disc:t.disc||"", unit:t.unit||"", projVol:t.projVol||0}; }),
      elemRes: state.elemRes || {},
      detail: state.detail || {},
      bars: state.bars.map(function(b){
        return {id:b.id,order:b.order,typeId:b.typeId,s:iso(dayToDate(b.start)),e:iso(dayToDate(b.end)),note:b.note,contr:b.contr,
          pkgVol:(b.pkgVol!=null?b.pkgVol:""), fact:(b.fact!=null?b.fact:""), resOv:(b.resOv||{}),
          mats:(b.mats||[]).map(function(m){ return {n:m.name,u:m.unit,q:m.qty,rt:m.rtype,pr:m.price,ch:m.chh}; })};
      })
    });
  }

  function saveCatalogImmediate(){
    var data = serializeCatalog();
    var k = catalogKey();
    var r = StorageAdapter.setBoth(k, data, {preferIdb:true});
    if(!r.ok && r.error==="quota") try{ toast("Память заполнена (справочник)"); }catch(e){}
    catalogDirty = false;
    return r.ok;
  }
  function saveImmediate(){
    var data=serializeBoard(); var k=boardKey();
    var prev=StorageAdapter.getSync(k);
    if(prev) StorageAdapter.setBoth(lastGoodKey(), prev, {preferIdb:true});
    var r=StorageAdapter.setBoth(k, data, {preferIdb:true});
    if(!r.ok){
      if(r.error==="quota") try{ toast("Память заполнена. Сделайте экспорт."); }catch(e){}
      return false;
    }
    if(catalogDirty || true){ saveCatalogImmediate(); } // always keep catalog in sync for safety
    updateProjStats();
    persistProjects();
    flashSaved();
    stateRev++;
    return true;
  }
  function save(){
    if(saveTimerLS) clearTimeout(saveTimerLS);
    saveTimerLS=setTimeout(function(){ saveImmediate(); }, 180);
    if(hasWinStore()){
      if(saveTimer) clearTimeout(saveTimer);
      saveTimer=setTimeout(function(){
        try{
          window.storage.set(boardKey(), serializeBoard(), false);
          window.storage.set(catalogKey(), serializeCatalog(), false);
          window.storage.set(KEY_PROJECTS, JSON.stringify({v:1, projects:projects, cur:curId}), false);
        }catch(e){}
      }, 250);
    }
  }

  function applyCatalogObject(c){
    if(!c || typeof c!=="object") return;
    if(c.elemRes) state.elemRes = c.elemRes;
    if(c.detail) state.detail = c.detail;
  }
  function loadCatalog(cb){
    StorageAdapter.getAsync(catalogKey(), function(raw){
      if(raw){
        try{
          var c = JSON.parse(raw);
          applyCatalogObject(c);
        }catch(e){}
      }
      if(cb) cb();
    });
  }
  function ensureCatalogLoaded(cb){
    // if detail already has keys or elemRes non-empty, assume loaded
    var has = (state.elemRes && Object.keys(state.elemRes).length) || (state.detail && Object.keys(state.detail).length);
    if(has){ if(cb) cb(); return; }
    loadCatalog(cb);
  }

  function loadKey(key, cb){
    function finish(raw){
      resetState();
      var ok = false;
      if(raw) ok = hydrate(raw);
      if(!ok){
        var lg=StorageAdapter.getSync(key+"__lastGood");
        if(lg) ok = hydrate(lg);
      }
      if(!ok) state.bars=defaultBars();
      rebuildTypeIndex();
      // load split catalog (and migrate embedded catalog if needed)
      StorageAdapter.getAsync(catalogKey(), function(catRaw){
        if(catRaw){
          try{ applyCatalogObject(JSON.parse(catRaw)); }catch(e){}
        } else if(raw){
          // migrate: old board may still contain elemRes/detail
          try{
            var o = JSON.parse(raw);
            if(o.elemRes || o.detail){
              state.elemRes = o.elemRes || {};
              state.detail = o.detail || {};
              saveCatalogImmediate();
              // rewrite board without catalog
              StorageAdapter.setBoth(boardKey(), serializeBoard(), {preferIdb:true});
            }
          }catch(e){}
        }
        rebuildTypeIndex();
        cb();
      });
    }
    StorageAdapter.getAsync(key, finish);
  }
  function load(cb){ loadKey(boardKey(), cb); }

  function loadRequests(){
    try{ var raw=StorageAdapter.getSync(requestsKey()); var a=raw?JSON.parse(raw):[]; return Array.isArray(a)?a:[]; }catch(e){ return []; }
  }
  function saveRequests(list){
    var s=JSON.stringify(list||[]);
    var r=StorageAdapter.setBoth(requestsKey(), s, {preferIdb:true});
    if(!r.ok && r.error==="quota") try{ toast("Память заполнена (заявки)"); }catch(e){}
  }

  var statusEl, statusT=null;
  function flashSaved(){ if(!statusEl)return; statusEl.classList.add("on"); if(statusT)clearTimeout(statusT);
    statusT=setTimeout(function(){ statusEl.classList.remove("on"); },1400); }

  function applyZoomVars(){ var rs=document.documentElement.style; rs.setProperty("--weekW",WEEKW+"px"); rs.setProperty("--dayW",DAYW+"px"); }
  function setZoom(newi){
    var sc=document.getElementById("scroll"); var center=(sc.scrollLeft+sc.clientWidth/2)/DAYW;
    zi=(newi+ZOOMS.length)%ZOOMS.length; DAYW=ZOOMS[zi]; WEEKW=DAYW*7; applyZoomVars();
    try{ lsSet("gantt_zoom", ""+zi); }catch(e){}
    buildHeader(); render();
    sc.scrollLeft=Math.max(0, center*DAYW - sc.clientWidth/2);
    toast("Масштаб: "+["очень мелкий","мелкий","обычный","крупный"][zi]);
  }
  // ---- header ----
  var viewMode="L2"; try{ var vm=lsGet("gantt_view"); if(vm==="L1"||vm==="L2") viewMode=vm; }catch(e){}
  function buildHeader(){
    var header=document.getElementById("header"); var totalW=DAYS*DAYW;
    document.getElementById("canvas").style.width=totalW+"px"; header.style.width=totalW+"px";
    header.className="header"+(viewMode==="L1"?" l1":"");
    var months=document.createElement("div"); months.className="months"; var i=0;
    while(i<WEEKS){ var m=dayToDate(i*7).getMonth(); var span=0;
      while(i+span<WEEKS && dayToDate((i+span)*7).getMonth()===m) span++;
      var cell=document.createElement("div"); cell.className="mcell"; cell.style.width=(span*WEEKW)+"px"; cell.textContent=MONTHS[m];
      if(i===0) cell.style.borderLeft="none"; months.appendChild(cell); i+=span; }
    header.innerHTML=""; header.appendChild(months);
    if(viewMode==="L2"){
      var weeks=document.createElement("div"); weeks.className="weeks";
      for(var w=0;w<WEEKS;w++){ var wc=document.createElement("div"); wc.className="wcell"; wc.textContent=ddmm(dayToDate(w*7)); weeks.appendChild(wc); }
      header.appendChild(weeks);
    }
    document.getElementById("today").style.left=(todayDay*DAYW)+"px";
    buildBands();
  }
  function buildBands(){
    var bands=document.getElementById("bands"); if(!bands) return; bands.innerHTML=""; bands.style.width=(DAYS*DAYW)+"px";
    var i=0, mi=0;
    while(i<WEEKS){ var m=dayToDate(i*7).getMonth(); var span=0;
      while(i+span<WEEKS && dayToDate((i+span)*7).getMonth()===m) span++;
      var el=document.createElement("div"); el.className="mb"+(mi%2?" alt":"")+(i>0?" edge":"");
      el.style.left=(i*7*DAYW)+"px"; el.style.width=(span*WEEKW)+"px"; bands.appendChild(el); i+=span; mi++; }
  }

  // ---- render ----
  var groupsEl=document.getElementById("groups");
  function barText(b){ var p=[]; if(b.note)p.push(b.note);
    var v=(b.pkgVol!=null&&b.pkgVol!=="")?((""+b.pkgVol+" "+(typeById(b.typeId).unit||"")).trim()):""; if(v)p.push(v);
    var d=pkgDonePct(b); if(d>0)p.push(Math.round(d)+"%");
    if(b.contr)p.push(b.contr); return p.join(" · "); }
  function updateBarLabel(b){ var el=groupsEl.querySelector('.bar[data-id="'+b.id+'"]'); if(!el)return;
    var l=el.querySelector('.lbl'); if(l) l.textContent=barText(b);
    var f=el.querySelector('.prog'); if(f) f.style.width=pkgDonePct(b)+"%"; }
  function escapeHtml(s){ return (s||"").replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];}); }
  var collapsed={}; try{ collapsed=JSON.parse(lsGet("gantt_collapsed")||"{}")||{}; }catch(e){ collapsed={}; }
  function discOf(t){ return (t.id===null? "Без дисциплины" : (t.disc||"Без дисциплины")); }
  function toggleDisc(d){ collapsed[d]=!collapsed[d]; try{ lsSet("gantt_collapsed",JSON.stringify(collapsed)); }catch(e){} render(); }
  function render(){
    groupsEl.style.width=(DAYS*DAYW)+"px"; groupsEl.innerHTML="";
    var known=knownIdSet();
    // элементы с полосами, сгруппированные по дисциплине (в порядке groupOrder)
    var discList=[], byDisc={};
    groupOrder().forEach(function(t){
      var bars=state.bars.filter(function(b){return effTypeId(b,known)===t.id;}).sort(function(a,b){return a.order-b.order;});
      if(!bars.length) return;
      var d=discOf(t);
      if(!byDisc[d]){ byDisc[d]={items:[],count:0}; discList.push(d); }
      byDisc[d].items.push({t:t,bars:bars}); byDisc[d].count+=bars.length;
    });
    discList.forEach(function(d){
      var isC=!!collapsed[d];
      var dh=document.createElement("div"); dh.className="dhead"+(isC?" collapsed":"");
      dh.innerHTML='<div class="dlabel"><span class="dcaret">▾</span><span>'+escapeHtml(d)+'</span><span class="dcount">'+byDisc[d].items.length+' эл · '+byDisc[d].count+' пак</span></div>';
      dh.addEventListener("click",function(){ toggleDisc(d); });
      groupsEl.appendChild(dh);
      if(isC) return;
      byDisc[d].items.forEach(function(it){
        var t=it.t, bars=it.bars;
        var g=document.createElement("div"); g.className="group";
        var head=document.createElement("div"); head.className="ghead";
        var lab=document.createElement("div"); lab.className="glabel";
        lab.innerHTML='<span class="chip" style="background:'+t.color+'"></span><span>'+t.short+'</span><span class="gcount">'+bars.length+'</span>';
        head.appendChild(lab); g.appendChild(head);
        var rows=document.createElement("div"); rows.className="grows";
        if(viewMode==="L1"){
          rows.style.height=L1ROWH+"px"; rows.appendChild(makeRollupBar(t,bars));
        } else {
          rows.style.height=(bars.length*ROWH)+"px";
          var vis=getVisibleDayRange();
          bars.forEach(function(b,ri){
            if(!barIntersects(b, vis.from, vis.to)) return; // virtualization: skip offscreen bars
            rows.appendChild(makeBar(b,ri,t));
          });
        }
        g.appendChild(rows); groupsEl.appendChild(g);
      });
    });
    groupsEl.style.minHeight="";
    renderPeopleCard();
  }
  var PROFCOL=["#C0392B","#2980B9","#16A085","#8E44AD","#E67E22","#2C3E50","#D81B60"];
  function renderPeopleCard(){
    var host=document.getElementById("peopleChart"); if(!host) return; host.innerHTML="";
    var L=computeLabor();
    // недельные суммы + диапазон с данными
    var totals=[], per=[]; var maxT=0, first=-1, last=-1;
    for(var w=0; w<WEEKS; w++){ var s=0, pp={}; L.contrs.forEach(function(c){ var mh=L.weeks[w][c]||0; var n=mh>0?Math.ceil(mh/WORKWEEK):0; if(n>0){pp[c]=n; s+=n;} }); totals.push(s); per.push(pp); if(s>0){ if(first<0)first=w; last=w; } if(s>maxT)maxT=s; }
    if(maxT<=0){ host.innerHTML='<div style="color:var(--muted);font-size:13px;padding:12px">Нет данных: задайте работы, объёмы и сроки пакетов.</div>'; return; }
    // ось Y: округлим макс до кратного 5
    var ymax=Math.max(5, Math.ceil(maxT/5)*5);
    var wrap=document.createElement("div"); wrap.className="pchwrap"; wrap.style.overflowX="auto"; wrap.style.webkitOverflowScrolling="touch";
    var chart=document.createElement("div"); chart.className="pch";
    // ось + сетка
    var yax=document.createElement("div"); yax.className="pchy";
    for(var g=0; g<=ymax; g+=5){ var sp=document.createElement("span"); sp.style.bottom=(g/ymax*100)+"%"; sp.textContent=g; yax.appendChild(sp); }
    chart.appendChild(yax);
    var s0=first, s1=last; var count=s1-s0+1; var minW=Math.max(320, count*30);
    chart.style.minWidth=minW+"px";
    for(var w2=s0; w2<=s1; w2++){
      var col=document.createElement("div"); col.className="pcol";
      var tot=totals[w2];
      if(tot>0){ var num=document.createElement("div"); num.className="pcnum"; num.textContent=tot; col.appendChild(num);
        var bar=document.createElement("div"); bar.className="pcbar"; bar.style.height=(tot/ymax*100)+"%";
        (function(pp,tt){ L.contrs.forEach(function(c,ci){ if(pp[c]){ var seg=document.createElement("div"); seg.className="pcseg"; seg.style.height=(pp[c]/tt*100)+"%"; seg.style.background=PROFCOL[ci%PROFCOL.length]; bar.appendChild(seg); } }); })(per[w2],tot);
        col.appendChild(bar);
      } else { var sp2=document.createElement("div"); sp2.style.flex="1"; col.appendChild(sp2); }
      var x=document.createElement("div"); x.className="pcx"; x.textContent=ddmm(dayToDate(w2*7)); col.appendChild(x);
      chart.appendChild(col);
    }
    // подпись оси
    var ylab=document.createElement("div"); ylab.style.cssText="font-size:11px;color:var(--muted);font-weight:600;padding:0 0 2px 4px"; ylab.textContent="Люди";
    host.appendChild(ylab);
    wrap.appendChild(chart); host.appendChild(wrap);
    var leg=document.createElement("div"); leg.className="plegend";
    L.contrs.forEach(function(c,ci){ var s=document.createElement("span"); s.innerHTML='<i style="background:'+PROFCOL[ci%PROFCOL.length]+'"></i>'+escapeHtml(c); leg.appendChild(s); });
    host.appendChild(leg);
  }
  function renderLabor_UNUSED(){
    var L=computeLabor(); if(!L.contrs.length) return;
    var wrap=document.createElement("div"); wrap.className="labor"; wrap.style.width=(DAYS*DAYW)+"px";
    var head=document.createElement("div"); head.className="dhead labhead";
    var leg='<span>👷 Рабочих в неделю (сред.):</span>';
    L.contrs.forEach(function(c,ci){ leg+=' <span class="legit"><span class="chip" style="background:'+PROFCOL[ci%PROFCOL.length]+'"></span>'+escapeHtml(c)+'</span>'; });
    head.innerHTML='<div class="dlabel lableg">'+leg+'</div>';
    wrap.appendChild(head);
    // недельные суммы
    var totals=[]; var maxT=0;
    for(var w=0; w<WEEKS; w++){ var s=0; L.contrs.forEach(function(c){ var mh=L.weeks[w][c]||0; if(mh>0) s+=Math.ceil(mh/WORKWEEK); }); totals.push(s); if(s>maxT)maxT=s; }
    // 1) столбчатая диаграмма
    if(maxT>0){
      var chart=document.createElement("div"); chart.className="labchart"; var maxBarH=64;
      for(var w=0; w<WEEKS; w++){
        var col=document.createElement("div"); col.className="lccol";
        if(totals[w]>0){
          var num=document.createElement("div"); num.className="lcnum"; num.textContent=totals[w]; col.appendChild(num);
          var barh=Math.max(3, Math.round(totals[w]/maxT*maxBarH));
          var bar=document.createElement("div"); bar.className="lcbar"; bar.style.height=barh+"px";
          L.contrs.forEach(function(c,ci){ var mh=L.weeks[w][c]||0; var n=mh>0?Math.ceil(mh/WORKWEEK):0; if(n>0){ var seg=document.createElement("div"); seg.className="lcseg"; seg.style.height=(n/totals[w]*100)+"%"; seg.style.background=PROFCOL[ci%PROFCOL.length]; bar.appendChild(seg); } });
          col.appendChild(bar);
        }
        chart.appendChild(col);
      }
      chart.style.width=(DAYS*DAYW)+"px"; wrap.appendChild(chart);
    }
    // 2) лёгкая таблица под диаграммой: цветные цифры на прозрачном фоне
    L.contrs.forEach(function(c,ci){
      var row=document.createElement("div"); row.className="labrow";
      var lab=document.createElement("div"); lab.className="lablabel"; lab.innerHTML='<i style="background:'+PROFCOL[ci%PROFCOL.length]+'"></i>'; row.appendChild(lab);
      var cells=document.createElement("div"); cells.className="labcells";
      for(var w=0; w<WEEKS; w++){ var mh=L.weeks[w][c]||0; var n=mh>0?Math.ceil(mh/WORKWEEK):0;
        var cc=document.createElement("div"); cc.className="labcell"+(n>0?" has":""); cc.textContent=n>0?n:""; if(n>0) cc.style.color=PROFCOL[ci%PROFCOL.length]; cells.appendChild(cc); }
      row.appendChild(cells); wrap.appendChild(row);
    });
    // Итого
    var trow=document.createElement("div"); trow.className="labrow labtot";
    var tlab=document.createElement("div"); tlab.className="lablabel"; tlab.innerHTML='<i class="tot">Σ</i>'; trow.appendChild(tlab);
    var tcells=document.createElement("div"); tcells.className="labcells";
    for(var w=0; w<WEEKS; w++){ var cc=document.createElement("div"); cc.className="labcell tot"+(totals[w]>0?" has":""); cc.textContent=totals[w]>0?totals[w]:""; tcells.appendChild(cc); }
    trow.appendChild(tcells); wrap.appendChild(trow);
    groupsEl.appendChild(wrap);
  }
  var ROLLH=14, L1ROWH=24;
  function makeRollupBar(t,bars){
    var s=Math.min.apply(null,bars.map(function(b){return b.start;}));
    var e=Math.max.apply(null,bars.map(function(b){return b.end;}));
    var pv=num(t.projVol)||0, fact=0; bars.forEach(function(b){ fact+=(num(b.fact)||0); });
    var done=pv>0?Math.max(0,Math.min(100,fact/pv*100)):0;
    var el=document.createElement("div"); el.className="bar roll";
    el.style.height=ROLLH+"px"; el.style.top=((L1ROWH-ROLLH)/2)+"px"; el.style.left=(s*DAYW)+"px";
    el.style.width=Math.max(DAYW,(e-s)*DAYW)+"px"; el.style.background=t.color; el.style.color=t.ink;
    el.innerHTML='<span class="prog" style="width:'+done+'%"></span><span class="lbl">'+Math.round(done)+'%</span>';
    return el;
  }
  function dfmt(d){ return ("0"+d.getDate()).slice(-2)+"."+("0"+(d.getMonth()+1)).slice(-2); }
  function makeBar(b,ri,t){
    var el=document.createElement("div"); el.className="bar"; el.dataset.id=b.id;
    el.style.top=(ri*ROWH+(ROWH-BARH)/2)+"px"; el.style.left=(b.start*DAYW)+"px";
    el.style.width=Math.max(DAYW,(b.end-b.start)*DAYW)+"px";
    el.style.background=t.color; el.style.color=t.ink;
    el.innerHTML='<span class="prog" style="width:'+pkgDonePct(b)+'%"></span><span class="grip gl"></span><span class="lbl">'+escapeHtml(barText(b))+'</span><span class="grip gr"></span>';
    attachDrag(el,b); return el;
  }

  // ---- drag / resize / tap ----
  var tip=document.getElementById("tip");
  function showTip(x,y,text){ tip.textContent=text; tip.style.left=x+"px"; tip.style.top=y+"px"; tip.classList.add("on"); }
  function hideTip(){ tip.classList.remove("on"); }
  function attachDrag(el,b){
    var mode=null,startX=0,moved=0,o0=0,o1=0,downT=0,pid=null;
    el.addEventListener("pointerdown",function(e){
      pid=e.pointerId; try{ el.setPointerCapture(pid); }catch(_){}
      var r=el.getBoundingClientRect(); var lx=e.clientX-r.left;
      mode=lx<=18?"l":(lx>=r.width-18?"r":"move");
      startX=e.clientX; moved=0; downT=Date.now(); o0=b.start; o1=b.end; el.classList.add("dragging"); e.preventDefault();
    });
    el.addEventListener("pointermove",function(e){
      if(pid===null)return; var dx=e.clientX-startX; moved=Math.max(moved,Math.abs(dx)); var dd=Math.round(dx/DAYW);
      var ns=o0,ne=o1;
      if(mode==="move"){ ns=o0+dd; ne=o1+dd; var wdt=o1-o0; if(ns<0){ns=0;ne=wdt;} if(ne>DAYS){ne=DAYS;ns=DAYS-wdt;} }
      else if(mode==="l"){ ns=clampDay(o0+dd); if(ns>o1-1)ns=o1-1; }
      else { ne=clampDay(o1+dd); if(ne<o0+1)ne=o0+1; }
      b.start=ns; b.end=ne; el.style.left=(ns*DAYW)+"px"; el.style.width=Math.max(DAYW,(ne-ns)*DAYW)+"px";
      if(moved>4) showTip(e.clientX,e.clientY,ddmm(dayToDate(ns))+" – "+ddmm(dayToDate(ne-1))); e.preventDefault();
    });
    function up(){ if(pid===null)return; try{ el.releasePointerCapture(pid); }catch(_){}
      pid=null; el.classList.remove("dragging"); hideTip();
      if(moved<=5 && (Date.now()-downT)<300){ openEditor(b); } else { save(); render(); } }
    el.addEventListener("pointerup",up); el.addEventListener("pointercancel",up);
  }

  // ---- editor ----
  var ovl=document.getElementById("ovl"), sheet=document.getElementById("sheet");
  var fNote=document.getElementById("fNote"), fContr=document.getElementById("fContr");
  var fPkgVol=document.getElementById("fPkgVol"), fPkgPct=document.getElementById("fPkgPct");
  var fFact=document.getElementById("fFact"), fDone=document.getElementById("fDone"), fvUnit=document.getElementById("fvUnit");
  var pvUnit=document.getElementById("pvUnit"), pvInfo=document.getElementById("pvInfo");
  var editing=null;
  var selDisc=document.getElementById("selDisc"), selElem=document.getElementById("selElem");
  function discsWithElems(){
    var set={}, order=[];
    allTypes().forEach(function(t){ var d=t.disc||"Без дисциплины"; if(!set[d]){set[d]=1; order.push(d);} });
    order.sort(function(a,b){ var ia=DISCIPLINES.indexOf(a), ib=DISCIPLINES.indexOf(b); ia=ia<0?99:ia; ib=ib<0?99:ib; return ia-ib || a.localeCompare(b,"ru"); });
    return order;
  }
  function elemsOfDisc(d){ return allTypes().filter(function(t){ return (t.disc||"Без дисциплины")===d; }); }
  function fillDiscSel(cur){
    selDisc.innerHTML=""; var ds=discsWithElems();
    if(!ds.length){ var o=document.createElement("option"); o.value=""; o.textContent="— нет элементов (загрузите справочник) —"; selDisc.appendChild(o); return; }
    ds.forEach(function(d){ var o=document.createElement("option"); o.value=d; o.textContent=d; selDisc.appendChild(o); });
    selDisc.value=(cur && ds.indexOf(cur)>=0)?cur:ds[0];
  }
  function fillElemSel(disc, curId){
    selElem.innerHTML="";
    var none=document.createElement("option"); none.value="__none"; none.textContent="— не выбрано —"; selElem.appendChild(none);
    elemsOfDisc(disc).forEach(function(t){ var o=document.createElement("option"); o.value=t.id; o.textContent=t.short+(t.projVol?(" · "+t.projVol+" "+(t.unit||"")):""); selElem.appendChild(o); });
    selElem.value=(curId!=null)?curId:"__none"; if(selElem.selectedIndex<0) selElem.value="__none";
  }
  function buildElemSelectors(){
    var t=typeById(editing?editing.typeId:null);
    var curDisc=(editing&&editing.typeId!=null)?(t.disc||"Без дисциплины"):null;
    fillDiscSel(curDisc);
    fillElemSel(selDisc.value, (editing&&editing.typeId!=null)?editing.typeId:null);
  }
  function applyElem(){
    if(!editing) return;
    editing.typeId=(selElem.value==="__none"||selElem.value==="")?null:selElem.value;
    editing.resOv={}; refreshPkg(); updateBarLabel(editing); updateMatBtn(); save(); render();
  }
  selDisc.addEventListener("change",function(){ fillElemSel(selDisc.value,null); applyElem(); });
  selElem.addEventListener("change",applyElem);
  document.getElementById("addElemBtn").addEventListener("click",function(){ openTypeSheet(); });
  function refreshPkg(){
    if(!editing) return; var el=typeById(editing.typeId);
    pvUnit.textContent=el.unit||"ед."; fvUnit.textContent=el.unit||"ед.";
    fPkgVol.value=(editing.pkgVol!=null?editing.pkgVol:""); fFact.value=(editing.fact!=null?editing.fact:"");
    var pv=num(el.projVol)||0, v=num(editing.pkgVol);
    fPkgPct.value=(pv>0&&v!=null)?(Math.round(v/pv*1000)/10):"";
    fDone.value=(num(editing.pkgVol)&&num(editing.fact)!=null)?(Math.round(pkgDonePct(editing))+" %"):"";
    pvInfo.textContent = (el.id!==null)?("Проект: "+(pv||0)+" "+(el.unit||"")+(v!=null&&pv>0?("  ·  доля "+(Math.round(v/pv*1000)/10)+"%"):"")):"Выберите элемент";
  }
  function fillContractors(){
    var dl=document.getElementById("contrOpts"); if(!dl) return; var seen={}, out=[];
    state.bars.forEach(function(b){ var c=(b.contr||"").trim(); if(c&&!seen[c.toLowerCase()]){ seen[c.toLowerCase()]=1; out.push(c); } });
    out.sort(function(a,b){return a.localeCompare(b,"ru");});
    dl.innerHTML=""; out.forEach(function(c){ var o=document.createElement("option"); o.value=c; dl.appendChild(o); });
  }
  function openEditor(b){ editing=b; buildElemSelectors(); fNote.value=b.note||""; fContr.value=b.contr||""; fillContractors(); refreshPkg(); updateMatBtn(); ovl.classList.add("on"); sheet.classList.add("on"); }
  function moveBar(dir){
    if(!editing) return; var known=knownIdSet();
    var grp=state.bars.filter(function(b){ return effTypeId(b,known)===effTypeId(editing,known); }).sort(function(a,b){return a.order-b.order;});
    var i=grp.indexOf(editing), j=i+dir;
    if(j<0||j>=grp.length){ toast(dir<0?"Уже вверху":"Уже внизу"); return; }
    var o=editing.order; editing.order=grp[j].order; grp[j].order=o; save(); render();
  }
  function closeEditor(){ if(editing){ editing.note=fNote.value.trim(); editing.contr=fContr.value.trim(); }
    ovl.classList.remove("on"); sheet.classList.remove("on"); editing=null; save(); render(); }
  fNote.addEventListener("input",function(){ if(!editing)return; editing.note=fNote.value; updateBarLabel(editing); });
  fContr.addEventListener("input",function(){ if(!editing)return; editing.contr=fContr.value; updateBarLabel(editing); });
  fPkgVol.addEventListener("input",function(){ if(!editing)return; editing.pkgVol=fPkgVol.value; editing.resOv={};
    var el=typeById(editing.typeId); var pv=num(el.projVol)||0, v=num(fPkgVol.value);
    fPkgPct.value=(pv>0&&v!=null)?(Math.round(v/pv*1000)/10):""; refreshPkg(); updateBarLabel(editing); updateMatBtn(); save(); });
  fPkgPct.addEventListener("input",function(){ if(!editing)return; var el=typeById(editing.typeId); var pv=num(el.projVol)||0, p=num(fPkgPct.value);
    if(pv>0&&p!=null){ var v=Math.round(pv*p/100*1000)/1000; editing.pkgVol=v; fPkgVol.value=v; editing.resOv={}; }
    refreshPkg(); updateBarLabel(editing); updateMatBtn(); save(); });
  fFact.addEventListener("input",function(){ if(!editing)return; editing.fact=fFact.value;
    fDone.value=(num(editing.pkgVol)&&num(editing.fact)!=null)?(Math.round(pkgDonePct(editing))+" %"):""; updateBarLabel(editing); save(); });
  document.getElementById("doneBtn").addEventListener("click",closeEditor);
  ovl.addEventListener("click",closeEditor);
  document.getElementById("delBtn").addEventListener("click",function(){ if(!editing)return;
    state.bars=state.bars.filter(function(x){return x.id!==editing.id;}); ovl.classList.remove("on"); sheet.classList.remove("on"); editing=null; save(); render(); toast("Полоса удалена"); });
  document.getElementById("upBtn").addEventListener("click",function(){ moveBar(-1); });
  document.getElementById("downBtn").addEventListener("click",function(){ moveBar(1); });

  // ---- виды работ (свои) ----
  var ovl2=document.getElementById("ovl2"), typeSheet=document.getElementById("typeSheet");
  var tName=document.getElementById("tName"), tUnit=document.getElementById("tUnit"), tVol=document.getElementById("tVol"), tDisc=document.getElementById("tDisc");
  var swatchesEl=document.getElementById("swatches"), typeListEl=document.getElementById("typeList");
  var selColor=PALETTE[0];
  function renderSwatches(){ swatchesEl.innerHTML=""; PALETTE.forEach(function(c){
    var s=document.createElement("button"); s.className="sw"+(c===selColor?" sel":""); s.style.background=c; s.dataset.c=c; swatchesEl.appendChild(s); }); }
  swatchesEl.addEventListener("click",function(e){ var c=e.target&&e.target.dataset?e.target.dataset.c:null; if(!c)return; selColor=c; renderSwatches(); });
  function renderTypeList(){ typeListEl.innerHTML="";
    if(!state.types.length){ typeListEl.innerHTML='<div class="muted">Пока нет своих элементов</div>'; return; }
    state.types.forEach(function(t){ var row=document.createElement("div"); row.className="trow";
      var info=(t.projVol?(""+t.projVol+" "+(t.unit||"")):(t.unit||""));
      row.innerHTML='<span class="chip" style="background:'+t.color+'"></span><span class="tname">'+escapeHtml(t.short)+(info?(' <span style="color:var(--muted);font-weight:500">· '+escapeHtml(info)+'</span>'):'')+'</span><button class="tdel" data-id="'+t.id+'">✕</button>';
      typeListEl.appendChild(row); }); }
  typeListEl.addEventListener("click",function(e){ var id=(e.target&&e.target.classList&&e.target.classList.contains("tdel"))?e.target.dataset.id:null; if(!id)return;
    if(!confirm("Удалить элемент? Полоски станут «Без вида», ресурсы элемента удалятся.")) return;
    state.types=state.types.filter(function(t){return t.id!==id;}); if(state.elemRes) delete state.elemRes[id]; markCatalogDirty(); rebuildTypeIndex();
    state.bars.forEach(function(b){ if(b.typeId===id) b.typeId=null; });
    save(); render(); renderTypeList(); if(sheet.classList.contains("on")){ buildElemSelectors(); } toast("Элемент удалён"); });
  function fillDisc(){ tDisc.innerHTML=""; DISCIPLINES.forEach(function(d){ var o=document.createElement("option"); o.value=d; o.textContent=d; tDisc.appendChild(o); }); }
  function fillUnits(){
    var dl=document.getElementById("unitOpts"); if(!dl) return;
    var seen={}, out=[];
    ["м³","м²","м","шт","т","кг","л","маш-ч","чел-ч","компл.","пог.м"].forEach(function(u){ seen[u]=1; out.push(u); });
    allTypes().forEach(function(t){ if(t.unit&&!seen[t.unit]){ seen[t.unit]=1; out.push(t.unit); } });
    Object.keys(state.elemRes||{}).forEach(function(id){ (state.elemRes[id]||[]).forEach(function(r){ if(r.unit&&!seen[r.unit]){ seen[r.unit]=1; out.push(r.unit); } }); });
    dl.innerHTML=""; out.forEach(function(u){ var o=document.createElement("option"); o.value=u; dl.appendChild(o); });
  }
  function openTypeSheet(){ selColor=PALETTE[0]; tName.value=""; tUnit.value=""; tVol.value=""; fillDisc(); fillUnits(); renderSwatches(); renderTypeList(); ovl2.classList.add("on"); typeSheet.classList.add("on"); }
  function closeTypeSheet(){ ovl2.classList.remove("on"); typeSheet.classList.remove("on"); }
  ovl2.addEventListener("click",closeTypeSheet);
  document.getElementById("typeCloseBtn").addEventListener("click",closeTypeSheet);
  document.getElementById("addTypeBtn").addEventListener("click",function(){
    var name=tName.value.trim(); if(!name){ toast("Введите имя элемента"); return; }
    var dcol=discColor(tDisc.value||DISCIPLINES[0]);
    var t={id:"u"+(typeSeq++), short:name, color:dcol, ink:inkFor(dcol), disc:(tDisc.value||DISCIPLINES[0]), unit:(tUnit.value.trim()||"ед."), projVol:(num(tVol.value)||0)};
    state.types.push(t); save(); tName.value=""; tUnit.value=""; tVol.value=""; renderTypeList();
    if(editing && sheet.classList.contains("on")){ editing.typeId=t.id; editing.resOv={}; render(); buildElemSelectors(); refreshPkg(); closeTypeSheet(); }
    else { render(); }
    toast("Элемент добавлен: "+name);
  });

  // ---- add ----
  function addPackage(){
    var mx=state.bars.reduce(function(m,b){return Math.max(m,b.order);},-1);
    var nb={id:"b"+(seq++),order:mx+1,typeId:null,start:clampDay(todayDay),end:clampDay(todayDay+5),note:"",contr:"",pkgVol:"",fact:"",resOv:{},mats:[]};
    state.bars.push(nb); showScreen("gantt"); save(); render(); openEditor(nb);
  }
  document.getElementById("fab").addEventListener("click",addPackage);

  document.getElementById("zoomBtn").addEventListener("click",function(){ setZoom(zi-1); });
  var viewBtn=document.getElementById("viewBtn"); viewBtn.textContent=viewMode;
  viewBtn.addEventListener("click",function(){
    viewMode=(viewMode==="L2"?"L1":"L2"); viewBtn.textContent=viewMode;
    try{ lsSet("gantt_view",viewMode); }catch(e){}
    buildHeader(); render();
    toast(viewMode==="L1"?"L1 — элементы одной полоской, по месяцам (для скриншота)":"L2 — пакеты по неделям");
  });

  // свайп вниз за ползунок закрывает шторку
  function attachSheetDrag(grabEl, sheetEl, closeFn){
    if(!grabEl) return; var y0=0, dy=0, drag=false;
    grabEl.style.touchAction="none"; grabEl.style.cursor="grab";
    grabEl.addEventListener("pointerdown",function(e){ drag=true; y0=e.clientY; dy=0; sheetEl.style.transition="none"; try{grabEl.setPointerCapture(e.pointerId);}catch(_){} });
    grabEl.addEventListener("pointermove",function(e){ if(!drag)return; dy=Math.max(0,e.clientY-y0); sheetEl.style.transform="translateY("+dy+"px)"; });
    function end(){ if(!drag)return; drag=false; sheetEl.style.transition=""; sheetEl.style.transform="";
      if(dy>90){ closeFn(); } }
    grabEl.addEventListener("pointerup",end); grabEl.addEventListener("pointercancel",end);
  }
  attachSheetDrag(document.querySelector("#sheet .grab"), sheet, closeEditor);
  attachSheetDrag(document.querySelector("#matSheet .grab"), matSheet, closeMaterials);
  attachSheetDrag(document.querySelector("#typeSheet .grab"), typeSheet, closeTypeSheet);
  attachSheetDrag(document.querySelector("#specSheet .grab"), specSheet, closeSpecSheet);
  attachSheetDrag(document.querySelector("#sumSheet .grab"), sumSheet, closeSummary);

  // ---- menu / export / import / reset ----
  var menu=document.getElementById("menu"), importFile=document.getElementById("importFile");
  function toggleMenu(){ menu.classList.toggle("on"); }
  document.addEventListener("click",function(e){ if(menu.classList.contains("on") && !menu.contains(e.target) && !e.target.closest('[data-tab="more"]')) menu.classList.remove("on"); });
  menu.addEventListener("click",function(e){ var act=e.target&&e.target.dataset?e.target.dataset.act:null; if(!act)return; menu.classList.remove("on");
    if(act==="types") openTypeSheet();
    else if(act==="projects") showProjects();
    else if(act==="calc") openCalc();
    else if(act==="requests") openRequests();
    else if(act==="kpi") openKpi();
    else if(act==="cashflow") openCashflow();
    else if(act==="spec") openSpecSheet();
    else if(act==="summary") openSummary();
    else if(act==="export") exportJson();
    else if(act==="import") importFile.click();
    else if(act==="reset"){ if(confirm("Вернуть 20 пустых серых полосок? Текущие данные будут удалены.")){ seq=1; state.bars=defaultBars(); save(); render(); toast("Сброшено к 20 полоскам"); } }
  });
  function exportJson(){
    try{
      var blob=new Blob([serialize()],{type:"application/json"}); var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download="plan-rabot-"+iso(today)+".json"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },1000); toast("Файл сохранён в загрузки");
    }catch(e){ toast("Не удалось выгрузить"); }
  }
  importFile.addEventListener("change",function(){ var f=importFile.files&&importFile.files[0]; if(!f)return;
    if(f.size > 8*1024*1024){ toast("Файл слишком большой (>8 МБ)"); importFile.value=""; return; }
    var r=new FileReader(); r.onload=function(){
      try{
        var o=JSON.parse(r.result);
        var err=validateImportPayload(o);
        if(err){ toast(err); importFile.value=""; return; }
        // last-good before overwrite
        var k=boardKey(); var prev=StorageAdapter.getSync(k); if(prev) StorageAdapter.setSync(lastGoodKey(), prev);
        if(hydrate(r.result)){ saveImmediate(); render(); renderDash(); toast("Данные загружены"); }
        else toast("Файл не распознан");
      }catch(e){ toast("Файл не распознан"); }
      importFile.value="";
    };
    r.onerror=function(){ toast("Ошибка чтения файла"); importFile.value=""; }; r.readAsText(f);
  });

  // ---- ресурсы пакета / справочник / сводка ----
  var ovl3=document.getElementById("ovl3"), matSheet=document.getElementById("matSheet"), matBar=null;
  var ovl4=document.getElementById("ovl4"), specSheet=document.getElementById("specSheet");
  var ovl5=document.getElementById("ovl5"), sumSheet=document.getElementById("sumSheet");
  function fmtNum(n){ return (Math.round(n*1000)/1000).toString().replace(".",","); }
  function fmtMoney(n){ return Math.round(n||0).toLocaleString("ru-RU"); }
  function updateMatBtn(){ var btn=document.getElementById("matBtn"); if(btn&&editing) btn.textContent="Категории ресурса ("+pkgResources(editing).length+")"; }
  function matTotalsText(b){ var t=typeById(b.typeId); var d=pkgDonePct(b);
    return "Объём пакета: "+(b.pkgVol||0)+" "+(t.unit||"")+(num(b.pkgVol)?("   ·   доля "+fmtNum(pkgShare(b)*100)+"%"):"")+(d>0?("   ·   готово "+Math.round(d)+"%"):""); }

  function openMaterials(b){ matBar=b; if(!b.mats)b.mats=[]; if(!b.resOv)b.resOv={}; renderMatSheet(); ovl3.classList.add("on"); matSheet.classList.add("on"); }
  function closeMaterials(){ ovl3.classList.remove("on"); matSheet.classList.remove("on"); matBar=null; updateMatBtn(); render(); }
  function renderMatSheet(){
    var b=matBar; if(!b) return; var t=typeById(b.typeId);
    document.getElementById("matTitle").textContent="Категории — "+t.short;
    document.getElementById("matTotals").textContent=matTotalsText(b);
    var list=document.getElementById("matList"); list.innerHTML="";
    var res=pkgResources(b);
    if(!res.length){ list.innerHTML='<div class="empty">Нет категорий. Выберите элемент из справочника или добавьте вручную.</div>'; }
    res.forEach(function(r){
      var row=document.createElement("div"); row.className="matrow";
      var cls=(r.rtype==="Работа")?"r":((r.rtype==="Техника")?"t":"m");
      var tag=(cls==="r")?"Р":((cls==="t")?"Т":"М");
      row.innerHTML='<span class="rtag rt-'+cls+'">'+tag+'</span>'+
        '<span class="mn">'+escapeHtml(r.name)+(r.over?' <span class="ovmark">ручн.</span>':'')+(r.manual!=null?' <span class="ovmark" style="color:#2563eb">ручн.</span>':'')+'</span>'+
        '<input class="q" inputmode="decimal"><span class="mu">'+escapeHtml(r.unit||"")+'</span>'+
        '<button class="mdel">'+(r.manual!=null?"⚙":"↺")+'</button>';
      var q=row.querySelector(".q"); q.value=(r.qty!=null?Math.round(r.qty*1000)/1000:"");
      q.addEventListener("input",function(){ var val=num(q.value);
        if(r.manual!=null){ b.mats[r.manual].qty=(val!=null?val:0); }
        else { if(!b.resOv)b.resOv={}; b.resOv[r.idx]=(val!=null?val:0); row.querySelector(".mn").innerHTML=escapeHtml(r.name)+' <span class="ovmark">ручн.</span>'; }
        save(); });
      row.querySelector(".mdel").addEventListener("click",function(){
        if(r.manual!=null){ openResSheet(b, r.manual); } else { if(b.resOv) delete b.resOv[r.idx]; save(); renderMatSheet(); } });
      list.appendChild(row);
    });
  }
  ovl3.addEventListener("click",closeMaterials);
  // ---- настройки ресурса (ручного) ----
  var resBar=null, resIdx=null;
  function openResSheet(b, idx){ resBar=b; resIdx=idx; var m=b.mats[idx]; if(!m)return;
    document.getElementById("rsName").value=m.name||"";
    document.getElementById("rsType").value=m.rtype||"Материал";
    document.getElementById("rsUnit").value=m.unit||"";
    document.getElementById("rsQty").value=(m.qty!=null?m.qty:"");
    document.getElementById("rsPrice").value=(m.price!=null?m.price:"");
    document.getElementById("rsChh").value=(m.chh!=null?m.chh:"");
    resInfo(); document.getElementById("ovl10").classList.add("on"); document.getElementById("resSheet").classList.add("on");
  }
  function resInfo(){ var q=num(document.getElementById("rsQty").value)||0, pr=num(document.getElementById("rsPrice").value)||0, ch=num(document.getElementById("rsChh").value)||0;
    var t=document.getElementById("rsType").value; var s="Стоимость: "+fmtMoney(pr*q)+" ₽"; if(t==="Работа") s+="  ·  "+fmtNum(ch*q)+" чел-ч";
    document.getElementById("rsInfo").textContent=s; }
  ["rsQty","rsPrice","rsChh"].forEach(function(id){ document.getElementById(id).addEventListener("input",resInfo); });
  document.getElementById("rsType").addEventListener("change",resInfo);
  function closeResSheet(){ document.getElementById("ovl10").classList.remove("on"); document.getElementById("resSheet").classList.remove("on"); resBar=null; resIdx=null; }
  document.getElementById("ovl10").addEventListener("click",closeResSheet);
  document.getElementById("rsSave").addEventListener("click",function(){
    if(!resBar||resIdx==null)return; var m=resBar.mats[resIdx]; if(!m)return;
    var nm=document.getElementById("rsName").value.trim(); if(!nm){ toast("Введите наименование"); return; }
    m.name=nm; m.rtype=document.getElementById("rsType").value; m.unit=document.getElementById("rsUnit").value.trim();
    m.qty=num(document.getElementById("rsQty").value)||0; m.price=num(document.getElementById("rsPrice").value); m.chh=num(document.getElementById("rsChh").value);
    save(); closeResSheet(); renderMatSheet(); updateMatBtn();
  });
  document.getElementById("rsDelete").addEventListener("click",function(){
    if(!resBar||resIdx==null)return; resBar.mats.splice(resIdx,1); save(); closeResSheet(); renderMatSheet(); updateMatBtn();
  });
  attachSheetDrag(document.querySelector("#resSheet .grab"), document.getElementById("resSheet"), closeResSheet);
  document.getElementById("matCloseBtn").addEventListener("click",closeMaterials);
  document.getElementById("matBtn").addEventListener("click",function(){ if(editing) openMaterials(editing); });
  document.getElementById("mAddBtn").addEventListener("click",function(){
    if(!matBar)return; var n=document.getElementById("mName").value.trim();
    if(!n){ toast("Введите ресурс"); return; }
    var u=document.getElementById("mUnit").value.trim();
    var qv=num(document.getElementById("mQty").value);
    matBar.mats.push({name:n,unit:u,qty:(qv!=null?qv:1),rtype:"Материал",price:null,chh:null});
    document.getElementById("mName").value=""; document.getElementById("mUnit").value=""; document.getElementById("mQty").value="";
    save(); renderMatSheet();
    openResSheet(matBar, matBar.mats.length-1);
  });

  // ---- справочник (импорт CSV: элементы + ресурсы) ----
  function splitCSV(text){
    text=(""+text).replace(/\r\n?/g,"\n").replace(/^\uFEFF/,"");
    var lines=text.split("\n").filter(function(l){return l.trim().length;});
    if(!lines.length) return [];
    var f=lines[0]; var cnt={";":(f.split(";").length-1),",":(f.split(",").length-1),"\t":(f.split("\t").length-1)};
    var delim=(cnt["\t"]>=cnt[";"]&&cnt["\t"]>=cnt[","])?"\t":(cnt[";"]>=cnt[","]?";":",");
    function sp(l){ var out=[],cur="",q=false; for(var i=0;i<l.length;i++){ var ch=l[i];
      if(q){ if(ch==='"'){ if(l[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=ch; }
      else { if(ch==='"')q=true; else if(ch===delim){out.push(cur);cur="";} else cur+=ch; } }
      out.push(cur); return out.map(function(s){return s.trim();}); }
    var rows=lines.map(sp);
    var h=rows[0].join(" ").toLowerCase();
    if(/дисциплин|элемент|ресурс|расход|тип/.test(h)) rows.shift();
    return rows;
  }
  function importSpravochnik(text){
    var rows=splitCSV(text); if(!rows.length) return 0;
    var newRes={}, palIdx=state.types.length, count=0;
    rows.forEach(function(r){
      var name=(r[1]||"").trim(); if(!name) return;
      var disc=(r[0]||"").trim(), unit=(r[2]||"").trim(), pv=num(r[3]);
      var el=elemByName(name);
      if(!el){ el={id:"u"+(typeSeq++), short:name, color:discColor(disc), disc:disc, unit:unit||"ед.", projVol:(pv||0)};
        el.ink=inkFor(el.color); state.types.push(el); }
      else { if(disc){el.disc=disc; el.color=discColor(disc); el.ink=inkFor(el.color);} if(unit)el.unit=unit; if(pv!=null)el.projVol=pv; }
      var cat={rtype:(r[4]||"Материал").trim(), name:(r[5]||"").trim(), unit:(r[6]||"").trim(), total:num(r[7]), chh:num(r[8]), price:num(r[9]), prof:(r[10]||"").trim()};
      if(!cat.name) return;
      (newRes[el.id]=newRes[el.id]||[]).push(cat); count++;
    });
    Object.keys(newRes).forEach(function(id){ state.elemRes[id]=newRes[id]; markCatalogDirty(); });
    return count;
  }
  function importDetail(text){
    var rows=splitCSV(text); if(!rows.length) return 0;
    var d={}, count=0;
    rows.forEach(function(r){
      var cat=(r[0]||"").trim(), nm=(r[2]||"").trim(); if(!cat||!nm) return;
      var rec={group:(r[1]||"").trim(), name:nm, unit:(r[3]||"").trim(), perCat:num(r[4]), buyUnit:(r[5]||"").trim(), conv:num(r[6]), price:num(r[7])};
      (d[cat]=d[cat]||[]).push(rec); count++;
    });
    Object.keys(d).forEach(function(k){ state.detail[k]=d[k]; markCatalogDirty(); });
    return count;
  }
  var specFile=document.getElementById("specFile"), detFile=document.getElementById("detFile");
  function openSpecSheet(){ ensureCatalogLoaded(function(){ renderSpecView(); ovl4.classList.add("on"); specSheet.classList.add("on"); }); }
  function closeSpecSheet(){ ovl4.classList.remove("on"); specSheet.classList.remove("on"); }
  function renderSpecView(){
    var v=document.getElementById("specView"); v.innerHTML="";
    var ids=Object.keys(state.elemRes||{}).filter(function(id){return (state.elemRes[id]||[]).length;});
    if(!ids.length){ v.innerHTML='<div class="empty" style="color:var(--muted);font-size:13px;padding:6px">Справочник не загружен.</div>'; return; }
    ids.forEach(function(id){
      var el=typeById(id); var rs=state.elemRes[id];
      var head=document.createElement("div"); head.className="svhead";
      head.innerHTML='<span class="chip" style="background:'+el.color+'"></span><span>'+escapeHtml(el.short)+' · '+(el.projVol||0)+' '+escapeHtml(el.unit||"")+'</span>'+((!el.projVol)?'<span class="warn">⚠ нет объёма</span>':'');
      v.appendChild(head);
      rs.forEach(function(m){ var r=document.createElement("div"); r.className="svrow";
        var dc=(state.detail&&state.detail[m.name])?state.detail[m.name].length:0;
        r.innerHTML='<span class="t">['+(m.rtype||"")[0]+'] '+escapeHtml(m.name)+(dc?' <span style="color:#16A085;font-weight:700">• '+dc+' марок</span>':'')+'</span><span class="q">'+(m.total!=null?fmtNum(m.total):"")+" "+escapeHtml(m.unit||"")+'</span>'; v.appendChild(r); });
    });
  }
  ovl4.addEventListener("click",closeSpecSheet);
  document.getElementById("specCloseBtn").addEventListener("click",closeSpecSheet);
  document.getElementById("specImportBtn").addEventListener("click",function(){ specFile.click(); });
  document.getElementById("detImportBtn").addEventListener("click",function(){ detFile.click(); });
  document.getElementById("specClearBtn").addEventListener("click",function(){ if(!confirm("Очистить справочник (категории и детализацию)?"))return; state.elemRes={}; state.detail={}; markCatalogDirty(); save(); renderSpecView(); render(); toast("Справочник очищен"); });
  function readCsv(file, cb){ var r=new FileReader();
    r.onload=function(){ var buf=r.result, txt="";
      try{ txt=new TextDecoder("utf-8",{fatal:false}).decode(buf); }catch(e){ txt=""; }
      if(/\uFFFD/.test(txt)){ try{ txt=new TextDecoder("windows-1251").decode(buf); }catch(e){} }
      cb(txt);
    };
    r.onerror=function(){ toast("Ошибка чтения файла"); }; r.readAsArrayBuffer(file);
  }
  specFile.addEventListener("change",function(){ var file=specFile.files&&specFile.files[0]; if(!file)return;
    readCsv(file,function(txt){ var n=importSpravochnik(txt);
      if(!n){ toast("Не удалось прочитать CSV"); specFile.value=""; return; }
      save(); renderSpecView(); render(); if(editing){ buildElemSelectors(); refreshPkg(); }
      toast("Категории: загружено "+n); specFile.value=""; });
  });
  detFile.addEventListener("change",function(){ var file=detFile.files&&detFile.files[0]; if(!file)return;
    readCsv(file,function(txt){ var n=importDetail(txt);
      if(!n){ toast("Не удалось прочитать CSV детализации"); detFile.value=""; return; }
      save(); renderSpecView(); toast("Детализация: загружено "+n+" марок"); detFile.value=""; });
  });

  // ---- сводка: категории (план) + готовность по элементам ----
  function computeSummary(){
    var cat={}, corder=[], el={}, eorder=[];
    state.bars.forEach(function(b){
      if(b.typeId===null) return;
      pkgResources(b).forEach(function(r){
        var key=norm(r.name)+"|"+norm(r.unit);
        if(!cat[key]){ cat[key]={name:r.name,unit:r.unit,rtype:r.rtype,qty:0}; corder.push(key); }
        cat[key].qty+=(r.qty||0);
      });
      var t=typeById(b.typeId);
      if(!el[b.typeId]){ el[b.typeId]={name:t.short,unit:t.unit,plan:0,fact:0}; eorder.push(b.typeId); }
      el[b.typeId].plan+=(num(b.pkgVol)||0); el[b.typeId].fact+=(num(b.fact)||0);
    });
    var cats=corder.map(function(k){return cat[k];}).sort(function(a,b){return a.name.localeCompare(b.name,"ru");});
    var elems=eorder.map(function(k){var e=el[k]; e.pct=(e.plan>0?Math.round(e.fact/e.plan*100):0); return e;});
    return {cats:cats, elems:elems};
  }
  function openSummary(){ var v=document.getElementById("sumView"); v.innerHTML=""; var s=computeSummary();
    var hh=document.createElement("div"); hh.className="svhead"; hh.innerHTML='<span>Готовность по элементам</span>'; v.appendChild(hh);
    if(!s.elems.length){ var e0=document.createElement("div"); e0.style.cssText="color:var(--muted);font-size:13px;padding:6px"; e0.textContent="Пакеты ещё не привязаны к элементам."; v.appendChild(e0); }
    s.elems.forEach(function(e){ var row=document.createElement("div"); row.className="svrow";
      row.innerHTML='<span class="t">'+escapeHtml(e.name)+'</span><span class="q">'+fmtNum(e.fact)+" / "+fmtNum(e.plan)+" "+escapeHtml(e.unit||"")+" · "+e.pct+"%</span>"; v.appendChild(row); });
    var hh2=document.createElement("div"); hh2.className="svhead"; hh2.style.marginTop="10px"; hh2.innerHTML='<span>Категории ресурса (план по пакетам)</span>'; v.appendChild(hh2);
    if(!s.cats.length){ var e1=document.createElement("div"); e1.style.cssText="color:var(--muted);font-size:13px;padding:6px"; e1.textContent="Категории появятся после выбора элемента и объёма."; v.appendChild(e1); }
    s.cats.forEach(function(m){ var row=document.createElement("div"); row.className="svrow";
      var tag=(m.rtype==="Работа")?"Р":((m.rtype==="Техника")?"Т":"М");
      row.innerHTML='<span class="t">['+tag+'] '+escapeHtml(m.name)+'</span><span class="q">'+fmtNum(m.qty)+" "+escapeHtml(m.unit||"")+'</span>'; v.appendChild(row); });
    var note=document.createElement("div"); note.style.cssText="color:var(--muted);font-size:12px;padding:8px 2px 0"; note.textContent="Стоимость и заказ конкретных изделий — следующий этап (детализация справочника)."; v.appendChild(note);
    ovl5.classList.add("on"); sumSheet.classList.add("on");
  }
  function closeSummary(){ ovl5.classList.remove("on"); sumSheet.classList.remove("on"); }
  ovl5.addEventListener("click",closeSummary);
  document.getElementById("sumCloseBtn").addEventListener("click",closeSummary);
  document.getElementById("sumExportBtn").addEventListener("click",function(){
    var s=computeSummary(); if(!s.cats.length && !s.elems.length){ toast("Нет данных"); return; }
    var lines=["РАЗДЕЛ;Название;Ед.;Значение"];
    s.elems.forEach(function(e){ lines.push('Готовность;"'+(e.name||"").replace(/"/g,'""')+'";'+(e.unit||"")+";"+fmtNum(e.fact)+" из "+fmtNum(e.plan)+" ("+e.pct+"%)"); });
    s.cats.forEach(function(m){ lines.push('Категория ('+(m.rtype||"")+');"'+(m.name||"").replace(/"/g,'""')+'";'+(m.unit||"")+";"+fmtNum(m.qty)); });
    try{
      var blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv"}); var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download="svodka-"+iso(today)+".csv"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000); toast("CSV сохранён в загрузки");
    }catch(e){ toast("Не удалось выгрузить"); }
  });

  // ---- показатели (строительная готовность по чел-ч) ----
  var ovl6=document.getElementById("ovl6"), kpiSheet=document.getElementById("kpiSheet");
  function fmtPct(x){ return fmtNum(Math.round(x*10)/10); }
  function bar(pct){ return '<span class="pbar"><span style="width:'+Math.max(0,Math.min(100,pct))+'%"></span></span>'; }
  function budgetData(){
    var byEl=[], disc={}, dorder=[], objB=0, objE=0;
    allTypes().forEach(function(t){
      var bud=elemBudget(t.id); if(bud<=0) return;
      var pv=num(t.projVol)||0, fact=elemFactVol(t.id);
      var done=pv>0?Math.min(fact,pv)/pv:0; var earned=bud*done;
      byEl.push({name:t.short, disc:t.disc||"—", bud:bud, earned:earned, pct:done*100});
      objB+=bud; objE+=earned;
      if(!disc[t.disc]){ disc[t.disc]={name:t.disc||"—",bud:0,earned:0}; dorder.push(t.disc); }
      disc[t.disc].bud+=bud; disc[t.disc].earned+=earned;
    });
    var byDisc=dorder.map(function(d){ var x=disc[d]; x.pct=(x.bud>0?x.earned/x.bud*100:0); return x; });
    return {byEl:byEl, byDisc:byDisc, objBud:objB, objEarned:objE};
  }
  function openKpi(){
    var v=document.getElementById("kpiView"); v.innerHTML="";
    var d=readiness(), bd=budgetData();
    if(d.objTot<=0 && bd.objBud<=0){ v.innerHTML='<div style="color:var(--muted);font-size:13px;padding:10px 2px">Нет данных. Загрузите справочник (чел-ч и цена у категорий) и введите факт по пакетам.</div>'; ovl6.classList.add("on"); kpiSheet.classList.add("on"); return; }
    var pager=document.createElement("div"); pager.className="kpipager";
    // --- страница 1: готовность ---
    var p1=document.createElement("div"); p1.className="kpipage";
    var h='<div class="kpibig"><div class="kpit">Строительная готовность объекта</div><div class="kpin">'+fmtPct(d.objPct)+' %</div>'+
      '<div class="kpisub">освоено '+fmtNum(Math.round(d.objEarned))+' из '+fmtNum(Math.round(d.objTot))+' чел-ч</div>'+bar(d.objPct)+'</div>';
    h+='<div class="svhead"><span>По дисциплинам</span></div>';
    d.byDisc.forEach(function(x){ h+='<div class="kpirow"><div class="kpil"><span>'+escapeHtml(x.name)+'</span><b>'+fmtPct(x.pct)+' %</b></div>'+bar(x.pct)+'<div class="kpix">'+fmtNum(Math.round(x.earned))+' / '+fmtNum(Math.round(x.tot))+' чел-ч</div></div>'; });
    h+='<div class="svhead" style="margin-top:10px"><span>По элементам</span></div>';
    d.byEl.forEach(function(x){ h+='<div class="kpirow"><div class="kpil"><span>'+escapeHtml(x.name)+'</span><b>'+fmtPct(x.pct)+' %</b></div>'+bar(x.pct)+'<div class="kpix">факт '+fmtNum(x.fact)+' / '+fmtNum(x.proj)+' '+escapeHtml(x.unit||"")+'</div></div>'; });
    p1.innerHTML=h;
    // --- страница 2: бюджет ---
    var p2=document.createElement("div"); p2.className="kpipage";
    var g='<div class="kpibig" style="background:linear-gradient(135deg,#1e7a46,#27AE60)"><div class="kpit">Прогнозный бюджет объекта</div><div class="kpin" style="font-size:30px">'+fmtMoney(bd.objBud)+' ₽</div>'+
      '<div class="kpisub">освоено '+fmtMoney(bd.objEarned)+' ₽ ('+fmtPct(bd.objBud>0?bd.objEarned/bd.objBud*100:0)+' %)</div>'+bar(bd.objBud>0?bd.objEarned/bd.objBud*100:0)+'</div>';
    g+='<div class="svhead"><span>По дисциплинам</span></div>';
    bd.byDisc.forEach(function(x){ g+='<div class="kpirow"><div class="kpil"><span>'+escapeHtml(x.name)+'</span><b>'+fmtMoney(x.bud)+' ₽</b></div>'+bar(x.pct)+'<div class="kpix">освоено '+fmtMoney(x.earned)+' ₽ · '+fmtPct(x.pct)+' %</div></div>'; });
    g+='<div class="svhead" style="margin-top:10px"><span>По элементам</span></div>';
    bd.byEl.forEach(function(x){ g+='<div class="kpirow"><div class="kpil"><span>'+escapeHtml(x.name)+'</span><b>'+fmtMoney(x.bud)+' ₽</b></div>'+bar(x.pct)+'<div class="kpix">освоено '+fmtMoney(x.earned)+' ₽ · '+fmtPct(x.pct)+' %</div></div>'; });
    p2.innerHTML=g;
    pager.appendChild(p1); pager.appendChild(p2); v.appendChild(pager);
    var dots=document.createElement("div"); dots.className="kpidots";
    dots.innerHTML='<span class="kd on">Готовность</span><span class="kd">Бюджет</span>'; v.appendChild(dots);
    var kds=dots.querySelectorAll(".kd");
    pager.addEventListener("scroll",function(){ var i=Math.round(pager.scrollLeft/pager.clientWidth); kds[0].classList.toggle("on",i===0); kds[1].classList.toggle("on",i===1); });
    kds[0].addEventListener("click",function(){ pager.scrollTo({left:0,behavior:"smooth"}); });
    kds[1].addEventListener("click",function(){ pager.scrollTo({left:pager.clientWidth,behavior:"smooth"}); });
    ovl6.classList.add("on"); kpiSheet.classList.add("on");
  }
  function closeKpi(){ ovl6.classList.remove("on"); kpiSheet.classList.remove("on"); }
  ovl6.addEventListener("click",closeKpi);
  document.getElementById("kpiCloseBtn").addEventListener("click",closeKpi);
  attachSheetDrag(document.querySelector("#kpiSheet .grab"), kpiSheet, closeKpi);

  // ---- кэшфло (равномерно по времени пакета) ----
  var ovl7=document.getElementById("ovl7"), cfSheet=document.getElementById("cfSheet"), cfMode="week";
  function computeCashflow(mode){
    var days=new Array(DAYS+1).join("0").split("").map(function(){return 0;}); // 0..DAYS-1
    state.bars.forEach(function(b){
      var cost=pkgCost(b); if(cost<=0) return;
      var s=Math.max(0,b.start), e=Math.min(DAYS,b.end); var span=e-s; if(span<=0) return;
      var per=cost/span; for(var d=s; d<e; d++) days[d]+=per;
    });
    var buckets=[], idx={};
    for(var d=0; d<DAYS; d++){ if(days[d]<=0 && !idx.hasOwnProperty(keyFor(d,mode))){} var k=keyFor(d,mode);
      if(!idx.hasOwnProperty(k)){ idx[k]=buckets.length; buckets.push({key:k,label:labelFor(d,mode),amount:0}); }
      buckets[idx[k]].amount+=days[d];
    }
    // оставляю только диапазон с деньгами (обрезаю пустые хвосты по краям)
    var first=0,last=buckets.length-1;
    while(first<buckets.length && buckets[first].amount<=0.5) first++;
    while(last>=0 && buckets[last].amount<=0.5) last--;
    var out = (first<=last)? buckets.slice(first,last+1) : [];
    var cum=0, total=0; out.forEach(function(x){ cum+=x.amount; x.cum=cum; }); total=cum;
    return {rows:out, total:total};
  }
  function keyFor(d,mode){ if(mode==="week") return "w"+Math.floor(d/7); var dt=dayToDate(d); return "m"+dt.getFullYear()+"-"+dt.getMonth(); }
  function labelFor(d,mode){ if(mode==="week") return ddmm(dayToDate(Math.floor(d/7)*7)); var dt=dayToDate(d); return MONTHS[dt.getMonth()].slice(0,3)+" "+dt.getFullYear(); }
  function openCashflow(){ renderCashflow(); ovl7.classList.add("on"); cfSheet.classList.add("on"); }
  function closeCashflow(){ ovl7.classList.remove("on"); cfSheet.classList.remove("on"); }
  function renderCashflow(){
    var v=document.getElementById("cfView"); v.innerHTML=""; var cf=computeCashflow(cfMode);
    if(!cf.rows.length){ v.innerHTML='<div style="color:var(--muted);font-size:13px;padding:10px 2px">Нет оплат: у пакетов нет стоимости (нужна цена категорий в справочнике) или не заданы сроки.</div>'; return; }
    var tot=document.createElement("div"); tot.className="sumtot"; tot.style.marginBottom="10px";
    tot.innerHTML='<div>Итого за период</div><div><b>'+fmtMoney(cf.total)+' ₽</b></div>'; v.appendChild(tot);
    var mx=cf.rows.reduce(function(m,x){return Math.max(m,x.amount);},0)||1;
    cf.rows.forEach(function(x){ var row=document.createElement("div"); row.className="cfrow";
      row.innerHTML='<div class="cflab">'+escapeHtml(x.label)+'</div>'+
        '<div class="cfbarwrap"><span class="cfbar" style="width:'+(x.amount/mx*100)+'%"></span></div>'+
        '<div class="cfamt">'+fmtMoney(x.amount)+'</div>'; v.appendChild(row);
    });
    var note=document.createElement("div"); note.style.cssText="color:var(--muted);font-size:12px;padding:8px 2px 0"; note.textContent="Оплата каждого пакета распределена равномерно по его срокам. Накопительно к концу: "+fmtMoney(cf.total)+" ₽.";
    v.appendChild(note);
  }
  Array.prototype.forEach.call(document.querySelectorAll(".cftab"),function(btn){
    btn.addEventListener("click",function(){ cfMode=btn.dataset.m;
      Array.prototype.forEach.call(document.querySelectorAll(".cftab"),function(x){ x.classList.toggle("on",x===btn); });
      renderCashflow(); });
  });
  ovl7.addEventListener("click",closeCashflow);
  document.getElementById("cfCloseBtn").addEventListener("click",closeCashflow);
  attachSheetDrag(document.querySelector("#cfSheet .grab"), cfSheet, closeCashflow);
  document.getElementById("cfExportBtn").addEventListener("click",function(){
    var cf=computeCashflow(cfMode); if(!cf.rows.length){ toast("Нет данных"); return; }
    var lines=[(cfMode==="week"?"Неделя":"Месяц")+";Оплата, руб;Накопительно, руб"];
    cf.rows.forEach(function(x){ lines.push(x.label+";"+Math.round(x.amount)+";"+Math.round(x.cum)); });
    lines.push("ИТОГО;"+Math.round(cf.total)+";");
    try{ var blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv"}); var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download="cashflow-"+cfMode+"-"+iso(today)+".csv"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000); toast("CSV сохранён"); }catch(e){ toast("Не удалось выгрузить"); }
  });

  // ---- калькулятор закупки + корзина + заявки (per project) ----
  var ovl8=document.getElementById("ovl8"), calcSheet=document.getElementById("calcSheet"), calcEl=document.getElementById("calcEl");
  var calcCart = [];
  function buyStep(unit){ var u=(unit||"").toLowerCase(); return /шт|поддон|карт|компл|упак|рулон|маш|чел|мешок/.test(u)?1:0.5; }
  function roundBuy(q, unit){ var s=buyStep(unit); return Math.floor(q/s + 1e-9)*s; }
  function openCalc(){
    ensureCatalogLoaded(function(){ openCalcInner(); });
  }
  function openCalcInner(){
    calcCart = [];
    updateCalcCartBar();
    var opts=allTypes().filter(function(t){ return elemRes(t.id).some(function(r){return r.rtype==="Материал";}); });
    calcEl.innerHTML="";
    if(!opts.length){ calcEl.innerHTML='<option>Нет элементов — загрузите справочник</option>'; }
    else {
      var byd={}, order=[];
      opts.forEach(function(t){ var d=t.disc||"Без дисциплины"; if(!byd[d]){byd[d]=[];order.push(d);} byd[d].push(t); });
      order.sort(function(a,b){ var ia=DISCIPLINES.indexOf(a),ib=DISCIPLINES.indexOf(b); ia=ia<0?99:ia; ib=ib<0?99:ib; return ia-ib||a.localeCompare(b,"ru"); });
      order.forEach(function(d){ var g=document.createElement("optgroup"); g.label=d;
        byd[d].forEach(function(t){ var o=document.createElement("option"); o.value=t.id; o.textContent=t.short; g.appendChild(o); });
        calcEl.appendChild(g); });
    }
    calcSetDefaults(); renderCalc(); ovl8.classList.add("on"); calcSheet.classList.add("on");
  }
  // openCalcInner end
  function calcSetDefaults(){ var t=typeById(calcEl.value); document.getElementById("calcUnit").textContent=t.unit||"ед.";
    document.getElementById("calcVol").value=(num(t.projVol)||0); }
  function closeCalc(){ ovl8.classList.remove("on"); calcSheet.classList.remove("on"); }
  function updateCalcCartBar(){
    var bar=document.getElementById("calcCartBar");
    var cnt=document.getElementById("cartCount");
    var sumEl=document.getElementById("cartSum");
    if(!bar||!cnt||!sumEl) return;
    if(!calcCart.length){ bar.style.display="none"; return; }
    bar.style.display="block";
    var total=0; calcCart.forEach(function(x){ total+=x.sum; });
    cnt.textContent=calcCart.length;
    sumEl.textContent=fmtMoney(total)+" ₽";
  }
  function addToCalcCart(item){
    var found=calcCart.find(function(x){ return x.name===item.name && x.buyUnit===item.buyUnit; });
    if(found){ found.buyQty += item.buyQty; found.sum = found.buyQty * found.price; }
    else calcCart.push(item);
    updateCalcCartBar();
    toast("Добавлено в корзину");
  }
  function renderCalc(){
    var v=document.getElementById("calcView"); v.innerHTML=""; var t=typeById(calcEl.value);
    if(!t||t.id===undefined){ return; }
    document.getElementById("calcUnit").textContent=t.unit||"ед.";
    var PV=num(t.projVol)||0, V=num(document.getElementById("calcVol").value); if(V==null) V=PV;
    document.getElementById("calcInfo").textContent="Проект: "+(PV||0)+" "+(t.unit||"")+(PV>0&&V!=PV?("  ·  считаем на "+fmtNum(V)+" "+(t.unit||"")):"");
    var mats=elemRes(t.id).filter(function(r){return r.rtype==="Материал";});
    if(!mats.length){ v.innerHTML='<div class="empty" style="color:var(--muted);font-size:13px;padding:8px">У элемента нет категорий-материалов.</div>'; return; }
    var anyDetail=false;
    mats.forEach(function(c){
      var effVol=(num(c.total)||0)*(PV>0?V/PV:0);
      var head=document.createElement("div"); head.className="svhead";
      head.innerHTML='<span>'+escapeHtml(c.name)+' · '+fmtNum(effVol)+' '+escapeHtml(c.unit||"")+'</span>';
      v.appendChild(head);
      var det=(state.detail&&state.detail[c.name])?state.detail[c.name]:[];
      if(!det.length){ var e=document.createElement("div"); e.className="svrow"; e.innerHTML='<span class="t" style="color:var(--muted)">детализация не загружена</span><span class="q"></span>'; v.appendChild(e); return; }
      anyDetail=true;
      det.forEach(function(d){
        var rash=(num(d.perCat)||0)*effVol;
        var conv=num(d.conv)||1; var buy=roundBuy(rash/conv, d.buyUnit);
        var price=num(d.price)||0; var sum=buy*price;
        var row=document.createElement("div"); row.className="calcrow";
        row.style.alignItems="center";
        row.innerHTML='<div class="cmark">'+escapeHtml(d.name)+'</div>'+
          '<div class="cnums"><span class="crash">'+fmtNum(Math.round(rash*100)/100)+' '+escapeHtml(d.unit||"")+'</span>'+
          '<span class="cbuy">→ '+fmtNum(buy)+' '+escapeHtml(d.buyUnit||"")+'</span>'+
          '<span class="csum">'+fmtMoney(sum)+' ₽</span></div>'+
          '<button class="btn small" style="padding:6px 10px;margin-left:6px;flex:0 0 auto" data-add="1">+</button>';
        row.querySelector("[data-add]").addEventListener("click",function(){
          addToCalcCart({ name:d.name||"", buyQty:buy, buyUnit:d.buyUnit||"", price:price, sum:sum, cat:c.name||"", elem:t.short||"" });
        });
        v.appendChild(row);
      });
    });
    if(!anyDetail){ var note=document.createElement("div"); note.style.cssText="color:var(--muted);font-size:12px;padding:8px 2px"; note.textContent="Загрузите «Детализацию» в справочнике, чтобы увидеть марки и расчёт закупки."; v.appendChild(note); }
  }
  calcEl.addEventListener("change",function(){ calcSetDefaults(); renderCalc(); });
  document.getElementById("calcVol").addEventListener("input",renderCalc);
  ovl8.addEventListener("click",closeCalc);
  document.getElementById("calcCloseBtn").addEventListener("click",closeCalc);
  attachSheetDrag(document.querySelector("#calcSheet .grab"), calcSheet, closeCalc);
  document.getElementById("calcClearCartBtn").addEventListener("click",function(){ calcCart=[]; updateCalcCartBar(); toast("Корзина очищена"); });
  document.getElementById("calcCreateReqBtn").addEventListener("click",function(){
    if(!calcCart.length){ toast("Корзина пуста"); return; }
    var reqs=loadRequests();
    var t=typeById(calcEl.value);
    var total=0; calcCart.forEach(function(x){ total+=x.sum; });
    var maxNum=0; reqs.forEach(function(r){ if((r.num||0)>maxNum) maxNum=r.num; });
    var req={ id:Date.now(), num:maxNum+1, projectId:(curProj()&&curProj().id)||null, created:iso(today), elem:t?t.short:"", status:"В работе", items:calcCart.slice(), total:total };
    reqs.unshift(req);
    saveRequests(reqs);
    calcCart=[]; updateCalcCartBar();
    toast("Заявка №"+req.num+" создана");
  });
  document.getElementById("calcExportBtn").addEventListener("click",function(){
    var t=typeById(calcEl.value); if(!t)return; var PV=num(t.projVol)||0, V=num(document.getElementById("calcVol").value); if(V==null)V=PV;
    var mats=elemRes(t.id).filter(function(r){return r.rtype==="Материал";});
    var lines=["Элемент;"+t.short+";объём;"+fmtNum(V)+" "+(t.unit||""), "", "Категория;Марка/изделие;Расход;Ед.;К закупке;Ед. закупки;Цена;Сумма, ₽"]; var total=0;
    mats.forEach(function(c){ var effVol=(num(c.total)||0)*(PV>0?V/PV:0); var det=(state.detail&&state.detail[c.name])||[];
      det.forEach(function(d){ var rash=(num(d.perCat)||0)*effVol; var buy=roundBuy(rash/(num(d.conv)||1), d.buyUnit); var sum=buy*(num(d.price)||0); total+=sum;
        lines.push('"'+c.name+'";"'+(d.name||"").replace(/"/g,'""')+'";'+fmtNum(Math.round(rash*100)/100)+";"+(d.unit||"")+";"+fmtNum(buy)+";"+(d.buyUnit||"")+";"+(num(d.price)||0)+";"+Math.round(sum)); }); });
    lines.push(";;;;;;ИТОГО;"+Math.round(total));
    try{ var blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv"}); var url=URL.createObjectURL(blob);
      var a=document.createElement("a"); a.href=url; a.download="zakupka-"+t.short.replace(/[^\wа-яА-Я]+/g,"_")+".csv"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000); toast("CSV сохранён"); }catch(e){ toast("Не удалось выгрузить"); }
  });

  var ovlReq=document.getElementById("ovlReq"), reqSheet=document.getElementById("reqSheet");
  function openRequests(){
    var list=document.getElementById("reqList"); list.innerHTML="";
    var reqs=loadRequests();
    if(!reqs.length){
      list.innerHTML='<div style="color:var(--muted);font-size:14px;padding:16px 4px;text-align:center">Пока нет заявок.<br>Создайте через «Калькулятор закупки».</div>';
    } else {
      reqs.forEach(function(r){
        var card=document.createElement("div");
        card.style.cssText="background:#fbfcfd;border:1px solid var(--grid);border-radius:12px;padding:12px;margin-bottom:10px";
        var itemsHtml=(r.items||[]).slice(0,4).map(function(it){
          return '<div style="font-size:12px;color:var(--muted)">• '+escapeHtml(it.name)+' — '+fmtNum(it.buyQty)+' '+escapeHtml(it.buyUnit||"")+'</div>';
        }).join("");
        if((r.items||[]).length>4) itemsHtml+='<div style="font-size:12px;color:var(--muted)">… и ещё '+(r.items.length-4)+'</div>';
        card.innerHTML=
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
            '<b>№ '+r.num+'</b>'+
            '<span style="font-size:12px;font-weight:700;color:#2563eb">'+escapeHtml(r.status||"В работе")+'</span></div>'+
          '<div style="font-size:14px;font-weight:700;margin-bottom:4px">'+escapeHtml(r.elem||"")+'</div>'+itemsHtml+
          '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:var(--muted)">'+
            '<span>Создана '+escapeHtml(r.created||"")+'</span>'+
            '<b style="color:var(--ink)">'+fmtMoney(r.total||0)+' ₽</b></div>';
        list.appendChild(card);
      });
    }
    ovlReq.classList.add("on"); reqSheet.classList.add("on");
  }
  function closeRequests(){ ovlReq.classList.remove("on"); reqSheet.classList.remove("on"); }
  if(ovlReq) ovlReq.addEventListener("click",closeRequests);
  var reqCloseBtn=document.getElementById("reqCloseBtn");
  if(reqCloseBtn) reqCloseBtn.addEventListener("click",closeRequests);
  if(reqSheet) attachSheetDrag(document.querySelector("#reqSheet .grab"), reqSheet, closeRequests);

// ---- toast ----
  var toastEl=document.getElementById("toast"), toastT=null;
  function toast(msg){ toastEl.textContent=msg; toastEl.classList.add("on"); if(toastT)clearTimeout(toastT); toastT=setTimeout(function(){ toastEl.classList.remove("on"); },2200); }

  // ---- погода (Open-Meteo, пос. Тургояк) ----
  function wxIcon(code){
    if(code===0) return "☀";
    if(code===1||code===2) return "⛅";
    if(code===3) return "☁";
    if(code===45||code===48) return "🌫";
    if((code>=51&&code<=67)||(code>=80&&code<=82)) return "🌧";
    if((code>=71&&code<=77)||code===85||code===86) return "❄";
    if(code>=95) return "⛈";
    return "☁";
  }
  function wxWord(code){
    if(code===0) return "ясно";
    if(code===1||code===2) return "перем. обл.";
    if(code===3) return "облачно";
    if(code===45||code===48) return "туман";
    if((code>=51&&code<=67)||(code>=80&&code<=82)) return "дождь";
    if((code>=71&&code<=77)||code===85||code===86) return "снег";
    if(code>=95) return "гроза";
    return "облачно";
  }
  function tsign(t){ t=Math.round(t); return (t>0?"+":"")+t+"°"; }
  function loadWeather(){
    var elw=document.getElementById("wxBig"); var p=curProj();
    if(!p || p.lat==null || p.lng==null){ if(elw) elw.innerHTML=""; return; }
    var url="https://api.open-meteo.com/v1/forecast?latitude="+p.lat+"&longitude="+p.lng+"&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2";
    fetch(url).then(function(r){ return r.json(); }).then(function(d){
      var cur=d.current||{}, day=d.daily||{};
      var nowT=cur.temperature_2m, nowC=cur.weather_code;
      var tmaxArr=day.temperature_2m_max||[], wcArr=day.weather_code||[];
      var tom=(tmaxArr.length>1)?("завтра "+wxIcon(wcArr[1])+" "+tsign(tmaxArr[1])):"";
      if(elw) elw.innerHTML='<span class="wi">'+(nowC!=null?wxIcon(nowC):"·")+'</span><span><span class="wt">'+(nowT!=null?tsign(nowT):"—")+'</span><span class="wsub">'+tom+'</span></span>';
      var gw=document.getElementById("wxGantt"); if(gw) gw.innerHTML=(nowT!=null?tsign(nowT):"—")+" "+(tmaxArr.length>1?("завтра "+tsign(tmaxArr[1])):"")+" "+(nowC!=null?wxIcon(nowC):"");
      p.wx=(nowC!=null?wxIcon(nowC):"")+" "+(nowT!=null?tsign(nowT):""); persistProjects();
    }).catch(function(){ if(elw) elw.innerHTML='<span class="wsub">погода недоступна</span>'; });
  }

  // ---- init ----
  // проекты
  function applyProjHeader(){ var p=curProj(); if(!p)return;
    var ht=document.getElementById("homeTitle"), hl=document.getElementById("homeLoc"), gt=document.querySelector(".gtitle");
    if(ht) ht.textContent=p.name; if(hl) hl.textContent=p.loc||""; if(gt) gt.textContent=p.name+" — График";
  }
  function fmtShortMoney2(n){ n=n||0; if(n>=1e6) return (Math.round(n/1e5)/10)+" млн ₽"; if(n>=1e3) return Math.round(n/1e3)+" тыс ₽"; return Math.round(n)+" ₽"; }
  function renderProjects(){
    var box=document.getElementById("projList"); if(!box)return; box.innerHTML="";
    projects.forEach(function(p){
      var c=document.createElement("div"); c.className="pcard"+(p.id===curId?" cur":"");
      var st=p.stats||{}; var pct=(st.pct!=null)?(fmtPct(st.pct)+" %"):"—";
      var bud=(st.budget!=null)?fmtShortMoney2(st.budget):"—";
      var wx=p.wx?('<span class="pwx">'+p.wx+'</span> <span class="dot">•</span> '):'';
      c.innerHTML='<button class="pedit" data-edit="'+p.id+'">✎</button>'+
        '<h3>'+escapeHtml(p.name)+'</h3><div class="ploc">'+escapeHtml(p.loc||"")+'</div>'+
        '<div class="pmeta">'+wx+'<b>'+pct+'</b> готовность <span class="dot">•</span> '+bud+'</div>';
      c.addEventListener("click",function(e){ if(e.target&&e.target.dataset&&e.target.dataset.edit){ openProjSheet(p.id); return; } openProject(p.id); });
      box.appendChild(c);
    });
    var add=document.createElement("div"); add.className="paddcard"; add.innerHTML='<span class="plus">+</span>Новый проект';
    add.addEventListener("click",function(){ openProjSheet(null); });
    box.appendChild(add);
  }
  function openProject(id){
    if(id!==curId){ curId=id; persistProjects(); }
    loadKey(boardKey(), function(){ applyProjHeader(); render(); renderDash(); loadWeather(); showScreen("home"); });
  }
  function showProjects(){ if(curId) save(); renderProjects(); ["scrHome","scrGantt"].forEach(function(x){document.getElementById(x).classList.remove("on");}); document.getElementById("scrProjects").classList.add("on"); document.getElementById("tabbar").style.display="none"; document.getElementById("fab").style.display="none"; menu.classList.remove("on"); }
  var editingProjId=null;
  function openProjSheet(id){ editingProjId=id;
    var p=id?projects.filter(function(x){return x.id===id;})[0]:null;
    document.getElementById("projSheetTitle").textContent=p?"Проект":"Новый проект";
    document.getElementById("npName").value=p?p.name:""; document.getElementById("npLoc").value=p?(p.loc||""):"";
    document.getElementById("npDelete").style.display=(p&&projects.length>1)?"block":"none";
    document.getElementById("ovl9").classList.add("on"); document.getElementById("projSheet").classList.add("on");
  }
  function closeProjSheet(){ document.getElementById("ovl9").classList.remove("on"); document.getElementById("projSheet").classList.remove("on"); }
  document.getElementById("ovl9").addEventListener("click",closeProjSheet);
  document.getElementById("npCancel").addEventListener("click",closeProjSheet);
  document.getElementById("npCreate").addEventListener("click",function(){
    var name=document.getElementById("npName").value.trim(); if(!name){ toast("Введите название"); return; }
    var loc=document.getElementById("npLoc").value.trim();
    if(editingProjId){ var p=projects.filter(function(x){return x.id===editingProjId;})[0]; if(p){ p.name=name; p.loc=loc; } persistProjects(); closeProjSheet(); if(editingProjId===curId) applyProjHeader(); renderProjects(); return; }
    if(curId) save();
    var id="p"+Date.now(); var proj={id:id,name:name,loc:loc,lat:null,lng:null,key:"gantt_board_"+id,stats:{},wx:""};
    projects.push(proj); curId=id; persistProjects();
    resetState(); state.bars=defaultBars(); save(); applyProjHeader(); render(); renderDash();
    closeProjSheet(); showScreen("home"); toast("Проект создан: "+name);
  });
  document.getElementById("npDelete").addEventListener("click",function(){
    if(!editingProjId||projects.length<2) return;
    if(!confirm("Удалить проект и все его данные?")) return;
    var p=projects.filter(function(x){return x.id===editingProjId;})[0];
    if(p){ try{ if(window.localStorage) window.localStorage.removeItem(p.key); }catch(e){} if(hasWinStore()){ try{ window.storage.delete(p.key,false); }catch(e){} } }
    projects=projects.filter(function(x){return x.id!==editingProjId;});
    if(curId===editingProjId) curId=projects[0].id;
    persistProjects(); closeProjSheet(); showProjects();
  });
  attachSheetDrag(document.querySelector("#projSheet .grab"), document.getElementById("projSheet"), closeProjSheet);
  document.getElementById("toProjBtn").addEventListener("click",showProjects);
  // экраны и навигация
  function showScreen(name){
    document.getElementById("scrProjects").classList.remove("on");
    document.getElementById("scrHome").classList.toggle("on", name==="home");
    document.getElementById("scrGantt").classList.toggle("on", name==="gantt");
    document.getElementById("tabbar").style.display="";
    document.getElementById("fab").style.display="";
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'),function(b){ b.classList.toggle("on", b.dataset.tab===(name==="gantt"?"gantt":"home")); });
    if(name==="home") renderDash();
    if(name==="gantt"){
      var el=document.getElementById("today"); if(el) el.style.left=(todayDay*DAYW)+"px";
      renderPeopleCard();
      var sc=document.getElementById("scroll");
      setTimeout(function(){ sc.scrollLeft=Math.max(0, todayDay*DAYW - sc.clientWidth*0.28); },30);
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tabbar button'),function(btn){
    btn.addEventListener("click",function(){ var t=btn.dataset.tab;
      if(t==="home") showScreen("home");
      else if(t==="gantt") showScreen("gantt");
      else if(t==="tasks") toast("Задачи — добавим позже");
      else if(t==="more") toggleMenu();
    });
  });
  document.getElementById("backBtn").addEventListener("click",function(){ showScreen("home"); });
  (function(){ var sc=document.getElementById("scroll"), hint=document.getElementById("scrollHint"); if(sc&&hint) sc.addEventListener("scroll",function(){ hint.style.opacity=(sc.scrollLeft>20?"0":"1"); }); })();

  function fmtShortMoney(n){ n=n||0; if(n>=1e6) return (Math.round(n/1e5)/10)+" млн"; if(n>=1e3) return Math.round(n/1e3)+" тыс"; return Math.round(n)+""; }
  function renderDash(){
    var dash=document.getElementById("dash"); if(!dash) return; dash.innerHTML="";
    var r=readiness(), bd=budgetData();
    var grid=document.createElement("div"); grid.className="kpigrid";
    function card(t,v,u,onclick){ var c=document.createElement("div"); c.className="kpicard";
      c.innerHTML='<div class="kt">'+t+'</div><div class="kv">'+v+' <span class="ku">'+u+'</span></div>'; c.addEventListener("click",onclick); return c; }
    grid.appendChild(card("Бюджет", fmtShortMoney(bd.objBud), "₽", function(){ openKpi(); }));
    grid.appendChild(card("Оплаты факт", fmtShortMoney(bd.objEarned), "₽", function(){ openCashflow(); }));
    grid.appendChild(card("Готовность", fmtPct(r.objPct), "%", function(){ openKpi(); }));
    dash.appendChild(grid);
    // виджет план
    var w1=document.createElement("div"); w1.className="widget";
    w1.innerHTML='<div class="wh"><b>План на 2 недели</b><span class="chev">›</span></div><div class="mgticks"></div><div class="mgbody"></div>';
    w1.addEventListener("click",function(){ showScreen("gantt"); });
    dash.appendChild(w1); renderMiniGantt(w1.querySelector(".mgticks"), w1.querySelector(".mgbody"));
    // виджет люди
    var w2=document.createElement("div"); w2.className="widget";
    w2.innerHTML='<div class="wh"><b>Прогноз людей на объекте</b><span class="chev">›</span></div><div class="mchartbody"></div><div class="wlegend"></div>';
    w2.addEventListener("click",function(){ showScreen("gantt"); });
    dash.appendChild(w2); renderMiniPeople(w2.querySelector(".mchartbody"), w2.querySelector(".wlegend"));
  }
  function renderMiniGantt(ticksEl, bodyEl){
    var winStart=(Math.floor(todayDay/7)-1)*7; if(winStart<0) winStart=0; var winLen=35, winEnd=winStart+winLen;
    for(var k=0;k<=5;k++){ var d=winStart+k*7; var tk=document.createElement("div"); tk.className="mgtick"; tk.style.left=(k*7/winLen*100)+"%"; tk.textContent=ddmm(dayToDate(d)); ticksEl.appendChild(tk); }
    var known=knownIdSet();
    var pk=state.bars.filter(function(b){ return b.typeId!==null && known[b.typeId] && b.end>winStart && b.start<winEnd; })
                     .sort(function(a,b){return a.start-b.start;}).slice(0,5);
    if(!pk.length){ var e=document.createElement("div"); e.style.cssText="color:var(--muted);font-size:13px;padding:6px 0"; e.textContent="Нет пакетов в ближайшие недели."; bodyEl.appendChild(e); return; }
    pk.forEach(function(b){ var t=typeById(b.typeId); var col=t.color;
      var row=document.createElement("div"); row.className="mgrow";
      var done=pkgDonePct(b);
      var lab=document.createElement("div"); lab.className="mglab";
      lab.innerHTML='<div class="n"><i style="background:'+col+'"></i>'+escapeHtml(t.short)+'</div><div class="s">'+(b.pkgVol||0)+' '+escapeHtml(t.unit||"")+(done>0?(" · "+Math.round(done)+"%"):"")+'</div>';
      row.appendChild(lab);
      var tr=document.createElement("div"); tr.className="mgtrack";
      var l=Math.max(0,(b.start-winStart)/winLen*100), rgt=Math.min(100,(b.end-winStart)/winLen*100); var w=Math.max(2,rgt-l);
      var bar=document.createElement("div"); bar.className="mgbar"; bar.style.left=l+"%"; bar.style.width=w+"%"; bar.style.background=col;
      if(done>0){ var f=document.createElement("div"); f.className="f"; f.style.width=done+"%"; f.style.background=col; bar.appendChild(f); }
      tr.appendChild(bar);
      if(todayDay>=winStart&&todayDay<=winEnd){ var tl=document.createElement("div"); tl.className="mgtoday"; tl.style.left=((todayDay-winStart)/winLen*100)+"%"; tr.appendChild(tl); }
      row.appendChild(tr); bodyEl.appendChild(row);
    });
  }
  function renderMiniPeople(bodyEl, legEl){
    var L=computeLabor(); var startW=Math.max(0,Math.floor(todayDay/7)-1); var n=Math.min(8, WEEKS-startW);
    var weeks=[]; var maxT=0;
    for(var i=0;i<n;i++){ var w=startW+i; var per={}, tot=0; L.contrs.forEach(function(c){ var mh=L.weeks[w][c]||0; var ppl=mh>0?Math.ceil(mh/WORKWEEK):0; if(ppl>0){per[c]=ppl; tot+=ppl;} }); weeks.push({w:w,per:per,tot:tot}); if(tot>maxT)maxT=tot; }
    if(maxT<=0){ bodyEl.innerHTML='<div style="color:var(--muted);font-size:13px;padding:6px 0">Нет данных: задайте работы, объёмы и сроки.</div>'; return; }
    var chart=document.createElement("div"); chart.className="mchart"; var maxH=60;
    weeks.forEach(function(wk){ var col=document.createElement("div"); col.className="mccol";
      if(wk.tot>0){ var num=document.createElement("div"); num.className="mcnum"; num.textContent=wk.tot; col.appendChild(num);
        var bar=document.createElement("div"); bar.className="mcbar"; bar.style.height=Math.max(4,Math.round(wk.tot/maxT*maxH))+"px";
        L.contrs.forEach(function(c,ci){ if(wk.per[c]){ var seg=document.createElement("div"); seg.className="mcseg"; seg.style.height=(wk.per[c]/wk.tot*100)+"%"; seg.style.background=PROFCOL[ci%PROFCOL.length]; bar.appendChild(seg); } });
        col.appendChild(bar);
      }
      var x=document.createElement("div"); x.className="mcx"; x.textContent=ddmm(dayToDate(wk.w*7)); col.appendChild(x);
      chart.appendChild(col);
    });
    bodyEl.appendChild(chart);
    L.contrs.forEach(function(c,ci){ var s=document.createElement("span"); s.innerHTML='<i style="background:'+PROFCOL[ci%PROFCOL.length]+'"></i>'+escapeHtml(c); legEl.appendChild(s); });
  }
  statusEl=document.getElementById("status");
  try{ var zsaved=parseInt(lsGet("gantt_zoom")); if(!isNaN(zsaved)&&zsaved>=0&&zsaved<ZOOMS.length){ zi=zsaved; DAYW=ZOOMS[zi]; WEEKW=DAYW*7; } }catch(e){}
  applyZoomVars();
  buildHeader();
  loadProjects(function(){
    applyProjHeader();
    load(function(){
      render(); renderDash(); renderProjects();
      var sc=document.getElementById("scroll"); sc.scrollLeft=Math.max(0,todayDay*DAYW - sc.clientWidth/2); sc._centered=1;
      if(!sc._virtBound){ sc._virtBound=1; var virtT=null; sc.addEventListener("scroll",function(){
        if(virtT) clearTimeout(virtT);
        virtT=setTimeout(function(){ render(); }, 80);
      }, {passive:true}); }
      loadWeather();
      document.getElementById("tabbar").style.display="none"; document.getElementById("fab").style.display="none";
    });
  });
  window.addEventListener("resize",render);
  function refreshToday(){
    var t=startOfDay(new Date()); if(+t===+today) return;
    today=t; todayDay=dateToDay(t);
    var el=document.getElementById("today"); if(el) el.style.left=(todayDay*DAYW)+"px";
    loadWeather();
  }
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) refreshToday(); });
  window.addEventListener("focus",refreshToday);
  window.addEventListener("pageshow",refreshToday);
  setInterval(refreshToday, 30*60*1000);
})();
