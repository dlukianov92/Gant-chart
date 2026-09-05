/**
 * domain-calc.js — чистые расчёты (Phase 2)
 * Не зависит от DOM. Принимает данные явно или через context.
 * Используется UI и автотестами.
 */
(function (global) {
  "use strict";
  var D = global.PlanDomain = global.PlanDomain || {};

  D.num = function (x) {
    if (x === "" || x == null) return null;
    var v = parseFloat(("" + x).replace(",", "."));
    return isNaN(v) ? null : v;
  };

  D.pkgDonePct = function (pkgVol, fact) {
    var pv = D.num(pkgVol) || 0, f = D.num(fact) || 0;
    return pv > 0 ? Math.max(0, Math.min(100, (f / pv) * 100)) : 0;
  };

  D.elemBudget = function (resources) {
    // resources: [{price, total}]
    var s = 0;
    (resources || []).forEach(function (r) {
      s += (D.num(r.price) || 0) * (D.num(r.total) || 0);
    });
    return s;
  };

  D.objBudget = function (types, elemResMap) {
    var s = 0;
    (types || []).forEach(function (t) {
      s += D.elemBudget(elemResMap && elemResMap[t.id]);
    });
    return s;
  };

  D.pkgShare = function (pkgVol, projVol) {
    var pv = D.num(projVol) || 0, v = D.num(pkgVol) || 0;
    return pv > 0 ? v / pv : 0;
  };

  D.migrateBoard = function (o, schemaVersion) {
    if (!o || typeof o !== "object") return null;
    var v = o.v || 1;
    if (v < 6) o.v = 6;
    if ((o.v || 6) < 7) {
      o.v = 7;
      if (!o.types) o.types = [];
      if (!o.elemRes) o.elemRes = {};
      if (!o.detail) o.detail = {};
      if (!o.bars) o.bars = [];
    }
    if ((o.v || 7) < 8) {
      o.v = 8;
      o._needsCatalogSplit = !!(o.elemRes || o.detail);
    }
    o.v = schemaVersion || 8;
    return o;
  };

  D.validateImportPayload = function (o) {
    if (!o || typeof o !== "object") return "Файл не распознан";
    if (!Array.isArray(o.bars)) return "Нет массива bars";
    if (o.bars.length > 5000) return "Слишком много полос (>" + 5000 + ")";
    if (o.types && o.types.length > 2000) return "Слишком много элементов";
    return null;
  };

  D.computeLaborTotals = function (bars, getWorkMH, workweek) {
    // getWorkMH(bar) -> {contractor: hours}
    workweek = workweek || 40;
    var weeks = {};
    var contrs = {};
    (bars || []).forEach(function (b) {
      var mh = getWorkMH(b) || {};
      Object.keys(mh).forEach(function (c) {
        if (!mh[c]) return;
        contrs[c] = 1;
        var start = b.start | 0, end = b.end | 0;
        if (end <= start) return;
        for (var d = start; d < end; d++) {
          var w = Math.floor(d / 7);
          if (!weeks[w]) weeks[w] = {};
          weeks[w][c] = (weeks[w][c] || 0) + mh[c] / (end - start);
        }
      });
    });
    return { weeks: weeks, contrs: Object.keys(contrs) };
  };

  D.SCHEMA_VERSION = 8;
})(typeof window !== "undefined" ? window : globalThis);
