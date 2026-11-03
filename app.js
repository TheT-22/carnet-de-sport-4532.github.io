/* Carnet de musculation
   Toutes les données restent dans le stockage local du téléphone (localStorage).
   Le programme de l'athlète arrive par son lien personnel (#p=...) : la partie après « # »
   n'est jamais envoyée au serveur. L'application ne fait aucune requête réseau vers l'extérieur
   (voir la Content-Security-Policy dans index.html). */
(function () {
"use strict";

var APP_VERSION = "1.0.4";
var KEY = "carnet-muscu:v1";

/* ================= Stockage local ================= */
function emptyData() { return { v: 1, actif: null, programmes: {}, liens: {}, seances: {}, pesees: {}, semaines: {} }; }
function normalize(d) {
  var e = emptyData();
  if (!d || typeof d !== "object") return e;
  Object.keys(e).forEach(function (k) { if (d[k] === undefined || d[k] === null) d[k] = e[k]; });
  return d;
}
var storageOK = true;
var D = (function () {
  try { var raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); }
  catch (err) { storageOK = false; }
  return emptyData();
})();
var saveTimer = null;
function persistNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { localStorage.setItem(KEY, JSON.stringify(D)); storageOK = true; setSaved("Enregistré sur ce téléphone"); }
  catch (err) { storageOK = false; setSaved("Échec de l'enregistrement : exporte tes données"); }
}
function persist() { setSaved("Enregistrement…"); clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 250); }
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && saveTimer) persistNow(); });
window.addEventListener("pagehide", function () { if (saveTimer) persistNow(); });
if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (err) {} }

/* ================= Utilitaires ================= */
function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parse(s) { var a = s.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2]); }
function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }
function dow(s) { return (parse(s).getDay() + 6) % 7; }
function todayStr() { return ymd(new Date()); }
function fmtLong(s) { return parse(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
function fmtShort(s) { return parse(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); }
function fmtDayName(s) { return parse(s).toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""); }
function toNum(v) { if (v === null || v === undefined || v === "") return null; var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
function fmt(n, d) { if (n === null || n === undefined || !isFinite(n)) return "–"; return n.toLocaleString("fr-FR", { maximumFractionDigits: d === undefined ? 1 : d }); }
function roundTo(x, step) { return Math.round(x / step) * step; }
function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function e1rm(load, reps, rir) { return load * (1 + (reps + rir) / 30); }
function keysOf(o) { return o ? Object.keys(o) : []; }
function valuesOf(o) { return o ? Object.keys(o).map(function (k) { return o[k]; }) : []; }
function getPath(o, path) { return path.split(".").reduce(function (a, k) { return a && a[k] !== undefined ? a[k] : undefined; }, o); }
function setPath(o, path, v) {
  var ks = path.split("."), cur = o;
  ks.slice(0, -1).forEach(function (k) { if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {}; cur = cur[k]; });
  var last = ks[ks.length - 1];
  if (v === "" || v === null || v === undefined) delete cur[last]; else cur[last] = v;
}

/* ================= Programme ================= */
var P = null;
function setActive() {
  P = D.actif && D.programmes[D.actif] ? D.programmes[D.actif] : null;
  if (P && !P.sessions.MENSU) P.sessions.MENSU = { kind: "mensu", name: "Mensurations", short: "Mensurations" };
}
var MESURES = [["epaules", "Tour d'épaules"], ["bras", "Tour de bras relâché"], ["poitrine", "Tour de poitrine"], ["taille", "Tour de taille"]];
function sessionName(t, date) { return t === "MENSU" && date !== P.debut ? "Mensurations" : P.sessions[t].name; }
setActive();

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function extractCode(text) {
  var t = String(text || "").trim();
  var m = t.match(/[#&?]p=([A-Za-z0-9_\-.]+)/) || t.match(/^p=([A-Za-z0-9_\-.]+)$/) || t.match(/^([01]\.[A-Za-z0-9_\-]+)$/);
  return m ? m[1] : null;
}
function decodeProgram(code) {
  var parts = code.split("."), ver = parts[0], bytes;
  try { bytes = b64uToBytes(parts[1] || ""); } catch (err) { return Promise.reject(new Error("Ce lien est incomplet. Copie-le en entier.")); }
  var textP;
  if (ver === "1") {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("Ton navigateur est trop ancien pour lire ce lien. Mets à jour ton téléphone ou demande un fichier de programme à ton coach."));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    textP = new Response(stream).text();
  } else if (ver === "0") textP = Promise.resolve(new TextDecoder().decode(bytes));
  else return Promise.reject(new Error("Ce lien n'est pas un lien de programme."));
  return textP.then(function (t) { return validateProgram(JSON.parse(t)); }, function () { throw new Error("Ce lien est incomplet ou abîmé. Copie-le en entier."); });
}
function validateProgram(p) {
  var ok = p && p.v === 1 && typeof p.id === "string" && /^[a-z0-9-]{3,24}$/.test(p.id) && /^\d{4}-\d{2}-\d{2}$/.test(p.debut || "") && p.sessions && p.versions && p.semaines >= 1;
  if (!ok) throw new Error("Ce programme n'est pas lisible par cette version de l'application.");
  return p;
}
function installProgram(p, link) {
  D.programmes[p.id] = p; D.actif = p.id; if (link) D.liens[p.id] = link;
  persistNow(); setActive(); S.date = initialDate(); S.week = clampWeek(weekOf(S.date)); S.view = "jour"; render();
  toast("Programme installé : " + (p.titre || "nouveau bloc"));
}

/* ================= Calendrier ================= */
function weekOf(s) { return Math.floor(diffDays(s, P.debut) / 7) + 1; }
function mondayOf(w) { return addDays(P.debut, (w - 1) * 7); }
function lastDay() { return P.testDay || addDays(P.debut, P.semaines * 7 - 1); }
function clampWeek(w) { return Math.min(P.semaines, Math.max(1, w)); }
function versionKeys() { return keysOf(P.versions); }
function weekDocId(w) { return P.id + "-S" + w; }
function weekDoc(w, create) { var id = weekDocId(w); if (!D.semaines[id] && create) D.semaines[id] = { programme: P.id, semaine: w }; return D.semaines[id]; }
function versionOf(w) { var ks = versionKeys(); if (ks.length === 1) return ks[0]; var d = weekDoc(w); return d && d.version ? d.version : null; }
function initialDate() { var t = todayStr(); if (!P) return t; if (t < P.debut) return P.debut; if (t > lastDay()) return lastDay(); return t; }

function plannedFor(date) {
  if (!P || date < P.debut) return [];
  if (P.testDay && date === P.testDay) return ["TESTS"];
  var w = weekOf(date); if (w > P.semaines) return [];
  var d = dow(date), v = versionOf(w), list;
  if (v) {
    var jours = P.versions[v].jours.map(function (a) { return a.slice(); });
    var sw = P.regles && P.regles.echange;
    if (sw && v === sw.si && w > 1 && versionOf(w - 1) === sw.apres) { var t = jours[sw.jours[0]]; jours[sw.jours[0]] = jours[sw.jours[1]]; jours[sw.jours[1]] = t; }
    list = jours[d];
  } else {
    var ks = versionKeys(), all = ks.map(function (k) { return JSON.stringify(P.versions[k].jours[d]); });
    if (!all.every(function (x) { return x === all[0]; })) return null;
    list = P.versions[ks[0]].jours[d].slice();
  }
  var out = [];
  list.forEach(function (t) {
    if (t.slice(-1) === "?") {
      var base = t.slice(0, -1), mon = mondayOf(w), done = false;
      for (var i = 0; i < 7; i++) { var dd = addDays(mon, i); if (dd < date && hasData(seance(dd, base))) done = true; }
      t = done ? "REPOS" : base;
    }
    if (out.indexOf(t) < 0 && P.sessions[t]) out.push(t);
  });
  if (date === P.debut && P.sessions.MENSU) out.unshift("MENSU");
  return out;
}
var NOT_DATA = ["date", "type", "semaine", "programme", "checkin", "ajoutee", "maj"];
function hasData(s) {
  if (!s) return false;
  return keysOf(s).some(function (k) { return NOT_DATA.indexOf(k) < 0 && s[k] !== undefined && s[k] !== null && JSON.stringify(s[k]) !== "{}"; });
}
function seanceId(date, type) { return date + "_" + type; }
function seance(date, type, create) {
  var id = seanceId(date, type);
  if (!D.seances[id] && create) D.seances[id] = { date: date, type: type, programme: P.id, semaine: weekOf(date) };
  return D.seances[id];
}
function dayDone(date) {
  var types = plannedFor(date);
  if (!types || !types.length) return null;
  var real = types.filter(function (t) { return t !== "REPOS"; });
  if (!real.length) return null;
  return real.every(function (t) { return hasData(seance(date, t)); });
}

/* ================= Charges ================= */
function presc(e, w) {
  var i = w - 1; if (!e.sets[i]) return null;
  return { sets: e.sets[i], reps: e.reps[i], repsN: e.repsN[i], load: e.load ? e.load[i] : "", base: e.base ? e.base[i] : null, rir: e.rir[i], rirN: e.rirN[i] };
}
function bodyweight(date) {
  var ds = keysOf(D.pesees).filter(function (d) { return d <= date; }).sort();
  for (var i = ds.length - 1; i >= 0; i--) { var k = toNum(D.pesees[ds[i]].kg); if (k) return k; }
  return P && P.poidsRef ? P.poidsRef : 75;
}
function rowsOk(obj) { return valuesOf(obj).filter(function (r) { return r && toNum(r.c) !== null && toNum(r.r); }); }
function lastPerf(exId, before) {
  var list = valuesOf(D.seances).filter(function (s) { return s.date < before && s.sets && s.sets[exId]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  for (var i = 0; i < list.length; i++) { var rows = rowsOk(list[i].sets[exId]); if (rows.length) return { date: list[i].date, rows: rows }; }
  return null;
}
function lastRemp(nom, before) {
  var list = valuesOf(D.seances).filter(function (s) { return s.date < before && s.remp; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  for (var i = 0; i < list.length; i++) {
    var ks = keysOf(list[i].remp);
    for (var j = 0; j < ks.length; j++) { var r = list[i].remp[ks[j]]; if (r && r.nom === nom && r.sets) { var rows = rowsOk(r.sets); if (rows.length) return { date: list[i].date, rows: rows }; } }
  }
  return null;
}
function targetFrom(last, p, step, bwThen, bwNow) {
  var best = 0, maxLoad = 0;
  last.rows.forEach(function (r) {
    var c = toNum(r.c) + bwThen, reps = toNum(r.r), rir = toNum(r.rir) !== null ? toNum(r.rir) : p.rirN;
    best = Math.max(best, e1rm(c, reps, rir)); maxLoad = Math.max(maxLoad, c);
  });
  var t = Math.min(best / (1 + (p.repsN + p.rirN) / 30), maxLoad * 1.05) - bwNow;
  return Math.max(0, roundTo(t, step));
}
function suggestion(e, p, date) {
  var last = lastPerf(e.id, date);
  if (last) return { load: targetFrom(last, p, e.step || 2.5, e.bw ? bodyweight(last.date) : 0, e.bw ? bodyweight(date) : 0), src: "d'après ta séance du " + fmtShort(last.date) };
  if (p.base !== null && p.base !== undefined) return { load: roundTo(p.base, e.step || 2.5), src: "charge prévue" };
  return null;
}
function loadLabel(e, x) { return e.bw ? (x > 0 ? "+" + fmt(x) + " kg de lest" : "poids de corps") : fmt(x) + " kg"; }

/* ================= Check-in ================= */
var CHECK = [
  { k: "sommeil", label: "Sommeil de la nuit", lo: "très mauvais", hi: "excellent" },
  { k: "fatigue", label: "Énergie générale", lo: "épuisé", hi: "frais" },
  { k: "courbatures", label: "Courbatures", lo: "fortes", hi: "aucune" },
  { k: "stress", label: "Stress", lo: "très élevé", hi: "calme" },
  { k: "motivation", label: "Envie de s'entraîner", lo: "aucune", hi: "très forte" }
];
function readiness(c) {
  if (!c) return null;
  var vals = CHECK.map(function (q) { return toNum(c[q.k]); }).filter(function (v) { return v !== null; });
  if (vals.length < CHECK.length) return null;
  var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  if (avg >= 3.5) return { avg: avg, level: "ok", title: "Feu vert", text: "Séance normale, charges et RIR prévus." };
  if (avg >= 2.5) return { avg: avg, level: "warn", title: "Prudence", text: "Garde les charges prévues, n'ajoute rien et vise le haut de la fourchette de RIR." };
  return { avg: avg, level: "stop", title: "Séance allégée", text: "Une série de moins par exercice et un RIR de plus. Si une douleur apparaît, saute l'exercice." };
}
var DOULEURS = ["Épaules", "Genoux", "Coudes", "Cou", "Bas du dos", "Poignets ou doigts"];
function zk(z) { return z.normalize("NFD").replace(/[^A-Za-z]/g, ""); }
var MOTIFS_EX = [{ v: "materiel", l: "Matériel indisponible" }, { v: "temps", l: "Manque de temps" }, { v: "douleur", l: "Douleur" }, { v: "autre", l: "Autre" }];
var MOTIFS_ARRET = [{ v: "temps", l: "Manque de temps" }, { v: "imprevu", l: "Imprévu" }, { v: "fatigue", l: "Fatigue" }, { v: "douleur", l: "Douleur" }, { v: "autre", l: "Autre" }];
function motifLabel(list, v) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].l.toLowerCase(); return "motif non précisé"; }

/* ================= Interface : état ================= */
var S = { view: "jour", date: null, week: 1, prompt: "", updateReady: false, pendingCode: null };
if (P) { S.date = initialDate(); S.week = clampWeek(weekOf(S.date)); }
var app = document.getElementById("app");
var isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;

var savedEl = null;
function setSaved(t) { if (savedEl) savedEl.textContent = t; }
var toastTimer;
function toast(t) { var el = document.getElementById("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove("on"); }, 3600); }

function dialog(title, bodyHtml, actions) {
  var back = document.getElementById("dialog");
  back.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">' + esc(title) + "</h2>" + bodyHtml + '<div class="row">' +
    actions.map(function (a, i) { return '<button type="button" class="btn ' + (a.cls || "") + '" data-dlg="' + i + '">' + esc(a.label) + "</button>"; }).join("") + "</div></div>";
  back.hidden = false;
  back.onclick = function (ev) {
    var b = ev.target.closest("[data-dlg]");
    if (!b) { if (ev.target === back) close(); return; }
    var a = actions[Number(b.dataset.dlg)]; close(); if (a.run) a.run();
  };
  function close() { back.hidden = true; back.innerHTML = ""; }
  var first = back.querySelector(".btn.primary, .btn"); if (first) first.focus();
}

/* ================= Rendu ================= */
function render() {
  var y = window.scrollY;
  renderMasthead();
  var tabs = document.getElementById("tabs");
  tabs.classList.toggle("hidden", !P);
  Array.prototype.forEach.call(tabs.querySelectorAll(".tab"), function (t) { if (t.dataset.view === S.view) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
  var h;
  if (!P) h = viewWelcome();
  else if (S.view === "jour") h = viewJour();
  else if (S.view === "semaine") h = viewSemaine();
  else if (S.view === "progres") h = viewProgres();
  else h = viewReglages();
  if (S.updateReady) h = '<div class="note info row"><span class="grow">Une nouvelle version de l\'application est prête.</span><button type="button" class="btn small primary" data-act="update">Mettre à jour</button></div>' + h;
  app.innerHTML = h;
  window.scrollTo(0, y);
}
function renderMasthead() {
  var m = document.getElementById("masthead"), h = '<div class="app-name"><span>Carnet de musculation</span><span class="saved" id="saved">' + (storageOK ? "Enregistré sur ce téléphone" : "Stockage indisponible") + "</span></div>";
  if (P) {
    var totals = [], max = 1;
    for (var w = 1; w <= P.semaines; w++) {
      var t = 0;
      keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { t += e.sets[w - 1] || 0; }); });
      totals.push(t); max = Math.max(max, t);
    }
    var cur = weekOf(S.date || todayStr());
    h += '<div class="block"><div class="block-title"><h2>' + esc(P.titre || "Programme") + '</h2><span class="tiny muted num">' + esc(fmtShort(P.debut)) + " au " + esc(fmtShort(lastDay())) + "</span></div>";
    if (P.objectif) h += '<p class="block-goal">' + esc(P.objectif) + "</p>";
    h += '<div class="bars" role="img" aria-label="Séries prévues par semaine : ' + totals.map(function (t, i) { return "semaine " + (i + 1) + " " + t; }).join(", ") + '">';
    totals.forEach(function (t, i) {
      var w = i + 1, cls = w === cur ? "now" : w < cur ? "past" : "";
      h += '<button type="button" class="bar ' + cls + '" data-act="gotoweek" data-w="' + w + '" aria-label="Semaine ' + w + ", " + t + ' séries prévues"><i style-h="' + Math.round(t / max * 100) + '"></i><span>' + (P.semainesNoms && P.semainesNoms[i] ? esc(P.semainesNoms[i]) : "S" + w) + "</span></button>";
    });
    h += '</div><p class="bars-caption">' + esc(P.legende || "Séries prévues chaque semaine") + "</p></div>";
  }
  m.innerHTML = h;
  savedEl = document.getElementById("saved");
  Array.prototype.forEach.call(m.querySelectorAll("[style-h]"), function (el) { el.style.height = Math.max(6, Math.round(Number(el.getAttribute("style-h")) * 0.34)) + "px"; });
}

/* ---------- Petits composants ---------- */
function seg(col, id, path, options, current, tight) {
  return '<div class="seg' + (tight ? " tight" : "") + '" role="group">' + options.map(function (o) {
    var v = typeof o === "object" ? o.v : o, l = typeof o === "object" ? o.l : o;
    return '<button type="button" data-act="seg" data-col="' + col + '" data-id="' + esc(id) + '" data-path="' + path + '" data-v="' + esc(v) + '" aria-pressed="' + (String(current) === String(v)) + '">' + esc(l) + "</button>";
  }).join("") + "</div>";
}
function inp(col, id, path, value, attrs) {
  return '<input type="text" autocomplete="off" ' + (attrs || "") + ' data-col="' + col + '" data-id="' + esc(id) + '" data-path="' + path + '" value="' + esc(value === undefined || value === null ? "" : value) + '">';
}
function txt(col, id, path, value, ph) {
  return '<textarea data-col="' + col + '" data-id="' + esc(id) + '" data-path="' + path + '" placeholder="' + esc(ph || "") + '">' + esc(value || "") + "</textarea>";
}
function zones(id, path, obj) {
  return '<div class="seg">' + DOULEURS.map(function (z) { var k = zk(z); return '<button type="button" data-act="toggle" data-col="seances" data-id="' + esc(id) + '" data-path="' + path + "." + k + '" aria-pressed="' + !!(obj && obj[k]) + '">' + esc(z) + "</button>"; }).join("") + "</div>";
}
function scaleQ(id, path, label, lo, hi, current, max) {
  var opts = []; for (var i = 1; i <= (max || 5); i++) opts.push(i);
  return '<div class="scale"><div class="scale-q"><span>' + esc(label) + '</span><span class="ends">1 ' + esc(lo) + ", " + (max || 5) + " " + esc(hi) + "</span></div>" + seg("seances", id, path, opts, current, true) + "</div>";
}

/* ---------- Accueil (aucun programme) ---------- */
function viewWelcome() {
  var h = '<section class="welcome"><h1>Ton carnet d\'entraînement</h1><p class="lead">Ta séance du jour, tes charges conseillées et ton suivi, enregistrés uniquement sur ce téléphone.</p>';
  h += '<div class="sheet"><h2>Installer ton programme</h2><p class="small muted">Ouvre le lien personnel envoyé par ton coach, ou colle-le ici.</p>' +
    '<label class="field" for="code-in"><span>Ton lien personnel</span><textarea id="code-in" placeholder="https://…#p=1.…"></textarea></label>' +
    '<div class="row"><button type="button" class="btn primary" data-act="paste-install">Installer le programme</button></div>' +
    '<label class="field" for="file-prog"><span>Ou importe un fichier de programme ou une sauvegarde</span><input type="file" id="file-prog" accept=".json,application/json" data-act="import-file"></label></div>';
  h += installHelp();
  h += privacyNote();
  return h + "</section>";
}
function installHelp() {
  return '<div class="sheet"><h2>Mettre l\'application sur ton écran d\'accueil</h2><ol class="steps small">' +
    '<li>iPhone : dans Safari, touche Partager, puis « Sur l\'écran d\'accueil ».</li>' +
    '<li>Android : dans Chrome, ouvre le menu ⋮, puis « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».</li>' +
    '<li>Ouvre l\'application depuis l\'icône. Sur iPhone, elle a son propre stockage : colle ton lien personnel la première fois.</li></ol>' +
    '<p class="small muted">Elle fonctionne ensuite sans réseau. Sur iPhone, l\'icône d\'écran d\'accueil protège aussi tes données : Safari efface celles des sites qu\'on n\'ouvre plus.</p></div>';
}
function privacyNote() {
  return '<div class="sheet"><h2>Tes données</h2><p class="small">Tout ce que tu notes reste sur ce téléphone. L\'application n\'envoie rien sur Internet : pas de compte, pas de statistiques, pas de publicité. Pense à exporter une sauvegarde de temps en temps depuis Réglages.</p></div>';
}

/* ---------- Aujourd'hui ---------- */
function viewJour() {
  var date = S.date, w = weekOf(date), plan = plannedFor(date), h = "";
  var mon = date >= P.debut ? addDays(date, -dow(date)) : addDays(P.debut, 0);
  h += '<div class="daystrip" role="group" aria-label="Jours de la semaine">';
  for (var i = 0; i < 7; i++) {
    var d = addDays(mon, i), done = d >= P.debut && d <= lastDay() ? dayDone(d) : null;
    h += '<button type="button" class="day' + (d === todayStr() ? " today" : "") + '" data-act="goto" data-date="' + d + '"' + (d === date ? ' aria-current="date"' : "") + ' aria-label="' + esc(fmtLong(d)) + '"><span class="dn">' + esc(fmtDayName(d)) + '</span><span class="dd">' + parse(d).getDate() + '</span><span class="dot ' + (done === true ? "done" : done === false ? "todo" : "") + '"></span></button>';
  }
  h += "</div>";
  h += '<div class="daynav"><h1>' + esc(fmtLong(date)) + "</h1>" + (date !== initialDate() ? '<button type="button" class="linkbtn" data-act="today">Aujourd\'hui</button>' : "") + "</div>";
  h += '<p class="small muted">' + esc(weekLabel(date)) + "</p>";
  if (todayStr() < P.debut && date === P.debut) h += '<div class="note info">Le bloc commence le ' + esc(fmtLong(P.debut)) + ". Voici la première séance.</div>";
  if (!isStandalone && !D.astuceVue) h += '<div class="note info row"><span class="grow">Installe l\'application sur ton écran d\'accueil pour l\'utiliser sans réseau et protéger tes données.</span><button type="button" class="btn small" data-act="view" data-v="reglages">Comment faire</button></div>';
  if (plan === null && P.question) h += choiceSheet(w);
  if (date >= P.debut && date <= lastDay()) h += weightSheet(date);
  var types = (plan || []).slice();
  valuesOf(D.seances).forEach(function (s) { if (s.date === date && types.indexOf(s.type) < 0 && P.sessions[s.type]) types.push(s.type); });
  if (!types.length && plan !== null) h += '<div class="sheet"><h2>Rien de prévu</h2><p class="small muted">Ce jour est en dehors du bloc. Tu peux quand même ajouter une séance ci-dessous.</p></div>';
  types.forEach(function (t) { h += sessionSheet(date, t, w); });
  h += addSheet(date, types);
  h += claudeSheet("jour");
  return h;
}
function weekLabel(date) {
  if (P.testDay && date === P.testDay) return "Tests de fin de bloc";
  if (date < P.debut) return "Avant le début du bloc";
  var w = weekOf(date); if (w > P.semaines) return "Après la fin du bloc";
  var v = versionOf(w), t = "Semaine " + w;
  if (P.deload && P.deload.indexOf(w) >= 0) t += ", décharge";
  if (versionKeys().length > 1) t += v ? ", " + P.versions[v].label.toLowerCase() : ", version à choisir";
  return t;
}
function choiceSheet(w) {
  return '<div class="sheet"><h2>' + esc(P.question.texte) + "</h2>" + (P.question.aide ? '<p class="small muted">' + esc(P.question.aide) + "</p>" : "") + '<div class="row">' +
    P.question.options.map(function (o, i) { return '<button type="button" class="btn ' + (i === 0 ? "primary" : "") + '" data-act="version" data-w="' + w + '" data-v="' + esc(o.v) + '">' + esc(o.l) + "</button>"; }).join("") + "</div></div>";
}
function weekAvgWeight(w) {
  var mon = mondayOf(w), vals = [];
  for (var i = 0; i < 7; i++) { var p = D.pesees[addDays(mon, i)], k = p ? toNum(p.kg) : null; if (k) vals.push(k); }
  return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
}
function weightSheet(date) {
  var p = D.pesees[date] || {}, avg = weekAvgWeight(weekOf(date));
  return '<div class="sheet"><div class="row end"><label class="field grow" for="kg-' + date + '"><span>Pesée du matin, à jeun (kg)</span>' + inp("pesees", date, "kg", p.kg, 'id="kg-' + date + '" inputmode="decimal" class="n" placeholder="ex. 76,2"') + '</label><div class="stat"><b>' + fmt(avg, 2) + '</b><span>moyenne de la semaine</span></div></div></div>';
}
function addSheet(date, types) {
  var opts = keysOf(P.sessions).filter(function (t) { return types.indexOf(t) < 0; });
  return '<label class="field" for="add-s"><span>Séance faite un autre jour, rattrapage ou séance en plus</span><select id="add-s" data-act="add"><option value="">Ajouter une séance à ce jour</option>' +
    opts.map(function (t) { return '<option value="' + t + '">' + esc(sessionName(t, date)) + "</option>"; }).join("") + "</select></label>";
}
function sessionSheet(date, type, w) {
  var def = P.sessions[type], s = seance(date, type) || {}, id = seanceId(date, type), st;
  if (s.arret && s.arret.motif) st = '<span class="state warn">Terminée plus tôt</span>';
  else st = hasData(s) ? '<span class="state done">Notée</span>' : '<span class="state">À faire</span>';
  var h = '<section class="sheet"><div class="sheet-head"><h2>' + esc(sessionName(type, date)) + "</h2>" + (def.kind === "repos" ? "" : st) + "</div>";
  if (def.kind === "muscu") h += bodyMuscu(date, def, w, s, id);
  else if (def.kind === "course") h += bodyCourse(date, def, w, s, id);
  else if (def.kind === "sport") h += bodySport(def, s, id);
  else if (def.kind === "repos") h += bodyRepos(def, s, id);
  else if (def.kind === "tests") h += bodyTests(def, s, id);
  else if (def.kind === "mensu") h += bodyMensu(s, id);
  return h + "</section>";
}
function checkin(s, id) {
  var c = s.checkin || {}, h = '<div class="section"><h3>Avant de commencer</h3><p class="small muted">Note chaque point de 1 à 5 : 5, c\'est au mieux.</p>';
  CHECK.forEach(function (q) { h += scaleQ(id, "checkin." + q.k, q.label, q.lo, q.hi, c[q.k]); });
  var r = readiness(c);
  if (r) h += '<div class="note ' + r.level + '"><b>' + r.title + " (" + fmt(r.avg, 1) + " sur 5).</b> " + r.text + "</div>";
  return h + "</div>";
}
function setRows(id, base, rows, n, o) {
  var h = '<div class="sets"><div class="set-head"><span></span><span>' + esc(o.head) + "</span><span>Reps</span><span>RIR</span><span></span></div>";
  for (var i = 0; i < n; i++) {
    var row = rows[i] || {}, b = base + "." + i + ".";
    var cl = o.load !== null && o.load !== undefined ? o.load : "";
    h += '<div class="set"><span class="i">' + (i + 1) + "</span>" +
      inp("seances", id, b + "c", row.c, 'inputmode="decimal" aria-label="Série ' + (i + 1) + ', charge en kg" placeholder="' + (cl !== "" ? fmt(cl) : "kg") + '"') +
      inp("seances", id, b + "r", row.r, 'inputmode="numeric" aria-label="Série ' + (i + 1) + ', répétitions" placeholder="' + esc(String(o.reps)) + '"') +
      inp("seances", id, b + "rir", row.rir, 'inputmode="decimal" aria-label="Série ' + (i + 1) + ', RIR" placeholder="' + fmt(o.rir) + '"') +
      '<button type="button" class="fill" data-act="fill" data-id="' + esc(id) + '" data-base="' + b + '" data-c="' + cl + '" data-r="' + o.reps + '" data-rir="' + o.rir + '">= prévu</button></div>';
  }
  return h + '</div><div><button type="button" class="btn small quiet" data-act="addset" data-id="' + esc(id) + '" data-base="' + base + "." + n + '">Ajouter une série</button></div>';
}
function bodyMuscu(date, def, w, s, id) {
  var h = "";
  if (s.arret && s.arret.motif) h += '<div class="note warn"><b>Séance terminée plus tôt</b> (' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + "). Les exercices non notés comptent comme non faits.</div>";
  h += checkin(s, id);
  var r = readiness(s.checkin), light = r && r.level === "stop";
  h += '<div class="hr"></div><div class="section"><h3>Exercices</h3><p class="small muted">Note pour chaque série la charge, les répétitions faites et ton RIR ressenti (répétitions que tu aurais encore pu faire). « = prévu » remplit la série avec la cible.</p></div>';
  def.ex.forEach(function (e) {
    var p = presc(e, w); if (!p) return;
    var sg = suggestion(e, p, date), planned = Math.max(1, p.sets - (light ? 1 : 0));
    var rows = (s.sets && s.sets[e.id]) || {}, has = rowsOk(rows).length > 0, n = Math.max(planned, keysOf(rows).length);
    var rirT = light ? p.rirN + 1 : p.rirN, mod = (s.mods || {})[e.id];
    var tag = mod ? (mod.statut === "saute" ? '<span class="state warn">Sauté</span>' : '<span class="state alt">Remplacé</span>') : (e.ss ? '<span class="ss">' + esc(e.ss) + "</span>" : "");
    h += '<div class="ex"><div class="ex-title"><h3><span class="ex-code">' + esc(e.id) + "</span>" + esc(e.name) + "</h3>" + tag + "</div>";
    h += '<div class="stats"><div class="stat"><b>' + planned + " × " + esc(p.reps) + '</b><span>séries × reps</span></div>' +
      (p.load ? '<div class="stat"><b>' + esc(p.load) + '</b><span>charge prévue</span></div>' : "") +
      '<div class="stat"><b>' + esc(light ? fmt(rirT) : p.rir) + '</b><span>RIR visé</span></div>' +
      '<div class="stat"><b>' + esc(e.rest) + '</b><span>repos</span></div></div>';
    if (!mod) {
      h += sg ? '<p class="advice">Charge conseillée : ' + esc(loadLabel(e, sg.load)) + ' <span class="muted">(' + esc(sg.src) + ")</span></p>" : '<p class="advice">Choisis la charge au RIR visé, puis note-la.</p>';
      if (e.note) h += '<p class="small muted">' + esc(e.note) + "</p>";
      h += setRows(id, "sets." + e.id, rows, n, { head: e.bw ? "Lest (kg)" : "Charge (kg)", load: sg ? sg.load : null, reps: p.repsN, rir: rirT });
      h += '<div><button type="button" class="btn small quiet" data-act="modopen" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '">Sauté ou remplacé</button></div>';
    } else {
      h += modPanel(e, p, s, id, mod, planned, rirT, date);
      if (has) h += '<p class="small muted">Séries faites avant le changement :</p>' + setRows(id, "sets." + e.id, rows, keysOf(rows).length, { head: e.bw ? "Lest (kg)" : "Charge (kg)", load: sg ? sg.load : null, reps: p.repsN, rir: rirT });
    }
    h += "</div>";
  });
  h += '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true);
  return h;
}
function modPanel(e, p, s, id, mod, planned, rirT, date) {
  var h = '<div class="panel">';
  h += '<div class="scale"><div class="scale-q"><span>Que s\'est-il passé ?</span></div>' + seg("seances", id, "mods." + e.id + ".statut", [{ v: "remplace", l: "Remplacé par un autre" }, { v: "saute", l: "Sauté" }], mod.statut) + "</div>";
  h += '<div class="scale"><div class="scale-q"><span>Pourquoi ?</span></div>' + seg("seances", id, "mods." + e.id + ".motif", MOTIFS_EX, mod.motif) + "</div>";
  if (mod.motif === "douleur") h += '<div class="scale"><div class="scale-q"><span>Où ?</span></div>' + zones(id, "mods." + e.id + ".zone", mod.zone) + "</div>";
  if (mod.motif === "autre") h += '<label class="field"><span>Précise</span>' + inp("seances", id, "mods." + e.id + ".precision", mod.precision, "") + "</label>";
  if (mod.statut === "remplace") {
    var rp = (s.remp || {})[e.id] || {}, alts = e.alt || [];
    if (alts.length) h += '<div class="scale"><div class="scale-q"><span>Exercice de remplacement</span></div>' + seg("seances", id, "remp." + e.id + ".nom", alts, rp.nom) + "</div>";
    h += '<label class="field"><span>' + (alts.length ? "Ou écris son nom" : "Exercice de remplacement") + "</span>" + inp("seances", id, "remp." + e.id + ".nom", alts.indexOf(rp.nom) >= 0 ? "" : rp.nom, 'placeholder="Nom de l\'exercice"') + "</label>";
    if (rp.nom) {
      var last = lastRemp(rp.nom, date), load = last ? targetFrom(last, p, e.step || 2.5, 0, 0) : null, rows = rp.sets || {};
      h += '<p class="advice">' + (last ? "Charge conseillée : " + esc(fmt(load)) + ' kg <span class="muted">(dernière fois le ' + esc(fmtShort(last.date)) + ")</span>" : "Première fois sur cet exercice : choisis la charge au RIR visé, même nombre de séries et de reps.") + "</p>";
      h += setRows(id, "remp." + e.id + ".sets", rows, Math.max(planned, keysOf(rows).length), { head: "Charge (kg)", load: load, reps: p.repsN, rir: rirT });
      h += '<p class="small muted">Ces séries sont gardées à part : elles ne changent pas les charges conseillées de « ' + esc(e.name) + " ».</p>";
    }
  }
  return h + '<div><button type="button" class="btn small quiet" data-act="modclose" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '">Annuler, exercice fait normalement</button></div></div>';
}
function arretBlock(s, id) {
  var a = s.arret;
  if (!a) return '<div><button type="button" class="btn" data-act="arretopen" data-id="' + esc(id) + '">Séance terminée plus tôt</button></div>';
  var h = '<div class="panel"><h3>Séance terminée plus tôt</h3><div class="scale"><div class="scale-q"><span>Pourquoi ?</span></div>' + seg("seances", id, "arret.motif", MOTIFS_ARRET, a.motif) + "</div>";
  if (a.motif === "douleur") {
    h += '<div class="scale"><div class="scale-q"><span>Où ?</span></div>' + zones(id, "arret.zone", a.zone) + "</div>";
    h += scaleQ(id, "arret.intensite", "Intensité de la douleur", "gêne", "très forte", a.intensite, 10);
  }
  h += '<label class="field"><span>Précision (facultatif)</span>' + inp("seances", id, "arret.note", a.note, 'placeholder="ex. réunion avancée, salle fermée plus tôt"') + "</label>";
  if (a.motif === "temps" || a.motif === "imprevu") h += '<p class="small muted">Aucune conséquence sur la suite : les charges conseillées restent calculées sur les séries faites.</p>';
  return h + '<div><button type="button" class="btn small quiet" data-act="arretclose" data-id="' + esc(id) + '">Annuler, séance finie normalement</button></div></div>';
}
function bilan(s, id, full) {
  var b = s.bilan || {}, h = '<div class="section"><h3>' + (full ? "Après la séance" : "Bilan") + "</h3>";
  if (full) h += scaleQ(id, "bilan.rpe", "Difficulté globale de la séance", "très facile", "maximale", b.rpe, 10);
  h += '<div class="scale"><div class="scale-q"><span>Douleurs (pas les courbatures)</span></div>' + zones(id, "bilan.douleurs", b.douleurs) + "</div>";
  h += '<label class="field"><span>Remarques</span>' + txt("seances", id, "bilan.note", b.note, "Facultatif : sensations, exercice à changer, machine prise…") + "</label>";
  return h + "</div>";
}
function paceStr(kmh) { var m = 60 / kmh, mm = Math.floor(m), ss = Math.round((m - mm) * 60); if (ss === 60) { mm++; ss = 0; } return mm + ":" + pad(ss); }
function bodyCourse(date, def, w, s, id) {
  var plan = def.plan[w - 1] || def.plan[def.plan.length - 1], h = "";
  if (s.arret && s.arret.motif) h += '<div class="note warn"><b>Séance terminée plus tôt</b> (' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + ").</div>";
  h += '<div class="note info">' + esc(plan.texte) + "</div>";
  if (def.consignes) h += '<p class="small muted">' + esc(def.consignes) + "</p>";
  h += checkin(s, id) + '<div class="hr"></div>';
  if (plan.test) {
    var dist = toNum(s.distanceTest);
    h += '<label class="field"><span>Distance parcourue en 6 minutes (m)</span>' + inp("seances", id, "distanceTest", s.distanceTest, 'inputmode="numeric" placeholder="ex. 1450"') + "</label>";
    if (dist) h += '<div class="note ok">VMA estimée : <b class="num">' + fmt(dist / 100, 1) + " km/h</b>, soit " + paceStr(dist / 100) + " au kilomètre.</div>";
  } else {
    h += '<div class="row"><label class="field grow"><span>Durée totale (min)</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric"') + '</label><label class="field grow"><span>Distance (km)</span>' + inp("seances", id, "distance", s.distance, 'inputmode="decimal"') + "</label></div>";
    h += '<div class="scale"><div class="scale-q"><span>Allures tenues ?</span></div>' + seg("seances", id, "allures", ["Oui", "À peu près", "Non"], s.allures) + "</div>";
  }
  return h + arretBlock(s, id) + bilan(s, id, true);
}
function bodySport(def, s, id) {
  var h = '<p class="small muted">Après la séance, note son intensité : elle sert à doser la séance du lendemain.</p>';
  h += '<div class="scale"><div class="scale-q"><span>Intensité de la séance</span></div>' + seg("seances", id, "intensite", ["Légère", "Normale", "Très dure"], s.intensite) + "</div>";
  h += '<label class="field"><span>Minutes de combat ou de travail intense</span>' + inp("seances", id, "combats", s.combats, 'inputmode="numeric" placeholder="ex. 25"') + "</label>";
  return h + bilan(s, id, false);
}
function bodyRepos(def, s, id) {
  return '<p class="small muted">' + esc(def.texte || "Journée de récupération.") + '</p><label class="field"><span>Footing fait (minutes)</span>' + inp("seances", id, "footing", s.footing, 'inputmode="numeric" placeholder="Laisse vide si repos complet"') + "</label>";
}
function bodyTests(def, s, id) {
  var t = s.tests || {}, h = '<p class="small muted">' + esc(def.consignes || "") + "</p>";
  (def.items || []).forEach(function (it) {
    var v = toNum(t[it.k]), res = "";
    if (v) res = it.type === "e1rm" ? "1RM estimé : " + fmt(e1rm(v, it.reps, it.rir)) + " kg" : v + " répétitions" + (it.avant ? " (avant le bloc : " + it.avant + ")" : "");
    h += '<label class="field"><span>' + esc(it.label) + "</span>" + inp("seances", id, "tests." + it.k, t[it.k], 'inputmode="decimal"') + (res ? '<span class="advice">' + esc(res) + "</span>" : "") + "</label>";
  });
  return h + '<div class="hr"></div>' + bodyMensu(s, id);
}
function bodyMensu(s, id) {
  var m = s.mensu || {};
  return '<p class="small muted">Le matin, à jeun. Photos de face, de profil et de dos, avec la même lumière à chaque fois.</p><div class="row end">' +
    MESURES.map(function (f) {
      return '<label class="field grow"><span>' + esc(f[1]) + " (cm)</span>" + inp("seances", id, "mensu." + f[0], m[f[0]], 'inputmode="decimal"') + "</label>";
    }).join("") + "</div>";
}

/* ---------- Semaine ---------- */
function viewSemaine() {
  var w = S.week, mon = mondayOf(w), wd = weekDoc(w) || {}, id = weekDocId(w), h = "";
  h += '<div class="daynav"><button type="button" class="btn small" data-act="week" data-d="-1"' + (w <= 1 ? " disabled" : "") + ' aria-label="Semaine précédente">Précédente</button><h1>Semaine ' + w + '</h1><button type="button" class="btn small" data-act="week" data-d="1"' + (w >= P.semaines ? " disabled" : "") + ' aria-label="Semaine suivante">Suivante</button></div>';
  h += '<p class="small muted">Du ' + esc(fmtLong(mon)) + " au " + esc(fmtLong(addDays(mon, 6))) + (P.deload && P.deload.indexOf(w) >= 0 ? ", semaine de décharge" : "") + ".</p>";
  var cur = weekAvgWeight(w), prev = w > 1 ? weekAvgWeight(w - 1) : null, sports = valuesOf(D.seances).filter(function (s) { return s.programme === P.id && s.semaine === w && s.intensite; });
  var sheet = '<div class="sheet">';
  if (versionKeys().length > 1) sheet += '<div class="scale"><div class="scale-q"><span>Organisation de la semaine</span></div>' + seg("semaines", id, "version", versionKeys().map(function (k) { return { v: k, l: P.versions[k].label }; }), wd.version) + "</div>";
  sheet += '<div class="kpis"><div class="kpi"><b>' + fmt(cur, 2) + '</b><span>poids moyen (kg)</span></div><div class="kpi"><b>' + (cur && prev ? (cur - prev >= 0 ? "+" : "") + fmt(cur - prev, 2) : "–") + "</b><span>" + esc(P.poidsCibleTexte || "écart avec la semaine d'avant") + '</span></div><div class="kpi"><b>' + doneCount(w) + "</b><span>séances notées</span></div></div>";
  if (sports.length) sheet += '<p class="small muted">Intensité des séances de ' + esc((P.sessions.SAMBO && P.sessions.SAMBO.name || "sport").toLowerCase()) + " : " + esc(sports.map(function (s) { return s.intensite.toLowerCase(); }).join(", ")) + ".</p>";
  h += sheet + '</div><div class="sheet"><div class="weeklist">';
  for (var i = 0; i < 7; i++) {
    var d = addDays(mon, i), types = plannedFor(d), done = dayDone(d);
    var label = types === null ? "Selon l'organisation de la semaine" : types.length ? types.map(function (t) { return P.sessions[t].short || P.sessions[t].name; }).join(" et ") : "Rien de prévu";
    h += '<button type="button" class="wrow' + (d === todayStr() ? " today" : "") + '" data-act="goto" data-date="' + d + '"><span class="d">' + esc(fmtDayName(d)) + " " + parse(d).getDate() + "</span><span>" + esc(label) + '</span><span class="tick' + (done ? " done" : "") + '" aria-label="' + (done ? "fait" : "à faire") + '"></span></button>';
  }
  h += "</div></div>";
  h += '<section class="sheet"><h2>Bilan de la semaine</h2>';
  h += '<div class="scale"><div class="scale-q"><span>Fatigue générale</span><span class="ends">1 en forme, 10 épuisé</span></div>' + seg("semaines", id, "fatigue", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], wd.fatigue, true) + "</div>";
  h += '<label class="field"><span>Sommeil moyen par nuit (heures)</span>' + inp("semaines", id, "sommeil", wd.sommeil, 'inputmode="decimal" placeholder="ex. 7,5"') + "</label>";
  h += '<label class="field"><span>Douleurs, même légères</span>' + txt("semaines", id, "douleurs", wd.douleurs, "Épaules, genoux, coudes, cou…") + "</label>";
  h += '<label class="field"><span>Exercices aimés, détestés ou machines indisponibles</span>' + txt("semaines", id, "exercices", wd.exercices, "Facultatif") + "</label></section>";
  h += claudeSheet("semaine");
  return h;
}
function doneCount(w) { return valuesOf(D.seances).filter(function (s) { return s.programme === P.id && s.semaine === w && s.type !== "REPOS" && hasData(s); }).length; }

/* ---------- Progrès ---------- */
function viewProgres() {
  var h = '<h1>Progrès</h1>';
  var weights = valuesOf(D.pesees).filter(function (p) { return toNum(p.kg); }).map(function (p) { return { x: p.date, y: toNum(p.kg) }; }).sort(function (a, b) { return a.x < b.x ? -1 : 1; });
  var avgs = []; for (var w = 1; w <= P.semaines; w++) { var a = weekAvgWeight(w); if (a) avgs.push({ x: addDays(mondayOf(w), 3), y: a }); }
  h += '<section class="sheet"><h2>Poids</h2>' + (weights.length ? chart([{ pts: weights, cls: "s-steel", dots: true, line: false, soft: true }, { pts: avgs, cls: "s-plate", dots: true, line: true }], { unit: "kg", ref: P.poidsMax ? [{ y: P.poidsMax, label: fmt(P.poidsMax) + " kg, plafond" }] : [] }) +
    '<div class="legend"><span><i class="k-steel"></i>pesées</span><span><i class="k-plate"></i>moyenne de la semaine</span></div>' : '<p class="small muted">Pas encore de pesée. Note ton poids chaque matin dans Aujourd\'hui.</p>') + "</section>";
  var tracked = [], classes = ["s-plate", "s-ink", "s-steel"], keys = ["k-plate", "k-ink", "k-steel"];
  keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { if (e.suivi && tracked.length < 3) tracked.push(e); }); });
  var series = tracked.map(function (e, i) { return { e: e, cls: classes[i], key: keys[i], pts: e1rmSeries(e) }; });
  var any = series.some(function (s) { return s.pts.length; });
  h += '<section class="sheet"><h2>Force estimée (1RM)</h2>' + (any ? chart(series.map(function (s) { return { pts: s.pts, cls: s.cls, dots: true, line: true }; }), { unit: "kg" }) +
    '<div class="legend">' + series.map(function (s) { return '<span><i class="' + s.key + '"></i>' + esc(s.e.name) + (s.pts.length ? " : " + fmt(s.pts[s.pts.length - 1].y) + " kg" : "") + "</span>"; }).join("") + "</div>" : '<p class="small muted">La courbe apparaît après ta première séance notée.</p>') +
    '<p class="tiny muted">Calcul : charge × (1 + (reps + RIR) ÷ 30), meilleure série de chaque séance. Pour les tractions et les dips, le poids de corps est compris.</p></section>';
  var list = valuesOf(D.seances).filter(hasData).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 40);
  h += mensuSheet();
  h += '<section class="sheet"><h2>Séances notées</h2><div class="log">' + (list.length ? list.map(logItem).join("") : '<p class="small muted">Aucune séance notée pour l\'instant.</p>') + "</div></section>";
  return h;
}
function mensuSeries(k) {
  var byDate = {};
  valuesOf(D.seances).forEach(function (s) { var v = s.mensu ? toNum(s.mensu[k]) : null; if (v) byDate[s.date] = v; });
  return keysOf(byDate).sort().map(function (d) { return { x: d, y: byDate[d] }; });
}
function mensuSheet() {
  var classes = ["s-plate", "s-ink", "s-steel", "s-c4"], keys = ["k-plate", "k-ink", "k-steel", "k-c4"];
  var series = MESURES.map(function (m, i) {
    var pts = mensuSeries(m[0]), base = pts.length ? pts[0].y : 0;
    return { label: m[1], cls: classes[i], key: keys[i], raw: pts, pts: pts.map(function (p) { return { x: p.x, y: p.y - base }; }) };
  });
  var any = series.some(function (s) { return s.pts.length; });
  var h = '<section class="sheet"><h2>Mensurations</h2>';
  if (!any) return h + '<p class="small muted">Aucune mesure pour l\'instant. Note tes mensurations le jour du départ, puis toutes les 2 à 4 semaines : dans Aujourd\'hui, « Ajouter une séance » puis « Mensurations ».</p></section>';
  h += '<p class="small muted">Écart en centimètres depuis ta première mesure, pour comparer les quatre tours sur la même échelle.</p>';
  h += chart(series.map(function (s) { return { pts: s.pts, cls: s.cls, dots: true, line: true }; }), { unit: "cm", ref: [{ y: 0, label: "première mesure" }] });
  h += '<div class="legend">' + series.map(function (s) {
    if (!s.raw.length) return '<span><i class="' + s.key + '"></i>' + esc(s.label) + " : pas encore mesuré</span>";
    var last = s.raw[s.raw.length - 1], d = s.pts[s.pts.length - 1].y;
    return '<span><i class="' + s.key + '"></i>' + esc(s.label) + " : " + fmt(last.y, 1) + " cm" + (s.raw.length > 1 ? " (" + (d >= 0 ? "+" : "") + fmt(d, 1) + ")" : "") + "</span>";
  }).join("") + "</div>";
  return h + '<p class="tiny muted">Mesure toujours le matin à jeun, avant l\'entraînement, au même endroit et de la même façon. Une courbe apparaît dès la deuxième mesure.</p></section>';
}
function logItem(s) {
  var def = P.sessions[s.type], r = readiness(s.checkin), b = s.bilan || {}, chips = [];
  if (r) chips.push('<span class="state ' + (r.level === "ok" ? "done" : "warn") + '">forme ' + fmt(r.avg, 1) + "</span>");
  if (b.rpe) chips.push('<span class="state">difficulté ' + b.rpe + "</span>");
  if (s.intensite) chips.push('<span class="state">' + esc(s.intensite.toLowerCase()) + "</span>");
  if (s.arret && s.arret.motif) chips.push('<span class="state warn">arrêtée, ' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + "</span>");
  if (s.mods && keysOf(s.mods).length) chips.push('<span class="state alt">' + keysOf(s.mods).length + " exercice" + (keysOf(s.mods).length > 1 ? "s" : "") + " changé" + (keysOf(s.mods).length > 1 ? "s" : "") + "</span>");
  var pains = b.douleurs ? keysOf(b.douleurs).filter(function (k) { return b.douleurs[k]; }) : [];
  return '<button type="button" class="log-item linkless" data-act="goto" data-date="' + s.date + '"><div class="row"><b>' + esc(fmtShort(s.date)) + ", " + esc(def ? def.short || def.name : s.type) + '</b><span class="row">' + chips.join("") + "</span></div>" +
    (pains.length ? '<span class="pain">Douleurs : ' + esc(pains.map(function (k) { return labelZone(k); }).join(", ")) + "</span>" : "") + (b.note ? '<span class="small muted">' + esc(b.note) + "</span>" : "") + "</button>";
}
function labelZone(k) { for (var i = 0; i < DOULEURS.length; i++) if (zk(DOULEURS[i]) === k) return DOULEURS[i].toLowerCase(); return k; }
function e1rmSeries(e) {
  return valuesOf(D.seances).filter(function (s) { return s.sets && s.sets[e.id]; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (s) {
    var bw = e.bw ? bodyweight(s.date) : 0, best = 0;
    rowsOk(s.sets[e.id]).forEach(function (r) { var rir = toNum(r.rir) !== null ? toNum(r.rir) : 2; best = Math.max(best, e1rm(toNum(r.c) + bw, toNum(r.r), rir)); });
    return best ? { x: s.date, y: best } : null;
  }).filter(Boolean);
}
function niceStep(raw) { var p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function chart(series, opt) {
  var W = 600, H = 210, L = 40, R = 14, T = 14, B = 28;
  var pts = []; series.forEach(function (s) { pts = pts.concat(s.pts); });
  var ys = pts.map(function (p) { return p.y; }).concat((opt.ref || []).map(function (r) { return r.y; }));
  var x0 = P.debut, x1 = lastDay();
  pts.forEach(function (p) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; });
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), padY = Math.max(1, (y1 - y0) * 0.15);
  y0 = Math.floor(y0 - padY); y1 = Math.ceil(y1 + padY);
  var span = diffDays(x1, x0) || 1;
  function X(x) { return L + diffDays(x, x0) / span * (W - L - R); }
  function Y(y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); }
  var g = "", step = niceStep((y1 - y0) / 4);
  for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="lbl" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + fmt(v) + "</text>";
  for (var w = 1; w <= P.semaines; w++) { var d = mondayOf(w); if (d >= x0 && d <= x1) g += '<text class="lbl" x="' + X(d) + '" y="' + (H - 8) + '" text-anchor="middle">S' + w + "</text>"; }
  (opt.ref || []).forEach(function (r) { if (r.y >= y0 && r.y <= y1) g += '<line class="ref" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(r.y) + '" y2="' + Y(r.y) + '"/><text class="lbl" x="' + (W - R) + '" y="' + (Y(r.y) - 6) + '" text-anchor="end">' + esc(r.label) + "</text>"; });
  series.forEach(function (s) {
    if (s.line && s.pts.length > 1) g += '<polyline class="' + s.cls + '" points="' + s.pts.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" ") + '"/>';
    if (s.dots) s.pts.forEach(function (p, i) { var last = s.line && i === s.pts.length - 1; g += '<circle class="' + s.cls + (s.soft ? " soft" : "") + '" stroke-width="0" cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (last ? 5 : s.line ? 3 : 2.6) + '"><title>' + esc(fmtShort(p.x) + " : " + fmt(p.y, 1) + " " + opt.unit) + "</title></circle>"; });
  });
  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Évolution en ' + opt.unit + '">' + g + "</svg>";
}

/* ---------- Réglages ---------- */
function viewReglages() {
  var h = "<h1>Réglages</h1>";
  h += '<section class="sheet"><h2>Mon programme</h2><p class="small">' + esc(P.athlete ? P.athlete + ", " : "") + esc(P.titre || "") + ", du " + esc(fmtLong(P.debut)) + " au " + esc(fmtLong(lastDay())) + ".</p>";
  if (D.liens[P.id]) h += '<div class="row"><button type="button" class="btn" data-act="copylink">Copier mon lien personnel</button></div><p class="small muted">Utile pour installer le programme dans l\'application d\'écran d\'accueil, ou sur un autre téléphone. Ne le partage pas : il contient ton programme.</p>';
  var others = keysOf(D.programmes).filter(function (k) { return k !== P.id; });
  if (others.length) h += '<div class="scale"><div class="scale-q"><span>Autres programmes sur ce téléphone</span></div><div class="row">' + others.map(function (k) { return '<button type="button" class="btn small" data-act="switchprog" data-id="' + esc(k) + '">' + esc(D.programmes[k].titre || k) + "</button>"; }).join("") + "</div></div>";
  h += '<label class="field" for="code-in"><span>Nouveau programme envoyé par ton coach : colle le lien</span><textarea id="code-in" placeholder="https://…#p=1.…"></textarea></label><div class="row"><button type="button" class="btn" data-act="paste-install">Installer ce programme</button></div><p class="small muted">Tes séances déjà notées sont conservées.</p></section>';
  h += '<section class="sheet"><h2>Sauvegarde</h2><p class="small">Tes données ne sont que sur ce téléphone. Exporte une sauvegarde régulièrement, par exemple chaque dimanche, et garde-la dans Fichiers ou envoie-la-toi.</p>' +
    '<div class="row"><button type="button" class="btn primary" data-act="export">Exporter mes données</button></div>' +
    '<label class="field" for="file-prog"><span>Restaurer une sauvegarde ou importer un fichier de programme</span><input type="file" id="file-prog" accept=".json,application/json" data-act="import-file"></label></section>';
  h += installHelp();
  h += privacyNote();
  h += '<section class="sheet"><h2>Tout effacer</h2><p class="small">Supprime le programme et toutes les données de ce téléphone. Exporte une sauvegarde avant si tu veux les garder.</p><div><button type="button" class="btn danger" data-act="wipe">Effacer toutes mes données</button></div></section>';
  h += '<p class="tiny muted">Version ' + APP_VERSION + (isStandalone ? ", application installée" : "") + ".</p>";
  return h;
}

/* ================= Claude (sans API) ================= */
function claudeSheet(where) {
  var h = '<section class="sheet"><h2>Demander à Claude</h2><p class="small muted">Le carnet prépare un texte avec ton programme, tes 3 dernières semaines et ta question. Il le copie, puis ouvre Claude : colle-le si la question n\'apparaît pas. Il faut un compte Claude, même gratuit. Rien n\'est envoyé sans que tu le colles toi-même.</p><div class="row">' +
    (where === "jour" ? '<button type="button" class="btn primary" data-act="ask" data-q="jour">Ajuster ma séance du jour</button>' : "") +
    '<button type="button" class="btn ' + (where === "jour" ? "" : "primary") + '" data-act="ask" data-q="semaine">Analyser ma semaine</button></div>' +
    '<label class="field" for="claude-q"><span>Ou pose ta propre question</span><textarea id="claude-q" placeholder="ex. J\'ai mal au coude droit sur les tractions, que faire ?"></textarea></label><div><button type="button" class="btn" data-act="ask" data-q="libre">Préparer ma question</button></div>';
  if (S.prompt) h += '<details><summary class="small">Voir le texte copié</summary><textarea class="prompt-box" readonly>' + esc(S.prompt) + "</textarea></details>";
  return h + "</section>";
}
function summarize(s) {
  var def = P.sessions[s.type], parts = [fmtShort(s.date) + " " + (def ? def.short || def.name : s.type)];
  var r = readiness(s.checkin); if (r) parts.push("forme " + fmt(r.avg, 1) + "/5 (" + CHECK.map(function (q) { return q.k + " " + s.checkin[q.k]; }).join(", ") + ")");
  keysOf(s.sets).forEach(function (k) { var rows = valuesOf(s.sets[k]).filter(function (x) { return toNum(x.c) !== null || toNum(x.r); }); if (rows.length) parts.push(k + " : " + rows.map(function (x) { return (x.c !== undefined ? x.c : "?") + "×" + (x.r || "?") + "@" + (x.rir !== undefined ? x.rir : "?"); }).join(", ")); });
  keysOf(s.mods).forEach(function (k) {
    var m = s.mods[k], rp = s.remp && s.remp[k], t = k + (m.statut === "saute" ? " sauté" : " remplacé" + (rp && rp.nom ? " par " + rp.nom : ""));
    if (m.motif) t += " (" + motifLabel(MOTIFS_EX, m.motif) + (m.zone ? " : " + keysOf(m.zone).map(labelZone).join("/") : "") + (m.precision ? ", " + m.precision : "") + ")";
    if (rp && rp.sets) { var rr = rowsOk(rp.sets); if (rr.length) t += " : " + rr.map(function (x) { return x.c + "×" + x.r + "@" + (x.rir !== undefined ? x.rir : "?"); }).join(", "); }
    parts.push(t);
  });
  if (s.arret && s.arret.motif) parts.push("séance terminée plus tôt : " + motifLabel(MOTIFS_ARRET, s.arret.motif) + (s.arret.zone ? " (" + keysOf(s.arret.zone).map(labelZone).join("/") + ")" : "") + (s.arret.intensite ? ", douleur " + s.arret.intensite + "/10" : "") + (s.arret.note ? ", " + s.arret.note : ""));
  if (s.intensite) parts.push("intensité " + s.intensite.toLowerCase() + (s.combats ? ", " + s.combats + " min de combat" : ""));
  if (s.duree) parts.push(s.duree + " min" + (s.distance ? ", " + s.distance + " km" : "") + (s.allures ? ", allures tenues : " + s.allures.toLowerCase() : ""));
  if (s.distanceTest) parts.push("test 6 min : " + s.distanceTest + " m");
  if (s.footing) parts.push("footing " + s.footing + " min");
  if (s.tests) parts.push("tests " + JSON.stringify(s.tests));
  if (s.mensu) parts.push("mensurations " + JSON.stringify(s.mensu));
  var b = s.bilan || {};
  if (b.rpe) parts.push("difficulté " + b.rpe + "/10");
  if (b.douleurs) { var dl = keysOf(b.douleurs).filter(function (k) { return b.douleurs[k]; }); if (dl.length) parts.push("douleurs : " + dl.map(labelZone).join(", ")); }
  if (b.note) parts.push("note : " + b.note);
  return "- " + parts.join(" ; ");
}
function planText(date) {
  var w = weekOf(date), types = plannedFor(date) || [];
  return types.map(function (t) {
    var def = P.sessions[t];
    if (def.kind === "muscu") return def.name + " :\n" + def.ex.map(function (e) { var p = presc(e, w); if (!p) return null; var sg = suggestion(e, p, date); return "  " + e.id + " " + e.name + " : " + p.sets + "×" + p.reps + (p.load ? ", " + p.load : "") + ", RIR " + p.rir + (sg ? " (charge conseillée " + loadLabel(e, sg.load) + ")" : ""); }).filter(Boolean).join("\n");
    if (def.kind === "course") return def.name + " : " + (def.plan[w - 1] || def.plan[def.plan.length - 1]).texte;
    return def.name;
  }).join("\n") || "Rien de prévu.";
}
function buildPrompt(kind, question) {
  var date = S.date, w = weekOf(date), from = addDays(date, -21);
  var hist = valuesOf(D.seances).filter(function (s) { return s.date >= from && s.date <= date && (hasData(s) || s.checkin); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(summarize).join("\n") || "Aucune séance notée.";
  var pes = valuesOf(D.pesees).filter(function (p) { return p.date >= from && toNum(p.kg); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (p) { return fmtShort(p.date) + " " + p.kg + " kg"; }).join(", ") || "aucune";
  var avgs = []; for (var x = 1; x <= P.semaines; x++) { var a = weekAvgWeight(x); if (a) avgs.push("S" + x + " " + fmt(a, 2) + " kg"); }
  var bilans = valuesOf(D.semaines).filter(function (b) { return b.programme === P.id; }).map(function (b) { return "S" + b.semaine + (b.version ? ", " + P.versions[b.version].label.toLowerCase() : "") + (b.fatigue ? ", fatigue " + b.fatigue + "/10" : "") + (b.sommeil ? ", sommeil " + b.sommeil + " h" : "") + (b.douleurs ? ", douleurs : " + b.douleurs : "") + (b.exercices ? ", exercices : " + b.exercices : ""); }).join("\n") || "aucun";
  var ask = kind === "jour" ? "Propose des ajustements concrets pour la séance prévue aujourd'hui (charges en kg, nombre de séries, RIR, exercice à remplacer si besoin), en tenant compte de mon check-in du jour, de mes dernières séances et de mon activité sportive récente."
    : kind === "semaine" ? "Fais le bilan de ma semaine " + w + " (progression des charges, forme, poids par rapport à l'objectif, douleurs) et propose 2 ou 3 ajustements précis pour la semaine suivante."
    : "Réponds à ma question : « " + question + " »";
  return "Tu es mon préparateur physique. Réponds en français, en me tutoyant.\n\nMON PROGRAMME ET SES RÈGLES\n" + (P.contexte || "") +
    "\n\nAUJOURD'HUI : " + fmtLong(date) + ", " + weekLabel(date).toLowerCase() + ".\nSéance prévue :\n" + planText(date) +
    "\n\nMES SÉANCES DES 21 DERNIERS JOURS (exercice : charge×reps@RIR ; pour les tractions et les dips, la charge est le lest)\n" + hist +
    "\n\nPESÉES : " + pes + "\nMOYENNES PAR SEMAINE : " + (avgs.join(", ") || "aucune") + "\nBILANS DE SEMAINE :\n" + bilans +
    "\n\nMA DEMANDE\n" + ask +
    "\n\nFORMAT : 180 mots maximum, phrases courtes ou puces, chiffres précis. Reste dans la logique du programme sans le réécrire. S'il manque des données, dis lesquelles noter. Une séance arrêtée pour manque de temps ou imprévu, ou un exercice remplacé faute de matériel, ne signale pas une baisse de forme. Pas de diagnostic médical : une douleur qui dure ou augmente se montre à un professionnel de santé. Si tu proposes de modifier le programme, rappelle en une ligne que mon coach valide les changements.";
}
function copyText(t) {
  function fallback() {
    var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (err) {} document.body.removeChild(ta); return ok;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
  return Promise.resolve(fallback());
}
function ask(kind) {
  var q = document.getElementById("claude-q"), question = q ? q.value.trim() : "";
  if (kind === "libre" && !question) { toast("Écris d'abord ta question."); if (q) q.focus(); return; }
  var text = buildPrompt(kind, question);
  S.prompt = text;
  var url = text.length <= 1800 ? "https://claude.ai/new?q=" + encodeURIComponent(text) : "https://claude.ai/new";
  copyText(text).then(function (ok) { toast(ok ? "Texte copié. Colle-le dans Claude s'il n'apparaît pas." : "Copie impossible : ouvre « Voir le texte copié » et copie-le à la main."); });
  var win = null; try { win = window.open(url, "_blank", "noopener"); } catch (err) {}
  if (!win) { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click(); a.remove(); }
  render();
}

/* ================= Export / import ================= */
function exportData() {
  persistNow();
  var payload = JSON.stringify({ format: "carnet-muscu-export", v: 1, exporte: new Date().toISOString(), data: D }, null, 1);
  var name = "carnet-musculation-" + todayStr() + ".json", blob = new Blob([payload], { type: "application/json" });
  var file = null; try { file = new File([blob], name, { type: "application/json" }); } catch (err) {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Sauvegarde du carnet" }).then(function () { toast("Sauvegarde exportée."); }, function () {});
    return;
  }
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  toast("Sauvegarde téléchargée : " + name);
}
function importFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var obj; try { obj = JSON.parse(reader.result); } catch (err) { toast("Ce fichier n'est pas lisible."); return; }
    if (obj && obj.format === "carnet-muscu-export" && obj.data) {
      dialog("Restaurer cette sauvegarde ?", '<p class="small">Sauvegarde du ' + esc(new Date(obj.exporte).toLocaleDateString("fr-FR")) + '. Elle remplace toutes les données actuelles de ce téléphone.</p>', [
        { label: "Restaurer", cls: "primary", run: function () { D = normalize(obj.data); persistNow(); setActive(); if (P) { S.date = initialDate(); S.week = clampWeek(weekOf(S.date)); } S.view = "jour"; render(); toast("Sauvegarde restaurée."); } },
        { label: "Annuler" }]);
      return;
    }
    try { var p = validateProgram(obj.programme || obj); confirmInstall(p, null); } catch (err) { toast(err.message); }
  };
  reader.readAsText(file);
}
function confirmInstall(p, link) {
  var body = '<p class="small">' + esc((p.athlete ? p.athlete + ", " : "") + (p.titre || "Programme")) + ", du " + esc(fmtLongFrom(p.debut)) + " pendant " + p.semaines + " semaines.</p>" +
    (D.programmes[p.id] ? '<p class="small muted">Ce programme est déjà installé : il sera mis à jour. Tes séances notées sont conservées.</p>' : '<p class="small muted">Tes éventuelles séances déjà notées sont conservées.</p>');
  dialog("Installer ce programme ?", body, [{ label: "Installer", cls: "primary", run: function () { installProgram(p, link); } }, { label: "Annuler" }]);
}
function fmtLongFrom(s) { return parse(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }
function tryInstallFromText(text, link) {
  var code = extractCode(text);
  if (!code) { toast("Lien non reconnu. Copie le lien complet envoyé par ton coach."); return; }
  decodeProgram(code).then(function (p) { confirmInstall(p, link || ("" + location.origin + location.pathname + "#p=" + code)); }, function (err) { toast(err.message); });
}

/* ================= Événements ================= */
document.getElementById("tabs").addEventListener("click", function (ev) {
  var b = ev.target.closest(".tab"); if (!b) return;
  S.view = b.dataset.view; if (S.view === "semaine") S.week = clampWeek(weekOf(S.date));
  render(); window.scrollTo(0, 0);
});
document.getElementById("masthead").addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-act='gotoweek']"); if (!b) return;
  S.week = Number(b.dataset.w); S.view = "semaine"; render(); window.scrollTo(0, 0);
});
function docFor(col, id) {
  if (col === "seances") { var i = id.lastIndexOf("_"); return seance(id.slice(0, i), id.slice(i + 1), true); }
  if (col === "semaines") { var w = Number(id.split("-S").pop()); return weekDoc(w, true); }
  if (col === "pesees") { if (!D.pesees[id]) D.pesees[id] = { date: id }; return D.pesees[id]; }
  return null;
}
app.addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-act]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  var a = b.dataset.act, doc;
  switch (a) {
    case "goto": S.date = b.dataset.date; S.view = "jour"; S.prompt = ""; render(); if (b.classList.contains("wrow") || b.classList.contains("log-item")) window.scrollTo(0, 0); break;
    case "today": S.date = initialDate(); S.prompt = ""; render(); break;
    case "view": S.view = b.dataset.v; D.astuceVue = true; persist(); render(); window.scrollTo(0, 0); break;
    case "week": S.week = clampWeek(S.week + Number(b.dataset.d)); render(); break;
    case "version": doc = weekDoc(Number(b.dataset.w), true); doc.version = b.dataset.v; persist(); render(); break;
    case "seg":
      doc = docFor(b.dataset.col, b.dataset.id); var cur = getPath(doc, b.dataset.path), v = b.dataset.v;
      if (/^\d+$/.test(v)) v = Number(v);
      setPath(doc, b.dataset.path, String(cur) === String(v) ? null : v); persist(); render(); break;
    case "toggle": doc = docFor(b.dataset.col, b.dataset.id); setPath(doc, b.dataset.path, getPath(doc, b.dataset.path) ? null : true); persist(); render(); break;
    case "fill":
      doc = docFor("seances", b.dataset.id);
      if (b.dataset.c !== "") setPath(doc, b.dataset.base + "c", Number(b.dataset.c));
      setPath(doc, b.dataset.base + "r", Number(b.dataset.r)); setPath(doc, b.dataset.base + "rir", Number(b.dataset.rir)); persist(); render(); break;
    case "addset": doc = docFor("seances", b.dataset.id); setPath(doc, b.dataset.base, { c: "" }); render(); break;
    case "modopen": doc = docFor("seances", b.dataset.id); setPath(doc, "mods." + b.dataset.ex, { statut: "remplace" }); persist(); render(); break;
    case "modclose": doc = docFor("seances", b.dataset.id); setPath(doc, "mods." + b.dataset.ex, null); setPath(doc, "remp." + b.dataset.ex, null); persist(); render(); break;
    case "arretopen": doc = docFor("seances", b.dataset.id); doc.arret = { ouvert: true }; persist(); render(); break;
    case "arretclose": doc = docFor("seances", b.dataset.id); delete doc.arret; persist(); render(); break;
    case "ask": ask(b.dataset.q); break;
    case "export": exportData(); break;
    case "copylink": copyText(D.liens[P.id]).then(function (ok) { toast(ok ? "Lien copié." : "Copie impossible sur ce navigateur."); }); break;
    case "paste-install": var ta = document.getElementById("code-in"); tryInstallFromText(ta ? ta.value : ""); break;
    case "switchprog": D.actif = b.dataset.id; persistNow(); setActive(); S.date = initialDate(); S.week = clampWeek(weekOf(S.date)); S.view = "jour"; render(); break;
    case "wipe":
      dialog("Effacer toutes les données ?", '<p class="small">Le programme, les séances, les pesées et les bilans de ce téléphone seront supprimés. Cette action est définitive.</p>', [
        { label: "Effacer", cls: "danger", run: function () { D = emptyData(); try { localStorage.removeItem(KEY); } catch (err) {} setActive(); S.view = "jour"; render(); toast("Données effacées."); } },
        { label: "Annuler", cls: "primary" }]);
      break;
    case "update": if (swReg && swReg.waiting) swReg.waiting.postMessage("skipWaiting"); break;
  }
});
app.addEventListener("change", function (ev) {
  var el = ev.target;
  if (el.dataset.act === "add" && el.value) { var s = seance(S.date, el.value, true); s.ajoutee = true; persist(); render(); return; }
  if (el.dataset.act === "import-file" && el.files && el.files[0]) { importFile(el.files[0]); el.value = ""; return; }
  if (el.dataset.path && /\.nom$/.test(el.dataset.path)) render();
});
var NUMERIC = /\.(c|r|rir)$|^kg$|^duree$|^distance$|^distanceTest$|^combats$|^footing$|^sommeil$|^tests\.|^mensu\./;
app.addEventListener("input", function (ev) {
  var el = ev.target; if (!el.dataset || !el.dataset.path) return;
  var doc = docFor(el.dataset.col, el.dataset.id); if (!doc) return;
  var v = el.value.trim();
  setPath(doc, el.dataset.path, NUMERIC.test(el.dataset.path) ? (v === "" ? null : (toNum(v) !== null ? toNum(v) : v)) : v);
  persist();
});

/* ================= Mode hors ligne ================= */
var swReg = null;
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").then(function (reg) {
    swReg = reg;
    function watch(w) { w.addEventListener("statechange", function () { if (w.state === "installed" && navigator.serviceWorker.controller) { S.updateReady = true; render(); } }); }
    if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = true; render(); }
    reg.addEventListener("updatefound", function () { if (reg.installing) watch(reg.installing); });
  }).catch(function () {});
  var reloading = false, hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading || !hadController) { hadController = true; return; }
    reloading = true; persistNow(); location.reload();
  });
}

/* ================= Démarrage ================= */
render();
var startCode = extractCode(location.hash);
if (startCode) {
  var link = location.href;
  history.replaceState(null, "", location.pathname + location.search);
  decodeProgram(startCode).then(function (p) { confirmInstall(p, link); }, function (err) { toast(err.message); });
}
})();
