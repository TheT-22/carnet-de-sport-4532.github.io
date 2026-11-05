/* Carnet de musculation
   Toutes les données restent dans le stockage local du téléphone (localStorage).
   Le programme de l'athlète arrive par son lien personnel (#p=...) : la partie après « # »
   n'est jamais envoyée au serveur. L'application ne fait aucune requête réseau vers l'extérieur
   (voir la Content-Security-Policy dans index.html). */
(function () {
"use strict";

var APP_VERSION = "1.10.0";
var KEY = "carnet-muscu:v1";

/* ================= Stockage local ================= */
function emptyData() { return { v: 1, actif: null, programmes: {}, liens: {}, seances: {}, pesees: {}, semaines: {}, vue: {}, profil: {}, brouillons: {} }; }
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
  try { localStorage.setItem(KEY, JSON.stringify(D)); storageOK = true; setSaved("Enregistré"); }
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
var BUILTIN = { MENSU: { kind: "mensu", name: "Mensurations", short: "Mensurations" } };
function sessionDef(t) { var C = compProg(); return (P && P.sessions[t]) || BUILTIN[t] || (C && C.sessions[t]) || null; }
function sessionName(t, date) { var d = sessionDef(t); return t === "MENSU" && (!P || date !== P.debut) ? "Mensurations" : d ? d.name : t; }
setActive();

/* Séance libre (hors salle) : exercices courants, les mêmes pour tous les athlètes.
   per : charge notée pour un haltère ; bw : poids de corps (bwf : part du poids de corps comptée) ;
   time : exercice au temps (lest, durée, marge). Un exercice du programme rejoint la même courbe
   de progrès quand le programme lui donne le même code (champ « cat »). */
var CATALOGUE = [
  { g: "Poussée · pectoraux, épaules", ex: [
    { k: "dc-barre", n: "Développé couché, barre", gr: "push", mu: { pecs: 1, triceps: 0.5, epaules: 0.5 } },
    { k: "dc-halt", n: "Développé couché, haltères", per: true, gr: "push", mu: { pecs: 1, triceps: 0.5, epaules: 0.5 } },
    { k: "di-halt", n: "Développé incliné, haltères", per: true, gr: "push", mu: { pecs: 1, triceps: 0.5, epaules: 0.5 } },
    { k: "dm-barre", n: "Développé militaire, barre", gr: "push", mu: { epaules: 1, triceps: 0.5 } },
    { k: "dm-halt", n: "Développé militaire, haltères", per: true, gr: "push", mu: { epaules: 1, triceps: 0.5 } },
    { k: "dips", n: "Dips", bw: true, gr: "push", mu: { pecs: 1, triceps: 0.5, epaules: 0.5 } },
    { k: "pompes", n: "Pompes", bw: true, bwf: 0.65, gr: "push", mu: { pecs: 1, triceps: 0.5, epaules: 0.5 } },
    { k: "ecarte-poulie", n: "Écarté à la poulie", gr: "push", mu: { pecs: 1 } },
    { k: "pec-deck", n: "Pec deck", gr: "push", mu: { pecs: 1 } },
    { k: "el-lat", n: "Élévations latérales, haltères", per: true, gr: "push", mu: { epaules: 1 } },
    { k: "el-lat-poulie", n: "Élévation latérale à la poulie", gr: "push", mu: { epaules: 1 } },
    { k: "pompes-serrees", n: "Pompes serrées", bw: true, bwf: 0.65, gr: "push", mu: { triceps: 1, pecs: 0.5 } }] },
  { g: "Tirage · dos", ex: [
    { k: "tractions", n: "Tractions, pronation", bw: true, gr: "pull", mu: { dorsal: 1, biceps: 0.5 } },
    { k: "tractions-neutre", n: "Tractions, prise neutre", bw: true, gr: "pull", mu: { dorsal: 1, biceps: 0.5 } },
    { k: "tractions-supi", n: "Tractions, supination", bw: true, gr: "pull", mu: { dorsal: 1, biceps: 1 } },
    { k: "row-inv", n: "Rowing inversé (australien)", bw: true, bwf: 0.6, gr: "pull", mu: { dorsal: 1, trapezes: 0.5, biceps: 0.5 } },
    { k: "tirage-vert", n: "Tirage vertical", gr: "pull", mu: { dorsal: 1, biceps: 0.5 } },
    { k: "tirage-horiz", n: "Tirage horizontal à la poulie", gr: "pull", mu: { dorsal: 1, trapezes: 0.5, biceps: 0.5 } },
    { k: "row-barre", n: "Rowing, barre", gr: "pull", mu: { dorsal: 1, trapezes: 0.5, biceps: 0.5 } },
    { k: "row-1b", n: "Rowing un bras, haltère", gr: "pull", mu: { dorsal: 1, biceps: 0.5 } },
    { k: "face-pull", n: "Face pull", gr: "pull", mu: { epaules: 1, trapezes: 0.5 } },
    { k: "oiseau", n: "Oiseau, haltères", per: true, gr: "pull", mu: { epaules: 1, trapezes: 0.5 } }] },
  { g: "Bras", ex: [
    { k: "curl-barre", n: "Curl biceps, barre", gr: "pull", mu: { biceps: 1 } },
    { k: "curl-halt", n: "Curl biceps, haltères", per: true, gr: "pull", mu: { biceps: 1 } },
    { k: "curl-incl", n: "Curl incliné, haltères", per: true, gr: "pull", mu: { biceps: 1 } },
    { k: "ext-poulie", n: "Extension triceps, poulie", gr: "push", mu: { triceps: 1 } },
    { k: "ext-tete", n: "Extension triceps au-dessus de la tête", gr: "push", mu: { triceps: 1 } },
    { k: "ext-halt", n: "Extension triceps, haltère", gr: "push", mu: { triceps: 1 } }] },
  { g: "Jambes", ex: [
    { k: "squat", n: "Squat", gr: "jambes", mu: { quadri: 1 } },
    { k: "squat-halt", n: "Squat, haltères", per: true, gr: "jambes", mu: { quadri: 1 } },
    { k: "fentes", n: "Fentes avant", per: true, gr: "jambes", mu: { quadri: 1 } },
    { k: "hack-squat", n: "Hack squat", gr: "jambes", mu: { quadri: 1 } },
    { k: "fente-bulg", n: "Fente bulgare", per: true, gr: "jambes", mu: { quadri: 1 } },
    { k: "sdtr-barre", n: "Soulevé de terre roumain, barre", gr: "jambes", mu: { ischios: 1 } },
    { k: "sdtr-halt", n: "Soulevé de terre roumain, haltères", per: true, gr: "jambes", mu: { ischios: 1 } },
    { k: "sdt", n: "Soulevé de terre", gr: "jambes", mu: { ischios: 1, quadri: 0.5, trapezes: 0.5 } },
    { k: "hip-thrust", n: "Hip thrust", gr: "jambes", mu: { ischios: 0.5 } },
    { k: "leg-curl", n: "Leg curl", gr: "jambes", mu: { ischios: 1 } },
    { k: "mollets", n: "Mollets", gr: "jambes", mu: { mollets: 1 } },
    { k: "superman", n: "Superman (extension du dos au sol)", bw: true, gr: "tronc", mu: {} },
    { k: "releve", n: "Relevés de jambes, suspendu", bw: true, gr: "tronc", mu: { abdos: 1 } }] },
  { g: "Au temps · durée au lieu des reps", ex: [
    { k: "gainage", n: "Gainage, planche", time: true, gr: "tronc", mu: { abdos: 1 } },
    { k: "gainage-lat", n: "Gainage latéral", time: true, gr: "tronc", mu: { abdos: 1 } }] },
  /* Retirés de la liste : gardés seulement pour afficher les séances déjà notées */
  { g: "", hidden: true, ex: [
    { k: "cou", n: "Cou, flexion et extension" },
    { k: "kb-swing", n: "Kettlebell swing", gr: "jambes", mu: { ischios: 1 } },
    { k: "suspension", n: "Suspension à la barre", time: true }] }
];
/* Reconnaissance d'un exercice de programme d'après son nom, quand le programme ne donne pas son code
   (programmes installés avant la bibliothèque). Mots cherchés dans le nom sans accents, dans l'ordre. */
var BANK_MATCH = [
  ["leg-curl", ["leg curl"]], ["pec-deck", ["pec deck"]], ["face-pull", ["face pull"]], ["hip-thrust", ["hip thrust"]],
  ["gainage-lat", ["gainage", "lateral"]], ["gainage", ["gainage"]],
  ["dc-halt", ["developpe couche", "haltere"]], ["dc-barre", ["developpe couche"]], ["di-halt", ["developpe incline", "haltere"]],
  ["dm-halt", ["developpe militaire", "haltere"]], ["dm-barre", ["developpe militaire"]], ["dips", ["dips"]], ["pompes-serrees", ["pompe", "serree"]], ["pompes", ["pompe"]],
  ["el-lat-poulie", ["elevation", "lateral", "poulie"]], ["el-lat", ["elevation", "lateral"]], ["ecarte-poulie", ["ecarte", "poulie"]],
  ["tirage-vert", ["tirage vertical"]], ["tirage-horiz", ["tirage horizontal"]], ["row-1b", ["rowing", "un bras"]], ["row-barre", ["rowing", "barre"]],
  ["tractions-neutre", ["traction", "neutre"]], ["tractions-supi", ["traction", "supination"]], ["tractions", ["traction"]], ["curl-incl", ["curl", "incline"]], ["curl-halt", ["curl", "haltere"]], ["curl-barre", ["curl", "barre"]],
  ["ext-tete", ["extension", "triceps", "tete"]], ["ext-halt", ["extension", "triceps", "haltere"]], ["ext-poulie", ["extension", "triceps", "poulie"]],
  ["squat-halt", ["squat", "haltere"]], ["squat", ["squat", "barre"]], ["hack-squat", ["hack"]], ["fente-bulg", ["fente bulgare"]], ["fentes", ["fentes avant"]],
  ["sdtr-halt", ["roumain", "haltere"]], ["sdtr-barre", ["roumain"]], ["sdt", ["souleve de terre"]], ["mollets", ["mollet"]]
];
var matchCache = {};
function bankMatch(name) {
  if (!name) return "";
  if (matchCache[name] !== undefined) return matchCache[name];
  var t = " " + String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ") + " ", found = "";
  for (var i = 0; i < BANK_MATCH.length && !found; i++) if (BANK_MATCH[i][1].every(function (w) { return t.indexOf(w) >= 0; })) found = BANK_MATCH[i][0];
  matchCache[name] = found;
  return found;
}
/* Code de bibliothèque d'un exercice de programme : celui que le programme donne, sinon reconnu d'après le nom */
function exCat(e) { if (!e) return ""; if (e.cat && CAT[e.cat]) return e.cat; return bankMatch(e.name); }
/* Volume : séries de travail fractionnées (1 pour le muscle travaillé directement, 0,5 pour un muscle
   qui aide ; Pelland et al., Sports Medicine 2026). Vue par groupe : chaque série compte une fois,
   dans le groupe de son mouvement. */
var MUSCLES = [["biceps", "Biceps"], ["triceps", "Triceps"], ["epaules", "Épaules"], ["pecs", "Pectoraux"], ["dorsal", "Grand dorsal"], ["trapezes", "Trapèzes"], ["abdos", "Abdominaux"], ["quadri", "Quadriceps"], ["ischios", "Ischio-jambiers"], ["mollets", "Mollets"]];
var GROUPES = [["push", "Poussée", "pectoraux, épaules, triceps"], ["pull", "Tirage", "grand dorsal, trapèzes, biceps"], ["jambes", "Jambes", "quadriceps, ischio-jambiers, mollets"], ["tronc", "Tronc", "abdominaux"]];
var MUSCLE_GROUPE = { biceps: "pull", triceps: "push", epaules: "push", pecs: "push", dorsal: "pull", trapezes: "pull", abdos: "tronc", quadri: "jambes", ischios: "jambes", mollets: "jambes" };
var RIR_MAX_SERIE = 4;
var CAT = {}, CAT_ORDER = {};
CATALOGUE.forEach(function (g) { g.ex.forEach(function (c) { CAT_ORDER[c.k] = keysOf(CAT).length; CAT[c.k] = c; }); });
var LIBRE = "LIBRE";
var LIEUX = [{ v: "maison", l: "À la maison" }, { v: "salle", l: "Autre salle" }, { v: "dehors", l: "Dehors" }];
var ICON_X = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';

function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
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
/* Une séance déjà notée garde ses exercices et ses consignes d'origine,
   même si le programme est modifié ou remplacé ensuite. */
function freezeSession(s, prog) {
  if (!s || s.plan || !prog || s.programme !== prog.id || !hasData(s)) return false;
  var def = prog.sessions[s.type]; if (!def) return false;
  var w = s.semaine || (Math.floor(diffDays(s.date, prog.debut) / 7) + 1);
  if (def.kind === "course") {
    if (s.legacy || s.ftexte || !def.plan) return false;
    var pl = def.custom ? def.plan[w - 1] : def.plan[w - 1] || def.plan[def.plan.length - 1]; if (!pl || pl.test) return false;
    s.ftexte = pl.texte || " "; if (pl.fr) s.fplan = JSON.parse(JSON.stringify(pl.fr));
    if (def.sport) s.fsport = def.sport; if (pl.ctype || def.ctype) s.fctype = pl.ctype || def.ctype;
    if (pl.test6 || pl.chrono) s.fspec = { test6: !!pl.test6, chrono: pl.chrono || null, lab: pl.lab || "" };
    if (pl.duree) s.fspec = Object.assign(s.fspec || {}, { duree: pl.duree, role: pl.role || "", lab: pl.lab || "" });
    return true;
  }
  if (def.kind !== "muscu") return false;
  s.plan = { name: def.name, short: def.short || def.name, ex: def.ex.map(function (e) {
    var p = presc(e, w); if (!p) return null;
    var x = { id: e.id, name: e.name, bw: !!e.bw, cat: exCat(e), mu: e.mu || null, gr: e.gr || "", step: e.step || 2.5, rest: p.rest || e.rest, ss: e.ss || "", note: e.note || "", alt: e.alt || [], p: p };
    if (e.code) x.code = e.code; if (e.time) x.time = true;
    return x;
  }).filter(Boolean) };
  return true;
}
function freezeAll(onlyPast) {
  var changed = false, today = todayStr();
  valuesOf(D.seances).forEach(function (s) {
    if (onlyPast && s.date >= today) return;
    if (freezeSession(s, D.programmes[s.programme])) changed = true;
  });
  return changed;
}
/* Version 1.5 : les séances de course déjà notées gardent leur ancienne saisie */
function migrateCardio() {
  if (D.cardioMig) return false;
  valuesOf(D.seances).forEach(function (s) { var prog = D.programmes[s.programme], def = prog && prog.sessions ? prog.sessions[s.type] : null; if (def && def.kind === "course" && hasData(s)) s.legacy = true; });
  D.cardioMig = 1; return true;
}
function installProgram(p, link) {
  freezeAll(false);
  D.programmes[p.id] = p; D.actif = p.id; if (link) D.liens[p.id] = link;
  persistNow(); setActive(); S.date = initialDate(); S.mon = mondayOfDate(S.date); S.view = "jour"; render();
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
function initialDate() { var t = todayStr(); if (P && t < P.debut) return P.debut; return t; }
/* Jours couverts par le bloc ; en dehors, et sans programme, l'application fonctionne en séances libres */
function inBlock(date) { return !!P && date >= P.debut && date <= lastDay(); }
function mondayOfDate(date) { return addDays(date, -dow(date)); }
function blockWeek(mon) { return !!P && mon >= P.debut && mon <= lastDay() && weekOf(mon) <= P.semaines; }
function anyData(date) { return valuesOf(D.seances).some(function (s) { return s.date === date && s.type !== "REPOS" && hasData(s); }); }
function sessionLabel(s) { if (s.type === LIBRE) return "Séance libre"; if (isCardioType(s.type)) return cardioTitle(s); if (s.plan) return s.plan.short; var d = sessionDef(s.type); return d ? d.short || d.name : s.type; }

function plannedFor(date) {
  var base = plannedBase(date); if (base === null) return null;
  compPlanned(date).forEach(function (t) { if (base.indexOf(t) < 0) base.push(t); });
  if (D.avances) base = base.filter(function (t) { return !D.avances[date + "_" + t]; });
  return base;
}
function plannedBase(date) {
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
      for (var i = 0; i < 7; i++) { var dd = addDays(mon, i); if (dd < date && (hasData(seance(dd, base)) || replacedDone(dd, base))) done = true; }
      t = done ? "REPOS" : base;
    }
    if (out.indexOf(t) < 0 && P.sessions[t] && !planSkip(P, t, w)) out.push(t);
  });
  if (date === P.debut && P.sessions.MENSU && !P.cree) out.unshift("MENSU");
  return out;
}
var NOT_DATA = ["date", "type", "semaine", "programme", "checkin", "ajoutee", "maj", "libre", "lieu", "remplace", "liste", "nU", "cardio", "sport", "ctype", "fmt", "velMes", "nSer", "nRep", "legacy", "fplan", "ftexte", "fsport", "fctype", "fspec", "adapte", "alerteA", "pour", "avanceDe", "garderSeries", "modele"];
function hasData(s) {
  if (!s) return false;
  return keysOf(s).some(function (k) { if (k === "smod") return !!(s.smod && s.smod.statut); return NOT_DATA.indexOf(k) < 0 && s[k] !== undefined && s[k] !== null && JSON.stringify(s[k]) !== "{}"; });
}
function seanceId(date, type) { return date + "_" + type; }
function seance(date, type, create) {
  var id = seanceId(date, type);
  if (!D.seances[id] && create) {
    if (isCompType(type)) { var C = compProg(); D.seances[id] = { date: date, type: type, programme: C.id, semaine: weekOfProg(C, date) }; }
    else { var blk = inBlock(date); D.seances[id] = { date: date, type: type, programme: blk ? P.id : null, semaine: blk ? weekOf(date) : null }; }
  }
  return D.seances[id];
}
function dayDone(date) {
  var types = plannedFor(date), libDone = anyData(date);
  function ok(t) { var x = seance(date, t); return hasData(x) || replacedDone(date, t) || !!(x && x.adapte && x.adapte.repos); }
  if (!types || !types.length) return libDone ? true : null;
  var real = types.filter(function (t) { return t !== "REPOS"; });
  if (!real.length) return libDone ? true : null;
  return real.every(ok);
}
/* Séance libre du jour et séance prévue qu'elle remplace */
function libreOf(date) { return D.seances[seanceId(date, LIBRE)]; }
function isReplaced(date, t) { var l = libreOf(date); return !!(l && l.remplace === t); }
function replacedDone(date, t) { var l = libreOf(date); return !!(l && l.remplace === t && hasData(l)); }
function lieuLabel(v) { for (var i = 0; i < LIEUX.length; i++) if (LIEUX[i].v === v) return LIEUX[i].l; return "Hors salle"; }
function shortName(t) { var d = sessionDef(t); return d ? d.short || d.name : t; }
function libreSub(s) { return lieuLabel(s.lieu) + (s.modele ? " · " + s.modele : "") + (s.remplace ? " · remplace " + shortName(s.remplace) : ""); }

/* ================= Charges ================= */
function presc(e, w) {
  var i = w - 1; if (!e.sets[i]) return null;
  return { sets: e.sets[i], reps: e.reps[i], repsN: e.repsN[i], load: e.load ? e.load[i] : "", base: e.base ? e.base[i] : null, rir: e.rir[i], rirN: e.rirN[i], rest: e.restW ? e.restW[i] : null };
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
  if (e.time) {
    if (last) return { load: last.rows.reduce(function (m, r) { return Math.max(m, toNum(r.c) || 0); }, 0), src: "comme ta séance du " + fmtShort(last.date) };
    return { load: 0, src: "au poids de corps" };
  }
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
var S = { view: "jour", date: null, week: 1, prompt: "", updateReady: false, pendingCode: null, stripMon: null, stripFor: null, slide: null, swipeAt: 0 };
S.date = initialDate(); S.mon = mondayOfDate(S.date);
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
  applyTheme();
  renderMasthead();
  var tabs = document.getElementById("tabs");
  tabs.classList.toggle("hidden", !P && !D.sansProgramme);
  var tv = S.view;
  Array.prototype.forEach.call(tabs.querySelectorAll(".tab"), function (t) { if (t.dataset.view === tv) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
  var h;
  if (S.view === "editeur" && !S.ed) S.view = S.menuBack || "jour";
  if (S.view === "editeur") h = viewEditeur();
  else if (!P && !D.sansProgramme) h = viewWelcome();
  else if (S.view === "jour") h = viewJour();
  else if (S.view === "semaine") h = viewSemaine();
  else if (S.view === "progres") h = viewProgres();
  else h = viewJour();
  if (S.updateReady) h = '<div class="note info row"><span class="grow">Une nouvelle version de l\'application est prête.</span><button type="button" class="btn small primary" data-act="update">Mettre à jour</button></div>' + h;
  app.innerHTML = h;
  Array.prototype.forEach.call(app.querySelectorAll("[data-w]"), function (el) { el.style.width = Math.min(100, Number(el.dataset.w)) + "%"; });
  Array.prototype.forEach.call(app.querySelectorAll("[data-l]"), function (el) { el.style.left = Math.min(100, Number(el.dataset.l)) + "%"; });
  window.scrollTo(0, y);
  syncMenu();
}
function renderMasthead() {
  var m = document.getElementById("masthead"), h = '<div class="app-name"><span class="brand">' + (S.view === "editeur" ? "" : '<button type="button" class="menu-btn" id="menu-btn" data-act="menu" aria-label="Ouvrir le menu Réglages" aria-haspopup="dialog"><span class="burger" aria-hidden="true"><i></i><i></i><i></i></span></button>') + '<span>Carnet de musculation</span></span><span class="saved" id="saved">' + (storageOK ? "Enregistré" : "Stockage indisponible") + "</span></div>";
  if (S.view === "editeur") { /* rien : l'éditeur occupe l'écran */ }
  else if (P && (S.date || todayStr()) > lastDay()) {
    h += '<div class="block"><div class="block-title"><h2>' + esc(P.titre || "Programme") + '</h2><span class="tiny muted num">terminé le ' + esc(fmtShort(lastDay())) + "</span></div>" +
      '<p class="block-goal">Bloc terminé : continue en séances libres. Le bloc suivant s\'installe dans Réglages, avec le lien de ton coach.</p></div>';
  } else if (P) {
    var totals = [], max = 1;
    for (var w = 1; w <= P.semaines; w++) {
      var t = 0;
      if (P.run || (P.src && P.src.type === "mixte")) keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "course" && s.plan) t += entryMin(s.plan[w - 1]); else if (s.kind === "muscu" && s.ex.some(function (e) { return e.sets[w - 1]; })) t += (P.src && P.src.type === "mixte") ? 45 : 30; });
      else keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { t += e.sets[w - 1] || 0; }); });
      totals.push(t); max = Math.max(max, t);
    }
    var cur = weekOf(S.date || todayStr());
    h += '<div class="block"><div class="block-title"><h2>' + esc(P.titre || "Programme") + '</h2><span class="tiny muted num">' + esc(fmtShort(P.debut)) + " au " + esc(fmtShort(lastDay())) + "</span></div>";
    if (P.objectif) h += '<p class="block-goal">' + esc(P.objectif) + "</p>";
    h += '<div class="bars" role="img" aria-label="Séries prévues par semaine : ' + totals.map(function (t, i) { return "semaine " + (i + 1) + " " + t; }).join(", ") + '">';
    totals.forEach(function (t, i) {
      var w = i + 1, cls = w === cur ? "now" : w < cur ? "past" : "";
      h += '<button type="button" class="bar ' + cls + '" data-act="gotoweek" data-w="' + w + '" aria-label="Semaine ' + w + ", " + t + (P.run || (P.src && P.src.type === "mixte") ? " minutes prévues" : " séries prévues") + '"><i style-h="' + Math.round(t / max * 100) + '"></i><span>' + (P.semainesNoms && P.semainesNoms[i] ? esc(P.semainesNoms[i]) : "S" + w) + "</span></button>";
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
  h += '<div class="sheet"><h2>Sans programme</h2><p class="small muted">Compose tes séances toi-même avec les exercices de la bibliothèque, et suis ton poids, ta force et ton volume par muscle. Tu pourras installer un programme plus tard : ton historique est conservé.</p><div class="row"><button type="button" class="btn" data-act="sansprog">Commencer sans programme</button><button type="button" class="btn" data-act="edstart">Créer mon programme</button></div></div>';
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
  var date = S.date, w = inBlock(date) ? weekOf(date) : null, plan = plannedFor(date), h = "";
  if (!S.stripMon || S.stripFor !== date) { S.stripMon = mondayOfDate(date); S.stripFor = date; }
  var mon = S.stripMon, sunS = addDays(mon, 6), pm = parse(mon), ps = parse(sunS);
  var range = "Du " + pm.getDate() + (pm.getMonth() === ps.getMonth() ? "" : " " + fmtShort(mon).replace(/^\d+\s*/, "")) + " au " + fmtShort(sunS);
  var wt = blockWeek(mon) ? "Semaine " + weekOf(mon) : P && mon < P.debut ? "Avant le bloc" : P && mon > lastDay() ? "Après le bloc" : "Semaine du " + fmtShort(mon).replace(/\.$/, "");
  h += '<div class="weeknav"><button type="button" class="icon-btn" data-act="stripweek" data-d="-1" aria-label="Semaine précédente"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3L5 9l6 6"/></svg></button>' +
    '<div class="wk"><b>' + esc(wt) + '</b><span class="tiny muted">' + esc(range) + '</span></div>' +
    '<button type="button" class="icon-btn" data-act="stripweek" data-d="1" aria-label="Semaine suivante"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3l6 6-6 6"/></svg></button></div>';
  h += '<div class="daystrip' + (S.slide ? " slide-" + S.slide : "") + '" role="group" aria-label="Jours de la semaine, fais glisser pour changer de semaine">';
  S.slide = null;
  for (var i = 0; i < 7; i++) {
    var d = addDays(mon, i), done = dayDone(d);
    h += '<button type="button" class="day' + (d === todayStr() ? " today" : "") + '" data-act="goto" data-date="' + d + '"' + (d === date ? ' aria-current="date"' : "") + ' aria-label="' + esc(fmtLong(d)) + '"><span class="dn">' + esc(fmtDayName(d)) + '</span><span class="dd">' + parse(d).getDate() + '</span><span class="dot ' + (done === true ? "done" : done === false ? "todo" : "") + '"></span></button>';
  }
  h += "</div>";
  h += '<div class="daynav"><h1>' + esc(fmtLong(date)) + "</h1>" + (date !== initialDate() || S.stripMon !== mondayOfDate(initialDate()) ? '<button type="button" class="linkbtn" data-act="today">Aujourd\'hui</button>' : "") + "</div>";
  h += '<p class="small muted">' + esc(weekLabel(date)) + "</p>";
  if (P && todayStr() < P.debut && date === P.debut) h += '<div class="note info">Le bloc commence le ' + esc(fmtLong(P.debut)) + ". Voici la première séance.</div>";
  if (!isStandalone && !D.astuceVue) h += '<div class="note info row"><span class="grow">Installe l\'application sur ton écran d\'accueil pour l\'utiliser sans réseau et protéger tes données.</span><button type="button" class="btn small" data-act="view" data-v="reglages" data-r="ecran">Comment faire</button></div>';
  if (plan === null && P && P.question) h += choiceSheet(w);
  h += weightSheet(date);
  var types = (plan || compPlanned(date)).slice();
  valuesOf(D.seances).forEach(function (s) { if (s.date === date && types.indexOf(s.type) < 0 && s.type !== LIBRE && !isCardioType(s.type) && (sessionDef(s.type) || (hasData(s) && defOf(s)))) types.push(s.type); });
  if (!types.length && plan !== null && !libreOf(date) && !cardioOf(date).length) h += freeSheet(date);
  keysOf(D.avances || {}).forEach(function (k) { var i = k.lastIndexOf("_"); if (k.slice(0, i) === date) h += '<div class="note info">' + esc(shortName(k.slice(i + 1))) + " a été avancée au " + esc(fmtLong(D.avances[k])) + ".</div>"; });
  h += fatigueBanner(date, types);
  types.forEach(function (t) { if (!isReplaced(date, t)) h += sessionSheet(date, t, w); });
  if (libreOf(date)) h += libreSheet(date);
  cardioOf(date).forEach(function (s) { h += cardioSheet(date, s); });
  h += addSheet(date, types);
  h += claudeSheet("jour");
  return h;
}
function freeSheet(date) {
  var t = !P ? "Pas de programme : compose ta séance avec les exercices de la bibliothèque."
    : date > lastDay() ? "Ton bloc est terminé. Continue en séances libres en attendant le suivant."
    : date < P.debut ? "Le bloc n'a pas encore commencé. Tu peux faire une séance libre."
    : "Rien de prévu par ton programme ce jour-là.";
  return '<div class="sheet"><h2>' + (inBlock(date) ? "Rien de prévu" : "Séance libre") + '</h2><p class="small muted">' + esc(t) + '</p><div class="row"><button type="button" class="btn primary" data-act="librestart" data-t="">Faire une séance libre</button><button type="button" class="btn" data-act="cardiostart">Activité cardio</button></div></div>';
}
function weekLabel(date) {
  if (!P) return "Séances libres";
  if (P.testDay && date === P.testDay) return "Tests de fin de bloc";
  if (date < P.debut) return "Avant le début du bloc";
  var w = weekOf(date); if (w > P.semaines || date > lastDay()) return "Après la fin du bloc : séances libres";
  var v = versionOf(w), t = "Semaine " + w;
  if (P.deload && P.deload.indexOf(w) >= 0) t += ", décharge";
  if (versionKeys().length > 1) t += v ? ", " + P.versions[v].label.toLowerCase() : ", version à choisir";
  return t;
}
function choiceSheet(w) {
  return '<div class="sheet"><h2>' + esc(P.question.texte) + "</h2>" + (P.question.aide ? '<p class="small muted">' + esc(P.question.aide) + "</p>" : "") + '<div class="row">' +
    P.question.options.map(function (o, i) { return '<button type="button" class="btn ' + (i === 0 ? "primary" : "") + '" data-act="version" data-w="' + w + '" data-v="' + esc(o.v) + '">' + esc(o.l) + "</button>"; }).join("") + "</div></div>";
}
function weekAvg(mon) {
  var vals = [];
  for (var i = 0; i < 7; i++) { var p = D.pesees[addDays(mon, i)], k = p ? toNum(p.kg) : null; if (k) vals.push(k); }
  return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
}
/* Heures de sommeil : « 7 h 30 », « 7h30 », « 7,5 » ou « 7.5 » */
function parseHours(v) {
  var t = String(v === undefined || v === null ? "" : v).trim().toLowerCase(); if (!t) return null;
  var m = t.match(/^(\d{1,2})\s*h\s*(\d{0,2})\s*(min)?$/);
  var x = m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : toNum(t);
  return x !== null && x >= 0 && x <= 24 ? Math.round(x * 100) / 100 : null;
}
function fmtHours(x) { if (x === null || x === undefined || !isFinite(x)) return "–"; var mn = Math.round(x * 60), hh = Math.floor(mn / 60); return hh + " h " + pad(mn % 60); }
function sleepWeek(mon) {
  var nights = [];
  for (var i = 0; i < 7; i++) { var d = addDays(mon, i), p = D.pesees[d], x = p ? parseHours(p.sommeil) : null; nights.push({ date: d, h: x }); }
  var vals = nights.filter(function (n) { return n.h !== null; }).map(function (n) { return n.h; });
  return { nights: nights, n: vals.length, avg: vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null };
}
function sleepLabel(sw) { return sw.n ? "moyenne de la semaine, " + sw.n + " nuit" + (sw.n > 1 ? "s" : "") : "moyenne de la semaine"; }
function weightSheet(date) {
  var p = D.pesees[date] || {}, mon = mondayOfDate(date), avg = weekAvg(mon), sw = sleepWeek(mon), sl = parseHours(p.sommeil);
  return '<div class="sheet morning"><h2>Ce matin</h2><div class="row end"><label class="field grow" for="kg-' + date + '"><span>Pesée, à jeun (kg)</span>' + inp("pesees", date, "kg", p.kg, 'id="kg-' + date + '" inputmode="decimal" class="n" placeholder="ex. 76,2"') + '</label><div class="stat"><b data-avg="kg">' + fmt(avg, 2) + '</b><span>moyenne de la semaine</span></div></div>' +
    '<div class="row end"><label class="field grow" for="sl-' + date + '"><span>Heures de sommeil cette nuit</span>' + inp("pesees", date, "sommeil", sl !== null ? fmtHours(sl) : p.sommeil, 'id="sl-' + date + '" class="n" placeholder="ex. 7 h 30"') + '</label><div class="stat"><b data-avg="sommeil">' + fmtHours(sw.avg) + '</b><span data-avg="sommeil-n">' + sleepLabel(sw) + "</span></div></div>" +
    '<p class="tiny muted">Ex. 7 h 30 ou 7,5. À noter chaque matin, même les jours de repos.</p></div>';
}
function addSheet(date, types) {
  var opts = (inBlock(date) ? keysOf(P.sessions) : ["MENSU"]).filter(function (t) { return types.indexOf(t) < 0; });
  return '<label class="field" for="add-s"><span>' + (inBlock(date) ? "Séance faite un autre jour, rattrapage, séance en plus ou séance libre" : "Séance libre ou mensurations") + '</span><select id="add-s" data-act="add"><option value="">Ajouter une séance à ce jour</option>' +
    (libreOf(date) ? "" : '<option value="' + LIBRE + '">Séance libre (hors salle)</option>') + '<option value="CARDIO">Activité cardio (course, vélo, natation)</option>' +
    opts.map(function (t) { return '<option value="' + t + '">' + esc(sessionName(t, date)) + "</option>"; }).join("") + "</select></label>";
}
function sessionSheet(date, type, w) {
  var s = seance(date, type) || {}, id = seanceId(date, type), st, other = !!(s.programme && (!P || s.programme !== P.id) && hasData(s));
  var def = (other && defOf(s)) || sessionDef(type) || defOf(s);
  if (other) w = s.semaine || w;
  else if (isCompType(type)) w = weekOfProg(compProg(), date);
  if (def && def.kind === "course" && def.custom && def.plan && def.plan[w - 1] && def.plan[w - 1].lab && !s.plan) def = Object.assign({}, def, { name: def.plan[w - 1].lab });
  var smk = smodKind(date, type, def, s), ld = def.kind === "muscu" && !s.plan && !hasData(s) && !s.garderSeries && lendemainDur(date);
  if (s.smod && s.smod.statut) st = smodState(s);
  else if (s.arret && s.arret.motif) st = '<span class="state warn">Terminée plus tôt</span>';
  else st = hasData(s) ? '<span class="state done">Notée</span>' : ld ? '<span class="state alt">Adaptée</span>' : s.adapte && s.adapte.repos ? '<span class="state alt">Repos</span>' : s.adapte ? '<span class="state alt">Adaptée</span>' : '<span class="state">À faire</span>';
  var h = '<section class="sheet" id="sess-' + esc(id) + '"><div class="sheet-head"><h2>' + esc(s.plan ? s.plan.name : other || !sessionDef(type) || def.custom ? def.name || type : sessionName(type, date)) + "</h2>" + (def.kind === "repos" ? "" : st) + "</div>";
  if (s.pour) h += '<p class="small muted">' + (s.avanceDe ? "Avancée du " + esc(fmtLong(s.avanceDe)) + ", à la place de « " : "À la place de « ") + esc(shortName(s.pour)) + " ».</p>";
  var smOpen = smk && ((s.smod && s.smod.statut) || (S.smodOpen && S.smodOpen[id]));
  CK = smk ? { kind: def.kind, name: def.name, id: id, smod: !smOpen && !hasData(s) } : null;
  if (smOpen) { var ckh = (def.kind === "tests" || def.kind === "mensu") ? "" : checkin(s, id); CK = null; return h + ckh + '<div data-smod="' + esc(id) + '">' + smodPanel(date, type, def, s, id) + "</div></section>"; }
  if (smk && !hasData(s) && (def.kind === "tests" || def.kind === "mensu")) h += smodBtn(id);
  if (def.kind === "muscu" && !hasData(s) && !libreOf(date) && !s.pour) h += '<div class="note info stack"><p><b>Pas à ta salle aujourd\'hui ?</b> Compose une séance avec le matériel que tu as sous la main.</p><div><button type="button" class="btn primary small" data-act="librestart" data-t="' + esc(type) + '">Faire une séance libre</button></div></div>';
  if (s.adapte && def.kind !== "course" && (s.adapte.repos || def.kind === "sport")) { CK = null; return h + adapteNote(s, id) + "</section>"; }
  if (def.kind === "muscu") h += adapteNote(s, id) + bodyMuscu(date, def, w, s, id);
  else if (def.kind === "course") h += courseSession(date, def, w, s, id);
  else if (def.kind === "sport") h += bodySport(def, s, id);
  else if (def.kind === "repos") h += bodyRepos(def, s, id);
  else if (def.kind === "tests") h += bodyTests(def, s, id);
  else if (def.kind === "mensu") h += bodyMensu(s, id);
  CK = null;
  return h + "</section>";
}
function checkin(s, id) {
  var c = s.checkin || {}, h = '<div class="section"><h3>Avant de commencer</h3><p class="small muted">Note chaque point de 1 à 5 : 5, c\'est au mieux.</p>';
  CHECK.forEach(function (q) { h += scaleQ(id, "checkin." + q.k, q.label, q.lo, q.hi, c[q.k]); if (q.k === "sommeil") h += '<p class="tiny muted">Les heures se notent en haut, dans « Ce matin » ; ici, la qualité du sommeil.</p>'; });
  var ctx = CK && CK.id === id ? CK : null, r = readinessFor(readiness(c), ctx);
  if (r && ctx && ctx.smod && r.level === "stop") h += '<div class="note stop stack"><p><b>' + r.title + " (" + fmt(r.avg, 1) + " sur 5).</b> " + r.text + "</p>" + smodBtn(id, "primary") + "</div>";
  else if (r) h += '<div class="note ' + r.level + '"><b>' + r.title + " (" + fmt(r.avg, 1) + " sur 5).</b> " + r.text + "</div>";
  if (ctx && ctx.smod && !(r && r.level === "stop")) h += smodBtn(id);
  return h + "</div>";
}
function setRows(id, base, rows, n, o) {
  var h = '<div class="sets"><div class="set-head"><span></span><span>' + esc(o.head) + "</span><span>" + (o.repsHead || "Reps") + "</span><span>RIR</span><span></span></div>";
  for (var i = 0; i < n; i++) {
    var row = rows[i] || {}, b = base + "." + i + ".";
    var cl = o.load !== null && o.load !== undefined ? o.load : "";
    h += '<div class="set"><span class="i">' + (i + 1) + "</span>" +
      inp("seances", id, b + "c", row.c, 'inputmode="decimal" aria-label="Série ' + (i + 1) + ', charge en kg" placeholder="' + (cl !== "" ? fmt(cl) : "kg") + '"') +
      inp("seances", id, b + "r", row.r, 'inputmode="numeric" aria-label="Série ' + (i + 1) + (o.repsHead ? ', durée en secondes' : ', répétitions') + '" placeholder="' + esc(String(o.reps)) + '"') +
      inp("seances", id, b + "rir", row.rir, 'inputmode="decimal" aria-label="Série ' + (i + 1) + ', RIR" placeholder="' + fmt(o.rir) + '"') +
      '<button type="button" class="fill" data-act="fill" data-id="' + esc(id) + '" data-base="' + b + '" data-c="' + cl + '" data-r="' + o.reps + '" data-rir="' + o.rir + '">= prévu</button></div>';
  }
  return h + '</div><div><button type="button" class="btn small quiet" data-act="addset" data-id="' + esc(id) + '" data-base="' + base + "." + n + '">Ajouter une série</button></div>';
}
function bodyMuscu(date, def, w, s, id) {
  var h = "";
  if (s.arret && s.arret.motif) h += '<div class="note warn"><b>Séance terminée plus tôt</b> (' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + "). Les exercices non notés comptent comme non faits.</div>";
  var ld = !s.plan && !hasData(s) && !s.garderSeries && lendemainDur(date), ldOff = !s.plan && !hasData(s) && s.garderSeries && lendemainDur(date);
  if (ld) h += '<div class="note info stack"><p><b>' + esc(ld.name) + " très dur hier.</b> " + esc(ld.texte || "Règle de ton programme : une série de moins par exercice, mêmes charges.") + '</p><div><button type="button" class="linkbtn" data-act="toggle" data-col="seances" data-id="' + esc(id) + '" data-path="garderSeries">Garder toutes les séries</button></div></div>';
  else if (ldOff) h += '<div class="note info stack"><p>Toutes les séries gardées malgré la séance très dure d\'hier.</p><div><button type="button" class="linkbtn" data-act="toggle" data-col="seances" data-id="' + esc(id) + '" data-path="garderSeries">Appliquer la règle : une série de moins</button></div></div>';
  h += checkin(s, id);
  var r = readiness(s.checkin), light = r && r.level === "stop";
  h += '<div class="hr"></div><div class="section"><h3>Exercices</h3><p class="small muted">Note pour chaque série la charge, les répétitions faites et ton RIR ressenti (répétitions que tu aurais encore pu faire). « = prévu » remplit la série avec la cible.</p></div>';
  var items = s.plan ? s.plan.ex.map(function (x) { return { e: x, p: x.p }; }) : def.ex.map(function (e) { return { e: e, p: presc(e, w) }; });
  items.forEach(function (it) {
    var e = it.e, p = it.p; if (!p) return;
    var ad = s.adapte || {}, sg = suggestion(e, p, date), planned = Math.max(1, p.sets - (light || ad.court || ld ? 1 : 0));
    var rows = (s.sets && s.sets[e.id]) || {}, has = rowsOk(rows).length > 0, n = Math.max(planned, keysOf(rows).length);
    var rirT = (light ? p.rirN + 1 : p.rirN) + (ad.facile ? 2 : 0), mod = (s.mods || {})[e.id];
    var tag = mod ? (mod.statut === "saute" ? '<span class="state warn">Sauté</span>' : '<span class="state alt">Remplacé</span>') : (e.ss ? '<span class="ss">' + esc(e.ss) + "</span>" : "");
    h += '<div class="ex"><div class="ex-title"><h3><span class="ex-code">' + esc(e.code || e.id) + "</span>" + esc(e.name) + "</h3>" + tag + "</div>";
    h += '<div class="stats"><div class="stat"><b>' + planned + " × " + esc(p.reps) + '</b><span>séries × reps</span></div>' +
      (p.load ? '<div class="stat"><b>' + esc(p.load) + '</b><span>charge prévue</span></div>' : "") +
      '<div class="stat"><b>' + esc(light || ad.facile ? fmt(rirT) : p.rir) + '</b><span>RIR visé</span></div>' +
      '<div class="stat"><b>' + esc(p.rest || e.rest) + '</b><span>repos</span></div></div>';
    if (!mod) {
      h += sg ? '<p class="advice">Charge conseillée : ' + esc(loadLabel(e, sg.load)) + ' <span class="muted">(' + esc(sg.src) + ")</span></p>" : '<p class="advice">Choisis la charge au RIR visé, puis note-la.</p>';
      if (e.note) h += '<p class="small muted">' + esc(e.note) + "</p>";
      h += setRows(id, "sets." + e.id, rows, n, { head: e.bw || e.time ? "Lest (kg)" : "Charge (kg)", load: sg ? sg.load : null, reps: p.repsN, rir: rirT, repsHead: e.time ? "Sec." : "" });
      h += '<div><button type="button" class="btn small quiet" data-act="modopen" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '">Sauté ou remplacé</button></div>';
    } else {
      h += modPanel(e, p, s, id, mod, planned, rirT, date);
      if (has) h += '<p class="small muted">Séries faites avant le changement :</p>' + setRows(id, "sets." + e.id, rows, keysOf(rows).length, { head: e.bw ? "Lest (kg)" : "Charge (kg)", load: sg ? sg.load : null, reps: p.repsN, rir: rirT });
    }
    h += "</div>";
  });
  h += '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true, { duree: true, charge: true });
  return h;
}
function modPanel(e, p, s, id, mod, planned, rirT, date) {
  var h = '<div class="panel">';
  h += '<div class="scale"><div class="scale-q"><span>Que s\'est-il passé ?</span></div>' + seg("seances", id, "mods." + e.id + ".statut", [{ v: "remplace", l: "Remplacé par un autre" }, { v: "saute", l: "Sauté" }], mod.statut) + "</div>";
  h += '<div class="scale"><div class="scale-q"><span>Pourquoi ?</span></div>' + seg("seances", id, "mods." + e.id + ".motif", MOTIFS_EX, mod.motif) + "</div>";
  if (mod.motif === "douleur") h += '<div class="scale"><div class="scale-q"><span>Où ?</span></div>' + zones(id, "mods." + e.id + ".zone", mod.zone) + "</div>";
  if (mod.motif === "autre") h += '<label class="field"><span>Précise</span>' + inp("seances", id, "mods." + e.id + ".precision", mod.precision, "") + "</label>";
  if (mod.statut === "remplace") {
    var rp = (s.remp || {})[e.id] || {}, rc = rp.k ? CAT[rp.k] : null, rows = rp.sets || {};
    h += '<div class="scale"><div class="scale-q"><span>Exercice de remplacement</span></div>';
    if (rc) {
      h += '<div class="row"><b class="grow">' + esc(rc.n) + '</b><button type="button" class="btn small" data-act="rempchange" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '">Changer</button></div></div>';
    } else {
      var sug = rempSuggestions(e);
      if (sug.length) h += '<p class="small muted">Proposés dans la bibliothèque, pour les mêmes muscles :</p><div class="seg">' + sug.map(function (k) { return '<button type="button" data-act="rempk" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '" data-k="' + k + '">' + esc(CAT[k].n) + "</button>"; }).join("") + "</div>";
      h += '<div><button type="button" class="btn small" data-act="rempmenu" data-id="' + esc(id) + '" data-ex="' + esc(e.id) + '">' + (sug.length ? "Autre exercice de la bibliothèque" : "Choisir dans la bibliothèque") + "</button></div></div>";
      h += '<label class="field"><span>Ou écris son nom, s\'il n\'est pas dans la bibliothèque</span>' + inp("seances", id, "remp." + e.id + ".nom", rp.nom, 'placeholder="Nom de l\'exercice"') + "</label>";
    }
    if (rc || rp.nom) {
      var rk2 = rempCat(rp); if (!rc && rk2) rc = CAT[rk2];
      var last = rc ? lastCat(rk2, date) : lastRemp(rp.nom, date), step = rc ? (rc.per ? 2 : 2.5) : (e.step || 2.5);
      var bwThen = rc && rc.bw && last ? bodyweight(last.date) * (rc.bwf || 1) : 0, bwNow = rc && rc.bw ? bodyweight(date) * (rc.bwf || 1) : 0;
      var load = last ? targetFrom(last, p, step, bwThen, bwNow) : null, le = { bw: !!(rc && rc.bw) };
      h += '<p class="advice">' + (last ? "Charge conseillée : " + esc(loadLabel(le, load)) + ' <span class="muted">(dernière fois le ' + esc(fmtShort(last.date)) + ")</span>" : "Première fois sur cet exercice : choisis la charge au RIR visé, même nombre de séries et de reps.") + "</p>";
      h += setRows(id, "remp." + e.id + ".sets", rows, Math.max(planned, keysOf(rows).length), { head: rc && rc.bw ? "Lest (kg)" : rc && rc.per ? "kg / haltère" : "Charge (kg)", load: load, reps: p.repsN, rir: rirT });
      h += '<p class="small muted">' + (rc ? (rp.k ? "" : "Reconnu dans la bibliothèque : « " + esc(rc.n) + " ». ") + "Ces séries comptent pour « " + esc(rc.n) + " » dans tes courbes de force et ton volume. Elles ne changent pas les charges conseillées de « " + esc(e.name) + " »."
        : "Ces séries comptent dans ton volume pour les muscles de « " + esc(e.name) + " », mais n'ont pas de courbe de force et ne changent pas ses charges conseillées. Choisis l'exercice dans la bibliothèque pour qu'il ait sa courbe.") + "</p>";
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
function bilan(s, id, full, o) {
  var b = s.bilan || {}, h = '<div class="section"><h3>' + (full ? "Après la séance" : "Bilan") + "</h3>";
  o = o || {};
  if (full) h += scaleQ(id, "bilan.rpe", "Difficulté globale de la séance", "très facile", "maximale", b.rpe, 10);
  if (o.duree) h += '<label class="field"><span>Durée de la séance (min), facultatif</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric"') + '</label><p class="tiny muted">La durée sert seulement à additionner musculation, sport et cardio dans la charge de la semaine.</p>';
  if (o.charge) h += '<div data-live="' + esc(id) + '" data-kind="charge">' + chargeLine(s) + "</div>";
  h += '<div class="scale"><div class="scale-q"><span>Douleurs (pas les courbatures)</span></div>' + zones(id, "bilan.douleurs", b.douleurs) + "</div>";
  h += '<label class="field"><span>Remarques</span>' + txt("seances", id, "bilan.note", b.note, "Facultatif : sensations, exercice à changer, machine prise…") + "</label>";
  return h + "</div>";
}
/* ---------- Séance libre (hors salle) ---------- */
function rowsFor(c, obj) { return c && c.time ? valuesOf(obj).filter(function (r) { return r && toNum(r.t); }) : rowsOk(obj); }
function bestRow(c, rows) {
  var best = null, score = -1;
  rows.forEach(function (r) {
    var v = c && c.time ? toNum(r.t) : e1rm(toNum(r.c) + (c && c.bw ? 75 : 0), toNum(r.r), toNum(r.rir) !== null ? toNum(r.rir) : 2);
    if (v > score) { score = v; best = r; }
  });
  return best;
}
/* Exercice du programme noté dans une séance (consignes figées en priorité, code « cat » du programme) */
function progEx(s, id) {
  var prog = D.programmes[s.programme], def = prog && prog.sessions ? prog.sessions[s.type] : null;
  var pe = def && def.ex ? def.ex.filter(function (e) { return e.id === id; })[0] : null;
  var fe = s.plan ? s.plan.ex.filter(function (e) { return e.id === id; })[0] : null;
  var e = fe || pe; if (!e) return null;
  var cat = exCat(fe) || exCat(pe), c = CAT[cat];
  return { id: id, name: e.name, bw: !!e.bw, cat: cat,
    mu: (c && c.mu) || (fe && fe.mu) || (pe && pe.mu) || null, gr: (c && c.gr) || (fe && fe.gr) || (pe && pe.gr) || "" };
}
function catRows(s, k) {
  var out = [];
  if (s.type === LIBRE) (s.liste || []).forEach(function (it) { if (it.k === k && s.sets && s.sets[it.u]) out = out.concat(rowsFor(CAT[k], s.sets[it.u])); });
  else if (s.sets) keysOf(s.sets).forEach(function (exId) { var e = progEx(s, exId); if (e && e.cat === k) out = out.concat(rowsOk(s.sets[exId])); });
  if (s.type !== LIBRE) keysOf(s.remp).forEach(function (exId) { var r = s.remp[exId]; if (r && r.sets && rempCat(r) === k) out = out.concat(rowsOk(r.sets)); });
  return out;
}
function byDateDesc(a, b) { return a.date < b.date ? 1 : -1; }
function lastCat(k, before) {
  var list = valuesOf(D.seances).filter(function (s) { return s.date < before; }).sort(byDateDesc);
  for (var i = 0; i < list.length; i++) { var rows = catRows(list[i], k); if (rows.length) return { date: list[i].date, rows: rows, best: bestRow(CAT[k], rows), salle: list[i].type !== LIBRE }; }
  return null;
}
function lastAutre(nom, before) {
  var key = String(nom).trim().toLowerCase();
  var list = valuesOf(D.seances).filter(function (s) { return s.date < before && s.type === LIBRE; }).sort(byDateDesc);
  for (var i = 0; i < list.length; i++) {
    var s = list[i], rows = [];
    (s.liste || []).forEach(function (it) { if (it.k === "autre" && String(it.nom || "").trim().toLowerCase() === key && s.sets && s.sets[it.u]) rows = rows.concat(rowsOk(s.sets[it.u])); });
    if (rows.length) return { date: s.date, rows: rows, best: bestRow(null, rows), salle: false };
  }
  return null;
}
function perfText(c, r) {
  if (!r) return "";
  if (c && c.time) return (toNum(r.c) ? "+" + fmt(toNum(r.c)) + " kg, " : "") + fmt(toNum(r.t), 0) + " s" + (toNum(r.m) !== null ? ", marge " + fmt(toNum(r.m), 0) + " s" : "");
  var load = c && c.bw ? (toNum(r.c) > 0 ? "+" + fmt(toNum(r.c)) + " kg" : "poids de corps") : fmt(toNum(r.c)) + " kg";
  return load + " × " + fmt(toNum(r.r), 0) + (toNum(r.rir) !== null ? ", RIR " + fmt(toNum(r.rir)) : "");
}
function muscleName(k) { for (var i = 0; i < MUSCLES.length; i++) if (MUSCLES[i][0] === k) return MUSCLES[i][1]; return k; }
function volText(mon) {
  var sun = addDays(mon, 6), d = doneVol(mon, sun), p = blockWeek(mon) ? plannedVol(mon, sun) : null;
  return MUSCLES.map(function (m) { return m[1].toLowerCase() + " " + fmt(d.m[m[0]]) + (p ? "/" + fmt(p.m[m[0]]) : ""); }).join(", ");
}
function libreName(it) { var c = CAT[it.k]; return c ? c.n : it.k === "autre" ? (it.nom || "Autre exercice") : "Exercice"; }
function libreSheet(date) {
  var s = libreOf(date), id = seanceId(date, LIBRE), liste = s.liste || [], st;
  if (s.arret && s.arret.motif) st = '<span class="state warn">Terminée plus tôt</span>';
  else st = hasData(s) ? '<span class="state done">Notée</span>' : '<span class="state alt">Hors salle</span>';
  var h = '<section class="sheet" id="libre"><div class="sheet-head"><div class="titled"><h2>Séance libre</h2><span class="small muted">' + esc(libreSub(s)) + "</span></div>" + st + "</div>";
  h += '<div><button type="button" class="linkbtn" data-act="libreedit">Modifier le lieu ou la séance remplacée</button></div>';
  if (s.arret && s.arret.motif) h += '<div class="note warn"><b>Séance terminée plus tôt</b> (' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + ").</div>";
  h += checkin(s, id);
  h += '<div class="hr"></div><div class="section"><h3>Exercices</h3><p class="small muted">Ajoute les exercices dans l\'ordre où tu les fais. Pour chaque série : charge, reps faites et RIR ressenti (répétitions que tu aurais encore pu faire).</p>' +
    (liste.length ? "" : '<p class="small muted">Aucun exercice pour l\'instant.</p>') + "</div>";
  liste.forEach(function (it, i) { h += libreEx(s, id, it, i, date); });
  h += '<button type="button" class="btn outline wide" data-act="libreadd" data-id="' + esc(id) + '">Ajouter un exercice</button>';
  h += '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true, { duree: true, charge: true });
  return h + "</section>";
}
function libreEx(s, id, it, i, date) {
  var c = CAT[it.k] || null, time = !!(c && c.time), rows = (s.sets && s.sets[it.u]) || {}, n = Math.max(parseInt(it.cible, 10) || (time ? 2 : 3), keysOf(rows).length), name = libreName(it);
  var h = '<div class="ex" id="ex-' + esc(it.u) + '"><div class="ex-title"><h3><span class="ex-code">' + (i + 1) + "</span>" + esc(name) + '</h3><button type="button" class="icon-btn" data-act="librerm" data-id="' + esc(id) + '" data-u="' + esc(it.u) + '" aria-label="Retirer ' + esc(name) + ' de la séance">' + ICON_X + "</button></div>";
  if (it.k === "autre") h += '<label class="field"><span>Nom de l\'exercice</span>' + inp("seances", id, "liste." + i + ".nom", it.nom, 'placeholder="ex. Rotation externe à l\'élastique"') + "</label>" +
    '<div class="scale"><div class="scale-q"><span>Muscle travaillé</span></div>' + seg("seances", id, "liste." + i + ".mu", MUSCLES.map(function (m) { return { v: m[0], l: m[1] }; }), it.mu) + "</div>" +
    '<p class="small muted">Noté dans le journal et le résumé pour Claude, et compté dans le volume du muscle choisi. Pas de courbe de force pour cet exercice.</p>';
  var last = it.k === "autre" ? (it.nom ? lastAutre(it.nom, date) : null) : c ? lastCat(it.k, date) : null;
  h += '<p class="advice">' + (last ? "Dernière fois : " + esc(perfText(c, last.best)) + ' <span class="muted">(' + esc(fmtShort(last.date)) + (last.salle ? ", à la salle" : "") + ")</span>"
    : time ? "Première fois : note la durée tenue et la marge qu'il te restait." : "Première fois sur cet exercice : choisis une charge qui laisse 2 répétitions en réserve.") + "</p>";
  if (it.cible) h += '<p class="small">Prévu : ' + esc(it.cible) + (it.consigne ? ". " + esc(it.consigne) : "") + "</p>";
  h += libreRows(id, it.u, rows, n, c, last);
  if (c && c.bw) h += '<p class="tiny muted">Poids de corps : mets 0 dans Lest. ' + (c.bwf ? "Les deux tiers de ton poids du jour sont comptés" : "Ton poids du jour est compté") + " dans la force estimée.</p>";
  if (time) h += '<p class="tiny muted">Marge : combien de secondes tu aurais encore pu tenir, comme le RIR.</p>';
  return h + '<div><button type="button" class="btn small quiet" data-act="addset" data-id="' + esc(id) + '" data-base="sets.' + esc(it.u) + "." + n + '">Ajouter une série</button></div></div>';
}
function libreRows(id, u, rows, n, c, last) {
  var time = !!(c && c.time), bw = !!(c && c.bw), f = time ? ["c", "t", "m"] : ["c", "r", "rir"];
  var heads = time ? ["Lest (kg)", "Durée (s)", "Marge (s)"] : [bw ? "Lest (kg)" : c && c.per ? "kg / haltère" : "Charge (kg)", "Reps", "RIR"];
  var aria = time ? ["lest en kg", "durée en secondes", "marge en secondes"] : [bw ? "lest en kg" : "charge en kg", "répétitions", "RIR"];
  var ph = time ? ["kg", "s", "s"] : ["kg", "reps", "RIR"], modes = time ? ["decimal", "numeric", "numeric"] : ["decimal", "numeric", "decimal"];
  var h = '<div class="sets"><div class="set-head"><span></span><span>' + heads.join("</span><span>") + "</span><span></span></div>";
  for (var i = 0; i < n; i++) {
    var row = rows[i] || {}, src = i > 0 ? rows[i - 1] : (last ? last.best : null), b = "sets." + u + "." + i + ".";
    var ok = src && f.some(function (k) { return toNum(src[k]) !== null; });
    h += '<div class="set"><span class="i">' + (i + 1) + "</span>";
    f.forEach(function (k, j) { var pv = ok && toNum(src[k]) !== null ? fmt(toNum(src[k])) : ph[j]; h += inp("seances", id, b + k, row[k], 'inputmode="' + modes[j] + '" aria-label="Série ' + (i + 1) + ", " + aria[j] + '" placeholder="' + esc(pv) + '"'); });
    h += ok ? '<button type="button" class="fill" data-act="fillvals" data-id="' + esc(id) + '" data-base="' + b + '" data-v="' + f.map(function (k) { return k + "=" + (toNum(src[k]) !== null ? toNum(src[k]) : ""); }).join(";") + '" aria-label="Série ' + (i + 1) + ' : reprendre ' + (i > 0 ? "la série précédente" : "ta dernière performance") + '">= préc.</button>' : "<span></span>";
    h += "</div>";
  }
  return h + "</div>";
}
function libreCandidates(date) { return (plannedFor(date) || []).filter(function (t) { var d = sessionDef(t); return d && d.kind === "muscu" && !hasData(seance(date, t)); }); }
function openSheet(html, onAct, tall) {
  var back = document.getElementById("dialog");
  back.innerHTML = '<div class="dialog' + (tall ? " tall" : "") + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t">' + html + "</div>";
  back.hidden = false;
  function close() { back.hidden = true; back.innerHTML = ""; }
  back.onclick = function (ev) {
    if (ev.target === back) { close(); return; }
    var b = ev.target.closest("[data-sh]"); if (b && !b.disabled) onAct(b, close, back);
  };
  var t = back.querySelector("#dlg-t"); if (t) { t.setAttribute("tabindex", "-1"); t.focus(); }
  return close;
}
function libreDialog(date, preT) {
  var cur = libreOf(date), cands = libreCandidates(date);
  var st = { lieu: cur ? cur.lieu || "maison" : "maison", remplace: cur ? cur.remplace || "" : (preT && cands.indexOf(preT) >= 0 ? preT : "") };
  function draw() {
    var h = '<h2 id="dlg-t">Séance libre</h2><p class="small muted">Pour t\'entraîner hors de ta salle. Tu ajoutes les exercices un par un, puis tu notes charge, reps et RIR comme d\'habitude.</p>';
    h += '<div class="scale"><div class="scale-q"><span>Où t\'entraînes-tu ?</span></div><div class="seg" role="group">' + LIEUX.map(function (o) { return '<button type="button" data-sh="lieu" data-v="' + o.v + '" aria-pressed="' + (st.lieu === o.v) + '">' + esc(o.l) + "</button>"; }).join("") + "</div></div>";
    if (cands.length) {
      var one = cands.length === 1;
      h += '<div class="scale"><div class="scale-q"><span>' + (one ? "Et la séance prévue, " + esc(shortName(cands[0])) + " ?" : "Et les séances prévues ?") + '</span></div><div class="seg stack" role="group">';
      cands.forEach(function (t) { h += '<button type="button" data-sh="remp" data-v="' + esc(t) + '" aria-pressed="' + (st.remplace === t) + '">' + (one ? "Remplacée par cette séance libre" : "Remplace " + esc(shortName(t))) + "</button>"; });
      h += '<button type="button" data-sh="remp" data-v="" aria-pressed="' + (st.remplace === "") + '">' + (one ? "Je la ferai un autre jour" : "Aucune, je les ferai un autre jour") + "</button></div>";
      h += '<p class="small muted">' + (st.remplace ? esc(shortName(st.remplace)) + " comptera comme faite cette semaine. La suite du programme ne change pas." : "La séance prévue reste à faire : tu pourras l'ajouter un autre jour avec «\u00a0Ajouter une séance\u00a0».") + "</p></div>";
    }
    h += '<div class="row"><button type="button" class="btn primary grow" data-sh="ok">' + (cur ? "Enregistrer" : "Commencer") + '</button><button type="button" class="btn quiet" data-sh="cancel">Annuler</button></div>';
    if (cur) h += '<div><button type="button" class="btn small quiet danger" data-sh="del">Supprimer cette séance libre</button></div>';
    return h;
  }
  function del() { delete D.seances[seanceId(date, LIBRE)]; persist(); render(); toast("Séance libre supprimée."); }
  openSheet(draw(), function (b, close, back) {
    var a = b.dataset.sh;
    if (a === "lieu" || a === "remp") {
      if (a === "lieu") st.lieu = b.dataset.v; else st.remplace = b.dataset.v;
      back.querySelector(".dialog").innerHTML = draw();
      var again = back.querySelector('[data-sh="' + a + '"][data-v="' + b.dataset.v + '"]'); if (again) again.focus();
    } else if (a === "cancel") close();
    else if (a === "ok") {
      close();
      var s = seance(date, LIBRE, true); s.libre = true; s.lieu = st.lieu;
      if (st.remplace) s.remplace = st.remplace; else delete s.remplace;
      if (!s.liste) s.liste = [];
      persist(); render();
      if (!cur) { var el = document.getElementById("libre"); if (el) el.scrollIntoView({ block: "start" }); libreMenu(seanceId(date, LIBRE)); }
    } else if (a === "del") {
      close();
      if (hasData(cur)) dialog("Supprimer la séance libre ?", '<p class="small">Les séries et le bilan notés dans cette séance seront effacés.</p>', [{ label: "Supprimer", cls: "danger", run: del }, { label: "Annuler", cls: "primary" }]);
      else del();
    }
  });
}
/* Remplacement d'un exercice du programme : exercices de la bibliothèque qui travaillent directement
   le même muscle principal, en commençant par les remplacements cités par le programme. */
function primaryMuscle(e) {
  var c = CAT[exCat(e)], mu = (c && c.mu) || e.mu || {};
  for (var k in mu) if (mu[k] === 1) return k;
  return null;
}
function rempSuggestions(e) {
  var own = exCat(e), pm = primaryMuscle(e), out = [];
  function ok(k) { var c = CAT[k]; return c && !c.time && k !== own && out.indexOf(k) < 0 && !CATALOGUE.some(function (g) { return g.hidden && g.ex.indexOf(c) >= 0; }); }
  (e.alt || []).forEach(function (a) { var k = bankMatch(a); if (ok(k) && pm && CAT[k].mu && CAT[k].mu[pm]) out.push(k); });
  if (pm) CATALOGUE.forEach(function (g) { if (!g.hidden) g.ex.forEach(function (c) { if (ok(c.k) && c.mu && c.mu[pm] === 1) out.push(c.k); }); });
  return out.slice(0, 6);
}
function rempMenu(id, exId, e) {
  var date = id.slice(0, id.lastIndexOf("_")), h = '<h2 id="dlg-t">Exercice de remplacement</h2><p class="small muted">Remplace « ' + esc(e.name) + " » par un exercice de la bibliothèque.</p>";
  var own = exCat(e);
  CATALOGUE.forEach(function (g) {
    if (g.hidden || g.ex.every(function (c) { return c.time; })) return;
    h += '<div class="menu-group"><h3>' + esc(g.g) + "</h3>";
    g.ex.forEach(function (c) { if (c.time) return; var last = lastCat(c.k, date); h += '<button type="button" class="pick" data-sh="pick" data-k="' + c.k + '"' + (c.k === own ? " disabled" : "") + "><span>" + esc(c.n) + '</span><span class="meta">' + (c.k === own ? "exercice prévu" : last ? esc(fmtShort(last.date)) : "") + "</span></button>"; });
    h += "</div>";
  });
  h += '<div><button type="button" class="btn wide" data-sh="cancel">Fermer</button></div>';
  openSheet(h, function (b, close) { close(); if (b.dataset.sh === "pick") setRemp(id, exId, b.dataset.k); }, true);
}
/* Exercice de bibliothèque d'un remplacement : choisi dans la liste, ou reconnu d'après le nom écrit */
function rempCat(r) { if (!r) return ""; if (r.k && CAT[r.k]) return r.k; return bankMatch(r.nom); }
function setRemp(id, exId, k) {
  var doc = docFor("seances", id), rp = (doc.remp && doc.remp[exId]) || {};
  if (k) { rp.k = k; rp.nom = CAT[k].n; } else { delete rp.k; delete rp.nom; }
  setPath(doc, "remp." + exId, rp); persist(); render();
}
function libreMenu(id) {
  var date = id.slice(0, id.lastIndexOf("_")), s = D.seances[id], present = {};
  if (!s) return;
  (s.liste || []).forEach(function (it) { present[it.k] = true; });
  var h = '<h2 id="dlg-t">Ajouter un exercice</h2><p class="small muted">Touche un exercice pour l\'ajouter à la fin de la séance.</p>';
  CATALOGUE.forEach(function (g) {
    if (g.hidden) return;
    h += '<div class="menu-group"><h3>' + esc(g.g) + "</h3>";
    g.ex.forEach(function (c) {
      var last = present[c.k] ? null : lastCat(c.k, date);
      h += '<button type="button" class="pick" data-sh="pick" data-k="' + c.k + '"' + (present[c.k] ? " disabled" : "") + "><span>" + esc(c.n) + '</span><span class="meta">' + (present[c.k] ? "dans la séance" : last ? esc(fmtShort(last.date)) : "") + "</span></button>";
    });
    h += "</div>";
  });
  h += '<div class="menu-group"><h3>Pas dans la liste</h3><button type="button" class="pick" data-sh="pick" data-k="autre"><span>Autre exercice…</span><span class="meta">pas de courbe de force</span></button></div>';
  h += '<div><button type="button" class="btn wide" data-sh="cancel">Fermer</button></div>';
  openSheet(h, function (b, close) {
    close();
    if (b.dataset.sh !== "pick") return;
    var doc = D.seances[id]; if (!doc) return;
    if (!doc.liste) doc.liste = [];
    doc.nU = (doc.nU || 0) + 1;
    var u = "lx" + doc.nU, k = b.dataset.k;
    doc.liste.push({ u: u, k: k }); persist(); render();
    var el = document.getElementById("ex-" + u);
    if (el) { el.scrollIntoView({ block: "center" }); var f = el.querySelector("input"); if (f && k === "autre") f.focus(); }
  }, true);
}
function libreRemove(id, u) {
  var doc = D.seances[id]; if (!doc) return;
  var rows = doc.sets && doc.sets[u] ? valuesOf(doc.sets[u]) : [];
  var noted = rows.some(function (r) { return r && (toNum(r.c) !== null || toNum(r.r) !== null || toNum(r.t) !== null); });
  function rm() {
    doc.liste = (doc.liste || []).filter(function (it) { return it.u !== u; });
    if (doc.sets) { delete doc.sets[u]; if (!keysOf(doc.sets).length) delete doc.sets; }
    persist(); render();
  }
  if (noted) dialog("Retirer cet exercice ?", '<p class="small">Les séries notées pour cet exercice seront effacées.</p>', [{ label: "Retirer", cls: "danger", run: rm }, { label: "Annuler", cls: "primary" }]);
  else rm();
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
/* Séance de course du programme : nouvelle saisie (format prérempli si le programme le décrit),
   ancienne saisie pour les séances déjà notées avant la version 1.5 et pour le test */
function courseSession(date, def, w, s, id) {
  var tp = id.slice(id.lastIndexOf("_") + 1), vs = s.type ? s : { date: date, type: tp, programme: progIdFor(tp, date), semaine: w };
  var ci = cardioInfo(vs);
  if (!ci || ci.legacy) return bodyCourse(date, def, w, s, id);
  var h = adapteNote(s, id);
  if (ci.repos) return h;
  if (ci.spec) return h + (ci.spec.test6 ? bodyTest6(date, vs, id) : bodyChrono(date, vs, id, ci.spec.chrono || {}));
  h += alertPlanHtml(vs, id, ci);
  if (ci.texte && ci.texte.trim()) h += '<div class="note info">' + esc(ci.texte) + "</div>";
  if (def.consignes) h += '<p class="small muted">' + esc(def.consignes) + "</p>";
  h += checkin(s, id) + '<div class="hr"></div>';
  return h + cardioBody(date, vs, id, ci) + '<div data-live="' + esc(id) + '" data-kind="alerta">' + alertAHtml(vs, id, ci) + "</div>";
}
function bodySport(def, s, id) {
  var h = (def.info ? '<p class="small muted">' + esc(def.info) + "</p>" : "") + checkin(s, id) + '<div class="hr"></div><p class="small muted">Après la séance, note son intensité : elle sert à doser la séance du lendemain.</p>';
  h += '<div class="scale"><div class="scale-q"><span>Intensité de la séance</span></div>' + seg("seances", id, "intensite", ["Légère", "Normale", "Très dure"], s.intensite) + "</div>";
  h += '<label class="field"><span>' + (def.custom ? "Minutes de travail intense" : "Minutes de combat ou de travail intense") + '</span>' + inp("seances", id, "combats", s.combats, 'inputmode="numeric" placeholder="ex. 25"') + "</label>";
  h += '<label class="field"><span>Durée totale de la séance (min)</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric" placeholder="ex. ' + (toNum(def.duree) || 90) + '"') + "</label>";
  return h + bilan(s, id, true, { charge: true });
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

/* ================= Cardio : course, vélo, natation =================
   Séances notées dans D.seances : activité ajoutée (type « CARDIO<n> », champs sport et ctype)
   ou séance de course du programme (kind « course »). Les valeurs proposées en pointillé
   (placeholder) ne sont jamais enregistrées : seules les valeurs saisies comptent, partout. */
var SPORTS = [{ v: "course", l: "Course" }, { v: "velo", l: "Vélo" }, { v: "natation", l: "Natation" }];
var CTYPES = [
  { v: "recup", l: "Récupération active", d: "Très facile, pour relancer la circulation après une grosse séance." },
  { v: "ef", l: "Endurance fondamentale", d: "Allure facile et régulière : tu peux tenir une conversation." },
  { v: "fractionne", l: "Fractionné", d: "Efforts et récupérations en alternance, notés répétition par répétition." },
  { v: "libre", l: "Sortie libre", d: "Sortie variée, compétition ou test : durée, distance et ressenti." }];
var NAGES = ["Crawl", "Brasse", "Dos", "Mélange"];
function listLabel(list, v) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].l; return ""; }
function isCardioType(t) { return /^CARDIO\d+$/.test(t || ""); }
function cardioOf(date) {
  return valuesOf(D.seances).filter(function (s) { return s.date === date && isCardioType(s.type); })
    .sort(function (a, b) { return Number(a.type.slice(6)) - Number(b.type.slice(6)); });
}
function sportsOn() { var v = D.vue && D.vue.sports; return SPORTS.filter(function (s) { return !v || v[s.v] !== false; }); }
function defOf(s) {
  if (s.plan) return { kind: "muscu" };
  var prog = D.programmes[s.programme];
  return (prog && prog.sessions && prog.sessions[s.type]) || sessionDef(s.type);
}
function coursePlanOf(s, def) { var w = s.semaine || 1; if (!def.plan) return null; return def.custom ? def.plan[w - 1] || null : def.plan[w - 1] || def.plan[def.plan.length - 1]; }
/* Ce que la séance est : discipline, type, format prévu par le programme ; legacy = ancienne saisie */
function cardioInfo(s) {
  if (!s) return null;
  if (isCardioType(s.type)) return { sport: s.sport || "course", ctype: s.ctype || "ef", fr: null, free: true };
  var def = defOf(s); if (!def || def.kind !== "course") return null;
  var pl = coursePlanOf(s, def);
  if (s.legacy || (pl && pl.test)) return { sport: "course", ctype: "fractionne", legacy: true, test: !!(pl && pl.test), fr: null };
  var fr = s.fplan || (s.ftexte ? null : pl && pl.fr) || null;
  var ct = s.fctype || (pl && pl.ctype) || def.ctype, fs = s.fspec || null;
  var spec = fs && (fs.test6 || fs.chrono) ? fs : pl && (pl.test6 || pl.chrono) ? { test6: !!pl.test6, chrono: pl.chrono || null, lab: pl.lab } : null;
  var ci = { sport: s.fsport || def.sport || "course", ctype: spec ? (spec.test6 ? "test6" : "chrono") : fr ? "fractionne" : ct || s.ctype || "", fixed: !!ct || !!spec, fr: fr, prog: true, texte: s.ftexte || (pl ? pl.texte : ""),
    spec: spec, planDuree: (fs && fs.duree) || (pl && pl.duree) || null, role: (fs && fs.role) || (pl && pl.role) || def.role || "", lab: (fs && fs.lab) || (pl && pl.lab) || "" };
  var a = s.adapte;
  if (a && !spec) {
    if (a.repos) ci.repos = true;
    if (a.ctype) { ci.ctype = a.ctype; ci.fr = null; ci.planDuree = a.duree || ci.planDuree; }
    else if (a.duree) ci.planDuree = a.duree;
    if (a.court) { ci.court = true; if (ci.planDuree && ci.ctype !== "fractionne") ci.planDuree = Math.round(ci.planDuree / 2); }
    if (a.capKm) ci.capKm = a.capKm;
  }
  return ci;
}
function cardioTitle(s) {
  var ci = cardioInfo(s); if (!ci) return sessionLabel(s);
  if (!ci.free) { var def = defOf(s); return def ? def.short || def.name : "Course"; }
  return listLabel(SPORTS, ci.sport) + " · " + listLabel(CTYPES, ci.ctype).toLowerCase();
}
/* ---------- FC et fourchettes ---------- */
function fcMaxInfo() {
  var p = D.profil || {}, m = toNum(p.fcmax); if (m) return { v: Math.round(m), est: false };
  var a = toNum(p.age); if (!a) return null;
  return { v: Math.round(p.sexe === "F" ? 206 - 0.88 * a : 208 - 0.7 * a), est: true, age: a };
}
function fcBands() {
  var mx = fcMaxInfo(); if (!mx) return null;
  var p = D.profil || {}, rep = toNum(p.fcrepos);
  if (p.methode === "karvonen" && rep && rep < mx.v - 20) {
    var r = mx.v - rep;
    return { mx: mx, karv: true, rep: rep, recupHi: Math.round(rep + 0.6 * r), efLo: Math.round(rep + 0.6 * r), efHi: Math.round(rep + 0.7 * r) };
  }
  return { mx: mx, karv: false, recupHi: Math.round(mx.v * 0.7), efLo: Math.round(mx.v * 0.7), efHi: Math.round(mx.v * 0.8) };
}
function bandsNote(b) {
  if (!b) return "";
  var src = b.mx.est ? "estimée d'après ton âge (FC max ≈ " + b.mx.v + " bpm, à une dizaine de battements près)" : "calculée sur ta FC max mesurée (" + b.mx.v + " bpm)";
  return "Fourchette " + src + (b.karv ? ", sur ta réserve cardiaque" : "") + ". En cas de doute, le test de la parole prime.";
}
/* ---------- Temps, allures ---------- */
function parseTm(v) {
  if (v === null || v === undefined || v === "") return null;
  var t = String(v).trim().replace(/[’']/g, ":").replace(",", ".");
  var m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/); if (m) return Number(m[1]) * 60 + Number(m[2]);
  var n = toNum(t); return n !== null && n > 0 ? n : null;
}
function fmtTm(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ":" + pad(sec % 60); }
function fmtDur(min) { min = Math.round(min); return min >= 60 ? Math.floor(min / 60) + " h " + pad(min % 60) : min + " min"; }
function paceKm(secPerKm) { return fmtTm(secPerKm) + " /km"; }
/* ---------- Format du fractionné ---------- */
var FMT_KEYS = ["mode", "effort", "recup", "reps", "series", "entre", "echauf", "calme", "vise"];
function effFmt(s, ci) {
  var f = {}, u = s.fmt || {}, p = (ci && ci.fr) || {};
  FMT_KEYS.forEach(function (k) { f[k] = u[k] !== undefined && u[k] !== "" ? u[k] : p[k]; });
  if (f.mode !== "distance") f.mode = "temps";
  f.viseTxt = u.vise !== undefined && u.vise !== "" ? "" : p.viseTxt || "";
  var ef0 = toNum(f.effort);
  if ((u.vise === undefined || u.vise === "") && ef0 && p.pct) { var vm = vmaNow(s.date); if (vm) { f.vise = Math.round(vm / 3.6 * ef0 * p.pct / 100); f.viseTxt = "≈ " + f.vise + " m (" + fmt(vm * p.pct / 100, 1) + " km/h)"; } else f.viseTxt = p.pct + " % de ta VMA (fais le test de 6 minutes pour avoir la distance)"; }
  if ((u.vise === undefined || u.vise === "") && ef0 && p.pace) { f.vise = Math.round(ef0 / p.pace * 1000); f.viseTxt = fmt(f.vise / 1000, 2) + " km à " + fmtPace(p.pace) + " (" + kmh(p.pace) + ")"; }
  if (ci && ci.court && toNum(f.reps)) f.reps = Math.max(1, Math.ceil(toNum(f.reps) / 2));
  return f;
}
function primKey(sport, mode, s) { if (mode === "distance") return "tm"; if (sport === "velo") return s.velMes === "v" ? "v" : "p"; return "d"; }
function primVal(row, pk) { if (!row) return null; return pk === "tm" ? parseTm(row.tm) : toNum(row[pk]); }
function rowAny(row, pk) { return primVal(row, pk) !== null || toNum(row && row.fc) !== null; }
function fmtVal(v, pk) { return pk === "tm" ? fmtTm(v) : pk === "d" ? fmt(v, 0) + " m" : pk === "p" ? fmt(v, 0) + " W" : fmt(v, 1) + " km/h"; }
function fmtLine(f) {
  var ef = toNum(f.effort), rc = toNum(f.recup), n = toNum(f.reps), se = toNum(f.series) || 1;
  if (!ef || !n) return "";
  var e = f.mode === "distance" ? fmt(ef, 0) + " m" : ef >= 60 && ef % 60 === 0 ? ef / 60 + " min" : ef >= 60 ? fmtTm(ef) : ef + " s";
  var r = rc ? (rc >= 60 && rc % 60 === 0 ? rc / 60 + " min" : rc >= 60 ? fmtTm(rc) : rc + " s") : "";
  return (se > 1 ? se + " × " : "") + n + " × " + e + (r ? " / " + r : "") + (se > 1 && toNum(f.entre) ? " · " + fmt(toNum(f.entre)) + " min entre les séries" : "");
}
function fmtSig(sport, f) { return [sport, f.mode, toNum(f.effort), toNum(f.recup), toNum(f.reps), toNum(f.series) || 1].join("|"); }
function fmtMinutes(f) {
  var n = toNum(f.reps), se = toNum(f.series) || 1, rc = toNum(f.recup) || 0;
  var ef = f.mode === "distance" ? parseTm(f.vise) : toNum(f.effort);
  if (!ef || !n) return null;
  var sec = se * (n * ef + (n - 1) * rc) + (se - 1) * (toNum(f.entre) || 0) * 60 + ((toNum(f.echauf) || 0) + (toNum(f.calme) || 0)) * 60;
  return Math.round(sec / 60);
}
/* Répétitions saisies, dans l'ordre : série puis répétition */
function repList(s) {
  var out = [];
  keysOf(s.reps).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
    keysOf(s.reps[i]).map(Number).sort(function (a, b) { return a - b; }).forEach(function (j) { var r = s.reps[i][j]; if (r) out.push({ i: i, j: j, row: r }); });
  });
  return out;
}
function fracData(s, ci) {
  var f = effFmt(s, ci), pk = primKey(ci.sport, f.mode, s), vals = [], fcs = [], work = 0, ef = toNum(f.effort) || 0;
  repList(s).forEach(function (x) {
    if (!rowAny(x.row, pk)) return;
    var v = primVal(x.row, pk); if (v !== null) vals.push(v);
    var fc = toNum(x.row.fc); if (fc !== null) fcs.push(fc);
    work += f.mode === "distance" ? parseTm(x.row.tm) || 0 : ef;
  });
  return { f: f, pk: pk, vals: vals, fcs: fcs, workSec: work, sig: fmtSig(ci.sport, f) };
}
function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
function dropOf(vals) {
  if (vals.length < 2) return null;
  var k = vals.length >= 6 ? 3 : Math.floor(vals.length / 2), a = avg(vals.slice(0, k)), b = avg(vals.slice(-k));
  return { k: k, first: a, last: b, pct: (b - a) / a * 100 };
}
function prevSameFmt(s, sig) {
  var list = valuesOf(D.seances).filter(function (x) { return x.date < s.date && x.reps; }).sort(byDateDesc);
  for (var i = 0; i < list.length; i++) {
    var ci = cardioInfo(list[i]); if (!ci || ci.legacy || ci.ctype !== "fractionne") continue;
    var fd = fracData(list[i], ci); if (fd.sig === sig && fd.vals.length) return { s: list[i], fd: fd };
  }
  return null;
}
function repPace(sport, mode, pk, f, v) {
  var ef = toNum(f.effort); if (v === null || !ef) return "";
  if (mode === "temps") { if (pk !== "d" || !v) return ""; return sport === "natation" ? fmtTm(ef / (v / 100)) + " /100 m" : paceKm(ef / (v / 1000)); }
  if (sport === "velo") return fmt(ef / 1000 / (v / 3600), 1) + " km/h";
  return sport === "natation" ? fmtTm(v / (ef / 100)) + " /100 m" : paceKm(v / (ef / 1000));
}
/* ---------- Saisie ---------- */
function cardioSheet(date, s) {
  var id = seanceId(date, s.type), st = s.arret && s.arret.motif ? '<span class="state warn">Terminée plus tôt</span>' : hasData(s) ? '<span class="state done">Notée</span>' : '<span class="state alt">À noter</span>';
  var ci = cardioInfo(s);
  var h = '<section class="sheet" id="c-' + esc(s.type) + '"><div class="sheet-head"><div class="titled"><h2>' + esc(listLabel(SPORTS, ci.sport)) + '</h2><span class="small muted">' + esc(listLabel(CTYPES, ci.ctype)) + "</span></div>" + st + "</div>";
  h += '<div><button type="button" class="linkbtn" data-act="cardioedit" data-id="' + esc(id) + '">Modifier la discipline ou le type</button></div>';
  return h + cardioBody(date, s, id, ci) + '<div data-live="' + esc(id) + '" data-kind="alerta">' + alertAHtml(s, id, ci) + "</div></section>";
}
function kvRows(rows) { return '<dl class="kv">' + rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>"; }
function consigneHtml(s, ci, f) {
  var b = fcBands(), t = ci.ctype, rows = [], foot = "";
  if (ci.planDuree && (t === "recup" || t === "ef")) rows.push(["Durée", fmtDur(ci.planDuree)]);
  if (ci.capKm) rows.push(["Distance", fmt(ci.capKm, 1) + " km au plus"]);
  if (t === "recup") { if (b) rows.push(["FC", "moins de " + b.recupHi + " bpm"]); rows.push(["Ressenti", "1 à 2 sur 10"], ["Repère", "très facile, respiration calme"]); }
  else if (t === "ef") { if (b) rows.push(["FC", b.efLo + " à " + b.efHi + " bpm, sans dépasser " + b.efHi]); rows.push(["Ressenti", "3 à 4 sur 10"], ["Repère", "tu peux parler en phrases complètes"]); }
  else if (t === "fractionne") {
    rows.push(["Ressenti", "7 à 9 sur 10"], ["Repère", "difficile mais régulier, tenable jusqu'à la dernière répétition"]);
    var pk = primKey(ci.sport, f.mode, s), what = pk === "tm" ? "Temps" : pk === "d" ? "Distance" : pk === "p" ? "Puissance" : "Vitesse";
    if (f.viseTxt) rows.push([what + " visé" + (pk === "d" || pk === "p" || pk === "v" ? "e" : ""), f.viseTxt + " par répétition"]);
    else if (f.vise !== undefined && f.vise !== "" && (pk === "tm" ? parseTm(f.vise) : toNum(f.vise)) !== null) rows.push([what + " visé" + (pk === "tm" ? "" : "e"), fmtVal(pk === "tm" ? parseTm(f.vise) : toNum(f.vise), pk) + " par répétition"]);
    else { var pv = prevSameFmt(s, fmtSig(ci.sport, f)); if (pv) foot = "Ta dernière séance du même format (" + fmtShort(pv.s.date) + ") : " + fmtVal(avg(pv.fd.vals), pk) + " en moyenne par répétition. ";
    }
    var short = f.mode === "temps" ? toNum(f.effort) && toNum(f.effort) <= 60 : parseTm(f.vise) && parseTm(f.vise) <= 60;
    if (short) foot += "La FC met une à deux minutes à suivre l'effort : sur des répétitions courtes, compare surtout les " + (pk === "tm" ? "temps" : pk === "d" ? "distances" : "valeurs") + ".";
  } else return '<p class="small muted">Sortie libre : pas de consigne de FC. Note la durée, la distance et ton ressenti.</p>';
  var h = '<div class="target"><h3>Ta consigne</h3>' + kvRows(rows);
  if (t !== "fractionne") h += '<p class="tiny muted">' + (b ? esc(bandsNote(b)) : 'Indique ton âge ou ta FC max dans Réglages pour avoir une fourchette de FC. En attendant, fie-toi au ressenti et au test de la parole.') + "</p>";
  if (foot) h += '<p class="tiny muted">' + esc(foot) + "</p>";
  if (!b && t !== "fractionne") h += '<div><button type="button" class="btn small" data-act="view" data-v="reglages" data-r="profil">Compléter mon profil</button></div>';
  return h + "</div>";
}
function sportNote(sport) {
  if (sport === "velo") return "À vélo, la FC est souvent un peu plus basse qu'en course pour un même effort : garde aussi un œil sur le ressenti.";
  if (sport === "natation") return "Dans l'eau, la FC mesurée au poignet est souvent moins fiable : elle reste facultative et le ressenti sert de repère principal.";
  return "FC facultative : laisse vide si tu n'as ni montre ni ceinture.";
}
function cardioBody(date, s, id, ci) {
  var h = "", f = effFmt(s, ci);
  if (s.arret && s.arret.motif) h += '<div class="note warn"><b>Séance terminée plus tôt</b> (' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + ").</div>";
  if (ci.prog && !ci.fr && !ci.fixed) {
    h += '<div class="scale"><div class="scale-q"><span>Type de séance</span></div>' + seg("seances", id, "ctype", CTYPES.map(function (c) { return { v: c.v, l: c.l }; }), s.ctype) + "</div>";
    if (!s.ctype) return h + '<p class="small muted">Choisis le type de séance pour afficher la saisie.</p>';
  }
  h += consigneHtml(s, ci, f);
  if (ci.ctype === "fractionne") h += fracInputs(s, id, ci, f);
  else h += globalInputs(s, id, ci);
  h += '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true, { charge: true });
  return h;
}
function globalInputs(s, id, ci) {
  var sp = ci.sport, h = '<div class="hr"></div><div class="section"><h3>Ta séance</h3>';
  if (sp === "natation") {
    h += '<div class="grid2"><label class="field"><span>Distance (m)</span>' + inp("seances", id, "distance", s.distance, 'inputmode="numeric"') + '</label><label class="field"><span>Durée (min)</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric"') + "</label></div>";
    h += '<div class="scale"><div class="scale-q"><span>Nage principale</span></div>' + seg("seances", id, "nage", NAGES, s.nage) + "</div>";
  } else {
    h += '<div class="grid3"><label class="field"><span>Durée (min)</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric"') + '</label><label class="field"><span>Distance (km)</span>' + inp("seances", id, "distance", s.distance, 'inputmode="decimal"') + '</label><label class="field"><span>Dénivelé (m)</span>' + inp("seances", id, "deniv", s.deniv, 'inputmode="numeric" placeholder="facult."') + "</label></div>";
  }
  h += '<div class="' + (sp === "velo" ? "grid3" : "grid2") + '">' + (sp === "velo" ? '<label class="field"><span>Puissance (W)</span>' + inp("seances", id, "puiss", s.puiss, 'inputmode="numeric" placeholder="facult."') + "</label>" : "") +
    '<label class="field"><span>FC moy.' + (sp === "velo" ? "" : " (bpm)") + "</span>" + inp("seances", id, "fcMoy", s.fcMoy, 'inputmode="numeric"') + '</label><label class="field"><span>FC max' + (sp === "velo" ? "" : " (bpm)") + "</span>" + inp("seances", id, "fcMax", s.fcMax, 'inputmode="numeric"') + "</label></div>";
  h += '<p class="tiny muted">' + esc(sportNote(sp)) + "</p>";
  h += '<div data-live="' + esc(id) + '" data-kind="stats">' + liveStats(s, ci) + "</div>";
  return h + "</div>";
}
function liveStats(s, ci) {
  var sp = ci.sport, dur = toNum(s.duree), dist = toNum(s.distance), h = "";
  if (dur && dist) {
    if (sp === "natation") h += '<div class="stats"><div class="stat"><b>' + fmtTm(dur * 60 / (dist / 100)) + ' /100 m</b><span>allure moyenne</span></div></div>';
    else { var kmh = dist / (dur / 60); h += '<div class="stats">' + (sp === "course" ? '<div class="stat"><b>' + paceKm(3600 / kmh) + '</b><span>allure moyenne</span></div>' : "") + '<div class="stat"><b>' + fmt(kmh, 1) + ' km/h</b><span>vitesse' + (sp === "course" ? "" : " moyenne") + "</span></div></div>"; }
  }
  var fc = toNum(s.fcMoy), b = fcBands();
  if (fc && b && (ci.ctype === "ef" || ci.ctype === "recup")) {
    var hi = ci.ctype === "ef" ? b.efHi : b.recupHi;
    h += fc > hi ? '<div class="note warn"><b>FC moyenne au-dessus de ta fourchette</b> (' + fmt(fc, 0) + " bpm pour " + hi + " au plus) : séance plus intense que prévu.</div>"
      : '<div class="note ok"><b>FC moyenne dans ta fourchette</b> (' + fmt(fc, 0) + " bpm).</div>";
  }
  return h;
}
function fracInputs(s, id, ci, f) {
  var sp = ci.sport, u = s.fmt || {}, p = ci.fr || {}, h = '<div class="section"><h3>Format</h3><div class="format">';
  function ph(k) { return p[k] !== undefined && p[k] !== "" ? ' placeholder="' + esc(String(p[k]).replace(".", ",")) + '"' : ""; }
  function fi(k, label, mode) { return '<label class="field"><span>' + esc(label) + "</span>" + inp("seances", id, "fmt." + k, u[k], 'inputmode="' + (mode || "numeric") + '"' + ph(k)) + "</label>"; }
  h += '<div class="scale"><div class="scale-q"><span>Effort mesuré</span></div><div class="seg" role="group">' + [{ v: "temps", l: "En temps" }, { v: "distance", l: "En distance" }].map(function (o) {
    return '<button type="button" data-act="fmtmode" data-id="' + esc(id) + '" data-v="' + o.v + '" aria-pressed="' + (f.mode === o.v) + '">' + o.l + "</button>"; }).join("") + "</div></div>";
  h += '<div class="grid2">' + fi("effort", f.mode === "distance" ? "Effort (m)" : "Effort (s)") + fi("recup", "Récupération (s)") + "</div>";
  h += '<div class="grid3">' + fi("reps", "Répétitions") + fi("series", "Séries") + fi("entre", "Entre séries (min)", "decimal") + "</div>";
  h += '<div class="grid2">' + fi("echauf", "Échauffement (min)") + fi("calme", "Retour au calme (min)") + "</div>";
  var pk = primKey(sp, f.mode, s);
  var vl = pk === "tm" ? "Temps visé (min:s)" : pk === "d" ? "Distance visée (m)" : pk === "p" ? "Puissance visée (W)" : "Vitesse visée (km/h)";
  h += '<label class="field"><span>' + esc(vl) + ", facultatif</span>" + inp("seances", id, "fmt.vise", u.vise, 'inputmode="' + (pk === "tm" ? "text" : "decimal") + '"' + (p.vise !== undefined ? ' placeholder="' + esc(String(p.vise).replace(".", ",")) + '"' : "")) + "</label>";
  var line = fmtLine(f);
  if (line) h += '<p class="line">' + esc(line) + "</p>";
  if (ci.fr) h += '<p class="tiny muted">Rempli d\'après ton programme (en pointillé). Ne saisis que ce que tu as fait autrement.</p>';
  h += "</div></div>";
  if (sp === "velo" && f.mode === "temps") h += '<div class="scale"><div class="scale-q"><span>Mesure à chaque répétition</span></div>' + seg("seances", id, "velMes", [{ v: "p", l: "Puissance" }, { v: "v", l: "Vitesse" }], s.velMes || "p") + "</div>";
  h += '<div class="section"><h3>Répétitions</h3>';
  var nRep = toNum(f.reps), nSer = Math.max(toNum(f.series) || 1, keysOf(s.reps).length ? Math.max.apply(null, keysOf(s.reps).map(Number)) + 1 : 0, toNum(s.nSer) || 0);
  if (!nRep && !keysOf(s.reps).length) return h + '<p class="small muted">Indique le nombre de répétitions et l\'effort pour afficher les lignes.</p></div>' + fracTotals(s, id, f);
  h += '<p class="small muted">Les chiffres en pointillé ne sont qu\'une proposition : une répétition ne compte que si tu la saisis.' + (pk === "tm" ? " Temps en minutes et secondes, par exemple 1:52." : "") + " FC facultative.</p>";
  var head = pk === "tm" ? "Temps" : pk === "d" ? "Distance (m)" : pk === "p" ? "Puissance (W)" : "Vitesse (km/h)";
  var prevV = null, prevFc = null, viseV = pk === "tm" ? parseTm(f.vise) : toNum(f.vise);
  for (var i = 0; i < nSer; i++) {
    var srows = (s.reps && s.reps[i]) || {}, n = Math.max(nRep || 0, keysOf(srows).length ? Math.max.apply(null, keysOf(srows).map(Number)) + 1 : 0, toNum((s.nRep || {})[i]) || 0) || 1;
    var sv = []; keysOf(srows).forEach(function (j) { var v = primVal(srows[j], pk); if (v !== null) sv.push(v); });
    h += '<div class="serie"><div class="serie-title"><h3>Série ' + (i + 1) + '</h3><span class="small muted">' + (sv.length ? "moyenne " + esc(fmtVal(avg(sv), pk)) : n + " répétition" + (n > 1 ? "s" : "")) + "</span></div>";
    h += '<div class="rep-head"><span></span><span>' + esc(head) + "</span><span>FC fin (bpm)</span><span>" + (pk === "p" || pk === "v" ? "" : "Allure") + "</span></div>";
    for (var j = 0; j < n; j++) {
      var row = srows[j] || {}, v = primVal(row, pk), phv = prevV !== null ? prevV : viseV, b = "reps." + i + "." + j + ".";
      h += '<div class="rep"><span class="i">' + (j + 1) + "</span>" +
        inp("seances", id, b + pk, row[pk], 'inputmode="' + (pk === "tm" ? "text" : pk === "v" ? "decimal" : "numeric") + '" aria-label="Série ' + (i + 1) + ", répétition " + (j + 1) + ", " + esc(head.toLowerCase()) + '" placeholder="' + esc(phv !== null ? (pk === "tm" ? fmtTm(phv) : String(phv).replace(".", ",")) : "") + '"') +
        inp("seances", id, b + "fc", row.fc, 'inputmode="numeric" aria-label="Série ' + (i + 1) + ", répétition " + (j + 1) + ', FC en fin de répétition" placeholder="' + (prevFc !== null ? prevFc : "facult.") + '"') +
        '<span class="pace" data-live="' + esc(id) + '" data-kind="pace" data-r="' + i + "." + j + '">' + esc(repPace(sp, f.mode, pk, f, v)) + "</span></div>";
      if (v !== null) prevV = v;
      if (toNum(row.fc) !== null) prevFc = toNum(row.fc);
    }
    h += '<div><button type="button" class="btn small quiet" data-act="addrep" data-id="' + esc(id) + '" data-i="' + i + '" data-n="' + (n + 1) + '">Ajouter une répétition</button></div></div>';
  }
  h += '<div><button type="button" class="btn small quiet" data-act="addser" data-id="' + esc(id) + '" data-n="' + (nSer + 1) + '">Ajouter une série</button></div></div>';
  h += '<div class="hr"></div><div class="section"><h3>Début et fin de séance</h3><div data-live="' + esc(id) + '" data-kind="sum">' + liveSum(s, ci) + "</div></div>";
  return h + fracTotals(s, id, f);
}
function fracTotals(s, id, f) {
  var est = fmtMinutes(f);
  return '<div class="grid2"><label class="field"><span>Durée totale (min)</span>' + inp("seances", id, "duree", s.duree, 'inputmode="numeric"' + (est ? ' placeholder="' + est + '"' : "")) + '</label><label class="field"><span>Distance totale (km)</span>' + inp("seances", id, "distTot", s.distTot, 'inputmode="decimal" placeholder="facult."') + "</label></div>" +
    '<p class="tiny muted">' + (est ? "Durée estimée d'après le format, en pointillé : saisis la durée réelle pour qu'elle compte dans la charge. " : "") + "Distance totale : échauffement et récupérations compris.</p>";
}
function liveSum(s, ci) {
  var fd = fracData(s, ci), vals = fd.vals, pk = fd.pk, dr = dropOf(vals);
  if (vals.length < 2) return '<p class="small muted">Le résumé apparaît dès 2 répétitions saisies.</p>';
  var up = pk === "tm" ? "plus lent" : "hausse", down = pk === "tm" ? "plus rapide" : "baisse";
  var word = dr.pct > 0 ? up : dr.pct < 0 ? down : "écart";
  var kl = dr.k === 1 ? "1re" : dr.k + " premières", kr = dr.k === 1 ? "dernière" : dr.k + " dernières";
  var h = '<div class="compare"><div><b>' + esc(fmtVal(dr.first, pk)) + "</b><span>" + kl + '</span></div><div><b>' + esc(fmtVal(dr.last, pk)) + "</b><span>" + kr + '</span></div><div><b>' + esc(signed(dr.pct, 0)) + " %</b><span>" + word + "</span></div></div>";
  h += repChart(s, ci, fd);
  var tot = pk === "d" ? ", " + fmt(vals.reduce(function (a, b) { return a + b; }, 0), 0) + " m en tout" : "";
  h += '<p class="small">Moyenne : <b>' + esc(fmtVal(avg(vals), pk)) + "</b> par répétition sur " + vals.length + " répétition" + (vals.length > 1 ? "s" : "") + tot + ".";
  var pv = prevSameFmt(s, fd.sig);
  if (pv) { var pd = dropOf(pv.fd.vals); h += " Dernière séance du même format (" + esc(fmtShort(pv.s.date)) + ") : " + esc(fmtVal(avg(pv.fd.vals), pk)) + (pd ? ", " + (pd.pct > 0 ? up : down) + " de " + fmt(Math.abs(pd.pct), 0) + " %" : "") + "."; }
  h += "</p>";
  if (fd.fcs.length >= 2) h += '<p class="small muted">FC de fin de répétition : de ' + fmt(fd.fcs[0], 0) + " à " + fmt(fd.fcs[fd.fcs.length - 1], 0) + " bpm au fil de la séance.</p>";
  return h;
}
function repChart(s, ci, fd) {
  var pk = fd.pk, items = [];
  repList(s).forEach(function (x) { var v = primVal(x.row, pk); if (v !== null) items.push({ i: x.i, v: v }); });
  if (items.length < 2) return "";
  var W = 600, H = 170, L = 44, R = 8, T = 10, B = 26, gap = 14, nSer = 0, last = -1;
  items.forEach(function (it) { if (it.i !== last) { nSer++; last = it.i; } });
  var lo = Math.min.apply(null, items.map(function (x) { return x.v; })), hi = Math.max.apply(null, items.map(function (x) { return x.v; }));
  var padv = Math.max((hi - lo) * 0.25, hi * 0.03, 1), y0 = Math.max(0, lo - padv), y1 = hi + padv * 0.4;
  var bw = (W - L - R - gap * (nSer - 1)) / items.length;
  function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
  var g = "", step = niceStep((y1 - y0) / 3);
  for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text class="lbl" x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(pk === "tm" ? fmtTm(v) : fmt(v, 0)) + "</text>";
  var x = L, cur = items[0].i, start = L, labels = [];
  items.forEach(function (it, k) {
    if (it.i !== cur) { labels.push({ x: (start + x) / 2, i: cur }); x += gap; start = x; cur = it.i; }
    g += '<rect class="bar-rep" x="' + (x + 1.5).toFixed(1) + '" y="' + Y(it.v).toFixed(1) + '" width="' + Math.max(1, bw - 3).toFixed(1) + '" height="' + (H - B - Y(it.v)).toFixed(1) + '" rx="2"><title>' + esc("Série " + (it.i + 1) + " : " + fmtVal(it.v, pk)) + "</title></rect>";
    x += bw;
  });
  labels.push({ x: (start + x) / 2, i: cur });
  if (labels.length > 1) labels.forEach(function (l) { g += '<text class="lbl" x="' + l.x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">Série ' + (l.i + 1) + "</text>"; });
  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc("Valeur de chaque répétition, de " + fmtVal(items[0].v, pk) + " à " + fmtVal(items[items.length - 1].v, pk)) + '">' + g + "</svg>";
}
function chargeLine(s) {
  var d = toNum(s.duree), r = toNum((s.bilan || {}).rpe);
  return d && r ? '<p class="calc-out">Charge de la séance : <b>' + fmt(d, 0) + " min × " + fmt(r, 0) + " = " + fmt(d * r, 0) + "</b></p>" : '<p class="small muted">Note la durée et la difficulté pour calculer la charge de la séance.</p>';
}
function liveUpdate(id) {
  var s = D.seances[id]; if (!s) return;
  var ci = cardioInfo(s);
  Array.prototype.forEach.call(app.querySelectorAll("[data-live]"), function (el) {
    if (el.dataset.live !== id) return;
    var k = el.dataset.kind;
    if (k === "charge") el.innerHTML = chargeLine(s);
    else if (k === "alerta") el.innerHTML = alertAHtml(s, id, ci);
    else if (ci && k === "stats") el.innerHTML = liveStats(s, ci);
    else if (ci && k === "sum") el.innerHTML = liveSum(s, ci);
    else if (ci && k === "pace") {
      var f = effFmt(s, ci), pk = primKey(ci.sport, f.mode, s), ij = el.dataset.r.split("."), row = s.reps && s.reps[ij[0]] ? s.reps[ij[0]][ij[1]] : null;
      el.textContent = repPace(ci.sport, f.mode, pk, f, primVal(row, pk));
    }
  });
}
/* Ajout ou modification d'une activité : discipline puis type */
function cardioDialog(date, id) {
  var cur = id ? D.seances[id] : null, st = { sport: cur ? cur.sport : (sportsOn()[0] || SPORTS[0]).v };
  function draw() {
    var b = fcBands(), sports = sportsOn().slice();
    if (cur && !sports.some(function (x) { return x.v === cur.sport; })) sports.push(SPORTS.filter(function (x) { return x.v === cur.sport; })[0]);
    var h = '<h2 id="dlg-t">' + (cur ? "Modifier l'activité" : "Nouvelle activité") + '</h2><p class="small muted">Choisis la discipline, puis le type de séance.</p>';
    h += '<div class="scale"><div class="scale-q"><span>Discipline</span></div><div class="seg" role="group">' + sports.map(function (o) { return '<button type="button" data-sh="sport" data-v="' + o.v + '" aria-pressed="' + (st.sport === o.v) + '">' + esc(o.l) + "</button>"; }).join("") + "</div></div>";
    h += '<div class="scale"><div class="scale-q"><span>Type de séance</span></div><div class="types">';
    CTYPES.forEach(function (c) {
      var hint = c.v === "recup" ? (b ? "FC conseillée : moins de " + b.recupHi + " bpm · " : "") + "ressenti 1 à 2" : c.v === "ef" ? (b ? "FC conseillée : " + b.efLo + " à " + b.efHi + " bpm · " : "") + "ressenti 3 à 4" : c.v === "fractionne" ? "ressenti 7 à 9" : "pas de consigne de FC";
      h += '<button type="button" class="type" data-sh="type" data-v="' + c.v + '"' + (cur && cur.ctype === c.v && cur.sport === st.sport ? ' aria-pressed="true"' : "") + "><b>" + esc(c.l) + "</b><span>" + esc(c.d) + '</span><span class="hint">' + esc(hint) + "</span></button>";
    });
    h += "</div></div>";
    if (!b) h += '<p class="small muted">Indique ton âge ou ta FC max dans Réglages pour avoir des fourchettes de FC.</p>';
    h += '<div class="row"><button type="button" class="btn quiet" data-sh="cancel">Annuler</button>' + (cur ? '<button type="button" class="btn small quiet danger" data-sh="del">Supprimer cette activité</button>' : "") + "</div>";
    return h;
  }
  function del() { delete D.seances[id]; persist(); render(); toast("Activité supprimée."); }
  openSheet(draw(), function (b, close, back) {
    var a = b.dataset.sh;
    if (a === "sport") { st.sport = b.dataset.v; back.querySelector(".dialog").innerHTML = draw(); var again = back.querySelector('[data-sh="sport"][data-v="' + st.sport + '"]'); if (again) again.focus(); }
    else if (a === "cancel") close();
    else if (a === "type") {
      close();
      var s = cur;
      if (!s) {
        var n = 1; cardioOf(date).forEach(function (x) { n = Math.max(n, Number(x.type.slice(6)) + 1); });
        s = seance(date, "CARDIO" + n, true); s.cardio = 1;
      }
      s.sport = st.sport; s.ctype = b.dataset.v; persist(); render();
      var el = document.getElementById("c-" + s.type); if (el) el.scrollIntoView({ block: "start" });
    } else if (a === "del") {
      close();
      if (hasData(cur)) dialog("Supprimer cette activité ?", '<p class="small">Les données notées pour cette activité seront effacées.</p>', [{ label: "Supprimer", cls: "danger", run: del }, { label: "Annuler", cls: "primary" }]);
      else del();
    }
  }, true);
}
/* ---------- Charge, zones, repère OMS ---------- */
function sessLoad(s) { var d = toNum(s.duree), r = toNum((s.bilan || {}).rpe); return d && r ? d * r : null; }
function loadCat(s) {
  var ci = cardioInfo(s); if (ci) return ci.sport;
  if (s.type === LIBRE) return "muscu";
  var def = defOf(s); if (!def) return null;
  return def.kind === "muscu" ? "muscu" : def.kind === "sport" ? "sport" : null;
}
function catLabel(c) {
  if (c === "muscu") return "Musculation";
  if (c === "sport") { var n = null; valuesOf(D.programmes).forEach(function (p) { keysOf(p.sessions).forEach(function (k) { if (p.sessions[k].kind === "sport" && !n) n = p.sessions[k].name; }); }); return n || "Sport"; }
  return listLabel(SPORTS, c);
}
var CAT_LOAD_ORDER = ["muscu", "sport", "course", "velo", "natation"];
function inRange(from, to) { return valuesOf(D.seances).filter(function (s) { return s.date >= from && s.date <= to && hasData(s); }); }
function weekCharge(from, to) {
  var by = {}, tot = 0, miss = 0;
  inRange(from, to).forEach(function (s) {
    var c = loadCat(s); if (!c) return;
    if (s.smod && s.smod.statut) { var Lm = smodLoad(s); if (!Lm) return; c = "sport"; var em = by[c] || (by[c] = { load: 0, n: 0, nTot: 0, min: 0 }); em.nTot++; em.load += Lm; em.n++; tot += Lm; return; }
    var e = by[c] || (by[c] = { load: 0, n: 0, nTot: 0, min: 0 }), L = sessLoad(s);
    e.nTot++;
    var z = cardioZones(s); if (z) e.min += z.dur;
    if (L) { e.load += L; e.n++; tot += L; } else miss++;
  });
  return { by: by, total: tot, miss: miss };
}
function cardioZones(s) {
  var ci = cardioInfo(s); if (!ci || ci.test) return null;
  var dur = toNum(s.duree) || 0, z = { sport: ci.sport, dur: dur, basse: 0, seuil: 0, haute: 0, nr: 0 };
  if (ci.legacy) { z.nr = dur; return z; }
  if (ci.ctype === "recup" || ci.ctype === "ef") z.basse = dur;
  else if (ci.ctype === "fractionne") { var hh = fracData(s, ci).workSec / 60; z.haute = hh; z.basse = Math.max(0, dur - hh); z.dur = Math.max(dur, hh); }
  else {
    var fc = toNum(s.fcMoy), mx = fcMaxInfo(), r = toNum((s.bilan || {}).rpe), lvl = null;
    if (fc && mx) lvl = fc < mx.v * 0.82 ? "basse" : fc <= mx.v * 0.87 ? "seuil" : "haute";
    else if (r) lvl = r <= 4 ? "basse" : r <= 6 ? "seuil" : "haute";
    if (lvl) z[lvl] = dur; else z.nr = dur;
  }
  return z;
}
function weekZones(from, to) {
  var z = { basse: 0, seuil: 0, haute: 0, nr: 0, dur: 0 };
  inRange(from, to).forEach(function (s) { var x = cardioZones(s); if (x) ["basse", "seuil", "haute", "nr", "dur"].forEach(function (k) { z[k] += x[k]; }); });
  return z;
}
function weekOms(from, to) {
  var mod = 0, vig = 0, renfo = {};
  inRange(from, to).forEach(function (s) {
    var ci = cardioInfo(s), r = toNum((s.bilan || {}).rpe), d = toNum(s.duree), c = loadCat(s);
    if (ci) { if (!d) { var z = cardioZones(s); if (z && z.haute) vig += z.haute; return; } if (ci.legacy ? r >= 7 : ci.ctype === "fractionne" || (ci.ctype === "libre" && r >= 7)) vig += d; else mod += d; }
    else if (c === "sport") { if (d) { if (r >= 7) vig += d; else mod += d; } }
    else if (c === "muscu") renfo[s.date] = true;
    if (s.footing && toNum(s.footing)) mod += toNum(s.footing);
  });
  return { mod: mod, vig: vig, eq: mod + 2 * vig, renfo: keysOf(renfo).length };
}
function chargeBar(label, val, mx, sub) {
  return '<div class="vrow grp" role="img" aria-label="' + esc(label + " : charge " + fmt(val, 0)) + '"><span class="m">' + esc(label) + '</span><span class="track">' + (val ? '<span class="done" data-w="' + (val / mx * 100).toFixed(1) + '"></span>' : "") + '</span><span class="v"><b>' + fmt(val, 0) + "</b></span></div>" + (sub ? '<p class="vsub">' + esc(sub) + "</p>" : "");
}
function weekCardioSheets(mon) {
  var sun = addDays(mon, 6), wc = weekCharge(mon, sun), prev = weekCharge(addDays(mon, -7), addDays(mon, -1)), h = "";
  var cats = CAT_LOAD_ORDER.filter(function (c) { return wc.by[c]; });
  h += '<section class="sheet"><div class="titled"><h2>Charge de la semaine</h2><p class="small muted">Durée × difficulté, additionnée sur toutes les activités.</p></div>';
  if (!cats.length) h += '<p class="small muted">Rien de noté cette semaine. La charge se calcule avec la durée et la difficulté de chaque séance.</p>';
  else {
    h += '<div class="kpis two"><div class="kpi"><b>' + fmt(wc.total, 0) + '</b><span>cette semaine</span></div><div class="kpi"><b>' + (prev.total ? fmt(prev.total, 0) : "–") + "</b><span>semaine précédente</span></div></div>";
    var mx = Math.max.apply(null, cats.map(function (c) { return wc.by[c].load; }).concat([1])) * 1.1, vh = '<div class="vol">';
    cats.forEach(function (c) {
      var e = wc.by[c], sub = (e.n === e.nTot ? e.n + " séance" + (e.n > 1 ? "s" : "") : e.n + " séance" + (e.n > 1 ? "s" : "") + " comptée" + (e.n > 1 ? "s" : "") + " sur " + e.nTot) + (e.min ? " · " + fmtDur(e.min) : "");
      vh += chargeBar(catLabel(c), e.load, mx, sub);
    });
    h += vh + "</div>";
    if (wc.miss) h += '<p class="small muted">' + wc.miss + " séance" + (wc.miss > 1 ? "s" : "") + " sans durée ou sans difficulté : non comptée" + (wc.miss > 1 ? "s" : "") + ". Tu peux les compléter dans la séance.</p>";
  }
  h += '<details class="calc"><summary class="small">Comment c\'est calculé</summary><ul class="small"><li>Charge d\'une séance : sa durée en minutes × sa difficulté de 1 à 10 (méthode de la séance-RPE, Foster, 2001). Elle permet d\'additionner musculation, sport et cardio sur une même échelle.</li><li>Seules les valeurs que tu as saisies comptent : une durée proposée en pointillé n\'est pas comptée.</li><li>Pour suivre l\'évolution, compare d\'une semaine à l\'autre plutôt que de viser un chiffre précis.</li></ul></details></section>';
  var z = weekZones(mon, sun);
  if (z.dur) {
    var tot = z.basse + z.seuil + z.haute, m2 = Math.max(z.basse, z.seuil, z.haute, 1) * 1.1;
    var zb = function (l, v, sub) { return '<div class="vrow grp" role="img" aria-label="' + esc(l + " : " + fmt(v, 0) + " minutes") + '"><span class="m">' + l + '</span><span class="track">' + (v ? '<span class="done" data-w="' + (v / m2 * 100).toFixed(1) + '"></span>' : "") + '</span><span class="v"><b>' + fmt(v, 0) + "</b> min</span></div>" + (sub ? '<p class="vsub">' + esc(sub) + "</p>" : ""); };
    var pc = function (v) { return tot ? " · " + fmt(v / tot * 100, 0) + " %" : ""; };
    h += '<section class="sheet"><div class="titled"><h2>Intensité en endurance</h2><p class="small muted">Temps des séances de course, vélo et natation, réparti selon leur type.</p></div><div class="vol">' +
      zb("Basse", z.basse, "endurance, récupération, échauffements" + pc(z.basse)) + zb("Seuil", z.seuil, z.seuil ? "sorties libres soutenues" + pc(z.seuil) : "") + zb("Haute", z.haute, z.haute ? "répétitions du fractionné" + pc(z.haute) : "") + "</div>";
    if (z.nr) h += '<p class="small muted">' + fmtDur(z.nr) + " non réparties (séances notées avant cette version ou sans repère d'intensité).</p>";
    h += '<p class="small muted">Repère courant : la grande majorité du temps en zone basse, une petite part en zone haute.</p></section>';
  }
  if (!(D.vue && D.vue.oms === false)) {
    var o = weekOms(mon, sun);
    if (o.eq || o.renfo) {
      var top = Math.max(450, o.eq * 1.05), ok = o.eq >= 150;
      h += '<section class="sheet"><div class="titled"><h2>Repère OMS</h2><p class="small muted">Au moins 150 à 300 min d\'activité d\'endurance modérée par semaine. Une minute intense compte double.</p></div>' +
        '<div class="gauge" role="img" aria-label="' + esc(fmt(o.eq, 0) + " minutes en équivalent modéré, repère de 150 à 300 minutes " + (ok ? "atteint" : "pas encore atteint")) + '"><span class="fillbar" data-w="' + (Math.min(o.eq, top) / top * 100).toFixed(1) + '"></span><span class="mark" data-l="' + (150 / top * 100).toFixed(1) + '"></span><span class="mark" data-l="' + (300 / top * 100).toFixed(1) + '"></span></div>' +
        '<div class="gauge-scale"><span data-l="' + (150 / top * 100).toFixed(1) + '">150</span><span data-l="' + (300 / top * 100).toFixed(1) + '">300</span></div>' +
        '<div class="note ' + (ok ? "ok" : "") + '"><b>' + fmt(o.eq, 0) + " min en équivalent modéré" + (ok ? " : repère atteint." : ".") + "</b> " + fmt(o.mod, 0) + " min modérées et " + fmt(o.vig, 0) + " min intenses.</div>" +
        '<p class="small muted">Comptés : course, vélo, natation, ' + esc(catLabel("sport").toLowerCase()) + " et footing du jour de repos. Endurance et récupération = modérée ; fractionné et ressenti de 7 ou plus = intense. Renforcement musculaire : " + o.renfo + " jour" + (o.renfo > 1 ? "s" : "") + ", pour 2 recommandés.</p></section>";
    }
  }
  return h;
}
/* ---------- Progrès : endurance ---------- */
function enduranceSheets() {
  var h = "", sigs = {};
  valuesOf(D.seances).forEach(function (s) {
    var ci = cardioInfo(s); if (!ci || ci.legacy || ci.ctype !== "fractionne") return;
    var fd = fracData(s, ci); if (!fd.vals.length) return;
    var e = sigs[fd.sig] || (sigs[fd.sig] = { sig: fd.sig, label: listLabel(SPORTS, ci.sport) + " · " + (fmtLine(fd.f) || "format libre"), pk: fd.pk, pts: [], last: "" });
    e.pts.push({ x: s.date, y: avg(fd.vals), drop: dropOf(fd.vals) }); if (s.date > e.last) e.last = s.date;
  });
  var keys = keysOf(sigs).sort(function (a, b) { return sigs[a].last < sigs[b].last ? 1 : -1; });
  h += '<section class="sheet"><div class="titled"><h2>Fractionné</h2><p class="small muted">Valeur moyenne par répétition, séance après séance, pour un même format.</p></div>';
  if (!keys.length) h += '<p class="small muted">La courbe apparaît après ta première séance de fractionné notée.</p>';
  else {
    var sel = D.vue && sigs[D.vue.frac] ? D.vue.frac : keys[0], e = sigs[sel], pk = e.pk;
    if (keys.length > 1) h += '<div class="seg chips" role="group">' + keys.map(function (k) { return '<button type="button" data-act="fracsel" data-k="' + esc(k) + '" aria-pressed="' + (k === sel) + '">' + esc(sigs[k].label) + "</button>"; }).join("") + "</div>";
    else h += '<p class="small"><b>' + esc(e.label) + "</b></p>";
    var pts = e.pts.sort(function (a, b) { return a.x < b.x ? -1 : 1; });
    h += chart([{ pts: pts, cls: "s-plate", dots: true, line: true }], pk === "tm" ? { unit: "par répétition", minStep: 5, tick: function (v) { return fmtTm(v); } } : { unit: pk === "d" ? "m" : pk === "p" ? "W" : "km/h" });
    h += '<div class="log">' + pts.slice().reverse().slice(0, 6).map(function (p) {
      return '<div class="log-item"><div class="row"><b>' + esc(fmtShort(p.x)) + "</b><span>" + esc(fmtVal(p.y, pk)) + (p.drop ? " · " + (p.drop.pct > 0 ? (pk === "tm" ? "plus lent" : "hausse") : (pk === "tm" ? "plus rapide" : "baisse")) + " de " + fmt(Math.abs(p.drop.pct), 0) + " %" : "") + "</span></div></div>";
    }).join("") + "</div>";
    h += '<p class="small muted">Baisse ou hausse : écart entre les 3 premières et les 3 dernières répétitions. Une baisse qui diminue d\'une séance à l\'autre signale une meilleure tenue de l\'effort.</p>';
  }
  h += "</section>";
  SPORTS.forEach(function (sp) {
    var list = valuesOf(D.seances).filter(function (s) { var ci = cardioInfo(s); return ci && !ci.legacy && ci.sport === sp.v && (ci.ctype === "ef" || ci.ctype === "recup") && toNum(s.duree) && toNum(s.distance); }).sort(byDateDesc).slice(0, 6);
    if (!list.length) return;
    function spd(s) { var d = toNum(s.duree), x = toNum(s.distance); return sp.v === "natation" ? d * 60 / (x / 100) : sp.v === "course" ? d * 60 / x : x / (d / 60); }
    function spdTxt(v) { return sp.v === "natation" ? fmtTm(v) + " /100 m" : sp.v === "course" ? paceKm(v) : fmt(v, 1) + " km/h"; }
    h += '<section class="sheet"><div class="titled"><h2>Endurance fondamentale · ' + esc(sp.l.toLowerCase()) + '</h2><p class="small muted">' + (sp.v === "velo" ? "Vitesse" : "Allure") + " et FC moyenne des dernières séances faciles.</p></div><div class=\"log\">";
    list.forEach(function (s) { h += '<div class="log-item"><div class="row"><b>' + esc(fmtShort(s.date)) + "</b><span>" + esc(spdTxt(spd(s)) + (toNum(s.fcMoy) ? " · " + fmt(toNum(s.fcMoy), 0) + " bpm" : "")) + "</span></div></div>"; });
    h += "</div>";
    var a = list[list.length - 1], b = list[0], fa = toNum(a.fcMoy), fb = toNum(b.fcMoy);
    if (list.length >= 2 && fa && fb && Math.abs(fa - fb) <= 3) {
      var va = spd(a), vb = spd(b), better = sp.v === "velo" ? vb > va : vb < va, diff = Math.abs(vb - va);
      var dt = sp.v === "velo" ? fmt(diff, 1) + " km/h" : fmt(diff, 0) + (sp.v === "natation" ? " s/100 m" : " s/km");
      if (diff >= (sp.v === "velo" ? 0.1 : 1)) h += '<div class="note ' + (better ? "ok" : "") + '"><b>À FC comparable (' + fmt(Math.min(fa, fb), 0) + " à " + fmt(Math.max(fa, fb), 0) + " bpm), tu " + (sp.v === "natation" ? "nages" : sp.v === "velo" ? "roules" : "cours") + " " + dt + " plus " + (better ? "vite" : "lentement") + "</b> que le " + esc(fmtShort(a.date)) + ".</div>";
    }
    h += "</section>";
  });
  var weeks = [], mon = mondayOfDate(todayStr());
  for (var k = 7; k >= 0; k--) { var m = addDays(mon, -7 * k), wc = weekCharge(m, addDays(m, 6)); if (wc.total || weeks.length) weeks.push({ m: m, t: wc.total }); }
  h += '<section class="sheet"><div class="titled"><h2>Charge par semaine</h2><p class="small muted">Toutes activités, durée × difficulté.</p></div>';
  if (!weeks.some(function (x) { return x.t; })) h += '<p class="small muted">La charge apparaît quand une séance a une durée et une difficulté notées.</p>';
  else { var mxw = Math.max.apply(null, weeks.map(function (x) { return x.t; })) * 1.1; h += '<div class="vol">' + weeks.map(function (x) { return chargeBar((blockWeek(x.m) ? "Semaine " + weekOf(x.m) : "Sem. du " + fmtShort(x.m).replace(/\.$/, "")), x.t, mxw, ""); }).join("") + "</div>"; }
  return h + "</section>";
}
/* ---------- Réglages : profil cardio ---------- */
function profilSheet() {
  var p = D.profil || {}, b = fcBands(), mx = fcMaxInfo(), h = '<section class="sheet"><div class="titled"><h2>Profil cardio</h2><p class="small muted">Tout est facultatif. Ces réponses servent à te proposer une FC et un ressenti à respecter selon le type de séance.</p></div>';
  h += '<div class="grid2"><label class="field"><span>Âge</span>' + inp("profil", "p", "age", p.age, 'inputmode="numeric"') + '</label><label class="field"><span>FC max mesurée</span>' + inp("profil", "p", "fcmax", p.fcmax, 'inputmode="numeric" placeholder="inconnue"') + "</label></div>";
  h += '<div class="grid2"><label class="field"><span>FC au repos</span>' + inp("profil", "p", "fcrepos", p.fcrepos, 'inputmode="numeric" placeholder="facult."') + '</label><div class="field"><span>Sexe</span>' + seg("profil", "p", "sexe", [{ v: "H", l: "H" }, { v: "F", l: "F" }], p.sexe) + "</div></div>";
  h += '<p class="tiny muted">FC au repos : à prendre le matin au réveil, allongé. FC max mesurée : le pic atteint à la fin d\'un effort maximal, par exemple un test ou une course à fond, lu sur une montre ou une ceinture.</p>';
  h += '<div class="scale"><div class="scale-q"><span>Calcul des fourchettes</span></div>' + seg("profil", "p", "methode", [{ v: "pct", l: "% de la FC max" }, { v: "karvonen", l: "Réserve cardiaque" }], p.methode === "karvonen" ? "karvonen" : "pct") + '<p class="tiny muted">La réserve cardiaque (méthode de Karvonen) tient compte de ta FC au repos' + (p.methode === "karvonen" && !(b && b.karv) ? " : indique-la pour l'utiliser." : ".") + "</p></div>";
  if (!mx) return h + '<p class="small muted">Indique ton âge ou ta FC max mesurée pour voir tes fourchettes.</p></section>';
  h += '<div class="note info"><b>FC max utilisée : ' + mx.v + " bpm</b>" + (mx.est ? ", estimée d'après ton âge (" + (p.sexe === "F" ? "206 − 0,88 × " : "208 − 0,7 × ") + fmt(mx.age, 0) + "). L'estimation peut se tromper d'une dizaine de battements : une FC max mesurée la remplace." : ", mesurée.") + "</div>";
  var pr = b.karv ? ["moins de 60 % de la réserve", "60 à 70 % de la réserve"] : ["moins de 70 % de la FC max", "70 à 80 % de la FC max"];
  h += '<div class="section"><h3>Tes fourchettes</h3><div class="ztable">' +
    '<div class="zrow"><b>Récupération active</b><span class="bpm">moins de ' + b.recupHi + ' bpm</span><span class="d">' + pr[0] + " · ressenti 1 à 2</span></div>" +
    '<div class="zrow"><b>Endurance fondamentale</b><span class="bpm">' + b.efLo + " à " + b.efHi + ' bpm</span><span class="d">' + pr[1] + " · ressenti 3 à 4 · tu peux parler</span></div>" +
    '<div class="zrow"><b>Fractionné</b><span class="bpm">pas de cible</span><span class="d">consigne en ressenti (7 à 9), puis en allure d\'après tes séances précédentes</span></div></div></div>';
  return h + "</section>";
}
function sportsSheet() {
  var on = sportsOn().map(function (s) { return s.v; }), oms = !(D.vue && D.vue.oms === false);
  return '<section class="sheet"><h2>Disciplines</h2><p class="small muted">Disciplines proposées quand tu ajoutes une activité cardio.</p><div class="seg chips" role="group">' +
    SPORTS.map(function (s) { return '<button type="button" data-act="sporttog" data-v="' + s.v + '" aria-pressed="' + (on.indexOf(s.v) >= 0) + '">' + esc(s.l) + "</button>"; }).join("") + "</div>" +
    '<div class="scale"><div class="scale-q"><span>Repère OMS dans le bilan de la semaine</span></div><div class="seg" role="group"><button type="button" data-act="omstog" data-v="1" aria-pressed="' + oms + '">Affiché</button><button type="button" data-act="omstog" data-v="0" aria-pressed="' + !oms + '">Masqué</button></div></div></section>';
}
/* ---------- Texte pour Claude ---------- */
function cardioSummary(s, ci) {
  var out = [], sp = ci.sport;
  if (ci.ctype === "fractionne") {
    var fd = fracData(s, ci), f = fd.f, pk = fd.pk, line = fmtLine(f);
    if (line) out.push("format " + line + (toNum(f.echauf) ? ", échauffement " + f.echauf + " min" : "") + (toNum(f.calme) ? ", retour au calme " + f.calme + " min" : ""));
    var bySer = {};
    repList(s).forEach(function (x) { if (!rowAny(x.row, pk)) return; var v = primVal(x.row, pk), fc = toNum(x.row.fc); (bySer[x.i] = bySer[x.i] || []).push((v !== null ? fmtVal(v, pk) : "?") + (fc !== null ? " (FC " + fc + ")" : "")); });
    keysOf(bySer).forEach(function (i) { out.push("série " + (Number(i) + 1) + " : " + bySer[i].join(", ")); });
    var dr = dropOf(fd.vals); if (dr) out.push("écart début/fin " + signed(dr.pct, 0) + " %");
    if (toNum(s.distTot)) out.push("distance totale " + fmt(toNum(s.distTot), 2) + " km");
  } else {
    var dur = toNum(s.duree), dist = toNum(s.distance);
    if (dur) out.push(dur + " min");
    if (dist) out.push(sp === "natation" ? fmt(dist, 0) + " m" : fmt(dist, 2) + " km");
    if (dur && dist) out.push(sp === "natation" ? fmtTm(dur * 60 / (dist / 100)) + "/100 m" : sp === "course" ? paceKm(dur * 60 / dist).replace(" /", "/") : fmt(dist / (dur / 60), 1) + " km/h");
    if (toNum(s.deniv)) out.push("D+ " + s.deniv + " m");
    if (toNum(s.puiss)) out.push(s.puiss + " W");
    if (s.nage) out.push(s.nage.toLowerCase());
  }
  if (ci.ctype === "fractionne" && toNum(s.duree)) out.push(s.duree + " min au total");
  if (toNum(s.fcMoy)) out.push("FC moy " + s.fcMoy);
  if (toNum(s.fcMax)) out.push("FC max " + s.fcMax);
  return out.join(", ");
}
function chargeText(mon) {
  var sun = addDays(mon, 6), wc = weekCharge(mon, sun), z = weekZones(mon, sun);
  var parts = CAT_LOAD_ORDER.filter(function (c) { return wc.by[c]; }).map(function (c) { return catLabel(c).toLowerCase() + " " + fmt(wc.by[c].load, 0); });
  return (wc.total ? fmt(wc.total, 0) + " (" + parts.join(", ") + ")" + (wc.miss ? ", " + wc.miss + " séance(s) sans durée ou difficulté" : "") : "aucune") +
    (z.dur ? ". Endurance : " + fmtDur(z.dur) + ", zone basse " + fmt(z.basse, 0) + " min, seuil " + fmt(z.seuil, 0) + " min, haute " + fmt(z.haute, 0) + " min" : "");
}

/* ---------- Semaine ---------- */
function viewSemaine() {
  var mon = S.mon, sun = addDays(mon, 6), blk = blockWeek(mon), w = blk ? weekOf(mon) : null;
  var id = blk ? weekDocId(w) : "L-" + mon, wd = D.semaines[id] || {}, h = "";
  h += '<div class="daynav"><button type="button" class="btn small" data-act="week" data-d="-1" aria-label="Semaine précédente">Précédente</button><h1>' + (blk ? "Semaine " + w : "Semaine du " + esc(parse(mon).getDate() + " " + parse(mon).toLocaleDateString("fr-FR", { month: "short" }).replace(/\.$/, ""))) + '</h1><button type="button" class="btn small" data-act="week" data-d="1" aria-label="Semaine suivante">Suivante</button></div>';
  h += '<p class="small muted">Du ' + esc(fmtLong(mon)) + " au " + esc(fmtLong(sun)) + (blk && P.deload && P.deload.indexOf(w) >= 0 ? ", semaine de décharge" : "") + "." + (!blk && P ? " En dehors du bloc : séances libres." : "") + "</p>";
  var cur = weekAvg(mon), prev = weekAvg(addDays(mon, -7)), sports = valuesOf(D.seances).filter(function (s) { return s.date >= mon && s.date <= sun && s.intensite; });
  var sheet = '<div class="sheet">';
  if (blk && versionKeys().length > 1) sheet += '<div class="scale"><div class="scale-q"><span>Organisation de la semaine</span></div>' + seg("semaines", id, "version", versionKeys().map(function (k) { return { v: k, l: P.versions[k].label }; }), wd.version) + "</div>";
  var sw = sleepWeek(mon);
  sheet += '<div class="kpis two"><div class="kpi"><b>' + fmt(cur, 2) + '</b><span>poids moyen (kg)</span></div><div class="kpi"><b>' + (cur && prev ? (cur - prev >= 0 ? "+" : "") + fmt(cur - prev, 2) : "–") + "</b><span>" + esc(blk && P.poidsCibleTexte || "écart avec la semaine d'avant") + '</span></div><div class="kpi"><b>' + fmtHours(sw.avg) + "</b><span>sommeil moyen" + (sw.n ? ", " + sw.n + " nuit" + (sw.n > 1 ? "s" : "") : "") + '</span></div><div class="kpi"><b>' + countDone(mon, sun) + "</b><span>séances notées</span></div></div>";
  if (sports.length) sheet += '<p class="small muted">Intensité des séances de ' + esc((P && P.sessions.SAMBO && P.sessions.SAMBO.name || "sport").toLowerCase()) + " : " + esc(sports.map(function (s) { return s.intensite.toLowerCase(); }).join(", ")) + ".</p>";
  h += sheet + '</div><div class="sheet"><div class="weeklist">';
  for (var i = 0; i < 7; i++) {
    var d = addDays(mon, i), label, done = dayDone(d);
    if (inBlock(d)) {
      var types = plannedFor(d), lib = libreOf(d);
      var names = (types || []).map(function (t) { return isReplaced(d, t) ? "Séance libre" : shortName(t); });
      if (lib && !(types || []).some(function (t) { return isReplaced(d, t); })) names.push("Séance libre");
      cardioOf(d).forEach(function (s) { names.push(cardioTitle(s)); });
      label = types === null ? "Selon l'organisation de la semaine" + (lib ? ", séance libre" : "") : names.length ? names.join(" et ") : "Rien de prévu";
    } else {
      var notees = valuesOf(D.seances).filter(function (s) { return s.date === d && hasData(s); }).map(sessionLabel);
      label = notees.length ? notees.join(" et ") : "–";
    }
    h += '<button type="button" class="wrow' + (d === todayStr() ? " today" : "") + '" data-act="goto" data-date="' + d + '"><span class="d">' + esc(fmtDayName(d)) + " " + parse(d).getDate() + "</span><span>" + esc(label) + '</span><span class="tick' + (done ? " done" : "") + '" aria-label="' + (done ? "fait" : "à faire") + '"></span></button>';
  }
  h += "</div></div>";
  h += weekVolSheet(mon);
  h += weekCardioSheets(mon);
  h += '<section class="sheet"><h2>Bilan de la semaine</h2>';
  if (alertOn("B") && mon <= todayStr()) { var fw = fatigueReasons(sun < todayStr() ? sun : todayStr()); if (fw.list.length) h += '<div class="note warn"><b>Signes de fatigue.</b> ' + esc(fw.list.join(" ")) + "</div>"; }
  h += '<div class="scale"><div class="scale-q"><span>Fatigue générale</span><span class="ends">1 en forme, 10 épuisé</span></div>' + seg("semaines", id, "fatigue", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], wd.fatigue, true) + "</div>";
  if (sw.n) {
    h += '<div class="section"><div class="row spread"><span>Sommeil moyen par nuit</span><b class="num">' + fmtHours(sw.avg) + '</b></div><p class="tiny muted">Calculé avec ' + (sw.n > 1 ? "les " + sw.n + " nuits notées" : "la nuit notée") + ' le matin dans Aujourd\'hui.</p>' +
      '<details><summary class="small">Détail des nuits</summary><dl class="kv">' + sw.nights.map(function (n) { return "<dt>" + esc(fmtDayName(n.date) + " " + parse(n.date).getDate()) + "</dt><dd>" + esc(fmtHours(n.h)) + "</dd>"; }).join("") + "</dl></details></div>";
  } else h += '<label class="field"><span>Sommeil moyen par nuit (heures), si tu n\'as noté aucune nuit</span>' + inp("semaines", id, "sommeil", wd.sommeil, 'inputmode="decimal" placeholder="ex. 7,5"') + "</label>";
  h += '<label class="field"><span>Douleurs, même légères</span>' + txt("semaines", id, "douleurs", wd.douleurs, "Épaules, genoux, coudes, cou…") + "</label>";
  h += '<label class="field"><span>Exercices aimés, détestés ou machines indisponibles</span>' + txt("semaines", id, "exercices", wd.exercices, "Facultatif") + "</label></section>";
  h += claudeSheet("semaine");
  return h;
}
function countDone(from, to) { return valuesOf(D.seances).filter(function (s) { return s.date >= from && s.date <= to && s.type !== "REPOS" && hasData(s); }).length; }

/* ---------- Progrès ---------- */
function viewProgres() {
  var endu = D.vue && D.vue.prog === "endu";
  var h = '<h1>Progrès</h1><div class="seg" role="group" aria-label="Type de progrès"><button type="button" data-act="progvue" data-v="force" aria-pressed="' + !endu + '">Force et poids</button><button type="button" data-act="progvue" data-v="endu" aria-pressed="' + endu + '">Endurance</button></div>';
  if (endu) {
    var lst = valuesOf(D.seances).filter(function (s) { return hasData(s) && cardioInfo(s); }).sort(byDateDesc).slice(0, 30);
    return h + chronoSheet() + enduranceSheets() + '<section class="sheet"><h2>Séances d\'endurance notées</h2><div class="log">' + (lst.length ? lst.map(logItem).join("") : '<p class="small muted">Aucune séance de course, vélo ou natation notée pour l\'instant.</p>') + "</div></section>";
  }
  var weights = valuesOf(D.pesees).filter(function (p) { return toNum(p.kg); }).map(function (p) { return { x: p.date, y: toNum(p.kg) }; }).sort(function (a, b) { return a.x < b.x ? -1 : 1; });
  var avgs = [];
  if (weights.length) for (var m = mondayOfDate(weights[0].x); m <= weights[weights.length - 1].x; m = addDays(m, 7)) { var a = weekAvg(m); if (a) avgs.push({ x: addDays(m, 3), y: a }); }
  h += '<section class="sheet"><h2>Poids</h2>' + (weights.length ? chart([{ pts: weights, cls: "s-steel", dots: true, line: false, soft: true }, { pts: avgs, cls: "s-plate", dots: true, line: true }], { unit: "kg", ref: P && P.poidsMax ? [{ y: P.poidsMax, label: fmt(P.poidsMax) + " kg, plafond" }] : [] }) +
    '<div class="legend"><span><i class="k-steel"></i>pesées</span><span><i class="k-plate"></i>moyenne de la semaine</span></div>' : '<p class="small muted">Pas encore de pesée. Note ton poids chaque matin dans Aujourd\'hui.</p>') + "</section>";
  h += forceSheet();
  h += cumulVolSheet();
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
  var def = sessionDef(s.type), r = readiness(s.checkin), b = s.bilan || {}, chips = [], isLib = s.type === LIBRE, isC = isCardioType(s.type);
  if (toNum(s.duree)) chips.push('<span class="state">' + esc(fmtDur(toNum(s.duree))) + "</span>");
  if (isLib) { chips.push('<span class="state alt">hors salle</span>'); var nx = (s.liste || []).length; if (nx) chips.push('<span class="state">' + nx + " exercice" + (nx > 1 ? "s" : "") + "</span>"); }
  if (r) chips.push('<span class="state ' + (r.level === "ok" ? "done" : "warn") + '">forme ' + fmt(r.avg, 1) + "</span>");
  if (b.rpe) chips.push('<span class="state">difficulté ' + b.rpe + "</span>");
  if (s.intensite) chips.push('<span class="state">' + esc(s.intensite.toLowerCase()) + "</span>");
  if (s.smod && s.smod.statut) chips.push('<span class="state ' + (s.smod.statut === "saute" ? "warn" : "alt") + '">' + esc(smodText(s)) + "</span>");
  if (s.arret && s.arret.motif) chips.push('<span class="state warn">arrêtée, ' + esc(motifLabel(MOTIFS_ARRET, s.arret.motif)) + "</span>");
  if (s.mods && keysOf(s.mods).length) chips.push('<span class="state alt">' + keysOf(s.mods).length + " exercice" + (keysOf(s.mods).length > 1 ? "s" : "") + " changé" + (keysOf(s.mods).length > 1 ? "s" : "") + "</span>");
  var pains = b.douleurs ? keysOf(b.douleurs).filter(function (k) { return b.douleurs[k]; }) : [];
  return '<button type="button" class="log-item linkless" data-act="goto" data-date="' + s.date + '"><div class="row"><b>' + esc(fmtShort(s.date)) + ", " + esc(isLib ? "Séance libre" : isC ? cardioTitle(s) : s.plan ? s.plan.short : def ? def.short || def.name : s.type) + '</b><span class="row">' + chips.join("") + "</span></div>" +
    (isLib ? '<span class="small muted">' + esc(libreSub(s)) + "</span>" : "") + (pains.length ? '<span class="pain">Douleurs : ' + esc(pains.map(function (k) { return labelZone(k); }).join(", ")) + "</span>" : "") + (b.note ? '<span class="small muted">' + esc(b.note) + "</span>" : "") + "</button>";
}
function labelZone(k) { for (var i = 0; i < DOULEURS.length; i++) if (zk(DOULEURS[i]) === k) return DOULEURS[i].toLowerCase(); return k; }
/* Courbes de force : une par exercice. Clé « cat:<code> » pour un exercice de la liste commune
   (séances libres et exercices du programme qui portent ce code), « ex:<id> » pour un exercice
   du programme actif sans code. Les exercices au temps et les « autres exercices » n'ont pas de courbe. */
/* ---------- Volume (séries de travail par muscle) ---------- */
function volRows(obj, time) {
  return valuesOf(obj || {}).filter(function (r) {
    if (!r) return false;
    if (time) return toNum(r.t) > 0;
    var rir = toNum(r.rir);
    return toNum(r.r) > 0 && (rir === null || rir <= RIR_MAX_SERIE);
  }).length;
}
function emptyVol() { var v = { m: {}, g: {} }; MUSCLES.forEach(function (m) { v.m[m[0]] = 0; }); GROUPES.forEach(function (g) { v.g[g[0]] = 0; }); return v; }
function addVol(v, mu, gr, n) {
  if (!n || !mu) return;
  keysOf(mu).forEach(function (k) { if (v.m[k] !== undefined) v.m[k] += n * mu[k]; });
  if (gr && v.g[gr] !== undefined) v.g[gr] += n;
}
function seanceVol(s, v) {
  if (s.type === LIBRE) {
    (s.liste || []).forEach(function (it) {
      var c = CAT[it.k], rows = s.sets && s.sets[it.u];
      if (!rows) return;
      if (it.k === "autre") { if (it.mu && MUSCLE_GROUPE[it.mu]) { var o = {}; o[it.mu] = 1; addVol(v, o, MUSCLE_GROUPE[it.mu], volRows(rows, false)); } return; }
      if (c && c.mu) addVol(v, c.mu, c.gr, volRows(rows, c.time));
    });
    return;
  }
  keysOf(s.sets).forEach(function (exId) { var e = progEx(s, exId); if (e && e.mu) addVol(v, e.mu, e.gr, volRows(s.sets[exId], false)); });
  keysOf(s.remp).forEach(function (exId) {
    var r = s.remp[exId], e = progEx(s, exId), rc = CAT[rempCat(r)] || null;
    if (!r || !r.sets) return;
    if (rc && rc.mu) addVol(v, rc.mu, rc.gr, volRows(r.sets, false));
    else if (e && e.mu) addVol(v, e.mu, e.gr, volRows(r.sets, false));
  });
}
function doneVol(from, to) {
  var v = emptyVol();
  valuesOf(D.seances).forEach(function (s) { if (s.date >= from && s.date <= to) seanceVol(s, v); });
  return v;
}
function plannedTypes(date) {
  var t = plannedFor(date); if (t) return t;
  var ks = versionKeys(); return (P.versions[ks[0]].jours[dow(date)] || []).map(function (x) { return x.replace("?", ""); });
}
function plannedVol(from, to) {
  var v = emptyVol();
  if (!P) return v;
  for (var d = from; d <= to; d = addDays(d, 1)) {
    if (d < P.debut || d > lastDay() || weekOf(d) > P.semaines) continue;
    var w = weekOf(d);
    plannedTypes(d).forEach(function (t) {
      var def = P.sessions[t]; if (!def || def.kind !== "muscu") return;
      def.ex.forEach(function (e) { var p = presc(e, w), c = CAT[exCat(e)], mu = (c && c.mu) || e.mu, gr = (c && c.gr) || e.gr; if (p && mu) addVol(v, mu, gr, p.sets); });
    });
  }
  return v;
}
function volBar(label, done, plan, mx, ref, big) {
  var noPlan = plan === null, aria = label + " : " + fmt(done) + " séries faites" + (noPlan ? "" : " sur " + fmt(plan) + " prévues");
  return '<div class="vrow' + (big ? " grp" : "") + '" role="img" aria-label="' + esc(aria) + '"><span class="m">' + esc(label) + '</span><span class="track">' +
    (plan ? '<span class="plan" data-w="' + (plan / mx * 100).toFixed(1) + '"></span>' : "") +
    (done ? '<span class="done" data-w="' + (done / mx * 100).toFixed(1) + '"></span>' : "") +
    (ref ? '<span class="ref" data-l="' + (ref / mx * 100).toFixed(1) + '"></span>' : "") +
    '</span><span class="v"><b>' + fmt(done) + "</b>" + (noPlan ? "" : " / " + fmt(plan)) + "</span></div>";
}
function volSheet(o) {
  var view = D.vue && D.vue[o.key] === "g" ? "g" : "m", done = o.done, plan = o.plan, h = '<section class="sheet"><div class="titled"><h2>' + esc(o.title) + '</h2><p class="small muted">' + esc(o.sub) + "</p></div>";
  h += '<div class="seg" role="group"><button type="button" data-act="volvue" data-k="' + o.key + '" data-v="m" aria-pressed="' + (view === "m") + '">Par muscle</button><button type="button" data-act="volvue" data-k="' + o.key + '" data-v="g" aria-pressed="' + (view === "g") + '">Par groupe</button></div><div class="vol">';
  function top(vals, extra) { var m = Math.max.apply(null, vals.concat([extra || 0, 1])), step = m <= 20 ? 5 : 10; return Math.ceil(m / step) * step; }
  if (view === "m") {
    var mx = top(MUSCLES.map(function (m) { return Math.max(done.m[m[0]], plan ? plan.m[m[0]] : 0); }), Math.max(20, o.ref || 0));
    MUSCLES.forEach(function (m) { h += volBar(m[1], done.m[m[0]], plan ? plan.m[m[0]] : null, mx, o.ref, false); });
  } else {
    var mg = top(GROUPES.map(function (g) { return Math.max(done.g[g[0]], plan ? plan.g[g[0]] : 0); }));
    GROUPES.forEach(function (g) { h += volBar(g[1], done.g[g[0]], plan ? plan.g[g[0]] : null, mg, 0, true) + '<p class="vsub">' + esc(g[2]) + "</p>"; });
  }
  h += '</div><div class="keyrow"><span><i class="k-done"></i>fait</span>' + (plan ? '<span><i class="k-plan"></i>prévu</span>' : "") + (view === "m" && o.ref ? '<span><i class="k-ref"></i>' + esc(o.refLabel) + "</span>" : "") + "</div>";
  h += '<details class="calc"><summary class="small">Comment c\'est calculé</summary><ul class="small">' +
    "<li>Une série compte si elle est notée et finie à 4 répétitions de l'échec ou moins (RIR 4 au plus). Les échauffements ne sont pas notés, donc pas comptés.</li>" +
    "<li>Par muscle : 1 série pour le muscle travaillé directement, 0,5 pour un muscle qui aide (méthode de Pelland et al., Sports Medicine, 2026). Un développé couché compte 1 pour les pectoraux, 0,5 pour les triceps et 0,5 pour les épaules.</li>" +
    "<li>Par groupe : chaque série compte une fois, dans le groupe de son mouvement. Un développé couché est une série de poussée, un face pull une série de tirage.</li>" +
    "<li>Les séances libres comptent ; un «\u00a0autre exercice\u00a0» compte pour le muscle choisi. Les exercices sautés, le cou et le sambo ne sont pas comptés.</li>" +
    "<li>Repère : 10 séries par muscle et par semaine, seuil au-delà duquel les études montrent nettement plus de prise de muscle.</li></ul></details>";
  return h + "</section>";
}
function weekVolSheet(mon) {
  var sun = addDays(mon, 6), blk = blockWeek(mon);
  return volSheet({ key: "volSem", title: "Volume de la semaine", sub: blk ? "Séries de travail par muscle, faites et prévues par le programme." : "Séries de travail par muscle.", done: doneVol(mon, sun), plan: blk ? plannedVol(mon, sun) : null, ref: 10, refLabel: "repère : 10 séries" });
}
function cumulVolSheet() {
  var today = todayStr();
  if (!P) {
    var first = valuesOf(D.seances).filter(hasData).map(function (s) { return s.date; }).sort()[0];
    if (!first) return '<section class="sheet"><h2>Volume depuis ta première séance</h2><p class="small muted">Le cumul commence à ta première séance notée.</p></section>';
    var nw = Math.floor(diffDays(today, mondayOfDate(first)) / 7) + 1;
    return volSheet({ key: "volCum", title: "Volume depuis ta première séance", sub: "Séries de travail cumulées du " + fmtShort(first) + " au " + fmtShort(today).replace(/\.$/, "") + ".",
      done: doneVol(first, today), plan: null, ref: 10 * nw, refLabel: "repère : 10 séries × " + nw + " semaine" + (nw > 1 ? "s" : "") });
  }
  if (today < P.debut) return '<section class="sheet"><h2>Volume depuis le début du bloc</h2><p class="small muted">Le cumul commence le ' + esc(fmtLong(P.debut)) + ".</p></section>";
  var to = today > lastDay() ? lastDay() : today, n = Math.min(P.semaines, weekOf(to));
  return volSheet({ key: "volCum", title: "Volume depuis le début du bloc", sub: "Séries de travail cumulées du " + fmtShort(P.debut) + " au " + fmtShort(to).replace(/\.$/, "") + ". Prévu : ce que le programme prévoyait jusqu'à ce jour.",
    done: doneVol(P.debut, to), plan: plannedVol(P.debut, to), ref: 10 * n, refLabel: "repère : 10 séries × " + n + " semaine" + (n > 1 ? "s" : "") });
}
function progOrder(id) {
  if (!P) return 999;
  var n = 0, found = -1;
  keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { if (e.id === id && found < 0) found = n; n++; }); });
  return found < 0 ? 999 : found;
}
function progName(id, fallback) {
  var name = fallback;
  if (!P) return name;
  keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { if (e.id === id) name = e.name; }); });
  return name;
}
function curveIndex() {
  var idx = {};
  function add(key, name, order, bw, bwf, s, rows, hollow) {
    if (!rows.length) return;
    var bwv = bw ? bodyweight(s.date) * (bwf || 1) : 0, best = 0;
    rows.forEach(function (r) { var rir = toNum(r.rir) !== null ? toNum(r.rir) : 2; best = Math.max(best, e1rm(toNum(r.c) + bwv, toNum(r.r), rir)); });
    if (!best) return;
    var c = idx[key] || (idx[key] = { key: key, name: name, order: order, byDate: {} }), prev = c.byDate[s.date];
    if (!prev || best > prev.y) c.byDate[s.date] = { x: s.date, y: best, hollow: hollow };
  }
  valuesOf(D.seances).forEach(function (s) {
    if (!s.sets && !s.remp) return;
    if (s.type === LIBRE) {
      if (!s.sets) return;
      (s.liste || []).forEach(function (it) { var c = CAT[it.k]; if (c && !c.time && s.sets[it.u]) add("cat:" + it.k, c.n, CAT_ORDER[it.k], c.bw, c.bwf, s, rowsOk(s.sets[it.u]), true); });
      return;
    }
    keysOf(s.remp).forEach(function (exId) { var r = s.remp[exId], rk = rempCat(r), c = CAT[rk]; if (c && !c.time && r.sets) add("cat:" + rk, c.n, CAT_ORDER[r.k], c.bw, c.bwf, s, rowsOk(r.sets), false); });
    keysOf(s.sets).forEach(function (exId) {
      var e = progEx(s, exId); if (!e) return;
      if (e.cat && CAT[e.cat]) add("cat:" + e.cat, CAT[e.cat].n, CAT_ORDER[e.cat], e.bw, CAT[e.cat].bwf, s, rowsOk(s.sets[exId]), false);
      else if (P && s.programme === P.id) add("ex:" + exId, progName(exId, e.name), 100 + progOrder(exId), e.bw, 1, s, rowsOk(s.sets[exId]), false);
    });
  });
  keysOf(idx).forEach(function (k) { idx[k].pts = keysOf(idx[k].byDate).sort().map(function (d) { return idx[k].byDate[d]; }); });
  return idx;
}
function curveKeyOf(e) { var c = exCat(e); return c ? "cat:" + c : "ex:" + e.id; }
function curveName(k, idx) {
  if (idx[k]) return idx[k].name;
  if (k.indexOf("cat:") === 0) return CAT[k.slice(4)] ? CAT[k.slice(4)].n : null;
  var id = k.slice(3), n = progName(id, null); return n;
}
function selectedCurves() {
  if (D.vue && D.vue.courbes) {
    var seen = [];
    D.vue.courbes.forEach(function (k) {
      if (k.indexOf("ex:") === 0 && P) keysOf(P.sessions).forEach(function (sk) { var s = P.sessions[sk]; if (s.kind === "muscu") s.ex.forEach(function (e) { if (e.id === k.slice(3)) k = curveKeyOf(e); }); });
      if (seen.indexOf(k) < 0) seen.push(k);
    });
    return seen;
  }
  var out = [];
  if (P) keysOf(P.sessions).forEach(function (k) { var s = P.sessions[k]; if (s.kind === "muscu") s.ex.forEach(function (e) { var key = curveKeyOf(e); if (e.suivi && out.indexOf(key) < 0) out.push(key); }); });
  if (!out.length) { var idx = curveIndex(); out = keysOf(idx).sort(function (a, b) { return idx[b].pts.length - idx[a].pts.length || idx[a].order - idx[b].order; }).slice(0, 3); }
  return out.slice(0, 4);
}
function signed(v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d); }
function curveChoice(idx, sel) {
  var avail = keysOf(idx).sort(function (a, b) { return idx[a].order - idx[b].order || (idx[a].name < idx[b].name ? -1 : 1); });
  sel.forEach(function (k) { if (avail.indexOf(k) < 0) avail.push(k); });
  return '<div class="seg chips" role="group">' + avail.map(function (k) { return '<button type="button" data-act="courbe" data-k="' + esc(k) + '" aria-pressed="' + (sel.indexOf(k) >= 0) + '">' + esc(curveName(k, idx)) + "</button>"; }).join("") + "</div>";
}
function courbesReglage() {
  var idx = curveIndex(), sel = selectedCurves().filter(function (k) { return curveName(k, idx); });
  if (!keysOf(idx).length) return "";
  return '<section class="sheet"><h2>Courbes de force</h2><p class="small muted">Exercices affichés sur le graphique de force, dans Progrès : 4 au plus.</p>' + curveChoice(idx, sel) + "</section>";
}
function forceSheet() {
  var idx = curveIndex(), sel = selectedCurves().filter(function (k) { return curveName(k, idx); }), mode = D.vue && D.vue.mode === "kg" ? "kg" : "pct";
  var h = '<section class="sheet"><h2>Force estimée (1RM)</h2>';
  if (!keysOf(idx).length) return h + '<p class="small muted">La courbe apparaît après ta première séance notée.</p></section>';
  h += '<div class="scale"><div class="scale-q"><span>Courbes affichées, 4 au plus</span></div>' + curveChoice(idx, sel) + "</div>";
  h += '<div class="scale"><div class="scale-q"><span>Afficher</span></div><div class="seg" role="group"><button type="button" data-act="courbemode" data-v="pct" aria-pressed="' + (mode === "pct") + '">Évolution en %</button><button type="button" data-act="courbemode" data-v="kg" aria-pressed="' + (mode === "kg") + '">En kg</button></div></div>';
  var classes = ["s-plate", "s-ink", "s-steel", "s-c4"], keys = ["k-plate", "k-ink", "k-steel", "k-c4"];
  var series = sel.map(function (k, i) {
    var raw = idx[k] ? idx[k].pts : [], base = raw.length ? raw[0].y : 1;
    return { name: curveName(k, idx), cls: classes[i], key: keys[i], raw: raw, pts: mode === "pct" ? raw.map(function (p) { return { x: p.x, y: (p.y / base - 1) * 100, hollow: p.hollow }; }) : raw };
  });
  if (!sel.length) h += '<p class="small muted">Choisis au moins une courbe ci-dessus.</p>';
  else if (!series.some(function (s) { return s.pts.length; })) h += '<p class="small muted">Pas encore de séance notée sur ces exercices.</p>';
  else {
    h += chart(series.map(function (s) { return { pts: s.pts, cls: s.cls, dots: true, line: true }; }), mode === "pct" ? { unit: "%", ref: [{ y: 0, label: "départ" }], tick: function (v) { return signed(v, 0) + "\u00a0%"; } } : { unit: "kg" });
    h += '<div class="legend">' + series.map(function (s) {
      if (!s.raw.length) return '<span><i class="' + s.key + '"></i>' + esc(s.name) + " : pas encore noté</span>";
      var last = s.raw[s.raw.length - 1].y;
      return '<span><i class="' + s.key + '"></i>' + esc(s.name) + " : " + (mode === "pct" ? signed(s.pts[s.pts.length - 1].y, 1) + " % (" + fmt(last) + " kg)" : fmt(last) + " kg") + "</span>";
    }).join("") + "</div>";
    if (series.some(function (s) { return s.pts.some(function (p) { return p.hollow; }); })) h += '<div class="legend"><span class="mk"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="currentColor"/></svg>à la salle</span><span class="mk"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>séance libre</span></div>';
  }
  return h + '<p class="tiny muted">Calcul : charge × (1 + (reps + RIR) ÷ 30), meilleure série de chaque séance. Pour les tractions et les dips, le poids de corps est compris (les deux tiers pour les pompes). En %, chaque courbe part de ta première séance sur l\'exercice. Les exercices au temps et les «\u00a0autres exercices\u00a0» ne sont pas suivis ici.</p></section>';
}
function niceStep(raw) { var p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function chart(series, opt) {
  var W = 600, H = 210, L = opt.tick ? 48 : 40, R = 14, T = 14, B = 28, tick = opt.tick || function (v) { return fmt(v); };
  var pts = []; series.forEach(function (s) { pts = pts.concat(s.pts); });
  var ys = pts.map(function (p) { return p.y; }).concat((opt.ref || []).map(function (r) { return r.y; }));
  var x0 = P ? P.debut : null, x1 = P ? lastDay() : null;
  pts.forEach(function (p) { if (!x0 || p.x < x0) x0 = p.x; if (!x1 || p.x > x1) x1 = p.x; });
  if (x0 === x1) x1 = addDays(x0, 7);
  var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), padY = Math.max(1, (y1 - y0) * 0.15);
  y0 = Math.floor(y0 - padY); y1 = Math.ceil(y1 + padY);
  var span = diffDays(x1, x0) || 1;
  function X(x) { return L + diffDays(x, x0) / span * (W - L - R); }
  function Y(y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); }
  var g = "", step = Math.max(niceStep((y1 - y0) / 4), opt.minStep || 0);
  for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="lbl" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(tick(v)) + "</text>";
  if (P && x0 >= P.debut && x1 <= lastDay()) { for (var w = 1; w <= P.semaines; w++) { var d = mondayOf(w); if (d >= x0 && d <= x1) g += '<text class="lbl" x="' + X(d) + '" y="' + (H - 8) + '" text-anchor="middle">S' + w + "</text>"; } }
  else [x0, addDays(x0, Math.round(span / 2)), x1].forEach(function (d, k) { g += '<text class="lbl" x="' + X(d) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? "start" : k === 2 ? "end" : "middle") + '">' + esc(fmtShort(d)) + "</text>"; });
  (opt.ref || []).forEach(function (r) { if (r.y >= y0 && r.y <= y1) g += '<line class="ref" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(r.y) + '" y2="' + Y(r.y) + '"/><text class="lbl" x="' + (W - R) + '" y="' + (Y(r.y) - 6) + '" text-anchor="end">' + esc(r.label) + "</text>"; });
  series.forEach(function (s) {
    if (s.line && s.pts.length > 1) g += '<polyline class="' + s.cls + '" points="' + s.pts.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" ") + '"/>';
    if (s.dots) s.pts.forEach(function (p, i) { var last = s.line && i === s.pts.length - 1; g += '<circle class="' + s.cls + (s.soft ? " soft" : "") + (p.hollow ? " hollow" : "") + '" stroke-width="0" cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (last ? 5 : p.hollow ? 4.5 : s.line ? 3 : 2.6) + '"><title>' + esc(fmtShort(p.x) + " : " + (opt.tick ? tick(Math.round(p.y * 10) / 10) : fmt(p.y, 1)) + " " + opt.unit + (p.hollow ? ", séance libre" : "")) + "</title></circle>"; });
  });
  return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Évolution en ' + opt.unit + '">' + g + "</svg>";
}

/* ---------- Réglages ---------- */
var RUBS = [
  { g: "Programme", k: "prog", t: "Mon programme" }, { k: "creer", t: "Créer un programme", d: "Musculation, course ou mixte" },
  { g: "Affichage", k: "apparence" },
  { g: "Profil", k: "profil", t: "Profil cardio", d: "Âge, fréquence cardiaque" }, { k: "disc", t: "Disciplines", d: "Activités cardio proposées" },
  { k: "alertes", t: "Alertes de surmenage", d: "Règle des 10 %, fatigue" }, { k: "courbes", t: "Courbes de force", d: "Exercices suivis dans Progrès" },
  { g: "Données", k: "sauv", t: "Sauvegarde", d: "Exporter ou restaurer" }, { k: "ecran", t: "Écran d'accueil", d: "Installer l'application" },
  { k: "donnees", t: "Tes données", d: "Ce qui reste sur ce téléphone" }, { k: "effacer", t: "Tout effacer", d: "Supprime tout sur ce téléphone", cls: "danger" }
];
function rubOf(k) { return RUBS.filter(function (r) { return r.k === k && r.t; })[0]; }
function noH2(html) { return html.replace(/<h2>[^<]*<\/h2>/, ""); }
function reglProg() {
  var h = '<section class="sheet">';
  if (P) h += '<p class="small">' + esc(P.athlete ? P.athlete + ", " : "") + esc(P.titre || "") + ", du " + esc(fmtLong(P.debut)) + " au " + esc(fmtLong(lastDay())) + (todayStr() > lastDay() ? ". Bloc terminé : tu es en séances libres en attendant le suivant." : ".") + "</p>";
  else h += '<p class="small">Aucun programme installé : tu fais des séances libres. Si un coach t\'envoie un programme, colle son lien ci-dessous ; ton historique est conservé.</p>';
  if (P && D.liens[P.id]) h += '<div class="row"><button type="button" class="btn" data-act="copylink">Copier mon lien personnel</button></div><p class="small muted">Utile pour installer le programme dans l\'application d\'écran d\'accueil, ou sur un autre téléphone. Ne le partage pas : il contient ton programme.</p>';
  h += compSheet();
  if (P && P.src && !P.run && P.src.type !== "mixte") h += objSheet();
  if (P && P.src) h += '<div class="row"><button type="button" class="btn" data-act="edmodify">Modifier les séances</button><button type="button" class="btn" data-act="mylink">Copier le lien de ce programme</button></div>';
  h += '<div class="hr"></div>';
  var others = keysOf(D.programmes).filter(function (k) { return !P || k !== P.id; });
  if (others.length) h += '<div class="scale"><div class="scale-q"><span>Autres programmes sur ce téléphone</span></div><div class="row">' + others.map(function (k) { return '<button type="button" class="btn small" data-act="switchprog" data-id="' + esc(k) + '">' + esc(D.programmes[k].titre || k) + "</button>"; }).join("") + "</div></div>";
  h += '<label class="field" for="code-in"><span>' + (P ? "Nouveau programme envoyé par ton coach : colle le lien" : "Programme envoyé par ton coach : colle le lien") + '</span><textarea id="code-in" placeholder="https://…#p=1.…"></textarea></label><div class="row"><button type="button" class="btn" data-act="paste-install">Installer ce programme</button></div><p class="small muted">Tes séances déjà notées sont conservées.</p></section>';
  return h;
}
function reglCreer() {
  var h = '<section class="sheet"><p class="small muted">Compose tes séances, place-les dans la semaine et choisis la durée du bloc. Il s\'installe comme un programme reçu par lien ; tes séances déjà notées sont conservées.</p>' +
    '<div class="stack-btns"><button type="button" class="btn primary wide" data-act="edstart">Créer un programme</button>' + (P ? '<button type="button" class="btn wide" data-act="edcopy">Copier ce programme pour le modifier</button>' : "") + "</div>";
  var drafts = valuesOf(D.brouillons || {}).sort(function (a, b) { return (b.maj || "") < (a.maj || "") ? -1 : 1; });
  if (drafts.length) h += '<div class="section"><h3>Mes programmes en préparation</h3>' + drafts.map(function (d) {
    var nm = d.seances.filter(function (s) { return s.kind === "muscu"; }).length;
    return '<div class="log-item"><div class="row"><b>' + esc(d.nom || "Mon programme") + '</b><span class="small muted">' + esc((d.pid ? "modification en cours" : "brouillon") + " · " + (Math.round(toNum(d.semaines)) || 6) + " semaines") + '</span></div><div class="row"><span class="small muted grow">' + esc((MATS.filter(function (m) { return m.v === d.mat; })[0] || { l: "" }).l + (nm ? ", " + nm + " séance" + (nm > 1 ? "s" : "") + " de musculation" : "")) + '</span><button type="button" class="linkbtn" data-act="edresume" data-id="' + esc(d.id) + '">Reprendre</button><button type="button" class="linkbtn" data-act="edrm" data-id="' + esc(d.id) + '">Supprimer</button></div></div>';
  }).join("") + "</div>";
  return h + "</section>";
}
function rubBody(k) {
  switch (k) {
    case "prog": return reglProg();
    case "creer": return reglCreer();
    case "profil": return noH2(profilSheet());
    case "disc": return noH2(sportsSheet());
    case "alertes": return noH2(alertesSheet());
    case "courbes": return noH2(courbesReglage()) || '<p class="small muted">Les exercices à suivre apparaissent ici après ta première séance de musculation notée.</p>';
    case "sauv": return '<p class="small">Tes données ne sont que sur ce téléphone. Exporte une sauvegarde régulièrement, par exemple chaque dimanche, et garde-la dans Fichiers ou envoie-la-toi.</p>' +
      '<div class="row"><button type="button" class="btn primary" data-act="export">Exporter mes données</button></div>' +
      '<label class="field" for="file-prog"><span>Restaurer une sauvegarde ou importer un fichier de programme</span><input type="file" id="file-prog" accept=".json,application/json" data-act="import-file"></label>';
    case "ecran": return noH2(installHelp()) + (isStandalone ? '<p class="small muted">C\'est déjà fait : tu utilises l\'application installée.</p>' : "");
    case "donnees": return noH2(privacyNote());
    case "effacer": return '<p class="small">Supprime le programme et toutes les données de ce téléphone. Exporte une sauvegarde avant si tu veux les garder.</p><div><button type="button" class="btn danger" data-act="wipe">Effacer toutes mes données</button></div>';
  }
  return "";
}

/* ---------- Menu latéral : Réglages dépliables (une rubrique ouverte à la fois) et apparence ---------- */
var THEMES = [{ v: "auto", l: "Automatique" }, { v: "jour", l: "Jour" }, { v: "nuit", l: "Nuit" }];
function themeOf() { var t = D.vue && D.vue.theme; return t === "jour" || t === "nuit" ? t : "auto"; }
function applyTheme() {
  var t = themeOf(), root = document.documentElement;
  if (t === "jour") root.setAttribute("data-theme", "light"); else if (t === "nuit") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
  Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) {
    var dark = /dark/.test(m.getAttribute("media") || "");
    m.setAttribute("content", t === "jour" ? "#f4f5f2" : t === "nuit" ? "#121417" : dark ? "#121417" : "#f4f5f2");
  });
}
function menuHtml() {
  var t = themeOf(), open = rubOf(S.rub) ? S.rub : null;
  var h = '<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="menu-t"><div class="drawer-head"><h2 id="menu-t">Réglages</h2><button type="button" class="icon-btn" data-m="close" aria-label="Fermer le menu"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"></path></svg></button></div><div class="drawer-body">';
  RUBS.forEach(function (r) {
    if (r.g) h += '<p class="grp">' + esc(r.g) + "</p>";
    if (r.k === "apparence") { h += '<div class="mi-app"><b id="app-t">Apparence</b><div class="seg" role="group" aria-labelledby="app-t">' + THEMES.map(function (x) { return '<button type="button" data-m="theme" data-v="' + x.v + '" aria-pressed="' + (t === x.v) + '">' + x.l + "</button>"; }).join("") + "</div></div>"; return; }
    var d = r.d, op = open === r.k;
    if (r.k === "prog") d = P ? (P.titre || "Programme") + " · lien du coach" : "Coller le lien de ton coach";
    if (r.k === "creer") { var n = keysOf(D.brouillons || {}).length; if (n) d += " · " + n + " en préparation"; }
    if (r.k === "ecran" && isStandalone) d = "Application installée";
    h += '<div class="acc' + (op ? " open" : "") + (r.cls ? " " + r.cls : "") + '"><button type="button" class="acc-h" id="acc-' + r.k + '" data-m="acc" data-r="' + r.k + '" aria-expanded="' + op + '"' + (op ? ' aria-controls="accb-' + r.k + '"' : "") + '><span class="tw" aria-hidden="true"></span><span><b>' + esc(r.t) + "</b>" + (op ? "" : '<span class="small">' + esc(d) + "</span>") + "</span></button>" +
      (op ? '<div class="acc-b" id="accb-' + r.k + '" role="region" aria-labelledby="acc-' + r.k + '">' + rubBody(r.k) + "</div>" : "") + "</div>";
  });
  return h + '<p class="ver">Version ' + APP_VERSION + (isStandalone ? ", application installée" : "") + ".</p></div></aside>";
}
function drawerEl() { return document.getElementById("drawer"); }
function fillMenu(keepFocus) {
  var back = drawerEl(), dr = back.querySelector(".drawer"), top = dr ? dr.scrollTop : 0, a = document.activeElement, sel = null;
  if (keepFocus && a && back.contains(a)) {
    var ds = a.dataset || {};
    sel = ds.path ? '[data-path="' + ds.path + '"][data-col="' + (ds.col || "") + '"]' : ds.act ? '[data-act="' + ds.act + '"]' + (ds.v ? '[data-v="' + ds.v + '"]' : "") + (ds.k ? '[data-k="' + ds.k + '"]' : "") : ds.m ? '[data-m="' + ds.m + '"]' + (ds.r ? '[data-r="' + ds.r + '"]' : "") + (ds.v ? '[data-v="' + ds.v + '"]' : "") : null;
  }
  back.innerHTML = menuHtml();
  dr = back.querySelector(".drawer"); dr.scrollTop = top;
  Array.prototype.forEach.call(back.querySelectorAll("[data-w]"), function (el) { el.style.width = Math.min(100, Number(el.dataset.w)) + "%"; });
  if (sel) { var f = back.querySelector(sel); if (f) f.focus({ preventScroll: true }); }
}
function openMenu(rub) {
  var back = drawerEl();
  if (rub !== undefined) S.rub = rub || null;
  S.menuView = S.view; S.menuD = D; S.menuP = P ? P.id : null; S.menuBack = S.view === "editeur" ? S.menuBack : S.view;
  back.hidden = false; S.menuDirty = false; document.body.classList.add("menu-open"); back.classList.add("opening"); clearTimeout(S.menuAnim); S.menuAnim = setTimeout(function () { back.classList.remove("opening"); }, 300); fillMenu(false);
  var target = S.rub && back.querySelector("#acc-" + S.rub);
  if (target) { target.focus(); target.scrollIntoView({ block: "start" }); } else { var c = back.querySelector("[data-m='close']"); if (c) c.focus(); }
}
function closeMenu(focusBtn) {
  var back = drawerEl(); if (back.hidden) return;
  back.hidden = true; back.innerHTML = ""; document.body.classList.remove("menu-open");
  if (focusBtn) { var m = document.getElementById("menu-btn"); if (m) m.focus(); }
}
function typingIn(back) { var a = document.activeElement; return !!(a && back.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "file"); }
function syncMenu() {
  var back = drawerEl(), skip = S.noMenuSync; S.noMenuSync = false; if (back.hidden || skip) return;
  if (S.view !== S.menuView || D !== S.menuD || (P ? P.id : null) !== S.menuP) closeMenu(false);
  else if (typingIn(back)) S.menuDirty = true; /* ne pas remplacer le champ en cours de saisie : mise à jour quand on en sort */
  else fillMenu(true);
}
drawerEl().addEventListener("click", function (ev) {
  var back = ev.currentTarget, b = ev.target.closest("[data-m]");
  if (!b) { if (ev.target === back) closeMenu(true); return; }
  if (b.dataset.m === "close") closeMenu(true);
  else if (b.dataset.m === "theme") {
    D.vue = D.vue || {}; if (b.dataset.v === "auto") delete D.vue.theme; else D.vue.theme = b.dataset.v; persist(); applyTheme();
    Array.prototype.forEach.call(back.querySelectorAll("[data-m='theme']"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
  } else if (b.dataset.m === "acc") {
    S.rub = S.rub === b.dataset.r ? null : b.dataset.r; fillMenu(false);
    var h = back.querySelector("#acc-" + b.dataset.r); if (h) { h.focus({ preventScroll: true }); if (S.rub) h.scrollIntoView({ block: "nearest" }); }
  }
});
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !drawerEl().hidden) closeMenu(true); });
drawerEl().addEventListener("focusout", function () {
  setTimeout(function () { var back = drawerEl(); if (S.menuDirty && !back.hidden && !typingIn(back)) { S.menuDirty = false; fillMenu(true); } }, 0);
});

/* ================= Créer mon programme ================= */
/* Modèles vérifiés (Schoenfeld 2017 ; Pelland 2026 ; ACSM 2026) : environ 10 séries fractionnées
   par muscle et par semaine, séances de 1 h 15 au plus, échauffement de 10 min compris.
   L'objectif ne change pas les exercices : répétitions, RIR, repos et, en force, séries d'isolation. */
var ISO_K = ["superman", "hip-thrust", "el-lat", "el-lat-poulie", "ecarte-poulie", "pec-deck", "curl-barre", "curl-halt", "curl-incl", "ext-poulie", "ext-tete", "ext-halt", "face-pull", "leg-curl", "mollets", "oiseau", "gainage", "gainage-lat", "releve"];
var UNI_K = ["row-1b", "fente-bulg"];
var MATS = [{ v: "salle", l: "Salle complète" }, { v: "halt", l: "Haltères et banc" }, { v: "street", l: "Street workout" }];
var OBJS = [
  { v: "muscle", l: "Prise de muscle", d: "Le choix par défaut : des séries de 6 à 20 répétitions, proches de l'échec.", h: "6–10 rép. sur les principaux · repos 2 à 3 min" },
  { v: "force", l: "Force", d: "Charges lourdes sur les exercices principaux, un peu moins d'isolation.", h: "3–6 rép. sur les principaux · repos 3 min" },
  { v: "mixte", l: "Force et muscle", d: "Lourd sur les deux premiers exercices de chaque séance, le reste comme en prise de muscle.", h: "4–6 rép., puis 8–20 rép. · repos 2 à 3 min" },
  { v: "endurance", l: "Endurance musculaire", d: "Séries longues et repos courts : des séances plus courtes.", h: "15–30 rép. · repos 30 à 45 s" }];
var ORGS = [
  { v: "fb", l: "Full body, 3 jours", d: "Tout le corps à chaque séance, chaque muscle 3 fois par semaine.", jours: [0, 2, 4] },
  { v: "hb", l: "Haut / bas, 4 jours", d: "Deux séances haut du corps, deux séances jambes.", jours: [0, 1, 3, 4] },
  { v: "ppl", l: "Push / pull / legs, 3 jours", d: "Poussée, tirage, jambes : chaque muscle une fois, plus de séries par séance.", jours: [0, 2, 4] }];
var ROLES = { principal: "principal", secondaire: "secondaire", iso: "isolation" };
function X(k, s, r, note, zero) { var o = { k: k, s: s, r: r }; if (note) o.note = note; if (zero) o.zero = true; return o; }
var VIDE = "À vide (0 kg) au début ; ajoute une charge quand le haut de la fourchette devient facile.";
var CHAISE = "À vide, le haut du dos appuyé sur une chaise ou un banc.";
var MODELES = {
  salle: {
    fb: [["Full body A", [X("squat", 3, "6–10"), X("dc-barre", 4, "6–10"), X("tirage-vert", 4, "8–12"), X("sdtr-barre", 3, "8–10"), X("el-lat", 3, "12–15"), X("curl-halt", 2, "10–15"), X("ext-poulie", 2, "10–15")]],
      ["Full body B", [X("hack-squat", 4, "8–12"), X("dm-halt", 3, "8–12"), X("row-barre", 3, "8–12"), X("leg-curl", 4, "10–15"), X("ecarte-poulie", 3, "12–15"), X("curl-incl", 3, "10–15"), X("mollets", 3, "10–15")]],
      ["Full body C", [X("fente-bulg", 3, "8–12"), X("di-halt", 3, "8–12"), X("tractions", 3, "6–10"), X("sdtr-halt", 3, "8–12"), X("el-lat-poulie", 2, "12–15"), X("ext-tete", 3, "10–15"), X("mollets", 3, "10–15"), X("gainage", 2, "30–60 s")]]],
    hb: [["Haut 1", [X("dc-barre", 4, "6–8"), X("row-barre", 3, "6–10"), X("dm-halt", 2, "8–12"), X("tirage-vert", 3, "8–12"), X("el-lat", 3, "12–15"), X("curl-barre", 2, "8–12"), X("ext-poulie", 2, "10–15")]],
      ["Bas 1", [X("squat", 3, "6–8"), X("sdtr-barre", 3, "8–10"), X("fente-bulg", 2, "8–12"), X("leg-curl", 2, "10–15"), X("mollets", 3, "10–15"), X("gainage", 2, "30–60 s")]],
      ["Haut 2", [X("di-halt", 3, "8–12"), X("tractions", 3, "6–10"), X("dips", 3, "8–12"), X("tirage-horiz", 3, "10–12"), X("el-lat-poulie", 3, "12–15"), X("curl-incl", 2, "10–15"), X("ext-tete", 2, "10–15")]],
      ["Bas 2", [X("hack-squat", 3, "8–12"), X("leg-curl", 3, "10–15"), X("sdtr-halt", 2, "8–12"), X("fente-bulg", 2, "10–15"), X("mollets", 3, "10–15"), X("gainage-lat", 2, "30–45 s")]]],
    ppl: [["Push", [X("dc-barre", 4, "6–10"), X("di-halt", 4, "8–12"), X("ecarte-poulie", 2, "12–15"), X("dm-halt", 2, "8–12"), X("el-lat", 4, "12–15"), X("ext-poulie", 3, "10–15"), X("ext-tete", 2, "10–15"), X("mollets", 3, "10–15")]],
      ["Pull", [X("tractions", 4, "6–10"), X("row-barre", 3, "8–12"), X("tirage-horiz", 3, "10–12"), X("face-pull", 2, "15–20"), X("curl-barre", 3, "8–12"), X("curl-incl", 3, "10–15"), X("mollets", 3, "10–15"), X("gainage", 2, "30–60 s")]],
      ["Legs", [X("squat", 4, "6–10"), X("hack-squat", 3, "8–12"), X("fente-bulg", 2, "8–12"), X("sdt", 3, "5–8"), X("leg-curl", 4, "10–15"), X("sdtr-halt", 3, "8–12")]]] },
  halt: {
    fb: [["Full body A", [X("squat-halt", 4, "8–15"), X("dc-halt", 4, "8–12"), X("row-1b", 4, "8–12"), X("sdtr-halt", 3, "8–12"), X("el-lat", 2, "12–20"), X("curl-halt", 2, "10–15")]],
      ["Full body B", [X("fentes", 3, "10–15"), X("dm-halt", 3, "8–12"), X("row-1b", 3, "10–15"), X("sdtr-halt", 4, "8–12"), X("ext-halt", 2, "10–15"), X("mollets", 4, "12–20")]],
      ["Full body C", [X("squat-halt", 3, "10–15"), X("di-halt", 3, "8–12"), X("pompes", 3, "8–20"), X("row-1b", 3, "8–12"), X("sdtr-halt", 3, "10–15"), X("curl-incl", 3, "10–15"), X("ext-halt", 2, "10–15")]]],
    hb: [["Haut 1", [X("dc-halt", 4, "6–10"), X("row-1b", 5, "8–12"), X("dm-halt", 3, "8–12"), X("el-lat", 3, "12–20"), X("curl-halt", 3, "8–12"), X("ext-halt", 2, "10–15")]],
      ["Bas 1", [X("squat-halt", 3, "8–15"), X("sdtr-halt", 4, "8–12"), X("fente-bulg", 3, "8–12"), X("mollets", 3, "12–20"), X("gainage", 2, "30–60 s")]],
      ["Haut 2", [X("di-halt", 3, "8–12"), X("row-1b", 5, "8–15"), X("pompes", 3, "8–20"), X("oiseau", 3, "12–20"), X("curl-incl", 3, "10–15"), X("ext-halt", 3, "10–15")]],
      ["Bas 2", [X("fentes", 3, "10–15"), X("sdtr-halt", 4, "10–15"), X("hip-thrust", 4, "10–20"), X("squat-halt", 2, "12–20"), X("mollets", 3, "12–20"), X("gainage-lat", 2, "30–45 s")]]],
    ppl: [["Push", [X("dc-halt", 4, "6–10"), X("di-halt", 3, "8–12"), X("pompes", 3, "8–20"), X("dm-halt", 2, "8–12"), X("el-lat", 4, "12–20"), X("ext-halt", 4, "10–15"), X("mollets", 3, "12–20")]],
      ["Pull", [X("row-1b", 5, "6–10", "Version lourde."), X("row-1b", 5, "12–15", "Version légère."), X("oiseau", 3, "12–20"), X("curl-halt", 3, "8–12"), X("curl-incl", 2, "10–15"), X("hip-thrust", 3, "10–20")]],
      ["Legs", [X("squat-halt", 4, "8–15"), X("fente-bulg", 3, "8–12"), X("fentes", 3, "10–15"), X("sdtr-halt", 4, "8–12", "Version lourde."), X("sdtr-halt", 3, "12–15", "Version légère."), X("hip-thrust", 3, "10–20")]]] },
  street: {
    fb: [["Full body A", [X("tractions", 3, "5–12"), X("dips", 3, "6–15"), X("squat", 3, "15–30", VIDE, true), X("row-inv", 3, "8–15"), X("superman", 3, "10–15"), X("releve", 2, "8–15")]],
      ["Full body B", [X("tractions-supi", 4, "5–12"), X("pompes", 4, "10–25"), X("fente-bulg", 3, "10–20 par jambe", VIDE, true), X("hip-thrust", 4, "15–25", CHAISE, true), X("pompes-serrees", 3, "8–20"), X("mollets", 3, "15–25", VIDE, true)]],
      ["Full body C", [X("tractions", 3, "5–12"), X("dips", 3, "6–15"), X("fentes", 4, "10–20 par jambe", VIDE, true), X("row-inv", 2, "8–15"), X("superman", 3, "10–15"), X("pompes-serrees", 2, "8–20"), X("mollets", 2, "15–25", VIDE, true)]]],
    hb: [["Haut 1", [X("tractions", 4, "5–12"), X("dips", 4, "6–15"), X("row-inv", 3, "8–15"), X("pompes-serrees", 3, "8–20")]],
      ["Bas 1", [X("squat", 3, "15–30", VIDE, true), X("superman", 3, "10–15"), X("fente-bulg", 3, "10–20 par jambe", VIDE, true), X("hip-thrust", 3, "15–25", CHAISE, true), X("mollets", 3, "15–25", VIDE, true), X("releve", 2, "8–15")]],
      ["Haut 2", [X("tractions-supi", 5, "5–12"), X("pompes", 4, "10–25"), X("row-inv", 3, "8–15"), X("dips", 2, "6–15"), X("pompes-serrees", 2, "8–20")]],
      ["Bas 2", [X("fentes", 3, "10–20 par jambe", VIDE, true), X("superman", 3, "10–15"), X("squat", 2, "15–30", VIDE, true), X("hip-thrust", 3, "15–25", CHAISE, true), X("mollets", 3, "15–25", VIDE, true), X("gainage", 2, "30–60 s")]]] }
};
function objOk(mat, obj) { return mat !== "street" || obj === "muscle" || obj === "endurance"; }
function orgOk(mat, org) { return !(mat === "street" && org === "ppl"); }
function objLabel(v) { return listLabel(OBJS.map(function (o) { return { v: o.v, l: o.l }; }), v); }

/* ---------- Rôles, réglages et durée ---------- */
function isTimeR(r) { return / s$/.test(String(r || "")); }
function exIso(x) { return !x.k || ISO_K.indexOf(x.k) >= 0 || !!(CAT[x.k] && CAT[x.k].time); }
function rolesOf(sess) { var n = 0; return sess.ex.map(function (x) { if (x.k && exIso(x)) return "iso"; n++; return n <= 2 ? "principal" : "secondaire"; }); }
function baseOf(x, role) {
  if (x.b) return x.b;
  var t = x.k && CAT[x.k] && CAT[x.k].time;
  return { s: 3, r: t ? "30–60 s" : role === "principal" ? "6–10" : role === "secondaire" ? "8–12" : "10–15" };
}
/* Réglages d'un exercice selon son rôle et l'objectif (tableau « Variantes selon l'objectif ») */
function settingsFor(x, role, obj) {
  var b = baseOf(x, role), t = isTimeR(b.r), pj = / par jambe$/.test(b.r) ? " par jambe" : "", o = { s: b.s, r: b.r };
  function R(r) { return t ? b.r : r + pj; }
  if (obj === "force") {
    if (role === "principal") { o.s = Math.max(3, b.s); o.r = R("3–6"); o.rir = "1–3"; o.rest = "3 min"; }
    else if (role === "secondaire") { o.s = Math.min(b.s, 3); o.r = R("6–8"); o.rir = "2"; o.rest = "2 min 30"; }
    else { o.s = t ? b.s : Math.max(2, Math.ceil(b.s / 2)); o.r = R("8–12"); o.rir = "1–2"; o.rest = "1 min 30"; }
  } else if (obj === "mixte") {
    if (role === "principal") { o.s = Math.max(3, b.s); o.r = R("4–6"); o.rir = "1–3"; o.rest = "3 min"; }
    else if (role === "secondaire") { o.rir = "1–3"; o.rest = "2 min"; }
    else { o.rir = "0–2"; o.rest = "1 min 30"; }
  } else if (obj === "endurance") {
    o.r = R(role === "iso" ? "20–30" : "15–25"); o.rir = "0–2"; o.rest = role === "iso" ? "30 s" : "45 s";
  } else {
    o.rir = role === "iso" ? "0–2" : "1–3"; o.rest = role === "principal" ? "2–3 min" : role === "secondaire" ? "2 min" : "1 min 30";
  }
  if (t) o.rir = "1–2";
  return o;
}
function alignEx(x, role, obj) { var o = settingsFor(x, role, obj); x.s = o.s; x.r = o.r; x.rir = o.rir; x.rest = o.rest; }
function realign(d, sess, all) {
  if (sess.kind !== "muscu") return;
  var rl = rolesOf(sess);
  sess.ex.forEach(function (x, i) { if (all || !x.perso) alignEx(x, rl[i], d.obj); });
}
function nums(s) { return (String(s || "").match(/\d+(?:[.,]\d+)?/g) || []).map(function (n) { return Number(n.replace(",", ".")); }); }
function midOf(s) { var n = nums(s); return n.length ? (n[0] + n[n.length - 1]) / 2 : null; }
function restMin(s) {
  s = String(s || ""); var n = nums(s); if (!n.length) return 2;
  if (/min/.test(s)) { if (/min\s*\d/.test(s)) return n[0] + n[1] / 60; return (n[0] + n[n.length - 1]) / 2; }
  if (/s\b|s$/.test(s)) return midOf(s) / 60;
  return midOf(s);
}
function workMin(r) { if (isTimeR(r)) return 0.75; var m = midOf(r); if (m === null) return 0.75; return m <= 5 ? 0.5 : m <= 7 ? 0.6 : m <= 15 ? 0.75 : 1; }
function exDur(x, s) { var n = s === undefined ? toNum(x.s) || 0 : s; return n * (workMin(x.r) * (UNI_K.indexOf(x.k) >= 0 ? 2 : 1) + restMin(x.rest)); }
function sessDur(sess, sets) { if (sess.kind !== "muscu") return sess.kind === "cardio" ? cardioMin(sess) : toNum(sess.duree); return Math.round((10 + sess.ex.reduce(function (a, x, i) { return a + exDur(x, sets ? sets[i] : undefined); }, 0)) / 5) * 5; }
function sessSets(sess) { return sess.ex.reduce(function (a, x) { return a + (toNum(x.s) || 0); }, 0); }
function exMu(x) { return (x.k && CAT[x.k] && CAT[x.k].mu) || x.mu || {}; }
function sessVol(sess) {
  var v = {}; MUSCLES.forEach(function (m) { v[m[0]] = 0; });
  if (sess.kind === "muscu") sess.ex.forEach(function (x) { var mu = exMu(x), n = toNum(x.s) || 0; keysOf(mu).forEach(function (m) { if (v[m] !== undefined) v[m] += n * mu[m]; }); });
  return v;
}
function exName(x) { return x.k && CAT[x.k] ? CAT[x.k].n : x.n || "Exercice"; }
function cardioMin(sess) {
  if (sess.ctype === "fractionne") return fmtMinutes(Object.assign({ mode: "temps" }, sess.fr || {}));
  return toNum(sess.duree);
}
function sessLine(sess) {
  if (sess.plan) return "Course · consigne différente chaque semaine";
  if (sess.kind === "muscu") { var m = sessDur(sess); return "Musculation · " + sess.ex.length + " exercice" + (sess.ex.length > 1 ? "s" : "") + " · " + fmt(sessSets(sess)) + " séries · " + m + " min"; }
  if (sess.kind === "cardio") {
    var t = listLabel(SPORTS, sess.sport) + " · ", mn = cardioMin(sess);
    if (sess.ctype === "fractionne") return t + (fmtLine(Object.assign({ mode: "temps" }, sess.fr || {})) || "fractionné à préciser") + (mn ? " · environ " + mn + " min" : "");
    return t + listLabel(CTYPES, sess.ctype).toLowerCase() + (mn ? " · " + mn + " min" : "");
  }
  return "Autre sport" + (toNum(sess.duree) ? " · " + toNum(sess.duree) + " min prévues" : "");
}

/* ---------- Brouillon ---------- */
function rndId(n, set) { var s = ""; for (var i = 0; i < n; i++) s += set.charAt(Math.floor(Math.random() * set.length)); return s; }
function letterOf(n) { var s = ""; n++; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function nextMonday() { var t = todayStr(); return dow(t) === 0 ? t : addDays(mondayOfDate(t), 7); }
function newDraft() {
  return { id: "d" + rndId(6, "abcdefghijkmnpqrstuvwxyz23456789"), tag: rndId(2, "ABCDEFGHJKLMNPQRSTUVWXYZ"), nom: "Mon programme", debut: nextMonday(), semaines: 6, decharge: true,
    mat: "salle", obj: "muscle", org: null, prog: "simple", seances: [], jours: [[], [], [], [], [], [], []], nl: 0 };
}
function newSess(d, kind, nom) { var u = letterOf(d.nl++); var s = { u: u, kind: kind, nom: nom }; if (kind === "muscu") { s.ex = []; s.nx = 0; } return s; }
function newEx(d, sess, k) { sess.nx = (sess.nx || 0) + 1; return { id: "U" + d.tag + sess.u + sess.nx, code: sess.u + sess.nx, k: k }; }
function loadModel(d) {
  var tpl = MODELES[d.mat] && MODELES[d.mat][d.org]; if (!tpl) return;
  var old = d.seances.filter(function (s) { return s.kind === "muscu"; }).map(function (s) { return s.u; });
  d.seances = d.seances.filter(function (s) { return s.kind !== "muscu"; });
  d.jours = d.jours.map(function (j) { return j.filter(function (u) { return old.indexOf(u) < 0; }); });
  var org = ORGS.filter(function (o) { return o.v === d.org; })[0], made = [];
  tpl.forEach(function (t) {
    var s = newSess(d, "muscu", t[0]);
    t[1].forEach(function (m) { var x = newEx(d, s, m.k); x.b = { s: m.s, r: m.r }; if (m.note) x.note = m.note; if (m.zero) x.zero = true; s.ex.push(x); });
    realign(d, s, true); made.push(s);
  });
  d.seances = made.concat(d.seances);
  made.forEach(function (s, i) { var day = org.jours[i % org.jours.length]; d.jours[day].push(s.u); });
}
function sessByU(d, u) { for (var i = 0; i < d.seances.length; i++) if (d.seances[i].u === u) return d.seances[i]; return null; }
function persoList(d) {
  var out = [];
  d.seances.forEach(function (s) { if (s.kind !== "muscu") return; var rl = rolesOf(s); s.ex.forEach(function (x, i) { if (x.perso || x.aj) out.push({ s: s, x: x, role: rl[i] }); }); });
  return out;
}
function exVals(x) { return x.s + " × " + x.r + (x.rir ? ", RIR " + x.rir : "") + ", repos " + x.rest; }
function setObj(d, obj, align) {
  d.obj = obj;
  d.seances.forEach(function (s) {
    if (s.kind !== "muscu") return;
    var rl = rolesOf(s);
    s.ex.forEach(function (x, i) { if ((!x.perso && !x.aj) || align[x.id]) { alignEx(x, rl[i], obj); x.perso = false; x.aj = false; } });
  });
}
function saveDraft(d) { d.maj = new Date().toISOString(); if (!D.brouillons) D.brouillons = {}; D.brouillons[d.id] = d; persist(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------- Programme installé à partir du brouillon ---------- */
function rirNum(s) { var n = nums(s); return n.length ? (n[0] + n[n.length - 1]) / 2 : 2; }
function rirTxt(v) { return v % 1 === 0 ? String(v) : Math.floor(v) + "–" + Math.ceil(v); }
function compile(d, pid) {
  var N = Math.max(1, Math.min(30, Math.round(toNum(d.semaines) || 6))), dl = !!d.decharge && N > 1 && !d.type || (!!d.decharge && N > 1 && d.type === "muscu"), K = dl ? N - 1 : N;
  var p = { v: 1, id: pid, titre: d.nom || "Mon programme", cree: true, debut: d.debut, semaines: N, deload: dl ? [N] : [],
    objectif: "Programme créé dans l'application · objectif " + objLabel(d.obj).toLowerCase() + (d.prog === "guidee" ? ", progression guidée." : "."),
    legende: "Séries de musculation prévues chaque semaine." + (dl ? " La dernière est une semaine de décharge." : ""),
    versions: { A: { label: "Semaine type", jours: d.jours.map(function (j) { return j.map(function (u) { return "S" + d.tag + u; }); }) } }, sessions: {}, src: clone(d) };
  d.seances.forEach(function (s) {
    var key = "S" + d.tag + s.u, nom = s.nom || "Séance";
    if (s.kind === "muscu") {
      var rl = rolesOf(s), base = s.ex.map(function (x) { return toNum(x.s) || 1; });
      var ex = s.ex.map(function (x) { var c = CAT[x.k] || {}; return { id: x.id, code: x.code, name: exName(x), cat: x.k || "", mu: exMu(x), gr: c.gr || x.gr || "", bw: !!c.bw, time: !!c.time, step: c.per ? 2 : 2.5,
        rest: x.rest, restW: [], sets: [], reps: [], repsN: [], rir: [], rirN: [], note: x.note || "", alt: [], base: c.bw || c.time || x.zero ? [] : null }; });
      for (var w = 1; w <= N; w++) {
        var deload = dl && w === N, sets = base.slice();
        if (deload) sets = sets.map(function (n) { return Math.max(1, Math.ceil(n / 2)); });
        else if (d.prog === "guidee") {
          var add = Math.floor((w - 1) / 2);
          while (add > 0) { var tr = base.map(function (n, i) { return rl[i] === "principal" ? n + add : n; }); if (sessDur(s, tr) <= 75) { sets = tr; break; } add--; }
        }
        var rg = K > 1 ? Math.round((3 - 2 * (w - 1) / (K - 1)) * 2) / 2 : 2;
        if (d.type === "mixte" && w <= 2) sets = sets.map(function (n) { return Math.max(1, n - 1); });
        if (s.renfo) sets = sets.map(function (n) { return w >= N - 1 ? 0 : w === N - 2 ? Math.max(1, Math.ceil(n / 2)) : n; });
        s.ex.forEach(function (x, i) {
          var e = ex[i], rr = deload ? "3–4" : d.type === "mixte" && w <= 2 ? "3" : d.prog === "guidee" && rl[i] !== "iso" && !isTimeR(x.r) ? rirTxt(rg) : x.rir || "2";
          e.sets.push(sets[i]); e.reps.push(x.r); e.repsN.push(nums(x.r)[0] || 8); e.rir.push(rr); e.rirN.push(deload ? 3.5 : rirNum(rr)); e.restW.push(x.rest);
          if (e.base) e.base.push(0);
        });
      }
      p.sessions[key] = { kind: "muscu", name: nom, short: nom, ex: ex };
    } else if (s.kind === "cardio" && s.plan) {
      p.sessions[key] = { kind: "course", name: nom, short: nom, sport: "course", role: s.role, custom: true, plan: s.plan.map(function (e) {
        if (!e || e.repos) return null;
        var x = clone(e); x.texte = entryText(e); x.role = e.role || s.role; return x;
      }) };
    } else if (s.kind === "cardio") {
      var fr = s.ctype === "fractionne" ? Object.assign({ mode: "temps" }, s.fr || {}) : null, plan = [];
      var texte = fr ? (fmtLine(fr) || "Fractionné") + (fmtMinutes(fr) ? ", environ " + fmtMinutes(fr) + " min." : ".") : listLabel(CTYPES, s.ctype) + (toNum(s.duree) ? ", " + toNum(s.duree) + " min." : ".");
      for (var c = 1; c <= N; c++) plan.push(fr ? { texte: texte, fr: clone(fr) } : { texte: texte });
      p.sessions[key] = { kind: "course", name: nom, short: nom, sport: s.sport || "course", ctype: s.ctype || "ef", plan: plan, custom: true };
    } else p.sessions[key] = { kind: "sport", name: nom, short: nom, duree: toNum(s.duree), custom: true };
  });
  if (d.type === "course" && d.run) {
    var o = runObjOf(d.run); p.run = clone(d.run); p.run.race = d.raceDate; p.deload = [];
    p.objectif = "Préparation du " + DISTL[d.run.dist] + " · objectif " + (o && o.t ? fmtRace(o.t) : "finir") + " · course le " + fmtLong(d.raceDate) + ".";
    p.legende = "Minutes de course prévues chaque semaine. La dernière semaine est une semaine de récupération.";
  } else if (d.type === "mixte") { p.deload = []; p.objectif = "Mixte remise en forme : 2 séances de course et 2 de musculation par semaine."; p.legende = "Minutes d'activité prévues chaque semaine."; }
  return p;
}
/* Changement d'objectif en cours de programme : les semaines avant « from » gardent leurs consignes */
function keepWeeks(np, op, from) {
  keysOf(np.sessions).forEach(function (k) {
    var ns = np.sessions[k], os = op.sessions[k]; if (!os || ns.kind !== "muscu" || os.kind !== "muscu") return;
    ns.ex.forEach(function (e) {
      var o = os.ex.filter(function (x) { return x.id === e.id; })[0]; if (!o) return;
      ["sets", "reps", "repsN", "rir", "rirN", "restW", "base"].forEach(function (f) {
        if (!e[f] || !o[f]) return;
        for (var i = 0; i < from - 1 && i < e[f].length; i++) if (o[f][i] !== undefined) e[f][i] = o[f][i];
      });
      if (!o.restW) for (var j = 0; j < from - 1 && j < e.restW.length; j++) e.restW[j] = o.rest;
    });
  });
}
function updateProgram(np) {
  freezeAll(false);
  D.programmes[np.id] = np; D.actif = np.id;
  persistNow(); setActive();
}

/* ---------- Vues de l'éditeur ---------- */
function stepHead(n, title) {
  var h = '<div class="ed-head"><p class="small muted">' + (S.ed.d.pid ? "Modifier mon programme" : "Créer mon programme") + " · étape " + n + ' sur 4</p><div class="stepbar" aria-hidden="true">';
  for (var i = 1; i <= 4; i++) h += '<span class="' + (i <= n ? "on" : "") + '"></span>';
  return h + "</div><h1>" + esc(title) + "</h1></div>";
}
function edBtn(op, label, cls, extra) { return '<button type="button" class="btn ' + (cls || "") + '" data-act="ed" data-op="' + op + '"' + (extra || "") + ">" + esc(label) + "</button>"; }
function edInp(path, value, attrs) { return inp("ed", "", path, value, attrs); }
function viewEditeur() {
  var ed = S.ed, d = ed.d;
  if (ed.sess) { var s = sessByU(d, ed.sess); if (s) return s.kind === "muscu" ? edSession(d, s) : s.kind === "cardio" ? edCardio(d, s) : edSport(d, s); ed.sess = null; }
  var run = d.type === "course" || d.type === "mixte";
  if (ed.step === 2 && run && ed.week) return edWeek(d, ed.week);
  if (ed.step === 2) return run ? edPlan2(d) : edStep2(d);
  if (ed.step === 3) return edStep3(d);
  if (ed.step === 4) return run ? edRecapRun(d) : edStep4(d);
  return edStep1(d);
}
function modelRange(mat, org, obj) {
  var tpl = MODELES[mat] && MODELES[mat][org]; if (!tpl) return null;
  var lo = 999, hi = 0, dd = { obj: obj };
  tpl.forEach(function (t) {
    var s = { kind: "muscu", ex: t[1].map(function (m) { return { k: m.k, b: { s: m.s, r: m.r } }; }) };
    realign(dd, s, true); var m = sessDur(s); lo = Math.min(lo, m); hi = Math.max(hi, m);
  });
  return lo === hi ? lo + " min par séance" : lo + " à " + hi + " min par séance";
}
function edStep1(d) { return d.type === "course" ? edRun1(d) : d.type === "mixte" ? edMixte1(d) : edStep1Muscu(d); }
function edStep1Muscu(d) {
  var h = stepHead(1, "Le cadre") + typeChooser(d), mons = [], m0 = mondayOfDate(todayStr());
  for (var i = 0; i < 10; i++) mons.push(addDays(m0, 7 * i));
  if (mons.indexOf(d.debut) < 0) mons.unshift(d.debut);
  h += '<section class="sheet"><label class="field"><span>Nom du programme</span>' + edInp("nom", d.nom, 'maxlength="40"') + "</label>";
  h += '<div class="grid2"><label class="field"><span>Début, un lundi</span><select data-act="edsel" data-op="debut">' + mons.map(function (x) { return '<option value="' + x + '"' + (x === d.debut ? " selected" : "") + ">" + esc(parse(x).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })) + "</option>"; }).join("") + "</select></label>" +
    '<label class="field"><span>Nombre de semaines</span>' + edInp("semaines", d.semaines, 'inputmode="numeric"') + "</label></div>";
  h += '<div class="scale"><div class="scale-q"><span>Dernière semaine</span></div><div class="seg">' +
    '<button type="button" data-act="ed" data-op="decharge" data-v="1" aria-pressed="' + !!d.decharge + '">Décharge</button><button type="button" data-act="ed" data-op="decharge" data-v="0" aria-pressed="' + !d.decharge + '">Normale</button></div></div>';
  h += '<p class="tiny muted">La semaine de décharge garde les mêmes exercices avec moitié moins de séries, loin de l\'échec, pour récupérer avant le bloc suivant.</p></section>';
  h += '<section class="sheet"><div class="titled"><h2>Point de départ</h2><p class="small muted">Pars d\'un modèle vérifié, puis adapte-le. Tout reste modifiable.</p></div>';
  h += '<div class="scale"><div class="scale-q"><span>Ton matériel</span></div><div class="seg">' + MATS.map(function (m) { return '<button type="button" data-act="ed" data-op="mat" data-v="' + m.v + '" aria-pressed="' + (d.mat === m.v) + '">' + esc(m.l) + "</button>"; }).join("") + "</div></div>";
  h += '<div class="scale"><div class="scale-q"><span>Ton objectif</span></div><div class="types">' + OBJS.map(function (o) {
    var dis = !objOk(d.mat, o.v);
    return '<button type="button" class="type" data-act="ed" data-op="obj" data-v="' + o.v + '" aria-pressed="' + (d.obj === o.v) + '"' + (dis ? ' aria-disabled="true"' : "") + "><b>" + esc(o.l) + "</b><span>" + esc(o.d) + '</span><span class="hint">' + esc(dis ? "Pas proposé en street workout : il faut pouvoir ajouter de la charge." : o.h) + "</span></button>";
  }).join("") + "</div></div>";
  if (d.mat === "halt" && (d.obj === "force" || d.obj === "mixte")) h += '<div class="note warn"><b>Il faut des haltères assez lourds.</b> L\'objectif ' + esc(objLabel(d.obj).toLowerCase()) + " demande de ne pouvoir faire que 3 à 6 répétitions au développé ou au squat. Si tes haltères sont trop légers pour ça, choisis la prise de muscle.</div>";
  if (S.ed.reset) h += '<div class="note info">En street workout, l\'objectif est revenu à <b>prise de muscle</b> : sans charge à ajouter, on ne peut pas faire 3 à 6 répétitions lourdes.</div>';
  h += '<div class="scale"><div class="scale-q"><span>Organisation</span></div><div class="types">' + ORGS.map(function (o) {
    var dis = !orgOk(d.mat, o.v);
    return '<button type="button" class="type" data-act="ed" data-op="org" data-v="' + o.v + '" aria-pressed="' + (d.org === o.v) + '"' + (dis ? ' aria-disabled="true"' : "") + "><b>" + esc(o.l) + "</b><span>" + esc(o.d) + '</span><span class="hint">' + esc(dis ? "Pas proposé en street workout." : modelRange(d.mat, o.v, d.obj) || "") + "</span></button>";
  }).join("") + "</div></div>";
  h += edBtn("blank", "Partir d'une page blanche", "quiet wide");
  h += '<p class="tiny muted">L\'objectif ne change pas les exercices : seulement les répétitions, les repos et, en force, le nombre de séries d\'isolation. Tu pourras en changer plus tard dans Réglages, pour les séances à venir. Les modèles visent 10 séries par muscle et par semaine, en 1 h 15 au plus par séance, échauffement compris. <button type="button" class="linkbtn" data-act="ed" data-op="pourquoi">Pourquoi ces modèles ?</button></p></section>';
  h += '<div class="row spread">' + edBtn("quit", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function edStep2(d) {
  var h = stepHead(2, "Les séances");
  h += '<p class="small muted">Touche une séance pour la modifier. Tu peux en ajouter de musculation, de cardio ou d\'un autre sport.</p>';
  h += '<section class="sheet ed-list">';
  if (!d.seances.length) h += '<div class="note info">Aucune séance pour l\'instant : ajoute-en une, ou reviens à l\'étape 1 pour partir d\'un modèle.</div>';
  d.seances.forEach(function (s) {
    var m = s.kind === "muscu" ? sessDur(s) : 0;
    h += '<button type="button" class="log-item ed-sess" data-act="ed" data-op="open" data-u="' + esc(s.u) + '"><span class="row"><b>' + esc(s.nom || "Séance") + '</b><span class="linkbtn">Modifier</span></span><span class="small muted">' + esc(sessLine(s)) + "</span>" +
      (s.kind === "muscu" && s.ex.length ? '<span class="tiny muted">' + esc(s.ex.map(exName).join(" · ")) + "</span>" : "") +
      (m > 75 ? '<span class="tiny warn-t">Plus de 1 h 15 : retire des séries ou un exercice.</span>' : "") + "</button>";
  });
  h += '<div class="row">' + edBtn("addmuscu", "+ Musculation", "small") + edBtn("addcardio", "+ Cardio", "small") + edBtn("addsport", "+ Autre sport", "small") + "</div></section>";
  h += '<div class="row spread">' + edBtn("prev", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function sessNote(d, s) {
  var v = sessVol(s), parts = VOL_ORDER.filter(function (k) { return v[k] > 0; }).map(function (k) { return muscleName(k).toLowerCase() + " " + fmt(v[k]); });
  var m = sessDur(s), over = MUSCLES.filter(function (mm) { return v[mm[0]] > 11; });
  var h = '<div class="note ' + (m > 75 || over.length ? "warn" : "info") + '"><b>Cette séance : ' + fmt(sessSets(s)) + " séries, environ " + m + " min.</b> " + esc(parts.join(", ")) + (parts.length ? "." : "");
  if (m > 75) h += " Au-delà de 1 h 15 avec l'échauffement : retire des séries ou un exercice.";
  if (over.length) h += " Plus de 11 séries pour " + esc(over.map(function (mm) { return mm[1].toLowerCase(); }).join(", ")) + " dans la même séance : au-delà, les séries en plus rapportent peu.";
  return h + "</div>";
}
function edSession(d, s) {
  var i = d.seances.indexOf(s), rl = rolesOf(s);
  var h = '<div class="ed-head"><p class="small muted">' + (d.pid ? "Modifier mon programme" : "Créer mon programme") + " · étape 2 sur 4</p><h1>" + esc(s.nom || "Séance") + "</h1></div>";
  h += '<section class="sheet"><label class="field"><span>Nom de la séance</span>' + edInp("seances." + i + ".nom", s.nom, 'maxlength="30"') + "</label>";
  if (d.obj !== "muscle") h += '<div class="note info"><b>Objectif ' + esc(objLabel(d.obj).toLowerCase()) + ".</b> Les répétitions, le RIR et les repos suivent le rôle de chaque exercice : les deux premiers polyarticulaires sont principaux, les autres secondaires, le reste en isolation. Tu peux changer chaque valeur.</div>";
  s.ex.forEach(function (x, j) {
    var p = "seances." + i + ".ex." + j + ".", c = CAT[x.k] || {};
    h += '<div class="ex" id="edx-' + esc(x.id) + '"><div class="ex-title"><h3><span class="ex-code">' + (j + 1) + "</span>" + esc(exName(x)) + '</h3><button type="button" class="icon-btn" data-act="ed" data-op="exrm" data-j="' + j + '" aria-label="Retirer ' + esc(exName(x)) + '">' + ICON_X + "</button></div>";
    h += '<div class="row"><span class="role r-' + rl[j] + '">' + ROLES[rl[j]] + "</span>" + (x.perso ? '<span class="tiny muted">modifié</span>' : x.aj ? '<span class="tiny muted">ajouté</span>' : "") + "</div>";
    h += '<div class="grid3"><label class="field"><span>Séries</span>' + edInp(p + "s", x.s, 'inputmode="numeric"') + '</label><label class="field"><span>' + (c.time ? "Durée" : "Répétitions") + "</span>" + edInp(p + "r", x.r) + '</label><label class="field"><span>RIR visé</span>' + edInp(p + "rir", x.rir) + "</label></div>";
    h += '<div class="row ed-rest"><label class="field"><span>Repos</span>' + edInp(p + "rest", x.rest) + "</label>" +
      (j > 0 ? '<button type="button" class="linkbtn" data-act="ed" data-op="exup" data-j="' + j + '">Monter</button>' : "") +
      (j < s.ex.length - 1 ? '<button type="button" class="linkbtn" data-act="ed" data-op="exdown" data-j="' + j + '">Descendre</button>' : "") + "</div>";
    if (x.note) h += '<p class="tiny muted">' + esc(x.note) + "</p>";
    h += "</div>";
  });
  h += edBtn("expick", "Ajouter un exercice de la bibliothèque", "outline wide");
  h += '<p class="tiny muted">Un exercice ajouté prend les réglages de son rôle' + (d.obj !== "muscle" ? " dans l'objectif " + esc(objLabel(d.obj).toLowerCase()) : "") + " ; tu peux ensuite les modifier.</p>";
  h += '<div data-edlive="sess">' + sessNote(d, s) + "</div></section>";
  h += '<div class="row spread">' + edBtn("sessrm", "Supprimer la séance", "quiet") + edBtn("close", "Enregistrer la séance", "primary") + "</div>";
  return h;
}
function cardioLine(s) { var mn = cardioMin(s); return s.ctype === "fractionne" ? (fmtLine(Object.assign({ mode: "temps" }, s.fr || {})) || "Indique l'effort et le nombre de répétitions.") + (mn ? " · environ " + mn + " min" : "") : listLabel(CTYPES, s.ctype) + (mn ? " · " + mn + " min" : ""); }
function edCardio(d, s) {
  var i = d.seances.indexOf(s), p = "seances." + i + ".";
  var h = '<div class="ed-head"><p class="small muted">' + (d.pid ? "Modifier mon programme" : "Créer mon programme") + ' · étape 2 sur 4</p><h1>Séance cardio</h1></div><section class="sheet">';
  h += '<label class="field"><span>Nom de la séance</span>' + edInp(p + "nom", s.nom, 'maxlength="30"') + "</label>";
  h += '<div class="scale"><div class="scale-q"><span>Discipline</span></div><div class="seg">' + SPORTS.map(function (x) { return '<button type="button" data-act="ed" data-op="csport" data-v="' + x.v + '" aria-pressed="' + (s.sport === x.v) + '">' + esc(x.l) + "</button>"; }).join("") + "</div></div>";
  h += '<div class="scale"><div class="scale-q"><span>Type</span></div><div class="seg">' + CTYPES.map(function (x) { return '<button type="button" data-act="ed" data-op="ctype" data-v="' + x.v + '" aria-pressed="' + (s.ctype === x.v) + '">' + esc(x.v === "recup" ? "Récupération" : x.v === "ef" ? "Endurance" : x.l) + "</button>"; }).join("") + "</div></div>";
  if (s.ctype === "fractionne") {
    var f = s.fr || {}, q = p + "fr.";
    h += '<div class="grid2"><label class="field"><span>Effort (s)</span>' + edInp(q + "effort", f.effort, 'inputmode="numeric"') + '</label><label class="field"><span>Récupération (s)</span>' + edInp(q + "recup", f.recup, 'inputmode="numeric"') + "</label></div>";
    h += '<div class="grid3"><label class="field"><span>Répétitions</span>' + edInp(q + "reps", f.reps, 'inputmode="numeric"') + '</label><label class="field"><span>Séries</span>' + edInp(q + "series", f.series, 'inputmode="numeric"') + '</label><label class="field"><span>Entre séries (min)</span>' + edInp(q + "entre", f.entre, 'inputmode="decimal"') + "</label></div>";
    h += '<div class="grid2"><label class="field"><span>Échauffement (min)</span>' + edInp(q + "echauf", f.echauf, 'inputmode="numeric"') + '</label><label class="field"><span>Retour au calme (min)</span>' + edInp(q + "calme", f.calme, 'inputmode="numeric"') + "</label></div>";
    h += '<label class="field"><span>' + (s.sport === "velo" ? "Puissance visée par répétition (W), facultatif" : "Distance visée par répétition (m), facultatif") + "</span>" + edInp(q + "vise", f.vise, 'inputmode="numeric"') + "</label>";
  } else h += '<label class="field"><span>Durée prévue (min)</span>' + edInp(p + "duree", s.duree, 'inputmode="numeric"') + "</label>";
  h += '<div class="note info" data-edlive="cardio"><b>' + esc(cardioLine(s)) + "</b></div>";
  h += '<p class="small muted">' + (s.ctype === "fractionne" ? "Le jour venu, la séance s'ouvre préremplie avec ce format, comme les fractionnés d'un programme de coach." : "Le jour venu, la séance affiche la consigne de FC et de ressenti de ce type de séance.") + "</p></section>";
  h += '<div class="row spread">' + edBtn("sessrm", "Supprimer la séance", "quiet") + edBtn("close", "Enregistrer la séance", "primary") + "</div>";
  return h;
}
function edSport(d, s) {
  var i = d.seances.indexOf(s), p = "seances." + i + ".";
  var h = '<div class="ed-head"><p class="small muted">' + (d.pid ? "Modifier mon programme" : "Créer mon programme") + ' · étape 2 sur 4</p><h1>Autre sport</h1></div><section class="sheet">';
  h += '<label class="field"><span>Nom du sport ou de la séance</span>' + edInp(p + "nom", s.nom, 'maxlength="30" placeholder="ex. Foot, sambo, judo"') + "</label>";
  h += '<label class="field"><span>Durée prévue (min)</span>' + edInp(p + "duree", s.duree, 'inputmode="numeric" placeholder="ex. 90"') + "</label>";
  h += '<p class="small muted">Le jour venu, tu noteras sa durée et son intensité : elles comptent dans la charge de la semaine.</p></section>';
  h += '<div class="row spread">' + edBtn("sessrm", "Supprimer la séance", "quiet") + edBtn("close", "Enregistrer la séance", "primary") + "</div>";
  return h;
}
var JOURS = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."], JOURS_L = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
function sessKind(s) {
  if (s.plan) return s.role === "vma" || s.role === "allure" ? "frac" : s.role === "sl" ? "long" : "cardio";
  if (s.kind === "cardio") return s.ctype === "fractionne" ? "frac" : "cardio";
  if (s.kind === "sport") return "sport";
  var v = sessVol(s), legs = v.quadri + v.ischios, up = v.pecs + v.dorsal + v.epaules + v.biceps + v.triceps;
  return legs >= 4 && up >= 4 ? "full" : legs >= 4 ? "legs" : "upper";
}
function recos(d) {
  var out = [], day = d.jours.map(function (j) { return j.map(function (u) { return sessByU(d, u); }).filter(Boolean); });
  function nm(s) { return s.nom || "Séance"; }
  for (var i = 0; i < 7; i++) {
    var a = day[i], b = day[(i + 1) % 7], wrap = i === 6;
    a.forEach(function (x) {
      var kx = sessKind(x);
      b.forEach(function (y) {
        var ky = sessKind(y);
        if (kx === "long" && ky === "frac") out.push({ c: "warn", t: nm(y) + " le lendemain de " + nm(x) + ".", d: "Conseil : pas de fractionné le lendemain de la sortie longue ; place une séance facile ou un repos entre les deux." });
        if ((kx === "legs" || kx === "full") && ky === "frac") out.push({ c: "warn", t: nm(y) + " le lendemain de " + nm(x) + ".", d: "Les jambes seront encore fatiguées. Conseil : éloigne le fractionné des séances de jambes, ou garde-le facile." });
        if ((kx === "legs" || kx === "full") && ky === "sport") out.push({ c: "warn", t: nm(x) + " la veille de " + nm(y) + ".", d: "Conseil : laisse au moins 24 h entre une séance de jambes et un match ou un entraînement intense." });
        if (x.kind === "muscu" && y.kind === "muscu" && !wrap) {
          var vx = sessVol(x), vy = sessVol(y), both = MUSCLES.filter(function (m) { return vx[m[0]] >= 4 && vy[m[0]] >= 4; });
          if (both.length) out.push({ c: "warn", t: nm(x) + " et " + nm(y) + " se suivent.", d: "Mêmes muscles deux jours de suite (" + both.map(function (m) { return m[1].toLowerCase(); }).join(", ") + "). Conseil : laisse environ 48 h entre deux séances qui les sollicitent." });
        }
      });
      a.forEach(function (y) {
        if (y === x) return;
        if ((kx === "legs" || kx === "full") && sessKind(y) === "frac" && d.jours[i].indexOf(x.u) < d.jours[i].indexOf(y.u)) out.push({ c: "warn", t: nm(y) + " le même jour que " + nm(x) + ".", d: "Conseil : fais le fractionné avant la musculation, ou un autre jour." });
      });
    });
  }
  var placed = {}; d.jours.forEach(function (j) { j.forEach(function (u) { placed[u] = (placed[u] || 0) + 1; }); });
  d.seances.forEach(function (s) { if (!placed[s.u]) out.push({ c: "warn", t: nm(s) + " n'est placée sur aucun jour.", d: "Elle ne sera pas au programme : ajoute-la à un jour, ou supprime-la à l'étape 2." }); });
  var rest = day.filter(function (x) { return !x.length; }).length;
  if (!rest) out.push({ c: "info", t: "Aucun jour de repos.", d: "Conseil : garde au moins un jour sans séance dans la semaine pour récupérer." });
  var mus = d.seances.filter(function (s) { return s.kind === "muscu" && placed[s.u]; }), groups = {};
  mus.forEach(function (s) { var k = sessKind(s); (groups[k] = groups[k] || []).push(s); });
  keysOf(groups).forEach(function (k) {
    var g = groups[k]; if (g.length !== 2) return;
    var da = [], db = [];
    d.jours.forEach(function (j, i) { if (j.indexOf(g[0].u) >= 0) da.push(i); if (j.indexOf(g[1].u) >= 0) db.push(i); });
    if (da.length === 1 && db.length === 1) { var gap = Math.abs(da[0] - db[0]); gap = Math.min(gap, 7 - gap); if (gap >= 2) out.push({ c: "ok", t: nm(g[0]) + " et " + nm(g[1]) + " sont séparées de " + gap + " jours.", d: "Les muscles récupèrent entre les deux." }); }
  });
  return out;
}
function edStep3(d) {
  var h = stepHead(3, "La semaine type");
  h += '<p class="small muted">Place chaque séance sur le jour que tu veux : rien n\'est imposé. Un jour peut en recevoir deux, et une séance peut revenir plusieurs fois.</p><section class="sheet">';
  d.jours.forEach(function (j, i) {
    h += '<div class="ed-day"><b>' + JOURS[i] + '</b><div class="ed-chips">' + (j.length ? j.map(function (u, k) { var s = sessByU(d, u); return s ? '<span class="chip">' + esc(s.nom || "Séance") + '<button type="button" class="icon-btn" data-act="ed" data-op="dayrm" data-d="' + i + '" data-k="' + k + '" aria-label="Retirer ' + esc(s.nom || "la séance") + " du " + JOURS_L[i] + '">' + ICON_X + "</button></span>" : ""; }).join("") : '<span class="small muted">Repos</span>') + "</div>" +
      '<select data-act="edsel" data-op="dayadd" data-d="' + i + '" aria-label="Ajouter une séance le ' + JOURS_L[i] + '"><option value="">+</option>' + d.seances.map(function (s) { return '<option value="' + esc(s.u) + '">' + esc(s.nom || "Séance") + "</option>"; }).join("") + "</select></div>";
  });
  h += "</section>";
  var r = recos(d);
  h += '<section class="sheet"><div class="titled"><h2>Recommandations</h2><p class="small muted">De simples conseils : tu peux installer le programme tel quel.</p></div>';
  if (!r.length) h += '<div class="note ok"><b>Rien à signaler.</b> Les séances sont bien réparties dans la semaine.</div>';
  r.forEach(function (x) { h += '<div class="note ' + x.c + '"><b>' + esc(x.t) + "</b> " + esc(x.d) + "</div>"; });
  h += "</section>";
  h += '<div class="row spread">' + edBtn("prev", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function weekVol(d) {
  var v = {}; MUSCLES.forEach(function (m) { v[m[0]] = 0; });
  d.jours.forEach(function (j) { j.forEach(function (u) { var s = sessByU(d, u); if (s && s.kind === "muscu") { var sv = sessVol(s); keysOf(sv).forEach(function (k) { v[k] += sv[k]; }); } }); });
  return v;
}
var VOL_ORDER = ["pecs", "dorsal", "epaules", "biceps", "triceps", "quadri", "ischios", "trapezes", "mollets", "abdos"];
function edStep4(d) {
  var h = stepHead(4, "Progression et vérification");
  h += '<section class="sheet"><h2>Progression</h2><div class="types">' +
    '<button type="button" class="type" data-act="ed" data-op="prog" data-v="simple" aria-pressed="' + (d.prog !== "guidee") + '"><b>Simple</b><span>Les mêmes séries chaque semaine. Les charges conseillées montent d\'après ta dernière séance.</span></button>' +
    '<button type="button" class="type" data-act="ed" data-op="prog" data-v="guidee" aria-pressed="' + (d.prog === "guidee") + '"><b>Guidée</b><span>Une série de plus toutes les 2 semaines sur les exercices principaux, tant que la séance reste sous 1 h 15, un RIR qui baisse de 3 à 1' + (d.decharge ? ", puis la semaine de décharge" : "") + ".</span></button></div></section>";
  var v = weekVol(d), mx = 20;
  VOL_ORDER.forEach(function (k) { mx = Math.max(mx, v[k]); });
  h += '<section class="sheet"><div class="titled"><h2>Volume prévu par semaine</h2><p class="small muted">Séries fractionnées par muscle, semaine 1. Le trait marque le repère de 10 séries.</p></div><div class="vol">';
  VOL_ORDER.forEach(function (k) {
    var n = v[k];
    h += '<div class="vrow" role="img" aria-label="' + esc(muscleName(k)) + " : " + esc(fmt(n)) + ' séries"><span class="m">' + esc(muscleName(k)) + '</span><span class="track">' + (n ? '<span class="done" data-w="' + (n / mx * 100).toFixed(1) + '"></span>' : "") + '<span class="ref" data-l="' + (10 / mx * 100).toFixed(1) + '"></span></span><span class="v"><b>' + fmt(n) + "</b></span></div>";
  });
  h += "</div>";
  var low = ["pecs", "dorsal", "epaules", "biceps", "triceps", "quadri", "ischios"].filter(function (k) { return v[k] < 8; });
  if (low.length && d.mat !== "street") h += '<p class="small muted">Moins de 8 séries par semaine pour ' + esc(low.map(function (k) { return muscleName(k).toLowerCase(); }).join(", ")) + " : ajoute des séries si tu veux les développer.</p>";
  h += '<p class="small muted">Trapèzes, mollets et abdominaux restent volontairement plus bas dans les modèles ; tu peux ajouter des séries si tu veux les développer.</p>';
  var over = [], long = [];
  d.seances.forEach(function (s) { if (s.kind !== "muscu") return; var sv = sessVol(s); MUSCLES.forEach(function (m) { if (sv[m[0]] > 11) over.push((s.nom || "Séance") + " : " + m[1].toLowerCase() + " " + fmt(sv[m[0]])); }); if (sessDur(s) > 75) long.push((s.nom || "Séance") + " (" + sessDur(s) + " min)"); });
  h += over.length ? '<div class="note warn"><b>Plus de 11 séries pour un même muscle dans une séance.</b> ' + esc(over.join(" ; ")) + ". Au-delà, les séries en plus rapportent peu : répartis-les sur deux séances.</div>" : '<div class="note ok"><b>Aucune séance au-delà de 11 séries pour un même muscle.</b></div>';
  if (long.length) h += '<div class="note warn"><b>Au-delà de 1 h 15 :</b> ' + esc(long.join(", ")) + ".</div>";
  h += "</section>";
  var N = Math.max(1, Math.min(16, Math.round(toNum(d.semaines) || 6))), cnt = { muscu: 0, cardio: 0, sport: 0 }, names = {};
  d.jours.forEach(function (j) { j.forEach(function (u) { var s = sessByU(d, u); if (s) { cnt[s.kind]++; if (s.kind === "sport") names[s.nom || "autre sport"] = 1; } }); });
  var parts = []; if (cnt.muscu) parts.push(cnt.muscu + " séance" + (cnt.muscu > 1 ? "s" : "") + " de musculation"); if (cnt.cardio) parts.push(cnt.cardio + " séance" + (cnt.cardio > 1 ? "s" : "") + " de cardio"); if (cnt.sport) parts.push(cnt.sport + " " + keysOf(names).join(", ").toLowerCase());
  h += '<section class="sheet"><h2>Récapitulatif</h2><p class="small">' + esc((d.nom || "Mon programme") + " · " + objLabel(d.obj).toLowerCase() + " · " + N + " semaine" + (N > 1 ? "s" : "") + " du " + fmtLong(d.debut) + " au " + fmtLong(addDays(d.debut, N * 7 - 1)) + (d.decharge && N > 1 ? ", dernière semaine de décharge" : "") + (parts.length ? " · " + parts.join(", ") + " par semaine." : ".")) + "</p>";
  h += '<p class="small muted">Tu pourras le modifier ensuite dans Réglages : les changements ne touchent que les séances à venir. Tes séances déjà notées ne changent pas.</p></section>';
  h += '<div class="row spread">' + edBtn("prev", "Retour", "quiet") + edBtn("install", d.pid ? "Mettre à jour le programme" : "Installer le programme", "primary") + "</div>";
  return h;
}

/* ---------- Actions de l'éditeur ---------- */
function edOpen(d, step) { S.ed = { d: d, step: step || 1, sess: null }; S.view = "editeur"; render(); window.scrollTo(0, 0); }
function edStart() { var d = newDraft(); var lr = lastRef(); d.run = runDefaults(); if (lr) { d.run.refDist = lr.dist; d.run.refTime = lr.t; } saveDraft(d); edOpen(d, 1); }
function edChange() { saveDraft(S.ed.d); render(); }
function edTop() { render(); window.scrollTo(0, 0); }
function replaceModel(d, run) {
  var has = d.seances.some(function (s) { return s.kind === "muscu"; });
  if (!has) { run(); return; }
  dialog("Remplacer tes séances de musculation ?", '<p class="small">Les séances de musculation actuelles seront remplacées par celles du modèle. Tes séances de cardio et d\'autres sports restent.</p>', [
    { label: "Remplacer", cls: "primary", run: run }, { label: "Annuler" }]);
}
function edAct(b) {
  var ed = S.ed, d = ed && ed.d, op = b.dataset.op, v = b.dataset.v, s;
  if (!d) return;
  if (edRunAct(op, b, d, ed)) return;
  switch (op) {
    case "quit": S.ed = null; S.view = S.menuBack || "jour"; render(); window.scrollTo(0, 0); openMenu(S.rub || "creer"); break;
    case "next":
      if (ed.step === 2 && !d.seances.length) { toast("Ajoute au moins une séance."); break; }
      if (ed.step === 1 && d.type === "course" && !runObjOf(d.run)) { toast("Choisis un objectif ou indique un temps valable."); break; }
      ed.step = Math.min(4, ed.step + 1); ed.reset = false; saveDraft(d); edTop(); break;
    case "prev": ed.step = Math.max(1, ed.step - 1); saveDraft(d); edTop(); break;
    case "decharge": d.decharge = v === "1"; edChange(); break;
    case "mat":
      if (d.mat === v) break;
      var go = function () {
        d.mat = v; ed.reset = false;
        if (!objOk(v, d.obj)) { setObj(d, "muscle", {}); ed.reset = true; }
        if (d.org && !orgOk(v, d.org)) d.org = "hb";
        if (d.org) loadModel(d);
        edChange();
      };
      if (d.org) replaceModel(d, go); else go();
      break;
    case "org":
      if (!orgOk(d.mat, v)) break;
      replaceModel(d, function () { d.org = v; loadModel(d); edChange(); });
      break;
    case "blank":
      replaceModel(d, function () {
        var old = d.seances.filter(function (x) { return x.kind === "muscu"; }).map(function (x) { return x.u; });
        d.seances = d.seances.filter(function (x) { return x.kind !== "muscu"; }); d.jours = d.jours.map(function (j) { return j.filter(function (u) { return old.indexOf(u) < 0; }); });
        d.org = null; ed.step = 2; saveDraft(d); edTop();
      });
      break;
    case "obj":
      if (!objOk(d.mat, v) || d.obj === v) break;
      ed.reset = false;
      objPopup(persoList(d), v, false, function (align) { setObj(d, v, align); edChange(); });
      break;
    case "pourquoi": whyModels(); break;
    case "open": ed.sess = b.dataset.u; edTop(); break;
    case "close": ed.sess = null; saveDraft(d); edTop(); break;
    case "addmuscu": s = newSess(d, "muscu", "Séance " + letterOf(d.seances.filter(function (x) { return x.kind === "muscu"; }).length)); d.seances.push(s); ed.sess = s.u; saveDraft(d); edTop(); break;
    case "addcardio": s = newSess(d, "cardio", "Fractionné"); s.sport = "course"; s.ctype = "fractionne"; s.fr = { effort: 30, recup: 30, reps: 10, series: 2, entre: 3, echauf: 15, calme: 10 }; d.seances.push(s); ed.sess = s.u; saveDraft(d); edTop(); break;
    case "addsport": s = newSess(d, "sport", ""); s.duree = 90; d.seances.push(s); ed.sess = s.u; saveDraft(d); edTop(); break;
    case "sessrm":
      s = sessByU(d, ed.sess); if (!s) break;
      dialog("Supprimer « " + (s.nom || "cette séance") + " » ?", '<p class="small">Elle disparaît aussi des jours où tu l\'avais placée.</p>', [
        { label: "Supprimer", cls: "danger", run: function () { d.seances = d.seances.filter(function (x) { return x !== s; }); d.jours = d.jours.map(function (j) { return j.filter(function (u) { return u !== s.u; }); }); ed.sess = null; saveDraft(d); edTop(); } },
        { label: "Annuler", cls: "primary" }]);
      break;
    case "csport": s = sessByU(d, ed.sess); if (s) { s.sport = v; edChange(); } break;
    case "ctype": s = sessByU(d, ed.sess); if (s) { s.ctype = v; if (v === "fractionne" && !s.fr) s.fr = { effort: 30, recup: 30, reps: 10, series: 2, entre: 3, echauf: 15, calme: 10 }; if (v !== "fractionne" && !s.duree) s.duree = v === "recup" ? 30 : 45; edChange(); } break;
    case "exrm": s = sessByU(d, ed.sess); if (s) { s.ex.splice(Number(b.dataset.j), 1); realign(d, s); edChange(); } break;
    case "exup": case "exdown":
      s = sessByU(d, ed.sess); if (!s) break;
      var j = Number(b.dataset.j), k = op === "exup" ? j - 1 : j + 1; if (k < 0 || k >= s.ex.length) break;
      var t = s.ex[j]; s.ex[j] = s.ex[k]; s.ex[k] = t; realign(d, s); edChange(); break;
    case "expick": exPicker(d, sessByU(d, ed.sess)); break;
    case "dayrm": d.jours[Number(b.dataset.d)].splice(Number(b.dataset.k), 1); edChange(); break;
    case "prog": d.prog = v; edChange(); break;
    case "install": edInstall(d); break;
  }
}
function exPicker(d, s) {
  if (!s) return;
  var present = {}; s.ex.forEach(function (x) { present[x.k] = true; });
  var h = '<h2 id="dlg-t">Ajouter un exercice</h2><p class="small muted">Touche un exercice pour l\'ajouter à la fin de la séance.</p>';
  CATALOGUE.forEach(function (g) {
    if (g.hidden) return;
    h += '<div class="menu-group"><h3>' + esc(g.g) + "</h3>";
    g.ex.forEach(function (c) { h += '<button type="button" class="pick" data-sh="pick" data-k="' + c.k + '"><span>' + esc(c.n) + '</span><span class="meta">' + (present[c.k] ? "déjà dans la séance" : "") + "</span></button>"; });
    h += "</div>";
  });
  h += '<div><button type="button" class="btn wide" data-sh="cancel">Fermer</button></div>';
  openSheet(h, function (b, close) {
    close();
    if (b.dataset.sh !== "pick") return;
    var x = newEx(d, s, b.dataset.k); x.aj = true; s.ex.push(x); realign(d, s); saveDraft(d); render();
    var el = document.getElementById("edx-" + x.id); if (el) el.scrollIntoView({ block: "center" });
  }, true);
}
/* Fenêtre « exercices personnalisés » : coché = aligné sur le nouvel objectif, décoché = personnalisation conservée */
function objPopup(list, obj, installed, apply) {
  if (!list.length) { apply({}); return; }
  var chk = {};
  function line(it) {
    var on = !!chk[it.x.id], nv = settingsFor(it.x, it.role, obj);
    return '<button type="button" role="checkbox" aria-checked="' + on + '" class="chk-item" data-sh="tog" data-id="' + esc(it.x.id) + '"><span class="box" aria-hidden="true"></span><span class="grow"><b>' + esc(exName(it.x)) + '</b><span class="small muted">' + esc(it.s.nom || "Séance") + " · " + (it.x.perso ? "modifié" : "ajouté") + " : " + esc(it.x.s + " × " + it.x.r) + '</span><span class="small st">' + (on ? "Alignement sur le nouvel objectif" : "Conservation de la personnalisation") + "</span>" +
      (on ? '<span class="tiny muted">' + esc(exVals(nv)) + "</span>" : "") + "</span></button>";
  }
  function body() { return list.map(line).join(""); }
  var h = '<h2 id="dlg-t">Tes exercices personnalisés</h2><p class="small muted">Tu as ajouté ou modifié ces exercices dans ' + (installed ? "les séances à venir" : "tes séances") + ". Coche ceux à aligner sur le nouvel objectif.</p>" +
    '<div class="row"><button type="button" class="btn small" data-sh="all">Tout aligner</button><button type="button" class="btn small" data-sh="none">Tout conserver</button></div>' +
    '<div class="chk-list" id="chk-list">' + body() + "</div>" + (installed ? '<p class="tiny muted">Les séances déjà enregistrées ne changent pas, quel que soit ton choix.</p>' : "") +
    '<div class="row spread"><button type="button" class="btn quiet" data-sh="back">Retour</button><button type="button" class="btn primary" data-sh="ok">Changer l\'objectif</button></div>';
  openSheet(h, function (b, close, back) {
    var a = b.dataset.sh;
    if (a === "back") { close(); return; }
    if (a === "ok") { close(); apply(chk); return; }
    if (a === "tog") chk[b.dataset.id] = !chk[b.dataset.id];
    if (a === "all") list.forEach(function (it) { chk[it.x.id] = true; });
    if (a === "none") chk = {};
    var el = back.querySelector("#chk-list"); if (el) el.innerHTML = body();
    if (a === "tog") { var nb = back.querySelector('[data-id="' + b.dataset.id + '"]'); if (nb) nb.focus(); }
  }, true);
}
function whyModels() {
  var h = '<h2 id="dlg-t">Pourquoi ces modèles ?</h2><ul class="small steps">' +
    "<li>Environ 10 séries par muscle et par semaine : au-delà, chaque série en plus rapporte de moins en moins.</li>" +
    "<li>Chaque muscle travaillé au moins deux fois par semaine en full body et en haut / bas ; une fois, avec plus de séries, en push / pull / legs.</li>" +
    "<li>Séries proches de l'échec (RIR 0 à 3) : une large plage de charges fait progresser si l'on finit près de l'échec.</li>" +
    "<li>Force : charges lourdes (3 à 6 répétitions) sur les exercices principaux, repos de 3 min.</li>" +
    "<li>Endurance musculaire : séries de 15 à 30 répétitions, repos courts.</li>" +
    "<li>Séances de 1 h 15 au plus, échauffement de 10 min compris ; 11 séries au plus pour un muscle dans une séance.</li></ul>" +
    '<p class="small muted">Sources : Schoenfeld et al., J. Sports Sci. 2017 ; Schoenfeld et al., Sports 2021 ; Robinson et al., Sports Med. 2024 ; Pelland et al., Sports Med. 2026 ; ACSM, prise de position sur l\'entraînement en résistance, 2026.</p>' +
    '<div><button type="button" class="btn wide" data-sh="cancel">Fermer</button></div>';
  openSheet(h, function (b, close) { close(); }, true);
}
function edInstall(d) {
  var editing = d.pid && D.programmes[d.pid];
  var body = '<p class="small">' + esc(d.nom || "Mon programme") + ", du " + esc(fmtLong(d.debut)) + " pendant " + (Math.round(toNum(d.semaines)) || 6) + " semaines.</p>" +
    '<p class="small muted">' + (editing ? "Les séances à venir sont mises à jour. Tes séances déjà notées ne changent pas." : "Il devient ton programme actif. Tes séances déjà notées sont conservées.") + "</p>";
  function go(asComp) {
    var pid = d.pid || ("c-" + rndId(6, "abcdefghijkmnpqrstuvwxyz23456789"));
    d.pid = pid; var p = compile(d, pid);
    if (D.brouillons) delete D.brouillons[d.id];
    S.ed = null;
    if (asComp || D.complement === pid) { freezeAll(false); D.programmes[pid] = p; D.complement = pid; persistNow(); setActive(); S.date = initialDate(); S.view = "jour"; render(); toast("Complément installé : " + p.titre); }
    else installProgram(p, null);
  }
  if (!editing && d.type === "course" && P) {
    dialog("Installer ce programme ?", body.replace("Il devient ton programme actif. ", "") + '<p class="small">Tu as déjà un programme : « ' + esc(P.titre || "programme") + ' ». Le programme de course peut s\'y ajouter en complément, sans le modifier, ou le remplacer.</p>', [
      { label: "Ajouter en complément", cls: "primary", run: function () { go(true); } }, { label: "Remplacer mon programme", run: function () { go(false); } }, { label: "Annuler" }]);
    return;
  }
  dialog(editing ? "Mettre à jour le programme ?" : "Installer ce programme ?", body, [{ label: editing ? "Mettre à jour" : "Installer", cls: "primary", run: function () { go(false); } }, { label: "Annuler" }]);
}
/* Copie d'un programme installé (créé ici ou reçu d'un coach) : semaine 1 comme point de départ */
function draftFrom(p) {
  if (p.src) { var c = clone(p.src); c.id = "d" + rndId(6, "abcdefghijkmnpqrstuvwxyz23456789"); c.pid = null; c.nom = "Copie de " + (p.titre || "mon programme"); c.debut = nextMonday(); return c; }
  var d = newDraft(), map = {};
  d.nom = "Copie de " + (p.titre || "programme"); d.semaines = p.semaines; d.decharge = !!(p.deload && p.deload.indexOf(p.semaines) >= 0); d.org = null; d.mat = "salle";
  keysOf(p.sessions).forEach(function (k) {
    var def = p.sessions[k], s;
    if (def.kind === "muscu") {
      s = newSess(d, "muscu", def.name);
      def.ex.forEach(function (e) { var x = { id: e.id, code: s.u + (++s.nx), k: exCat(e) }; if (!x.k) { x.n = e.name; x.mu = e.mu || {}; x.gr = e.gr || ""; } x.s = e.sets[0]; x.r = e.reps[0]; x.rir = e.rir[0]; x.rest = e.rest; x.b = { s: e.sets[0], r: e.reps[0] }; x.perso = true; if (e.note) x.note = e.note; s.ex.push(x); });
    } else if (def.kind === "course") {
      var pl = def.plan && (def.plan[0] || {}); s = newSess(d, "cardio", def.name); s.sport = def.sport || "course";
      if (pl && pl.fr) { s.ctype = "fractionne"; s.fr = clone(pl.fr); } else { s.ctype = def.ctype || "ef"; s.duree = 45; }
    } else if (def.kind === "sport") { s = newSess(d, "sport", def.name); s.duree = def.duree || 90; }
    if (s) { d.seances.push(s); map[k] = s.u; }
  });
  var v = p.versions[keysOf(p.versions)[0]];
  d.jours = v.jours.map(function (j) { return j.map(function (t) { return map[t.replace(/\?$/, "")]; }).filter(Boolean); });
  return d;
}

/* ---------- Réglages : mon programme créé ---------- */
function objWeeks() {
  var t = todayStr(), w0 = t < P.debut ? 1 : weekOf(t), out = [];
  if (w0 <= P.semaines) out.push({ v: w0, l: t < P.debut ? "Dès le début du programme, " + fmtLong(P.debut) : "Dès la prochaine séance" + (function () { for (var i = 0; i < 14; i++) { var dd = addDays(t, i), pl = plannedFor(dd) || []; if (pl.some(function (x) { var df = P.sessions[x]; return df && df.kind === "muscu" && !hasData(seance(dd, x)); })) return ", " + fmtLong(dd); } return ""; })() });
  if (w0 + 1 <= P.semaines && t >= P.debut) out.push({ v: w0 + 1, l: "Dès la semaine " + (w0 + 1) + ", " + fmtLong(mondayOf(w0 + 1)) });
  return out;
}
function objSheet() {
  if (!P || !P.src || todayStr() > lastDay()) return "";
  var d = P.src, ws = objWeeks(), pend = S.objPend, h = '<div class="scale"><div class="scale-q"><span>Objectif</span></div><div class="seg stack">';
  OBJS.forEach(function (o) {
    if (!objOk(d.mat, o.v)) return;
    var shown = pend || d.obj;
    h += '<button type="button" data-act="objpick" data-v="' + o.v + '" aria-pressed="' + (shown === o.v) + '">' + esc(o.l + (o.v === d.obj ? " · actuel" : "")) + "</button>";
  });
  h += "</div></div>";
  if (pend && ws.length) {
    if (!S.objFrom || !ws.some(function (w) { return w.v === S.objFrom; })) S.objFrom = ws[ws.length - 1].v;
    h += '<div class="note info stack"><p><b>Passer en ' + esc(objLabel(pend).toLowerCase()) + " ?</b> Les répétitions, le RIR, les repos et les séries d'isolation des séances à venir seront adaptés. Les exercices restent les mêmes.</p>" +
      '<div class="scale"><div class="scale-q"><span>À partir de</span></div><div class="seg stack">' + ws.map(function (w) { return '<button type="button" data-act="objfrom" data-v="' + w.v + '" aria-pressed="' + (S.objFrom === w.v) + '">' + esc(w.l) + "</button>"; }).join("") + "</div></div>" +
      '<p class="small">Les séances déjà enregistrées ne changent jamais.</p><div class="row"><button type="button" class="btn primary small" data-act="objgo">Continuer</button><button type="button" class="btn quiet small" data-act="objcancel">Annuler</button></div></div>';
  }
  if (S.objDone) h += '<div class="note ok">' + esc(S.objDone) + "</div>";
  return h;
}
function objApply() {
  var obj = S.objPend, from = S.objFrom, op = P, d = clone(P.src);
  var list = persoList(d);
  objPopup(list, obj, true, function (align) {
    setObj(d, obj, align);
    var np = compile(d, op.id); np.src.pid = op.id;
    keepWeeks(np, op, from);
    if (op.objHist) np.objHist = op.objHist.slice(); (np.objHist = np.objHist || []).push({ de: op.src.obj, a: obj, semaine: from });
    updateProgram(np);
    var kept = list.filter(function (it) { return !align[it.x.id]; }).length;
    S.objPend = null; S.objFrom = null;
    S.objDone = "Objectif changé : " + objLabel(obj).toLowerCase() + ". Il s'applique dès " + (from <= 1 ? "le début du programme" : "la semaine " + from) + (kept ? ", sauf pour " + kept + " exercice" + (kept > 1 ? "s" : "") + " dont la personnalisation est conservée." : ".");
    render();
  });
}

/* ================= Programmes de course et mixte ================= */
/* Règles (document « Programmes de course à relire ») : surtout du facile (Campos 2022), sortie longue
   jamais plus de 10 % au-dessus de la plus longue des 30 derniers jours, sauf si l'utilisateur force
   (Frandsen 2025), affûtage de 2 semaines à volume réduit (Bosquet 2007), fractionné court puis long
   (Milanović 2015, Wen 2019), temps probable par la formule de Riegel, seuil d'écart selon le niveau
   (Rosenblat 2021). */
var DISTKM = { "5": 5, "10": 10, "21": 21.0975 };
var DISTL = { "5": "5 km", "10": "10 km", "21": "semi-marathon" };
var RUNOBJ = {
  "5": [{ k: "finir", l: "Finir sans marcher", t: null, n: 3, lp: 35 }, { k: "30", l: "Moins de 30 min", t: 1800, n: 3, lp: 45 }, { k: "25", l: "Moins de 25 min", t: 1500, n: 4, lp: 55 }, { k: "22", l: "Moins de 22 min", t: 1320, n: 4, lp: 60 }],
  "10": [{ k: "60", l: "1 h", t: 3600, n: 3, lp: 70 }, { k: "55", l: "55 min", t: 3300, n: 3, lp: 70 }, { k: "50", l: "50 min", t: 3000, n: 4, lp: 75 }, { k: "45", l: "45 min", t: 2700, n: 5, lp: 85 }],
  "21": [{ k: "finir", l: "Finir", t: null, n: 3, lp: 105 }, { k: "120", l: "2 h", t: 7200, n: 3, lp: 110 }, { k: "110", l: "1 h 50", t: 6600, n: 4, lp: 110 }, { k: "105", l: "1 h 45", t: 6300, n: 4, lp: 105 }, { k: "100", l: "1 h 40", t: 6000, n: 5, lp: 105 }, { k: "90", l: "1 h 30", t: 5400, n: 5, lp: 105 }]
};
var RUN_STD = { "5": 8, "10": 10, "21": 12 }, RUN_MIN0 = { "5": 25, "10": 45, "21": 60 }, RUN_MAXW = { "5": 12, "10": 16, "21": 20 };
function riegel(t, d1, d2) { return t * Math.pow(d2 / d1, 1.06); }
function parseRaceTime(v) {
  var t = String(v === undefined || v === null ? "" : v).trim().toLowerCase().replace(/[’']/g, ":").replace(/,/g, ".");
  if (!t) return null;
  var m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/); if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = t.match(/^(\d+):(\d{1,2})$/); if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/^(\d+)\s*h\s*(\d{0,2})(?:\s*(?:min|mn|m)?\s*(\d{0,2})\s*s?)?$/); if (m) return Number(m[1]) * 3600 + (m[2] ? Number(m[2]) * 60 : 0) + (m[3] ? Number(m[3]) : 0);
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:min|mn|m)\s*(\d{0,2})\s*s?$/); if (m) return Math.round(Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0);
  var n = toNum(t); return n !== null && n > 0 ? Math.round(n * 60) : null;
}
function fmtRace(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return "–";
  sec = Math.round(sec); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + " h " + pad(m) + (s ? " min " + pad(s) : "");
  return m + " min" + (s ? " " + pad(s) : "");
}
function fmtPace(spk) { return fmtTm(spk) + "/km"; }
function kmh(spk) { return fmt(3600 / spk, 1) + " km/h"; }
function runObjOf(r) {
  var list = RUNOBJ[r.dist] || [];
  if (r.obj === "libre") {
    var t = parseRaceTime(r.libre); if (!t) return null;
    var best = list.filter(function (o) { return o.t; }).sort(function (a, b) { return Math.abs(a.t - t) - Math.abs(b.t - t); })[0] || list[0];
    return { k: "libre", l: fmtRace(t), t: t, n: best.n, lp: best.lp };
  }
  return list.filter(function (o) { return o.k === r.obj; })[0] || null;
}
function runFinish5(r) { return r.dist === "5" && r.obj === "finir"; }
/* Semaines : depuis la date de course, ou un nombre de semaines, ou la durée standard */
function runWeeks(r) {
  var start = nextMonday(), race, n;
  if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= start) { race = r.date; n = Math.floor(diffDays(race, start) / 7) + 1; }
  else { n = Math.max(1, Math.min(30, Math.round(toNum(r.weeks) || RUN_STD[r.dist] || 10))); race = addDays(start, n * 7 - 1); }
  return { n: n, race: race, debut: addDays(mondayOfDate(race), -7 * (n - 1)) };
}
function nextL(l, f) { var x = l * (f || 1.1), r = Math.floor(x / 5) * 5; return r - l >= (x - l) / 2 ? r : Math.max(l + 1, Math.floor(x)); }
function r5(x) { return Math.max(15, Math.round(x / 5) * 5); }
function runPhases(n, allegee) {
  var tp = n >= 4 ? 2 : 1, rem = n - tp, spec = Math.min(4, Math.floor(rem / 2)), dev = Math.min(4, rem - spec), base = rem - spec - dev, out = [];
  for (var w = 1; w <= n; w++) {
    var ph = w <= base ? "base" : w <= base + dev ? "dev" : w <= rem ? "spe" : "aff";
    if (allegee && w % 4 === 0 && w <= rem && w < rem) ph = "all";
    out.push(ph);
  }
  return out;
}
var PHASEL = { base: "Base", dev: "Développement", spe: "Spécifique", aff: "Affûtage", all: "Allégée", rec: "Récupération", cm: "Course et marche" };
/* Faisabilité : temps probable (Riegel) et écart acceptable selon le niveau (Rosenblat 2021) */
function runCheck(r) {
  var o = runObjOf(r), res = { o: o };
  if (!o || !o.t || runFinish5(r)) return res;
  var rt = parseRaceTime(r.refTime), rd = toNum(r.refDist);
  if (r.refMode !== "aucune" && rt && rd) {
    res.pred = riegel(rt, rd, DISTKM[r.dist]); res.gap = (res.pred - o.t) / res.pred;
    res.seuil = Number(r.freq) >= 4 ? 0.03 : 0.06;
    if (res.gap > res.seuil) res.propose = Math.ceil(res.pred * (1 - res.seuil) / 30) * 30;
  }
  return res;
}
function runNeed(r) {
  var o = runObjOf(r); if (!o) return null;
  if (runFinish5(r)) return { need: r.can15 === "oui" ? 5 : 8, nice: r.can15 === "oui" ? 7 : 10 };
  var l = Math.max(15, toNum(r.longest) || RUN_MIN0[r.dist]), steps = 0;
  while (l < o.lp && steps < 40) { l = nextL(l); steps++; }
  return { need: steps + 2, steps: steps };
}
/* Séances types */
function fr(effort, recup, reps, series, o) { var f = { mode: "temps", effort: effort, recup: recup, reps: reps, series: series || 1, echauf: 15, calme: 10 }; if (series > 1) f.entre = 3; return Object.assign(f, o || {}); }
function eFrac(lab, f, o) { return Object.assign({ lab: lab, ctype: "fractionne", fr: f }, o || {}); }
function eEf(lab, min, o) { return Object.assign({ lab: lab, ctype: "ef", duree: min }, o || {}); }
function vmaSeq(dist) {
  var S = function (n) { return eFrac("Fractionné", fr(30, 30, n, 2, { pct: 100 })); }, L = function (reps, min, rec) { return eFrac("Fractionné", fr(min * 60, rec, reps, 1, { pct: 95 })); };
  if (dist === "21") return [S(8), L(5, 3, 120), S(10), L(5, 4, 120), S(10), L(4, 5, 150), L(6, 3, 120), L(5, 4, 120)];
  if (dist === "5") return [S(8), L(6, 2, 90), S(10), L(5, 3, 120), S(10), L(6, 3, 120), L(8, 2, 90), L(6, 3, 120)];
  return [S(8), L(6, 2, 90), S(10), L(5, 3, 120), S(10), L(6, 3, 120), L(5, 3, 120), L(6, 3, 120)];
}
function allureSeq(dist, ph) {
  /* [minutes ou km, nombre, récup s] */
  if (dist === "5") return ph === "spe" ? [[1, 5, 120, "km"], [1, 6, 120, "km"], [1.5, 4, 150, "km"], [2, 3, 180, "km"]] : [[2, 6, 90], [3, 5, 120], [4, 4, 120], [3, 6, 120]];
  if (dist === "21") return ph === "spe" ? [[4, 2, 180, "km"], [3, 3, 150, "km"], [5, 2, 180, "km"], [6, 2, 180, "km"]] : [[10, 3, 120], [15, 2, 180], [12, 3, 150], [20, 2, 180]];
  return ph === "spe" ? [[15, 2, 180], [2, 3, 120, "km"], [2, 4, 120, "km"], [2.5, 3, 120, "km"]] : [[6, 3, 120], [8, 3, 120], [12, 2, 180], [10, 3, 120]];
}
function allureEntry(spec, pace, dist) {
  var q = spec[0], n = spec[1], rec = spec[2], km = spec[3] === "km";
  var lab = "Allure " + (dist === "21" ? "semi" : dist === "5" ? "5 km" : "10 km");
  if (!pace) return eFrac(lab, fr(km ? Math.round(q * 330) : q * 60, rec, n, 1, km ? { ress: "6 à 7 sur 10", km: q } : { ress: "6 à 7 sur 10" }), {});
  return eFrac(lab, fr(km ? Math.round(q * pace) : q * 60, rec, n, 1, km ? { pace: Math.round(pace), km: q } : { pace: Math.round(pace) }), {});
}
/* Programme de course : un créneau par rôle, une consigne par semaine */
function genRun(d) {
  var r = d.run, o = runObjOf(r); if (!o) return null;
  var W = runWeeks(r), n = W.n, pace = o.t ? o.t / DISTKM[r.dist] : null, slots = {};
  function slot(role, nom, day) { slots[role] = { role: role, nom: nom, day: day, plan: [] }; return slots[role]; }
  var race = slot("race", "La course", dow(W.race));
  if (runFinish5(r)) {
    var A = slot("a", "Course A", 1), B = slot("b", "Course B", 3), C = slot("c", "Course C", 6);
    var CM = function (run, walk, k) { return eFrac("Course et marche", fr(run, walk, k, 1, { echauf: 5, calme: 5, marche: true })); };
    var rows = [[CM(60, 120, 8), CM(60, 120, 8), CM(90, 120, 6)], [CM(120, 120, 6), CM(120, 90, 6), CM(180, 120, 5)], [CM(180, 90, 5), CM(240, 90, 4), CM(300, 120, 3)],
      [CM(360, 90, 3), CM(480, 120, 2), CM(600, 120, 2)], [CM(600, 90, 2), eEf("Course continue", 15), eEf("Course continue", 20)],
      [eEf("Course continue", 20), eFrac("Accélérations", fr(30, 60, 6, 1, { echauf: 15, calme: 5, ress: "un peu plus vite, 6 sur 10" })), eEf("Course continue", 22)],
      [eEf("Course continue", 24), eFrac("Accélérations", fr(45, 60, 6, 1, { echauf: 15, calme: 5, ress: "un peu plus vite, 6 sur 10" })), eEf("Course continue", 26)],
      [eEf("Course facile", 20), eFrac("Allure 5 km", fr(60, 90, 4, 1, { echauf: 15, calme: 5, ress: "allure de course, 7 sur 10" })), null]];
    if (r.can15 === "oui") rows = rows.slice(3);
    var ext = [[eEf("Course continue", 28), eFrac("Accélérations", fr(45, 60, 6, 1, { echauf: 15, calme: 5, ress: "un peu plus vite, 6 sur 10" })), eEf("Course continue", 28)],
      [eEf("Course continue", 30), eFrac("Accélérations", fr(60, 60, 5, 1, { echauf: 15, calme: 5, ress: "un peu plus vite, 6 sur 10" })), eEf("Course continue", 30)]];
    var last = rows.pop(), body = rows.slice(), want = n - 1;
    if (want >= body.length + 2) body = body.concat(ext);
    while (body.length < want) body.splice(Math.min(body.length - 1, 1), 0, body[0]);
    if (body.length > want) { var keep = []; for (var i = 0; i < want; i++) keep.push(body[Math.round(i * (body.length - 1) / Math.max(1, want - 1))]); body = want > 0 ? keep : []; }
    body.push(last);
    body.forEach(function (row, i) { A.plan.push(row[0]); B.plan.push(row[1]); C.plan.push(row[2]); race.plan.push(null); });
    race.plan[n - 1] = { lab: "Le 5 km", chrono: { dist: 5, race: true }, role: "race" };
    A.plan.push(null); B.plan.push(eEf("Récupération", 20, { ctype: "recup" })); C.plan.push(eEf("Course facile", 25)); race.plan.push(null);
    return { W: W, o: o, slots: slots, phases: body.map(function () { return "cm"; }).concat(["rec"]) };
  }
  var ns = o.n, vma = slot("vma", "Fractionné", 1), allure = slot("allure", "Allure " + (r.dist === "21" ? "semi" : r.dist === "5" ? "5 km" : "10 km"), ns >= 4 ? 5 : 3), sl = slot("sl", "Sortie longue", 6), ef = ns >= 4 ? slot("ef", "Endurance", 3) : null, ef2 = ns >= 5 ? slot("ef2", "Endurance courte", 0) : null;
  var ph = runPhases(n, r.allegee !== false), seq = vmaSeq(r.dist), vi = 0, ai = { dev: 0, spe: 0 };
  var l0 = Math.max(15, toNum(r.longest) || RUN_MIN0[r.dist]), cur = l0, need = runNeed(r), build = ph.filter(function (p) { return p === "base" || p === "dev" || p === "spe"; }).length;
  var fac = r.force && need && need.steps > build && build > 0 ? Math.pow(o.lp / l0, 1 / build) : 1.1;
  var noRef = r.refMode === "aucune" && o.t, midW = 0;
  var firstSpe = ph.indexOf("spe") + 1; midW = firstSpe > 1 ? firstSpe - 1 : 0; if (midW && ph[midW - 1] === "all") midW--;
  var hist = [];
  for (var w = 1; w <= n; w++) {
    var p = ph[w - 1], slw = null, e;
    if (p === "base" || p === "dev" || p === "spe") { cur = Math.min(o.lp, nextL(cur, fac)); slw = cur; }
    else if (p === "all") slw = r5(cur * 0.75);
    else if (w === n - 1) slw = r5(cur * 0.6);
    var mx = Math.max.apply(null, [l0].concat(hist.slice(-4)));
    sl.plan.push(slw ? eEf("Sortie longue", slw, { role: "sl", warn: slw > mx * 1.1 + 0.01 ? Math.round((slw / mx - 1) * 100) : 0 }) : null);
    if (slw) hist.push(slw);
    /* fractionné VMA */
    if (w === 1 && o.t) e = { lab: "Test de 6 minutes", test6: true };
    else if (p === "base") e = eFrac("Lignes droites", fr(20, 60, 6, 1, { echauf: 30, calme: 5, ress: "accélérations progressives, 7 sur 10" }));
    else if (p === "all") e = eFrac("Fractionné", fr(30, 30, 6, 2, { pct: 100 }));
    else if (p === "aff") e = w === n ? (pace ? eFrac("Rappel d'allure", fr(60, 60, 6, 1, { pace: Math.round(pace) })) : eFrac("Rappel", fr(60, 60, 6, 1, { ress: "allure de course" }))) : eFrac("Fractionné", fr(180, 120, 3, 1, { pct: 95 }));
    else { e = JSON.parse(JSON.stringify(seq[Math.min(vi, seq.length - 1)])); vi++; }
    vma.plan.push(e);
    /* allure de course */
    if (w === 1 && noRef) e = { lab: "5 km chronométré", chrono: { dist: 5 } };
    else if (w === midW && o.t) e = { lab: (r.dist === "21" ? "10 km" : "5 km") + " chronométré", chrono: { dist: r.dist === "21" ? 10 : 5 } };
    else if (p === "all") e = null;
    else if (p === "base") e = eFrac("Fartlek", fr(60, 90, 6, 1, { echauf: 15, calme: 10, ress: "un peu plus vite, 6 sur 10" }));
    else if (p === "dev" || p === "spe") { var sq = allureSeq(r.dist, p); e = allureEntry(sq[Math.min(ai[p], sq.length - 1)], pace, r.dist); ai[p]++; }
    else e = w === n ? null : allureEntry(r.dist === "21" ? [3, 2, 180, "km"] : r.dist === "5" ? [1, 3, 120, "km"] : [2, 2, 120, "km"], pace, r.dist);
    allure.plan.push(e);
    if (ef) ef.plan.push(eEf("Endurance", p === "all" ? 35 : p === "aff" ? (w === n ? 30 : 25) : p === "base" ? Math.min(45, 35 + 5 * (w - 1)) : p === "spe" ? 50 : 45));
    if (ef2) ef2.plan.push(p === "aff" || p === "all" ? null : eEf("Endurance courte", 30));
    race.plan.push(w === n ? { lab: "Le " + DISTL[r.dist], chrono: { dist: DISTKM[r.dist], race: true }, role: "race" } : null);
  }
  if (W.race && dow(W.race) <= 1) vma.plan[n - 1] = null;
  /* semaine de récupération (Sports Medicine – Open 2025 ; J Sports Sci Med) */
  vma.plan.push(null); race.plan.push(null); if (ef2) ef2.plan.push(null);
  if (ef) { ef.plan.push(eEf("Récupération", 30, { ctype: "recup" })); allure.plan.push(eEf("Course facile", 35)); }
  else allure.plan.push(eEf("Course facile", 30));
  sl.plan.push(eEf("Course facile", r.dist === "21" ? 45 : 40));
  return { W: W, o: o, slots: slots, phases: ph.concat(["rec"]) };
}
/* Mixte : 2 séances de course, 2 de musculation (OMS : Bull 2020 ; course et musculation séparées : Schumann 2022) */
var MIXTE_MU = {
  salle: [["Musculation A", [X("squat", 3, "10–12"), X("dc-barre", 3, "10–12"), X("tirage-vert", 3, "10–12"), X("sdtr-barre", 3, "10–12"), X("gainage", 2, "30–45 s")]],
    ["Musculation B", [X("fentes", 3, "10 par jambe"), X("dm-halt", 3, "10–12"), X("tirage-horiz", 3, "12–15"), X("hip-thrust", 3, "12–15"), X("gainage-lat", 2, "20–30 s")]]],
  halt: [["Musculation A", [X("squat-halt", 3, "10–12"), X("dc-halt", 3, "10–12"), X("row-1b", 3, "10–12"), X("sdtr-halt", 3, "10–12"), X("gainage", 2, "30–45 s")]],
    ["Musculation B", [X("fentes", 3, "10 par jambe"), X("dm-halt", 3, "10–12"), X("row-1b", 3, "12–15"), X("hip-thrust", 3, "12–15"), X("gainage-lat", 2, "20–30 s")]]],
  street: [["Musculation A", [X("squat", 3, "15–20", VIDE, true), X("pompes", 3, "8–15"), X("row-inv", 3, "8–12"), X("superman", 3, "10–15"), X("gainage", 2, "30–45 s")]],
    ["Musculation B", [X("fentes", 3, "10 par jambe", VIDE, true), X("dips", 3, "6–12"), X("tractions", 3, "3–8"), X("hip-thrust", 3, "12–15", CHAISE, true), X("gainage-lat", 2, "20–30 s")]]]
};
function genMixteRun(n) {
  var CM = function (run, walk, k) { return eFrac("Course et marche", fr(run, walk, k, 1, { echauf: 5, calme: 5, marche: true })); };
  var V = function (k) { return eFrac("Course variée", fr(30, 90, k, 1, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" })); };
  var A = [CM(120, 120, 6), CM(180, 90, 5), CM(360, 90, 3), CM(600, 120, 2), eEf("Course continue", 20), eEf("Course continue", 22), eEf("Course continue", 25), eEf("Course continue", 27), eEf("Course continue", 30)];
  var B = [CM(60, 90, 8), CM(120, 90, 6), V(6), V(8), eFrac("Course variée", fr(30, 30, 6, 2, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" })), eFrac("Course variée", fr(120, 120, 5, 1, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" })), eFrac("Course variée", fr(30, 30, 8, 2, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" })), eFrac("Course variée", fr(120, 120, 6, 1, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" })), eFrac("Course variée", fr(30, 30, 8, 2, { echauf: 10, calme: 5, ress: "vif, 7 sur 10" }))];
  function fit(arr) { if (n >= 9) { var out = arr.slice(0, 9); while (out.length < n) out.push(arr[8]); return out; } var a8 = arr.slice(0, 8), o = []; for (var i = 0; i < n; i++) o.push(a8[Math.round(i * 7 / Math.max(1, n - 1))]); return o; }
  return { a: fit(A), b: fit(B) };
}
function runSlotsTo(d, g) {
  var keep = {};
  d.seances.forEach(function (s) { if (s.role && s.plan) s.plan.forEach(function (e, i) { if (e && e.perso) keep[s.role + "|" + i] = e; }); });
  var old = d.seances.filter(function (s) { return s.role; }).map(function (s) { return s.u; });
  d.seances = d.seances.filter(function (s) { return !s.role; });
  d.jours = d.jours.map(function (j) { return j.filter(function (u) { return old.indexOf(u) < 0; }); });
  keysOf(g.slots).forEach(function (k) {
    var t = g.slots[k]; if (!t.plan.some(Boolean)) return;
    var s = newSess(d, "cardio", t.nom); s.sport = "course"; s.role = t.role; s.plan = t.plan.map(function (e, i) { return keep[t.role + "|" + i] || e; });
    d.seances.push(s); d.jours[t.day].push(s.u);
  });
}
function renfoSlot(d) {
  var had = d.seances.filter(function (s) { return s.renfo; })[0];
  if (d.run && d.run.renfo && !had) {
    var s = newSess(d, "muscu", "Renforcement"); s.renfo = true;
    [X("squat", 3, "4–6"), X("sdtr-barre", 3, "4–6"), X("mollets", 3, "10–15")].forEach(function (m) { var x = newEx(d, s, m.k); x.b = { s: m.s, r: m.r }; s.ex.push(x); });
    s.ex[2].note = "Puis 3 × 5 sauts groupés, bien amortis.";
    s.ex.forEach(function (x) { x.s = x.b.s; x.r = x.b.r; x.rir = "2"; x.rest = x.k === "mollets" ? "1 min 30" : "3 min"; x.perso = true; });
    d.seances.push(s); d.jours[2].push(s.u);
  } else if (!(d.run && d.run.renfo) && had) {
    d.seances = d.seances.filter(function (s) { return s !== had; }); d.jours = d.jours.map(function (j) { return j.filter(function (u) { return u !== had.u; }); });
  }
}
function regenRun(d) {
  if (d.type === "course") {
    var g = genRun(d); if (!g) return;
    d.semaines = g.W.n + 1; d.debut = g.W.debut; d.phases = g.phases; d.raceDate = g.W.race;
    runSlotsTo(d, g); renfoSlot(d);
  } else if (d.type === "mixte") {
    var n = Math.max(4, Math.min(12, Math.round(toNum(d.semaines) || 8))), m = genMixteRun(n);
    d.semaines = n; d.phases = null;
    var old = d.seances.filter(function (s) { return s.mixte; }).map(function (s) { return s.u; });
    d.seances = d.seances.filter(function (s) { return !s.mixte && !s.role; }); d.jours = [[], [], [], [], [], [], []];
    (MIXTE_MU[d.mat] || MIXTE_MU.halt).forEach(function (t, i) {
      var s = newSess(d, "muscu", t[0]); s.mixte = true;
      t[1].forEach(function (mm) { var x = newEx(d, s, mm.k); x.b = { s: mm.s, r: mm.r }; if (mm.note) x.note = mm.note; if (mm.zero) x.zero = true; s.ex.push(x); });
      s.ex.forEach(function (x) { x.s = x.b.s; x.r = x.b.r; x.rir = "2"; x.rest = exIso(x) ? "1 min 30" : "2 min"; });
      d.seances.push(s); d.jours[i === 0 ? 0 : 4].push(s.u);
    });
    [["a", "Course A", m.a, 2], ["b", "Course B", m.b, 6]].forEach(function (t) {
      var s = newSess(d, "cardio", t[1]); s.sport = "course"; s.role = t[0]; s.mixte = true; s.plan = t[2]; d.seances.push(s); d.jours[t[3]].push(s.u);
    });
    void old;
  }
}
/* Texte et minutes d'une consigne */
function entryMin(e) { if (!e) return 0; if (e.test6) return 40; if (e.chrono) return Math.round((e.chrono.race ? 0 : 25) + (e.chrono.dist || 5) * 6); return e.duree ? toNum(e.duree) || 0 : e.fr ? fmtMinutes(e.fr) || 0 : 0; }
function entryText(e) {
  if (!e) return "Repos";
  if (e.test6) return "Test de 6 minutes : il mesure ta VMA.";
  if (e.chrono) return e.chrono.race ? "Le jour de course : note ton temps officiel." : fmt(e.chrono.dist, 0) + " km chronométré : il donne ton temps probable sur la distance visée.";
  if (e.ctype !== "fractionne") return (e.lab || listLabel(CTYPES, e.ctype)) + ", " + fmtDur(toNum(e.duree) || 0) + (e.ctype === "recup" ? ", très facile." : " à allure facile.");
  var f = e.fr || {}, line = fmtLine(f);
  if (f.marche) line = (toNum(f.reps) || 1) + " × (" + fmtSecs(toNum(f.effort)) + " de course, " + fmtSecs(toNum(f.recup)) + " de marche)";
  else if (f.km) line = (toNum(f.reps) || 1) + " × " + fmt(f.km, 1) + " km, " + fmtSecs(toNum(f.recup)) + " de récupération";
  var x = f.pct ? " à " + f.pct + " % de la VMA" : f.pace ? " à " + fmtPace(f.pace) : f.ress ? ", " + f.ress : "";
  return (e.lab ? e.lab + " : " : "") + line + x + ".";
}
function fmtSecs(x) { x = Math.round(x || 0); return x % 60 === 0 ? x / 60 + " min" : x > 60 ? Math.floor(x / 60) + " min " + pad(x % 60) : x + " s"; }
function vmaNow(date) {
  var best = null;
  valuesOf(D.seances).forEach(function (s) { var dt = toNum(s.distanceTest); if (dt && (!date || s.date <= date) && (!best || s.date > best.date)) best = { date: s.date, v: dt / 100 }; });
  return best ? best.v : toNum((D.profil || {}).vma);
}
function chronoSpec(s) { var ci = cardioInfo(s) || {}; return (ci.spec && ci.spec.chrono) || {}; }
function runKm(s) { var c = s.chrono && parseRaceTime(s.chrono.temps); return toNum(s.distance) || toNum(s.distTot) || (c ? toNum(chronoSpec(s).dist) || null : null); }
function runHist(before, days) {
  var from = addDays(before, -(days || 30)), km = 0, min = 0;
  valuesOf(D.seances).forEach(function (s) {
    if (s.date >= before || s.date < from) return;
    var ci = cardioInfo(s); if (!ci || ci.sport !== "course" || !hasData(s)) return;
    km = Math.max(km, runKm(s) || 0); min = Math.max(min, toNum(s.duree) || 0);
  });
  return { km: km, min: min };
}

/* ---------- Éditeur : course et mixte ---------- */
function typeChooser(d) {
  if (d.pid) return "";
  var t = d.type || "muscu";
  return '<section class="sheet"><h2>Que veux-tu préparer ?</h2><div class="types">' +
    [["muscu", "Musculation", "Modèles par matériel et objectif."], ["course", "Course", "5 km, 10 km ou semi-marathon, pour une date de course."], ["mixte", "Mixte", "Course et musculation pour se remettre en forme, sans échéance particulière."]].map(function (o) {
      return '<button type="button" class="type" data-act="ed" data-op="dtype" data-v="' + o[0] + '" aria-pressed="' + (t === o[0]) + '"><b>' + o[1] + "</b><span>" + o[2] + "</span></button>";
    }).join("") + "</div></section>";
}
function runDefaults() { return { dist: "10", obj: "50", libre: "", date: "", weeks: "", freq: 3, longest: 45, refMode: "temps", refDist: "5", refTime: "", can15: "non", allegee: true, renfo: false, force: false }; }
function objHint(o) { return (o.t ? "Allure " + fmtPace(o.t / 1) + " · " : "") + o.n + " séances par semaine · sortie longue jusqu'à " + fmtDur(o.lp); }
function edRun1(d) {
  var r = d.run, h = stepHead(1, "Ta course") + typeChooser(d), list = RUNOBJ[r.dist], W = runWeeks(r), need = runNeed(r), chk = runCheck(r), fin5 = runFinish5(r);
  h += '<section class="sheet"><label class="field"><span>Nom du programme</span>' + edInp("nom", d.nom, 'maxlength="40"') + "</label>";
  h += '<div class="scale"><div class="scale-q"><span>Distance</span></div><div class="seg">' + ["5", "10", "21"].map(function (k) { return '<button type="button" data-act="ed" data-op="rdist" data-v="' + k + '" aria-pressed="' + (r.dist === k) + '">' + (k === "21" ? "Semi-marathon" : k + " km") + "</button>"; }).join("") + "</div></div>";
  h += '<div class="scale"><div class="scale-q"><span>Ton objectif</span></div><div class="types">' + list.map(function (o) {
    var pace = o.t ? o.t / DISTKM[r.dist] : null;
    return '<button type="button" class="type" data-act="ed" data-op="robj" data-v="' + o.k + '" aria-pressed="' + (r.obj === o.k) + '"><b>' + esc(o.l) + "</b>" + (pace ? "<span>Allure " + esc(fmtPace(pace)) + "</span>" : "<span>Au ressenti, sans chrono</span>") + '<span class="hint">' + o.n + " séances par semaine · sortie longue jusqu'à " + esc(fmtDur(o.lp)) + "</span></button>";
  }).join("") + "</div></div>";
  h += '<label class="field"><span>Ou un temps libre</span>' + edInp("run.libre", r.obj === "libre" ? r.libre : "", 'placeholder="ex. 47 min 30 ou 1:52:00"') + "</label>";
  h += '<p class="tiny muted">L\'objectif fixe l\'allure des séances à allure de course, le nombre de séances et la sortie longue la plus longue. Les fractionnés se règlent sur ta VMA, mesurée en semaine 1.</p></section>';
  h += '<section class="sheet"><div class="grid2"><label class="field"><span>Date de la course</span><input type="date" data-col="ed" data-id="" data-path="run.date" value="' + esc(r.date || "") + '" min="' + nextMonday() + '"></label><label class="field"><span>Ou nombre de semaines</span>' + edInp("run.weeks", r.date ? "" : r.weeks, 'inputmode="numeric" placeholder="' + RUN_STD[r.dist] + '"') + "</label></div>";
  var lab = W.n + " semaine" + (W.n > 1 ? "s" : "") + ", du " + fmtLong(W.debut) + " au " + fmtLong(W.race) + ", puis une semaine de récupération.";
  if (need && W.n < need.need && !r.force) {
    h += '<div class="note warn stack"><p><b>' + esc(lab) + "</b> C'est court pour cet objectif : " + (fin5 ? "il faut " + need.need + " semaines pour arriver à courir le 5 km." : "pour allonger ta sortie longue jusqu'à " + fmtDur(runObjOf(r).lp) + " par paliers de 10 % au plus, avec 2 semaines d'affûtage, il en faut " + need.need + ".") + "</p>" +
      '<div class="seg stack">' + (fin5 ? "" : '<button type="button" data-act="ed" data-op="rshort" data-v="easier">Viser un objectif plus accessible</button>') +
      '<button type="button" data-act="ed" data-op="rshort" data-v="later">Préparer une course plus tardive, à partir du ' + esc(fmtLong(addDays(nextMonday(), need.need * 7 - 1))) + "</button>" +
      '<button type="button" data-act="ed" data-op="rshort" data-v="keep">Garder ' + W.n + " semaines quand même</button></div>" +
      '<p class="tiny muted">« Garder » construit le plan avec des paliers de sortie longue plus grands, signalés semaine par semaine. Au-delà de 10 % de plus que la plus longue sortie du mois, le risque de blessure de surmenage augmente (Frandsen, 2025).</p></div>';
  } else if (W.n > RUN_MAXW[r.dist]) h += '<div class="note info"><b>' + esc(lab) + "</b> Les premières semaines seront des semaines de base : endurance facile, lignes droites et sortie longue qui monte doucement.</div>";
  else h += '<div class="note ok"><b>' + esc(lab) + "</b>" + (r.force ? " Paliers de sortie longue plus grands que 10 %, comme tu l'as choisi : ils sont signalés dans le plan." : "") + "</div>";
  h += "</section>";
  h += '<section class="sheet"><div class="titled"><h2>Ton niveau aujourd\'hui</h2><p class="small muted">Sert à construire le plan et à vérifier que l\'objectif est réaliste.</p></div>';
  if (fin5) h += '<div class="scale"><div class="scale-q"><span>Peux-tu déjà courir 15 minutes sans t\'arrêter ?</span></div><div class="seg">' + ["oui", "non"].map(function (v) { return '<button type="button" data-act="ed" data-op="rcan15" data-v="' + v + '" aria-pressed="' + (r.can15 === v) + '">' + (v === "oui" ? "Oui" : "Non") + "</button>"; }).join("") + "</div></div><p class=\"tiny muted\">Oui : le plan commence directement par des blocs de 6 à 10 minutes de course.</p>";
  else {
    h += '<div class="scale"><div class="scale-q"><span>Combien de fois cours-tu par semaine ?</span></div><div class="seg">' + [0, 1, 2, 3, 4].map(function (v) { return '<button type="button" data-act="ed" data-op="rfreq" data-v="' + v + '" aria-pressed="' + (Number(r.freq) === v) + '">' + (v === 4 ? "4 ou plus" : v) + "</button>"; }).join("") + "</div></div>";
    h += '<label class="field"><span>Ta plus longue sortie des 30 derniers jours (min)</span>' + edInp("run.longest", r.longest, 'inputmode="numeric"') + "</label>";
    if (runObjOf(r) && runObjOf(r).t) {
      h += '<div class="scale"><div class="scale-q"><span>Ta référence</span></div><div class="types">' +
        '<button type="button" class="type" data-act="ed" data-op="rref" data-v="temps" aria-pressed="' + (r.refMode !== "aucune") + '"><b>Un temps de course récent</b><span>Une course ou un chrono de 3 à 21 km, des 3 derniers mois.</span></button>' +
        '<button type="button" class="type" data-act="ed" data-op="rref" data-v="aucune" aria-pressed="' + (r.refMode === "aucune") + '"><b>Je n\'en ai pas</b><span>Un 5 km chronométré en semaine 1, avec ses consignes. L\'objectif reste « à confirmer » jusque-là.</span></button></div></div>';
      if (r.refMode !== "aucune") h += '<div class="grid2"><label class="field"><span>Distance (km)</span>' + edInp("run.refDist", r.refDist, 'inputmode="decimal" placeholder="ex. 5"') + '</label><label class="field"><span>Temps</span>' + edInp("run.refTime", r.refTime, 'placeholder="ex. 26:10"') + "</label></div>";
      if (chk.pred) {
        var pr = DISTL[r.dist];
        if (chk.propose && !r.garder) h += '<div class="note warn stack"><p><b>Temps probable au ' + esc(pr) + " : " + esc(fmtRace(chk.pred)) + ".</b> Ton objectif de " + esc(fmtRace(chk.o.t)) + " demande " + fmt(chk.gap * 100, 0) + " % de mieux. En courant " + (Number(r.freq) >= 4 ? "4 fois ou plus" : r.freq + " fois") + " par semaine, on gagne en général jusqu'à " + fmt(chk.seuil * 100, 0) + " % en quelques semaines.</p>" +
          '<div class="seg stack"><button type="button" data-act="ed" data-op="racc" data-v="propose">Viser ' + esc(fmtRace(chk.propose)) + '</button><button type="button" data-act="ed" data-op="racc" data-v="keep">Garder ' + esc(fmtRace(chk.o.t)) + "</button></div>" +
          '<p class="tiny muted">Temps probable : formule de Riegel. Gain habituel : méta-analyse de Rosenblat, 2021. Ce n\'est qu\'un conseil ; le chrono de mi-parcours refera le calcul.</p></div>';
        else h += '<div class="note ok"><b>Temps probable au ' + esc(pr) + " : " + esc(fmtRace(chk.pred)) + ".</b> " + (chk.gap > 0 ? "Ton objectif demande " + fmt(chk.gap * 100, 0) + " % de mieux." : "Ton objectif est déjà à ta portée : tu peux viser plus vite.") + "</div>";
      } else if (r.refMode === "aucune") h += '<p class="small muted">Objectif à confirmer : le 5 km chronométré de la semaine 1 donnera ton temps probable.</p>';
    }
  }
  h += "</section>";
  h += '<div class="row spread">' + edBtn("quit", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function edMixte1(d) {
  var h = stepHead(1, "Mixte, remise en forme") + typeChooser(d), mons = [], m0 = mondayOfDate(todayStr());
  for (var i = 0; i < 10; i++) mons.push(addDays(m0, 7 * i));
  if (mons.indexOf(d.debut) < 0) mons.unshift(d.debut);
  h += '<section class="sheet"><label class="field"><span>Nom du programme</span>' + edInp("nom", d.nom, 'maxlength="40"') + "</label>";
  h += '<div class="grid2"><label class="field"><span>Début, un lundi</span><select data-act="edsel" data-op="debut">' + mons.map(function (x) { return '<option value="' + x + '"' + (x === d.debut ? " selected" : "") + ">" + esc(parse(x).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })) + "</option>"; }).join("") + "</select></label>" +
    '<label class="field"><span>Nombre de semaines</span><select data-act="edsel" data-op="msem">' + [4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) { return '<option value="' + n + '"' + (Number(d.semaines) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label></div>";
  h += '<div class="scale"><div class="scale-q"><span>Ton matériel de musculation</span></div><div class="seg">' + MATS.map(function (m) { return '<button type="button" data-act="ed" data-op="mmat" data-v="' + m.v + '" aria-pressed="' + (d.mat === m.v) + '">' + esc(m.l) + "</button>"; }).join("") + "</div></div>";
  h += '<div class="note info">Chaque semaine : 2 séances de course (une d\'endurance, une plus variée) et 2 séances de musculation de 45 min environ, sur 4 jours différents. Environ 150 minutes d\'activité et 2 séances de renforcement, comme le recommande l\'OMS.' + (Number(d.semaines) >= 9 ? " Objectif : 30 minutes de course sans t'arrêter en fin de programme." : " Avec 9 semaines ou plus, le programme va jusqu'à 30 minutes de course continue.") + "</div>";
  h += '<p class="tiny muted">Intensité au ressenti et à la FC, sans test de VMA. Musculation : 2 séries les 2 premières semaines, puis 3.</p></section>';
  h += '<div class="row spread">' + edBtn("quit", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function dayOfSlot(d, u) { for (var i = 0; i < 7; i++) if (d.jours[i].indexOf(u) >= 0) return i; return -1; }
function weekRows(d) {
  var n = Number(d.semaines) || 1, slots = d.seances.filter(function (s) { return s.plan; }), out = [];
  for (var w = 1; w <= n; w++) {
    var items = slots.map(function (s) { var e = s.plan[w - 1]; return e && !e.repos ? { s: s, e: e, day: dayOfSlot(d, s.u) } : null; }).filter(Boolean).sort(function (a, b) { return a.day - b.day; });
    out.push({ w: w, ph: d.phases ? d.phases[w - 1] : null, items: items });
  }
  return out;
}
var PH_CLS = { base: "r-secondaire", dev: "r-principal", spe: "r-spe", aff: "r-aff", all: "r-iso", rec: "r-aff", cm: "r-principal" };
function edPlan2(d) {
  var r = d.run || {}, h = stepHead(2, "Ton plan, semaine par semaine"), o = r.dist ? runObjOf(r) : null;
  if (d.type === "mixte") {
    h += '<section class="sheet ed-list"><h2>Musculation</h2>';
    d.seances.forEach(function (s) { if (s.kind !== "muscu") return; h += '<button type="button" class="log-item ed-sess" data-act="ed" data-op="open" data-u="' + esc(s.u) + '"><span class="row"><b>' + esc(s.nom) + '</b><span class="linkbtn">Modifier</span></span><span class="small muted">' + esc(sessLine(s)) + '</span><span class="tiny muted">' + esc(s.ex.map(exName).join(" · ")) + "</span></button>"; });
    h += "</section>";
  }
  h += '<section class="sheet"><div class="titled"><h2>' + esc(d.type === "course" ? "Le " + DISTL[r.dist] + (o ? (o.t ? " en " + fmtRace(o.t) : ", pour finir") : "") + " · " + (Number(d.semaines) - 1) + " semaines" : "Course · " + d.semaines + " semaines") + '</h2><p class="small muted">Touche une semaine pour modifier ses séances de course.</p></div><div>';
  weekRows(d).forEach(function (x) {
    var tags = x.ph ? '<span class="role ' + (PH_CLS[x.ph] || "r-iso") + '">' + esc(PHASEL[x.ph] || "") + "</span>" : "", warn = "";
    x.items.forEach(function (it) { if (it.e.warn) warn = '<span class="tiny warn-t">Sortie longue : ' + it.e.warn + " % de plus que ta plus longue du mois</span>"; });
    h += '<button type="button" class="log-item ed-week" data-act="ed" data-op="week" data-w="' + x.w + '"><span class="row"><b>Semaine ' + x.w + "</b>" + tags + "</span>" +
      '<span class="small">' + (x.items.length ? x.items.map(function (it) { return esc(JOURS[it.day] + " " + shortEntry(it.e)); }).join(" · ") : "Repos") + "</span>" + warn + "</button>";
  });
  h += "</div></section>";
  if (d.type === "course" && !runFinish5(r)) {
    h += '<section class="sheet"><div class="chk-list">' + (r.dist !== "5" ? '<button type="button" role="checkbox" aria-checked="' + !!r.renfo + '" class="chk-item" data-act="ed" data-op="rrenfo"><span class="box" aria-hidden="true"></span><span class="grow"><b>Ajouter une séance de renforcement</b><span class="small muted">30 min par semaine : squat ou soulevé de terre roumain lourd, mollets, quelques sauts. Améliore l\'économie de course (Llanos-Lagos, 2024).</span></span></button>' : "") +
      '<button type="button" role="checkbox" aria-checked="' + (r.allegee !== false) + '" class="chk-item" data-act="ed" data-op="rall"><span class="box" aria-hidden="true"></span><span class="grow"><b>Semaine allégée toutes les 4 semaines</b><span class="small muted">Décoche pour la remplacer par une semaine normale. L\'affûtage reste.</span></span></button></div></section>';
  }
  h += '<div class="row spread">' + edBtn("prev", "Retour", "quiet") + edBtn("next", "Continuer", "primary") + "</div>";
  return h;
}
function shortEntry(e) {
  if (e.test6) return "test de 6 min"; if (e.chrono) return e.chrono.race ? "la course" : fmt(e.chrono.dist, 0) + " km chrono";
  if (e.ctype !== "fractionne") return (e.lab === "Sortie longue" ? "sortie longue " : e.ctype === "recup" ? "récup. " : "") + fmtDur(toNum(e.duree) || 0);
  var f = e.fr || {};
  if (f.marche) return (toNum(f.reps) || 1) + " × (" + fmtSecs(toNum(f.effort)) + " / " + fmtSecs(toNum(f.recup)) + " marche)";
  if (f.km) return (toNum(f.reps) || 1) + " × " + fmt(f.km, 1) + " km" + (f.pace ? " à " + fmtPace(f.pace) : "");
  return fmtLine(f) + (f.pct ? " à " + f.pct + " %" : f.pace ? " à " + fmtPace(f.pace) : "");
}
function edWeek(d, w) {
  var h = '<div class="ed-head"><p class="small muted">Étape 2 sur 4</p><h1>Semaine ' + w + "</h1></div>";
  d.seances.forEach(function (s, i) {
    if (!s.plan) return; var e = s.plan[w - 1], day = dayOfSlot(d, s.u);
    if (s.role === "race" && !e) return;
    h += '<section class="sheet"><div class="sheet-head"><h2>' + esc((day >= 0 ? JOURS_L[day] + " · " : "") + (e && e.lab ? e.lab : s.nom)) + "</h2>" + (e && e.perso ? '<span class="state alt">Modifiée</span>' : "") + "</div>";
    if (e && (e.test6 || e.chrono)) { h += '<p class="small">' + esc(entryText(e)) + "</p></section>"; return; }
    var ct = !e || e.repos ? "repos" : e.ctype;
    h += '<div class="seg">' + [["repos", "Repos"], ["recup", "Récupération"], ["ef", "Endurance"], ["fractionne", "Fractionné"]].map(function (o) { return '<button type="button" data-act="ed" data-op="wct" data-i="' + i + '" data-w="' + w + '" data-v="' + o[0] + '" aria-pressed="' + (ct === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>";
    var p = "seances." + i + ".plan." + (w - 1) + ".";
    if (ct === "ef" || ct === "recup") h += '<label class="field"><span>Durée (min)</span>' + edInp(p + "duree", e.duree, 'inputmode="numeric"') + "</label>";
    else if (ct === "fractionne") {
      var f = e.fr || {};
      h += '<div class="grid2"><label class="field"><span>' + (f.marche ? "Course (s)" : "Effort (s)") + "</span>" + edInp(p + "fr.effort", f.effort, 'inputmode="numeric"') + '</label><label class="field"><span>' + (f.marche ? "Marche (s)" : "Récupération (s)") + "</span>" + edInp(p + "fr.recup", f.recup, 'inputmode="numeric"') + "</label></div>";
      h += '<div class="grid2"><label class="field"><span>Répétitions</span>' + edInp(p + "fr.reps", f.reps, 'inputmode="numeric"') + '</label><label class="field"><span>Séries</span>' + edInp(p + "fr.series", f.series, 'inputmode="numeric"') + "</label></div>";
      h += '<p class="tiny muted">' + esc(entryText(e)) + "</p>";
    }
    h += "</section>";
  });
  h += '<p class="tiny muted">Une séance modifiée ici reste telle quelle si tu changes ensuite l\'objectif ou la durée.</p>';
  h += '<div class="row spread"><span></span>' + edBtn("wclose", "Enregistrer la semaine", "primary") + "</div>";
  return h;
}
function edRecapRun(d) {
  var r = d.run || {}, o = r.dist ? runObjOf(r) : null, N = Number(d.semaines) || 1, h = stepHead(4, "Vérification");
  var per = {}; d.jours.forEach(function (j) { j.forEach(function (u) { var s = sessByU(d, u); if (s && s.role !== "race") per[s.kind] = (per[s.kind] || 0) + 1; }); });
  var txt = d.type === "course" ? "Préparation du " + DISTL[r.dist] + (o && o.t ? ", objectif " + fmtRace(o.t) : ", objectif finir") + " · course le " + fmtLong(d.raceDate) + " · " + (N - 1) + " semaines du " + fmtLong(d.debut) + ", puis une semaine de récupération · " + (per.cardio || 0) + " séances de course par semaine" + (per.muscu ? " et 1 de renforcement" : "") + "."
    : "Mixte remise en forme · " + N + " semaines du " + fmtLong(d.debut) + " au " + fmtLong(addDays(d.debut, N * 7 - 1)) + " · 2 séances de course et 2 de musculation par semaine.";
  h += '<section class="sheet"><h2>Récapitulatif</h2><p class="small">' + esc(txt) + "</p>";
  var forced = d.seances.some(function (s) { return s.plan && s.plan.some(function (e) { return e && e.warn; }); });
  if (forced) h += '<div class="note warn"><b>Sorties longues au-delà de 10 % de progression.</b> Tu as choisi de garder une durée courte ; ces semaines sont signalées dans le plan, et la consigne du jour te le rappellera.</div>';
  h += '<p class="small muted">Tu pourras le modifier ensuite dans Réglages : les changements ne touchent que les séances à venir. Tes séances déjà notées ne changent pas.</p></section>';
  h += '<div class="row spread">' + edBtn("prev", "Retour", "quiet") + edBtn("install", d.pid ? "Mettre à jour le programme" : "Installer le programme", "primary") + "</div>";
  return h;
}
function edRunAct(op, b, d, ed) {
  var r = d.run, v = b.dataset.v;
  switch (op) {
    case "dtype":
      if ((d.type || "muscu") === v) return true;
      d.type = v; d.decharge = false;
      d.seances = d.seances.filter(function (s) { return !s.role && !s.mixte && !s.renfo; }); d.jours = d.jours.map(function (j) { return j.filter(function (u) { return !!sessByU(d, u); }); });
      if (v === "course") { d.run = d.run || runDefaults(); d.nom = d.nom === "Mon programme" || /^Mixte|^Préparation/.test(d.nom) ? "Préparation " + DISTL[d.run.dist] : d.nom; }
      if (v === "mixte") { d.mat = d.mat || "halt"; d.semaines = 8; d.debut = nextMonday(); d.nom = d.nom === "Mon programme" || /^Préparation/.test(d.nom) ? "Mixte remise en forme" : d.nom; d.seances = d.seances.filter(function (s) { return s.kind !== "muscu"; }); }
      if (v === "muscu") { d.semaines = 6; d.decharge = true; d.debut = nextMonday(); }
      regenRun(d); edChange(); return true;
    case "rdist": r.dist = v; r.obj = RUNOBJ[v][Math.min(2, RUNOBJ[v].length - 1)].k; r.libre = ""; r.garder = false; r.force = false; r.longest = Math.max(toNum(r.longest) || 0, RUN_MIN0[v]); if (/^Préparation/.test(d.nom)) d.nom = "Préparation " + DISTL[v]; regenRun(d); edChange(); return true;
    case "robj": r.obj = v; r.libre = ""; r.garder = false; r.force = false; regenRun(d); edChange(); return true;
    case "rfreq": r.freq = Number(v); regenRun(d); edChange(); return true;
    case "rref": r.refMode = v; regenRun(d); edChange(); return true;
    case "rcan15": r.can15 = v; regenRun(d); edChange(); return true;
    case "racc":
      if (v === "propose") { var c = runCheck(r); if (c.propose) { r.obj = "libre"; r.libre = fmtRace(c.propose); } }
      else r.garder = true;
      regenRun(d); edChange(); return true;
    case "rshort":
      if (v === "easier") { var L = RUNOBJ[r.dist], i = 0; L.forEach(function (o, k) { if (o.k === r.obj) i = k; }); if (r.obj === "libre") i = L.length - 1; while (i > 0) { i--; r.obj = L[i].k; r.libre = ""; var nd = runNeed(r); if (runWeeks(r).n >= nd.need) break; } }
      else if (v === "later") { var nn = runNeed(r).need; r.date = addDays(nextMonday(), nn * 7 - 1); r.weeks = ""; }
      else r.force = true;
      regenRun(d); edChange(); return true;
    case "rrenfo": r.renfo = !r.renfo; renfoSlot(d); edChange(); return true;
    case "rall": r.allegee = r.allegee === false; regenRun(d); edChange(); return true;
    case "mmat": d.mat = v; regenRun(d); edChange(); return true;
    case "week": ed.week = Number(b.dataset.w); edTop(); return true;
    case "wclose": ed.week = null; saveDraft(d); edTop(); return true;
    case "wct":
      var s = d.seances[Number(b.dataset.i)], w = Number(b.dataset.w), e = s && s.plan[w - 1];
      if (!s) return true;
      if (v === "repos") s.plan[w - 1] = { lab: e && e.lab || s.nom, repos: true, perso: true };
      else if (v === "fractionne") s.plan[w - 1] = { lab: "Fractionné", ctype: "fractionne", fr: e && e.fr ? e.fr : fr(30, 30, 8, 1, { pct: 100 }), perso: true, role: e && e.role };
      else s.plan[w - 1] = { lab: v === "recup" ? "Récupération" : e && e.lab && e.ctype === "ef" ? e.lab : "Endurance", ctype: v, duree: e && e.duree ? e.duree : v === "recup" ? 30 : 40, perso: true, role: e && e.role };
      edChange(); return true;
  }
  return false;
}

/* ---------- Programme complémentaire (à côté d'un programme de coach ou créé) ---------- */
function compProg() { var c = D.complement && D.programmes[D.complement]; return c && (!P || c.id !== P.id) ? c : null; }
function weekOfProg(p, date) { return Math.floor(diffDays(date, p.debut) / 7) + 1; }
function lastDayProg(p) { return addDays(p.debut, p.semaines * 7 - 1); }
function planSkip(p, t, w) {
  var def = p && p.sessions[t]; if (!def) return true;
  if (def.kind === "course" && def.custom && def.plan && !def.plan[w - 1]) return true;
  if (def.kind === "muscu" && def.ex && def.ex.length && def.ex.every(function (e) { return !e.sets[w - 1]; })) return true;
  return false;
}
function compPlanned(date) {
  var C = compProg(); if (!C || date < C.debut || date > lastDayProg(C)) return [];
  var w = weekOfProg(C, date), v = C.versions[keysOf(C.versions)[0]];
  return (v.jours[dow(date)] || []).filter(function (t) { return !planSkip(C, t, w); });
}
function isCompType(t) { var C = compProg(); return !!(C && C.sessions[t] && !(P && P.sessions[t])); }
function progIdFor(type, date) { var C = compProg(); if (isCompType(type)) return C.id; return inBlock(date) ? P.id : null; }
function compConflicts() {
  var C = compProg(); if (!C || !P) return [];
  var out = [], cw = Math.max(1, Math.min(P.semaines, weekOf(todayStr()))), v = versionOf(cw) || versionKeys()[0], cj = C.versions[keysOf(C.versions)[0]].jours;
  for (var i = 0; i < 7; i++) {
    var pt = (P.versions[v].jours[i] || []).map(function (t) { return P.sessions[t.replace(/\?$/, "")]; }).filter(Boolean);
    var ct = (cj[i] || []).map(function (t) { return C.sessions[t]; }).filter(Boolean);
    var pRun = pt.some(function (d) { return d.kind === "course"; }), cHard = ct.filter(function (d) { return d.role === "vma" || d.role === "allure"; });
    if (pRun && cHard.length) out.push({ t: "Ton coach prévoit déjà de la course le " + JOURS_L[i] + ".", d: "Avec le complément, tu ferais deux séances intenses de course ce jour-là. Conseil : préviens ton coach, ou déplace la séance du complément." });
    var legs = pt.some(function (d) { if (d.kind !== "muscu") return false; var n = 0; d.ex.forEach(function (e) { var mu = (CAT[exCat(e)] || {}).mu || e.mu || {}; n += (mu.quadri || 0) + (mu.ischios || 0); }); return n >= 2; });
    if (legs && ct.some(function (d) { return d.role === "sl"; })) out.push({ t: "Sortie longue le même jour qu'une séance de jambes de ton coach (" + JOURS_L[i] + ").", d: "Conseil : déplace la sortie longue à un autre jour, ou fais-la avant la musculation." });
  }
  var nRun = 0; for (var k = 0; k < 7; k++) { nRun += (P.versions[v].jours[k] || []).filter(function (t) { var d = P.sessions[t.replace(/\?$/, "")]; return d && d.kind === "course"; }).length + (cj[k] || []).filter(function (t) { return C.sessions[t] && C.sessions[t].kind === "course"; }).length; }
  if (nRun >= 6) out.push({ t: nRun + " séances de course par semaine en tout.", d: "C'est beaucoup avec un programme de coach : parles-en avec lui." });
  return out;
}
function compSheet() {
  var C = compProg(); if (!C) return "";
  var h = '<div class="note info stack"><p><b>Complément : ' + esc(C.titre || "programme de course") + ".</b> Du " + esc(fmtLong(C.debut)) + " au " + esc(fmtLong(lastDayProg(C))) + ". Il s'ajoute à ton programme sans le modifier ; un nouveau lien de ton coach le garde en place.</p>" +
    '<div class="row"><button type="button" class="btn small" data-act="compedit">Modifier le complément</button><button type="button" class="btn small quiet" data-act="comprm">Retirer</button></div></div>';
  compConflicts().forEach(function (x) { h += '<div class="note warn"><b>' + esc(x.t) + "</b> " + esc(x.d) + "</div>"; });
  return h;
}

/* ---------- Séances spéciales : test de 6 minutes, chrono, jour de course ---------- */
function bodyTest6(date, s, id) {
  var h = checkin(s, id) + '<div class="hr"></div><div class="target"><h3>Pourquoi ce test</h3><p class="small">Il mesure ta VMA, la vitesse que tu tiens environ 6 minutes. Les distances visées de tes fractionnés en découlent.</p></div>';
  h += '<div class="section"><h3>Comment faire</h3><ol class="steps small"><li>Sur une piste ou un parcours plat et mesuré, de préférence.</li><li>15 min d\'échauffement facile, puis 3 accélérations de 20 s.</li><li>Cours 6 minutes à l\'allure la plus rapide que tu peux tenir jusqu\'au bout, sans partir trop vite.</li><li>Note la distance parcourue, puis 10 min de retour au calme en trottinant.</li></ol></div>';
  h += '<label class="field"><span>Distance parcourue en 6 minutes (m)</span>' + inp("seances", id, "distanceTest", s.distanceTest, 'inputmode="numeric" placeholder="ex. 1450"') + "</label>";
  var dist = toNum(s.distanceTest);
  if (dist) { var v = dist / 100; h += '<div class="note ok"><b>VMA estimée : ' + fmt(v, 1) + " km/h</b> (" + esc(fmtPace(3600 / v)) + "). Tes répétitions de 30 s viseront environ " + Math.round(v / 3.6 * 30) + " m, celles de 3 min environ " + Math.round(v / 3.6 * 180 * 0.95) + " m.</div>"; }
  h += '<p class="tiny muted">Pas de piste ? Une montre GPS suffit ; la mesure sera un peu moins précise.</p>';
  return h + '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true, { duree: true, charge: true });
}
function bodyChrono(date, s, id, spec) {
  var prog = D.programmes[s.programme] || (isCompType(s.type) ? compProg() : P), run = prog && prog.run, dist = toNum(spec.dist) || 5, c = s.chrono || {}, t = parseRaceTime(c.temps), h = checkin(s, id) + '<div class="hr"></div>';
  if (spec.race) h += '<div class="target"><h3>Le jour J</h3><p class="small">Échauffe-toi 10 à 15 min, pars à ton allure visée sans t\'emballer sur le premier kilomètre, puis note ton temps officiel.' + (run && runObjOf(run) && runObjOf(run).t ? " Objectif : " + esc(fmtRace(runObjOf(run).t)) + ", soit " + esc(fmtPace(runObjOf(run).t / DISTKM[run.dist])) + "." : "") + "</p></div>";
  else h += '<div class="target"><h3>Pourquoi ce chrono</h3><p class="small">Il donne ton temps probable sur la distance visée, et permet d\'ajuster les allures des semaines suivantes.</p><ol class="steps small"><li>15 min d\'échauffement facile, puis 3 accélérations de 20 s.</li><li>' + fmt(dist, 0) + " km le plus vite possible en restant régulier, sur un parcours plat.</li><li>Note ton temps, puis 10 min de retour au calme.</li></ol></div>";
  h += '<div class="grid2"><label class="field"><span>' + (spec.race ? "Temps officiel" : "Temps") + "</span>" + inp("seances", id, "chrono.temps", c.temps, 'placeholder="ex. 24:40 ou 1:52:30"') + '</label><label class="field"><span>Distance</span><input type="text" value="' + esc(fmt(dist, dist % 1 ? 3 : 0) + " km") + '" disabled></label></div>';
  if (t) {
    h += '<p class="small">Allure moyenne : <b>' + esc(fmtPace(t / dist)) + "</b> (" + esc(kmh(t / dist)) + ").</p>";
    var o = run ? runObjOf(run) : null;
    if (spec.race) {
      h += '<div class="note ok"><b>' + (o && o.t ? (t <= o.t ? "Objectif atteint : " : "Objectif de " + fmtRace(o.t) + " manqué de " + fmtRace(t - o.t) + " : ") : "Course terminée : ") + esc(fmtRace(t)) + ".</b> Ce temps devient ta nouvelle référence ; il apparaît dans Progrès. La semaine qui suit est une semaine de récupération : pas d\'intensité les 2 premiers jours.</div>";
      h += '<div class="row"><button type="button" class="btn" data-act="edstartrun">Préparer une nouvelle course</button></div>';
    } else if (run && o && o.t) {
      var pred = riegel(t, dist, DISTKM[run.dist]), gap = (pred - o.t) / o.t;
      h += '<div class="note ' + (Math.abs(gap) > 0.02 ? "warn" : "ok") + ' stack"><p><b>Temps probable au ' + esc(DISTL[run.dist]) + " : " + esc(fmtRace(pred)) + ".</b> " + (Math.abs(gap) <= 0.02 ? "Ton objectif de " + esc(fmtRace(o.t)) + " reste adapté." : gap > 0 ? "C'est " + fmt(gap * 100, 0) + " % de plus que ton objectif de " + esc(fmtRace(o.t)) + "." : "C'est " + fmt(-gap * 100, 0) + " % de mieux que ton objectif de " + esc(fmtRace(o.t)) + " : tu peux viser plus vite.") + "</p>" +
        (Math.abs(gap) > 0.02 ? '<div><button type="button" class="btn small primary" data-act="runadj" data-id="' + esc(id) + '">Ajuster les allures pour la suite</button></div>' : "") + "</div>";
    }
  }
  return h + '<div class="hr"></div>' + arretBlock(s, id) + bilan(s, id, true, { duree: true, charge: true });
}
function runAdjust(id) {
  var s = D.seances[id]; if (!s) return;
  var prog = D.programmes[s.programme], run = prog && prog.run, spec = chronoSpec(s); if (!run || !spec.dist) return;
  var t = parseRaceTime((s.chrono || {}).temps), o = runObjOf(run); if (!t || !o || !o.t) return;
  var pred = riegel(t, toNum(spec.dist) || 5, DISTKM[run.dist]), newT = Math.round(pred / 30) * 30, cw = s.semaine || 1;
  var oldP = o.t / DISTKM[run.dist], newP = newT / DISTKM[run.dist], items = [{ k: "obj", t: "Objectif", v: fmtRace(o.t) + " → " + fmtRace(newT), d: "Temps probable d'après ton chrono : " + fmtRace(pred), on: true },
    { k: "allure", t: "Séances à allure de course", v: fmtPace(oldP) + " → " + fmtPace(newP), d: "Semaines " + (cw + 1) + " à " + (prog.semaines - 1), on: true }];
  keysOf(prog.sessions).forEach(function (k) { var df = prog.sessions[k]; if (df.plan) df.plan.forEach(function (e, i) { if (e && e.perso && e.fr && e.fr.pace && i + 1 > cw) items.push({ k: k + "|" + i, t: (e.lab || df.name) + ", semaine " + (i + 1), v: "Modifiée à la main : " + fmtPace(e.fr.pace), d: "", on: false }); }); });
  function line(it) { return '<button type="button" role="checkbox" aria-checked="' + it.on + '" class="chk-item" data-sh="tog" data-k="' + esc(it.k) + '"><span class="box" aria-hidden="true"></span><span class="grow"><b>' + esc(it.t) + '</b><span class="small st">' + esc(it.on ? it.v : "Rythme actuel conservé · " + it.v) + "</span>" + (it.d ? '<span class="tiny muted">' + esc(it.d) + "</span>" : "") + "</span></button>"; }
  function body() { return items.map(line).join(""); }
  var h = '<h2 id="dlg-t">Après ton chrono</h2><p class="small muted">' + esc(fmtRace(t)) + " sur " + fmt(toNum(spec.dist) || 5, 0) + " km, soit environ " + esc(fmtRace(pred)) + " au " + esc(DISTL[run.dist]) + ". Coche ce que tu veux adapter pour les semaines suivantes.</p>" +
    '<div class="row"><button type="button" class="btn small" data-sh="all">Tout adapter</button><button type="button" class="btn small" data-sh="none">Tout garder</button></div><div class="chk-list" id="chk-list">' + body() + '</div><p class="tiny muted">Les séances déjà notées ne changent pas.</p>' +
    '<div class="row spread"><button type="button" class="btn quiet" data-sh="back">Plus tard</button><button type="button" class="btn primary" data-sh="ok">Appliquer</button></div>';
  openSheet(h, function (b, close, back) {
    var a = b.dataset.sh;
    if (a === "back") { close(); return; }
    if (a === "tog") items.forEach(function (it) { if (it.k === b.dataset.k) it.on = !it.on; });
    if (a === "all" || a === "none") items.forEach(function (it) { it.on = a === "all"; });
    if (a === "ok") {
      close(); freezeAll(false);
      var np = clone(prog), on = {}; items.forEach(function (it) { on[it.k] = it.on; });
      if (on.obj) { np.run.obj = "libre"; np.run.libre = fmtRace(newT); if (np.src && np.src.run) { np.src.run.obj = "libre"; np.src.run.libre = fmtRace(newT); } np.objectif = np.objectif.replace(/objectif [^·]*?(?= ·|$)/, "objectif " + fmtRace(newT)); }
      keysOf(np.sessions).forEach(function (k) { var df = np.sessions[k]; if (!df.plan) return; df.plan.forEach(function (e, i) {
        if (!e || !e.fr || !e.fr.pace || i + 1 <= cw) return;
        if (e.perso ? on[k + "|" + i] : on.allure) { e.fr.pace = Math.round(newP); if (e.fr.km) e.fr.effort = Math.round(e.fr.km * newP); e.texte = entryText(e); }
      }); });
      D.programmes[np.id] = np; persistNow(); setActive(); render(); toast("Allures mises à jour pour la suite.");
      return;
    }
    var el = back.querySelector("#chk-list"); if (el) el.innerHTML = body();
  }, true);
}
function chronoSheet() {
  var list = valuesOf(D.seances).filter(function (s) { return s.chrono && parseRaceTime(s.chrono.temps); }).sort(byDateDesc);
  if (!list.length) return "";
  return '<section class="sheet"><div class="titled"><h2>Courses et chronos</h2><p class="small muted">Tes temps notés : ils servent de référence pour la préparation suivante.</p></div><dl class="kv">' + list.slice(0, 12).map(function (s) {
    var sp = chronoSpec(s), dk = toNum(sp.dist) || 5, t = parseRaceTime(s.chrono.temps);
    return "<dt>" + esc(fmtShort(s.date)) + "</dt><dd>" + esc((sp.race ? "Course, " : "Chrono, ") + fmt(dk, dk % 1 ? 1 : 0) + " km : " + fmtRace(t) + " (" + fmtPace(t / dk) + ")") + "</dd>";
  }).join("") + "</dl></section>";
}
function lastRef() {
  var best = null;
  valuesOf(D.seances).forEach(function (s) { if (s.chrono && parseRaceTime(s.chrono.temps) && (!best || s.date > best.date)) best = s; });
  if (!best) return null; var sp = chronoSpec(best);
  return { dist: String(toNum(sp.dist) || 5), t: best.chrono.temps, date: best.date };
}

/* ---------- Alertes de surmenage : toujours un conseil, avec une option pour adapter ---------- */
function alertOn(k) { return !(D.vue && D.vue["alerte" + k] === false); }
function alertThr() { var s = (D.vue && D.vue.alerteSens) || "normale"; return s === "sensible" ? { q: 0.3, h: 0.5 } : s === "peu" ? { q: 0.8, h: 1 } : { q: 0.5, h: 0.75 }; }
function alertAHtml(s, id, ci) {
  if (!alertOn("A") || !ci || ci.sport !== "course" || !hasData(s)) return "";
  var km = runKm(s), hh = runHist(s.date); if (!km || !hh.km || km <= hh.km * 1.1) return "";
  var pct = Math.round((km / hh.km - 1) * 100);
  if (s.alerteA === "garder") return '<p class="tiny muted">Sortie ' + pct + " % plus longue que ta plus longue du mois : plan gardé tel quel.</p>";
  if (s.alerteA === "adapter") return '<div class="note ok"><b>Prochaines séances adaptées.</b> Les deux suivantes restent faciles, et ta prochaine sortie longue est plafonnée à ' + esc(fmt(km, 1)) + " km.</div>";
  return '<div class="note warn stack"><p><b>Sortie ' + pct + " % plus longue que ta plus longue du mois</b> (" + esc(fmt(hh.km, 1)) + " km). Au-delà de 10 % de plus, le risque de blessure de surmenage augmente nettement, d'après le suivi de 5 205 coureurs (Frandsen, 2025). C'est un conseil, pas une interdiction.</p>" +
    '<div class="seg stack"><button type="button" data-act="alerta" data-id="' + esc(id) + '" data-v="adapter">Adapter les prochaines séances</button><button type="button" data-act="alerta" data-id="' + esc(id) + '" data-v="garder">Garder mon plan</button></div></div>';
}
function upcomingRuns(from, days) {
  var out = [];
  for (var i = 1; i <= days; i++) {
    var dd = addDays(from, i);
    (plannedFor(dd) || []).forEach(function (t) {
      var def = sessionDef(t); if (!def || def.kind !== "course") return;
      var x = seance(dd, t); if (x && hasData(x)) return;
      var p = isCompType(t) ? compProg() : P, w = isCompType(t) ? weekOfProg(p, dd) : weekOf(dd), pl = def.plan ? def.plan[w - 1] : null;
      out.push({ date: dd, t: t, pl: pl });
    });
  }
  return out;
}
function applyAlertA(id, v) {
  var s = D.seances[id]; if (!s) return;
  s.alerteA = v;
  if (v === "adapter") {
    var km = runKm(s), n = 0, slDone = false;
    upcomingRuns(s.date, 14).forEach(function (u) {
      var isSl = u.pl && u.pl.role === "sl";
      if (isSl && !slDone) { slDone = true; seance(u.date, u.t, true).adapte = { capKm: km, raison: "A", from: s.date }; return; }
      if (n < 2 && u.date <= addDays(s.date, 7)) { n++; if (u.pl && (u.pl.ctype === "fractionne" || u.pl.fr)) seance(u.date, u.t, true).adapte = { ctype: "ef", duree: 40, raison: "A", from: s.date }; }
    });
  }
  persist(); render();
}
function alertPlanHtml(s, id, ci) {
  if (!alertOn("A") || !ci || ci.role !== "sl" || !ci.planDuree || hasData(s) || s.adapte || s.alerteA) return "";
  var hm = runHist(s.date || todayStr()).min; if (!hm || ci.planDuree <= hm * 1.1) return "";
  var cap = Math.floor(hm * 1.1), pct = Math.round((ci.planDuree / hm - 1) * 100);
  return '<div class="note warn stack"><p><b>Prévue : ' + fmtDur(ci.planDuree) + ", soit " + pct + " % de plus que ta plus longue sortie du mois</b> (" + fmtDur(hm) + "). Conseil : la limiter à " + fmtDur(cap) + " (Frandsen, 2025).</p>" +
    '<div class="seg stack"><button type="button" data-act="alertplan" data-id="' + esc(id) + '" data-v="' + cap + '">Limiter à ' + fmtDur(cap) + '</button><button type="button" data-act="alertplan" data-id="' + esc(id) + '" data-v="garder">Garder ' + fmtDur(ci.planDuree) + "</button></div></div>";
}
function adapteNote(s, id) {
  var a = s.adapte; if (!a) return "";
  var why = a.raison === "A" ? (a.from ? "après ta sortie du " + fmtShort(a.from) : "pour rester sous les 10 % de progression") : "à cause des signes de fatigue";
  var what = a.repos ? "jour de repos" : a.capKm ? "distance plafonnée à " + fmt(a.capKm, 1) + " km" : a.ctype === "ef" ? (a.duree || 35) + " min d'endurance facile" : a.duree ? "durée limitée à " + fmtDur(a.duree) : a.court ? "séance raccourcie" : a.facile ? "séance gardée facile" : "séance adaptée";
  return '<div class="note info stack"><p><b>Séance adaptée ' + esc(why) + " :</b> " + esc(what) + '.</p><div><button type="button" class="linkbtn" data-act="unadapt" data-id="' + esc(id) + '">Revenir à la séance prévue</button></div></div>';
}
function fatigueReasons(date) {
  var thr = alertThr(), out = { list: [], pain: false };
  var checks = valuesOf(D.seances).filter(function (s) { return s.date <= date && s.date > addDays(date, -28) && readiness(s.checkin); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  if (checks.length >= 5) {
    var last2 = checks.slice(-2).map(function (s) { return readiness(s.checkin).avg; }), early = checks.slice(0, -2).map(function (s) { return readiness(s.checkin).avg; }), m = avg(early);
    if (last2.every(function (x) { return x < m - thr.q; })) out.list.push("Ton questionnaire « Avant de commencer » est à " + fmt(last2[1], 1) + " sur 5 pour la 2e séance de suite (ta moyenne : " + fmt(m, 1) + ").");
  }
  var recent = [], before = [];
  for (var i = 0; i < 35; i++) { var dd = addDays(date, -i), p = D.pesees[dd], x = p ? parseHours(p.sommeil) : null; if (x !== null) (i < 7 ? recent : before).push(x); }
  if (recent.length >= 3 && before.length >= 5 && avg(before) - avg(recent) >= thr.h) out.list.push("Tes nuits font " + fmtHours(avg(recent)) + " cette semaine (d'habitude " + fmtHours(avg(before)) + ").");
  var zones = {};
  valuesOf(D.seances).forEach(function (s) {
    if (s.date > date || s.date <= addDays(date, -7)) return;
    var z = {}; keysOf((s.bilan || {}).douleurs).forEach(function (k) { if (s.bilan.douleurs[k]) z[k] = 1; }); keysOf((s.arret || {}).zone).forEach(function (k) { if (s.arret.zone[k]) z[k] = 1; });
    keysOf(z).forEach(function (k) { zones[k] = (zones[k] || 0) + 1; });
  });
  keysOf(zones).forEach(function (k) { if (zones[k] >= 2) { out.list.push("Douleur aux " + labelZone(k) + " notée " + zones[k] + " fois en 7 jours."); out.pain = true; } });
  return out;
}
function fatigueBanner(date, types) {
  if (!alertOn("B") || date !== todayStr() || (D.vue && D.vue.fatigueOk && D.vue.fatigueOk[date])) return "";
  var todo = (types || []).filter(function (t) { var x = seance(date, t), def = sessionDef(t); return t !== "REPOS" && def && def.kind !== "repos" && def.kind !== "mensu" && !(x && (hasData(x) || x.adapte)); });
  if (!todo.length) return "";
  var f = fatigueReasons(date); if (!f.list.length) return "";
  return '<div class="note warn stack"><p><b>Signes de fatigue.</b> ' + esc(f.list.join(" ")) + "</p><p class=\"small\">Quand ces mesures baissent, c'est souvent que la charge récente a augmenté (Saw, 2016). Conseil pour aujourd'hui :</p>" +
    '<div class="seg stack">' + [["court", "Raccourcir la séance"], ["facile", "La garder facile"], ["repos", "Prendre un jour de repos"], ["garder", "Garder mon plan"]].map(function (o) { return '<button type="button" data-act="fatigue" data-v="' + o[0] + '">' + o[1] + "</button>"; }).join("") + "</div>" +
    '<p class="tiny muted">Seuils choisis par l\'application, réglables dans Réglages.' + (f.pain ? " Une douleur qui dure se montre à un professionnel de santé." : "") + "</p></div>";
}
function applyFatigue(date, v) {
  if (!D.vue.fatigueOk) D.vue.fatigueOk = {};
  D.vue.fatigueOk[date] = true;
  if (v !== "garder") (plannedFor(date) || []).forEach(function (t) {
    var def = sessionDef(t); if (!def || t === "REPOS" || def.kind === "repos" || def.kind === "mensu") return;
    var x = seance(date, t, true); if (hasData(x)) return;
    if (v === "repos") x.adapte = { repos: true, raison: "B" };
    else if (def.kind === "course") x.adapte = v === "court" ? { court: true, raison: "B" } : { ctype: "ef", duree: 35, raison: "B" };
    else x.adapte = v === "court" ? { court: true, raison: "B" } : { facile: true, raison: "B" };
  });
  persist(); render();
}
function alertesSheet() {
  var sens = (D.vue && D.vue.alerteSens) || "normale";
  return '<section class="sheet"><div class="titled"><h2>Alertes de surmenage</h2><p class="small muted">Des conseils, jamais des interdictions : chaque alerte propose d\'adapter ou de garder ton plan.</p></div>' +
    '<div class="scale"><div class="scale-q"><span>Séance nettement plus longue que d\'habitude</span></div><div class="seg"><button type="button" data-act="alertpref" data-k="A" data-v="1" aria-pressed="' + alertOn("A") + '">Activée</button><button type="button" data-act="alertpref" data-k="A" data-v="0" aria-pressed="' + !alertOn("A") + '">Désactivée</button></div></div>' +
    '<div class="scale"><div class="scale-q"><span>Signes de fatigue</span></div><div class="seg"><button type="button" data-act="alertpref" data-k="B" data-v="1" aria-pressed="' + alertOn("B") + '">Activée</button><button type="button" data-act="alertpref" data-k="B" data-v="0" aria-pressed="' + !alertOn("B") + '">Désactivée</button></div></div>' +
    '<div class="scale"><div class="scale-q"><span>Sensibilité des signes de fatigue</span></div><div class="seg">' + [["sensible", "Sensible"], ["normale", "Normale"], ["peu", "Peu sensible"]].map(function (o) { return '<button type="button" data-act="alertsens" data-v="' + o[0] + '" aria-pressed="' + (sens === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div></div>" +
    '<p class="tiny muted">Normale : questionnaire 0,5 point sous ta moyenne 2 séances de suite, nuits 45 min plus courtes que d\'habitude, ou même douleur 2 fois en 7 jours. Ces seuils sont des choix de l\'application : aucune étude ne les fixe.</p></section>';
}

/* ================= Séance sautée ou remplacée, questionnaire pour toutes les séances ================= */
var MOTIFS_SMOD = [{ v: "fatigue", l: "Fatigue" }, { v: "douleur", l: "Douleur" }, { v: "temps", l: "Manque de temps" }, { v: "imprevu", l: "Imprévu" }, { v: "autre", l: "Autre" }];
var INTENS_RPE = { "Légère": 3, "Normale": 5, "Très dure": 8 };
var CK = null; /* séance en cours d'affichage, pour le questionnaire */
function isCombat(name) { return /sambo|judo|lutte|jjb|jiu|grappling|boxe|mma|karat|taekwondo|kick|muay|combat/i.test(name || ""); }
function readinessFor(r, ctx) {
  if (!r || !ctx || ctx.kind === "muscu") return r;
  var o = Object.assign({}, r), comb = ctx.kind === "sport" && isCombat(ctx.name);
  if (r.level === "ok") o.text = "Séance normale.";
  else if (r.level === "warn") o.text = ctx.kind === "course" ? "Garde l'allure prévue, sans forcer sur la fin." : comb ? "Écoute-toi pendant les combats : tu peux en faire moins." : "Écoute-toi pendant la séance : tu peux lever le pied.";
  else { o.title = "Forme basse"; o.text = (ctx.kind === "course" ? "Conseil : endurance facile ou repos aujourd'hui." : comb ? "Conseil pour cette séance : technique sans combats, ou repos." : "Conseil : séance légère ou repos.") + " C'est un conseil : tu choisis."; }
  return o;
}
/* La séance peut-elle être sautée ou remplacée ? */
function smodKind(date, type, def, s) {
  if (!def || type === "REPOS" || def.kind === "repos" || type === LIBRE || isCardioType(type)) return null;
  if (def.kind === "tests" || def.kind === "mensu") return "saute";
  if (def.kind === "course") { var ci = cardioInfo(s && s.type ? s : { date: date, type: type, programme: progIdFor(type, date), semaine: null }); if (ci && ci.spec && ci.spec.chrono && ci.spec.chrono.race) return "saute"; }
  return "both";
}
function smodBtn(id, cls) { return '<div><button type="button" class="btn small ' + (cls || "quiet") + '" data-act="smodopen" data-id="' + esc(id) + '">' + (cls ? "Sauter ou remplacer la séance" : "Séance sautée ou remplacée") + "</button></div>"; }
function progOfType(type) { return isCompType(type) ? compProg() : P; }
function weekDates(date) { var mon = mondayOfDate(date), out = []; for (var i = 0; i < 7; i++) out.push(addDays(mon, i)); return out; }
function smodProgOptions(date, type) {
  var prog = progOfType(type); if (!prog) return [];
  var today = plannedFor(date) || [], days = weekDates(date);
  return keysOf(prog.sessions).filter(function (t) {
    var d = prog.sessions[t]; return t !== type && d && (d.kind === "muscu" || d.kind === "course" || d.kind === "sport") && today.indexOf(t) < 0 && !(seance(date, t) && (hasData(seance(date, t)) || seance(date, t).ajoutee));
  }).map(function (t) {
    var info = "", later = null;
    days.forEach(function (dd) {
      if (dd < date && (hasData(seance(dd, t)) || replacedDone(dd, t))) info = "faite " + fmtLong(dd).replace(/^(\S+) (\d+) .*$/, "$1 $2");
      if (dd > date && !later && (plannedFor(dd) || []).indexOf(t) >= 0 && !hasData(seance(dd, t))) later = dd;
    });
    var d = prog.sessions[t], n = d.kind === "muscu" ? (d.ex || []).length + " exercices" : d.kind === "course" ? "Course" : "Sport";
    if (later) info = "prévue " + fmtLong(later).replace(/^(\S+) (\d+) .*$/, "$1 $2");
    return { t: t, label: d.name, sub: n + (info ? " · " + info : ""), later: later };
  });
}
function smodPanel(date, type, def, s, id) {
  var m = s.smod || {}, k = smodKind(date, type, def, s), nm = def.short || def.name, h = '<div class="panel">';
  h += '<div class="scale"><div class="scale-q"><span>Que s\'est-il passé ?</span></div>' + seg("seances", id, "smod.statut", k === "both" ? [{ v: "saute", l: "Sautée" }, { v: "remplace", l: "Remplacée par autre chose" }] : [{ v: "saute", l: "Sautée" }], m.statut) + "</div>";
  h += '<div class="scale"><div class="scale-q"><span>Pourquoi ?</span></div>' + seg("seances", id, "smod.motif", MOTIFS_SMOD, m.motif) + "</div>";
  if (m.motif === "douleur") h += '<div class="scale"><div class="scale-q"><span>Où ?</span></div>' + zones(id, "smod.zone", m.zone) + "</div>";
  if (m.motif === "autre") h += '<label class="field"><span>Précise</span>' + inp("seances", id, "smod.precision", m.precision, "") + "</label>";
  if (m.statut === "saute") h += '<p class="small muted">' + (def.kind === "tests" ? "Les tests servent à calculer le bloc suivant : fais-les un autre jour avec « Ajouter une séance à ce jour »." : def.kind === "mensu" ? "Tu pourras les noter un autre jour avec « Ajouter une séance à ce jour »." : "Elle compte comme sautée dans ta semaine. Ton programme ne bouge pas : la séance suivante reste prévue.") + "</p>";
  if (m.statut === "remplace") h += smodRemp(date, type, def, s, id, nm);
  h += '<div><button type="button" class="linkbtn" data-act="smodundo" data-id="' + esc(id) + '">Revenir à la séance prévue</button></div>';
  return h + "</div>";
}
function smodRemp(date, type, def, s, id, nm) {
  var par = s.smod.par || {}, h = "";
  if (par.k === "prog" && par.started) {
    var d2 = sessionDef(par.t);
    return '<div class="note info">Remplacée par <b>' + esc(d2 ? d2.name : par.t) + "</b>" + (par.from ? ", avancée du " + esc(fmtLong(par.from)) : "") + " : la séance est plus bas.</div>";
  }
  if (par.k === "pret" && par.ref && D.seances[seanceId(date, par.ref)]) return '<div class="note info">Remplacée par <b>' + esc(par.nom) + "</b> : la séance est plus bas.</div>";
  h += '<div class="scale"><div class="scale-q"><span>Par quoi ?</span></div>';
  var opts = smodProgOptions(date, type);
  if (opts.length) {
    h += '<p class="small"><b>Dans ton programme</b></p><div class="seg stack" role="group">' + opts.map(function (o) {
      return '<button type="button" data-act="smodprog" data-id="' + esc(id) + '" data-t="' + esc(o.t) + '" aria-pressed="' + (par.k === "prog" && par.t === o.t) + '"><b>' + esc(o.label) + '</b><span class="tiny sub">' + esc(o.sub) + "</span></button>";
    }).join("") + "</div>";
  }
  h += "</div>";
  if (par.k === "prog" && par.t) {
    var o = opts.filter(function (x) { return x.t === par.t; })[0], d3 = sessionDef(par.t), sh = d3 ? d3.short || d3.name : par.t;
    if (o && o.later) h += '<div class="scale"><div class="scale-q"><span>' + esc(sh) + " était prévue " + esc(fmtLong(o.later)) + '</span></div><div class="seg stack" role="group">' +
      [["avance", "L'avancer à aujourd'hui : ce jour-là devient libre"], ["plus", "La faire en plus : ce jour-là ne change pas"]].map(function (x) { return '<button type="button" data-act="smodmode" data-id="' + esc(id) + '" data-v="' + x[0] + '" aria-pressed="' + ((par.mode || "avance") === x[0]) + '">' + esc(x[1]) + "</button>"; }).join("") + "</div></div>";
    h += '<button type="button" class="btn primary wide" data-act="smodgo" data-id="' + esc(id) + '">Commencer ' + esc(sh) + "</button>";
  }
  h += '<div class="hr"></div><p class="small"><b>Ou une séance prête de l\'application</b></p><p class="small muted">Full body, haut et bas, push pull legs, selon ton matériel ; récupération active, endurance ou fractionné en course, vélo ou natation.</p>' +
    '<div><button type="button" class="btn" data-act="smodpret" data-id="' + esc(id) + '">Choisir une séance prête</button></div>';
  h += '<div class="hr"></div><p class="small"><b>Ou autre chose</b></p><div class="seg" role="group">' + [["mob", "Mobilité, étirements"], ["sport", "Autre sport"]].map(function (x) { return '<button type="button" data-act="smodautre" data-id="' + esc(id) + '" data-v="' + x[0] + '" aria-pressed="' + (par.k === x[0]) + '">' + esc(x[1]) + "</button>"; }).join("") + "</div>";
  if (par.k === "mob" || par.k === "sport") {
    if (par.k === "sport") h += '<label class="field"><span>Quel sport ?</span>' + inp("seances", id, "smod.par.nom", par.nom, 'placeholder="ex. Foot, natation, vélo"') + "</label>";
    h += '<label class="field"><span>Durée (min)</span>' + inp("seances", id, "smod.par.duree", par.duree, 'inputmode="numeric" placeholder="ex. 30"') + "</label>";
    h += '<div class="scale"><div class="scale-q"><span>Intensité</span></div>' + seg("seances", id, "smod.par.intensite", ["Légère", "Normale", "Très dure"], par.intensite) + "</div>";
  }
  return h + '<p class="small muted">La séance de remplacement compte dans ta semaine et ta charge, à la place de « ' + esc(nm) + " ».</p>";
}
function smodState(s) { return s.smod && s.smod.statut === "saute" ? '<span class="state warn">Sautée</span>' : s.smod && s.smod.statut === "remplace" ? '<span class="state alt">Remplacée</span>' : ""; }
function smodText(s) {
  var m = s.smod; if (!m || !m.statut) return "";
  var p = m.par || {}, t = m.statut === "saute" ? "sautée" : "remplacée" + (p.k === "prog" ? " par " + shortName(p.t) + (p.from ? " (avancée du " + fmtShort(p.from) + ")" : "") : p.k === "pret" ? " par " + (p.nom || "une séance prête") : p.k === "mob" ? " par mobilité et étirements" : p.k === "sport" ? " par " + (p.nom || "un autre sport") : "");
  if (p.duree && (p.k === "mob" || p.k === "sport")) t += ", " + p.duree + " min" + (p.intensite ? ", " + p.intensite.toLowerCase() : "");
  if (m.motif) t += " (" + motifLabel(MOTIFS_SMOD, m.motif) + (m.zone ? " : " + keysOf(m.zone).filter(function (k) { return m.zone[k]; }).map(labelZone).join("/") : "") + (m.precision ? ", " + m.precision : "") + ")";
  return t;
}
function smodLoad(s) { var p = s.smod && s.smod.statut === "remplace" && s.smod.par; if (!p || (p.k !== "mob" && p.k !== "sport")) return null; var d = toNum(p.duree), r = INTENS_RPE[p.intensite]; return d && r ? d * r : null; }
function smodCleanup(date, s) {
  var p = s.smod && s.smod.par; if (!p) return;
  if (p.k === "prog" && p.t) {
    var x = seance(date, p.t);
    if (x && !hasData(x) && x.pour) delete D.seances[seanceId(date, p.t)];
    if (!(x && hasData(x)) && p.from && D.avances) delete D.avances[p.from + "_" + p.t];
  }
  if (p.k === "pret" && p.ref) { var y = D.seances[seanceId(date, p.ref)]; if (y && !hasData(y)) delete D.seances[seanceId(date, p.ref)]; }
}
/* Règle du programme : lendemain d'une séance de sport très dure, une série de moins */
function lendemainDur(date) {
  var r = P && P.regles && P.regles.lendemainDur; if (!r) return null;
  var y = addDays(date, -1), found = null;
  (r.types || []).forEach(function (t) { var x = seance(y, t); if (x && x.intensite === "Très dure") found = sessionDef(t); });
  return found ? { name: found.short || found.name, texte: r.texte } : null;
}
function smodPretDialog(date, type, id) {
  var st = { mat: (D.vue && D.vue.matPret) || "salle", sport: (sportsOn()[0] || SPORTS[0]).v };
  function draw() {
    var h = '<h2 id="dlg-t">Choisir une séance prête</h2><div class="scale"><div class="scale-q"><span>Ton matériel</span></div><div class="seg" role="group">' + MATS.map(function (m) { return '<button type="button" data-sh="mat" data-v="' + m.v + '" aria-pressed="' + (st.mat === m.v) + '">' + esc(m.l) + "</button>"; }).join("") + "</div></div>";
    h += '<p class="grp-t">Musculation</p><div class="pick-list">';
    ["fb", "hb", "ppl"].forEach(function (org) { ((MODELES[st.mat] || {})[org] || []).forEach(function (tp, i) {
      var ex = tp[1], names = ex.slice(0, 3).map(function (x) { return CAT[x.k] ? CAT[x.k].n.toLowerCase() : x.k; }).join(" / ");
      h += '<button type="button" class="pick" data-sh="tpl" data-org="' + org + '" data-i="' + i + '"><span><b>' + esc(tp[0]) + '</b><span class="small muted">' + ex.length + " exercices · " + esc(names) + '</span></span><span class="chev" aria-hidden="true">›</span></button>';
    }); });
    h += '</div><p class="grp-t">Cardio</p><div class="seg" role="group">' + sportsOn().map(function (o) { return '<button type="button" data-sh="sport" data-v="' + o.v + '" aria-pressed="' + (st.sport === o.v) + '">' + esc(o.l) + "</button>"; }).join("") + '</div><div class="pick-list">';
    CTYPES.forEach(function (c) { h += '<button type="button" class="pick" data-sh="ctype" data-v="' + c.v + '"><span><b>' + esc(c.l) + '</b><span class="small muted">' + esc(c.d) + '</span></span><span class="chev" aria-hidden="true">›</span></button>'; });
    return h + '</div><div><button type="button" class="btn wide" data-sh="cancel">Annuler</button></div>';
  }
  openSheet(draw(), function (b, close, back) {
    var a = b.dataset.sh, s = seance(date, type, true);
    if (a === "mat" || a === "sport") { st[a] = b.dataset.v; if (a === "mat") { D.vue.matPret = st.mat; persist(); } back.querySelector(".dialog").innerHTML = draw(); var f = back.querySelector('[data-sh="' + a + '"][data-v="' + b.dataset.v + '"]'); if (f) f.focus(); return; }
    if (a === "cancel") { close(); return; }
    if (a === "tpl") {
      var tp = MODELES[st.mat][b.dataset.org][Number(b.dataset.i)], cur = libreOf(date);
      if (cur && hasData(cur)) { close(); dialog("Une séance libre existe déjà", '<p class="small">Tu as déjà noté une séance libre aujourd\'hui. Ajoute les exercices dedans, ou choisis une séance de cardio.</p>', [{ label: "OK", cls: "primary" }]); return; }
      close();
      var L = seance(date, LIBRE, true); L.libre = true; L.lieu = st.mat === "salle" ? "salle" : st.mat === "street" ? "dehors" : "maison"; L.modele = tp[0]; L.nU = 0; L.liste = [];
      tp[1].forEach(function (x) { L.nU++; var it = { u: "lx" + L.nU, k: x.k, cible: x.s + " × " + x.r }; if (x.note) it.consigne = x.note; L.liste.push(it); });
      s.smod.par = { k: "pret", nom: tp[0], ref: LIBRE };
    } else if (a === "ctype") {
      close();
      var n = 1; cardioOf(date).forEach(function (x) { n = Math.max(n, Number(x.type.slice(6)) + 1); });
      var c = seance(date, "CARDIO" + n, true); c.cardio = 1; c.sport = st.sport; c.ctype = b.dataset.v;
      s.smod.par = { k: "pret", nom: listLabel(CTYPES, b.dataset.v) + " (" + listLabel(SPORTS, st.sport).toLowerCase() + ")", ref: "CARDIO" + n };
    } else return;
    persist(); render();
    var el = document.getElementById(s.smod.par.ref === LIBRE ? "libre" : "c-" + s.smod.par.ref); if (el) el.scrollIntoView({ block: "start" });
  }, true);
}
function smodAct(b) {
  var id = b.dataset.id, s = D.seances[id] || null, a = b.dataset.act, us = id.lastIndexOf("_"), date = id.slice(0, us), type = id.slice(us + 1);
  if (a === "smodopen") { S.smodOpen = S.smodOpen || {}; S.smodOpen[id] = true; render(); var p = document.querySelector('[data-smod="' + id + '"]'); if (p) p.scrollIntoView({ block: "nearest" }); return; }
  if (a === "smodundo") { if (s) { smodCleanup(date, s); delete s.smod; } if (S.smodOpen) delete S.smodOpen[id]; persist(); render(); return; }
  s = seance(date, type, true); s.smod = s.smod || { statut: "remplace" }; s.smod.statut = "remplace";
  if (a === "smodprog") { var keep = s.smod.par && s.smod.par.k === "prog" && s.smod.par.t === b.dataset.t; if (!keep) { smodCleanup(date, s); s.smod.par = { k: "prog", t: b.dataset.t, mode: "avance" }; } }
  else if (a === "smodmode") s.smod.par.mode = b.dataset.v;
  else if (a === "smodautre") { if (!(s.smod.par && s.smod.par.k === b.dataset.v)) { smodCleanup(date, s); s.smod.par = { k: b.dataset.v }; } }
  else if (a === "smodpret") { smodCleanup(date, s); s.smod.par = {}; persist(); smodPretDialog(date, type, id); return; }
  else if (a === "smodgo") {
    var par = s.smod.par, o = smodProgOptions(date, type).filter(function (x) { return x.t === par.t; })[0];
    var x = seance(date, par.t, true); x.ajoutee = true; x.pour = type;
    if (o && o.later && (par.mode || "avance") === "avance") { D.avances = D.avances || {}; D.avances[o.later + "_" + par.t] = date; par.from = o.later; x.avanceDe = o.later; }
    par.started = true; persist(); render();
    var el = document.getElementById("sess-" + seanceId(date, par.t)); if (el) el.scrollIntoView({ block: "start" });
    return;
  }
  persist(); render();
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
  var def = sessionDef(s.type), isLib = s.type === LIBRE, ci = cardioInfo(s), cNew = ci && !ci.legacy && !ci.test;
  var parts = [fmtShort(s.date) + " " + (isLib ? "séance libre hors salle (" + lieuLabel(s.lieu).toLowerCase() + (s.remplace ? ", remplace " + shortName(s.remplace) : "") + ")" : ci && ci.free ? cardioTitle(s).toLowerCase() : cNew ? (def ? def.short || def.name : "course") + (ci.ctype ? " (" + listLabel(CTYPES, ci.ctype).toLowerCase() + ")" : "") : s.plan ? s.plan.short : def ? def.short || def.name : s.type)];
  if (cNew) { var cs = cardioSummary(s, ci); if (cs) parts.push(cs); }
  var r = readiness(s.checkin); if (r) parts.push("forme " + fmt(r.avg, 1) + "/5 (" + CHECK.map(function (q) { return q.k + " " + s.checkin[q.k]; }).join(", ") + ")");
  if (isLib) (s.liste || []).forEach(function (it) {
    var c = CAT[it.k], rows = valuesOf((s.sets && s.sets[it.u]) || {}).filter(function (x) { return x && (toNum(x.c) !== null || toNum(x.r) || toNum(x.t)); });
    if (!rows.length) return;
    var nm = libreName(it) + (it.k === "autre" ? " (hors liste" + (it.mu ? ", " + muscleName(it.mu).toLowerCase() : "") + ")" : c && c.per ? " (kg par haltère)" : c && c.bw ? " (lest)" : "");
    parts.push(nm + " : " + rows.map(function (x) { return c && c.time ? (toNum(x.c) ? "+" + x.c + " kg " : "") + (x.t || "?") + " s, marge " + (x.m !== undefined ? x.m : "?") + " s" : (x.c !== undefined ? x.c : "?") + "×" + (x.r || "?") + "@" + (x.rir !== undefined ? x.rir : "?"); }).join(", "));
  });
  if (!isLib) keysOf(s.sets).forEach(function (k) { var rows = valuesOf(s.sets[k]).filter(function (x) { return toNum(x.c) !== null || toNum(x.r); }); if (rows.length) parts.push(k + " : " + rows.map(function (x) { return (x.c !== undefined ? x.c : "?") + "×" + (x.r || "?") + "@" + (x.rir !== undefined ? x.rir : "?"); }).join(", ")); });
  keysOf(s.mods).forEach(function (k) {
    var m = s.mods[k], rp = s.remp && s.remp[k], t = k + (m.statut === "saute" ? " sauté" : " remplacé" + (rp && rp.nom ? " par " + rp.nom : ""));
    if (m.motif) t += " (" + motifLabel(MOTIFS_EX, m.motif) + (m.zone ? " : " + keysOf(m.zone).map(labelZone).join("/") : "") + (m.precision ? ", " + m.precision : "") + ")";
    if (rp && rp.sets) { var rr = rowsOk(rp.sets); if (rr.length) t += " : " + rr.map(function (x) { return x.c + "×" + x.r + "@" + (x.rir !== undefined ? x.rir : "?"); }).join(", "); }
    parts.push(t);
  });
  if (s.arret && s.arret.motif) parts.push("séance terminée plus tôt : " + motifLabel(MOTIFS_ARRET, s.arret.motif) + (s.arret.zone ? " (" + keysOf(s.arret.zone).map(labelZone).join("/") + ")" : "") + (s.arret.intensite ? ", douleur " + s.arret.intensite + "/10" : "") + (s.arret.note ? ", " + s.arret.note : ""));
  if (s.smod && s.smod.statut) parts.push("séance " + smodText(s));
  if (s.intensite) parts.push("intensité " + s.intensite.toLowerCase() + (s.combats ? ", " + s.combats + " min de combat" : ""));
  if (s.duree && !cNew) parts.push(s.duree + " min" + (s.distance ? ", " + s.distance + " km" : "") + (s.allures ? ", allures tenues : " + s.allures.toLowerCase() : ""));
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
  var w = P ? weekOf(date) : null, types = plannedFor(date) || [], lib = libreOf(date);
  var out = types.map(function (t) {
    var def = P.sessions[t];
    if (!def) return t;
    if (isReplaced(date, t)) return def.name + " : remplacée aujourd'hui par une séance libre hors salle (" + lieuLabel(lib.lieu).toLowerCase() + ").";
    if (def.kind === "muscu") return def.name + " :\n" + def.ex.map(function (e) { var p = presc(e, w); if (!p) return null; var sg = suggestion(e, p, date); return "  " + e.id + " " + e.name + " : " + p.sets + "×" + p.reps + (p.load ? ", " + p.load : "") + ", RIR " + p.rir + (sg ? " (charge conseillée " + loadLabel(e, sg.load) + ")" : ""); }).filter(Boolean).join("\n");
    if (def.kind === "course") { var cp = def.plan[w - 1] || def.plan[def.plan.length - 1], fl = cp.fr ? fmtLine(cp.fr) : ""; return def.name + " : " + cp.texte + (fl ? " (format : " + fl + (cp.fr.viseTxt ? ", visé " + cp.fr.viseTxt + " par répétition" : "") + ")" : ""); }
    return def.name;
  });
  if (lib && !types.some(function (t) { return isReplaced(date, t); })) out.push("Séance libre hors salle en plus (" + lieuLabel(lib.lieu).toLowerCase() + ").");
  cardioOf(date).forEach(function (s) { out.push("Activité ajoutée : " + cardioTitle(s).toLowerCase() + "."); });
  return out.join("\n") || "Rien de prévu.";
}
function buildPrompt(kind, question) {
  var date = S.date, mon = mondayOfDate(date), blk = blockWeek(mon), w = blk ? weekOf(mon) : null, from = addDays(date, -21);
  var hist = valuesOf(D.seances).filter(function (s) { return s.date >= from && s.date <= date && (hasData(s) || s.checkin); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(summarize).join("\n") || "Aucune séance notée.";
  var pes = valuesOf(D.pesees).filter(function (p) { return p.date >= from && toNum(p.kg); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (p) { return fmtShort(p.date) + " " + p.kg + " kg"; }).join(", ") || "aucune";
  var avgs = [], sleeps = []; for (var m = mondayOfDate(addDays(date, -28)); m <= mon; m = addDays(m, 7)) { var a = weekAvg(m), sl = sleepWeek(m); if (a) avgs.push("semaine du " + fmtShort(m) + " " + fmt(a, 2) + " kg"); if (sl.n) sleeps.push("semaine du " + fmtShort(m) + " " + fmtHours(sl.avg) + " (" + sl.n + " nuit" + (sl.n > 1 ? "s" : "") + ")"); }
  var nuits = valuesOf(D.pesees).filter(function (p) { return p.date >= from && p.date <= date && parseHours(p.sommeil) !== null; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (p) { return fmtShort(p.date) + " " + fmtHours(parseHours(p.sommeil)); }).join(", ");
  var bilans = valuesOf(D.semaines).filter(function (b) { return (P && b.programme === P.id) || (b.lundi && b.lundi >= mondayOfDate(from)); }).map(function (b) { return (b.semaine ? "S" + b.semaine : "semaine du " + fmtShort(b.lundi)) + (b.version && P && P.versions[b.version] ? ", " + P.versions[b.version].label.toLowerCase() : "") + (b.fatigue ? ", fatigue " + b.fatigue + "/10" : "") + (b.sommeil ? ", sommeil " + b.sommeil + " h" : "") + (b.douleurs ? ", douleurs : " + b.douleurs : "") + (b.exercices ? ", exercices : " + b.exercices : ""); }).join("\n") || "aucun";
  var ask = kind === "jour" ? "Propose des ajustements concrets pour la séance prévue aujourd'hui (charges en kg, nombre de séries, RIR, exercice à remplacer si besoin), en tenant compte de mon check-in du jour, de mes dernières séances et de mon activité sportive récente."
    : kind === "semaine" ? "Fais le bilan de ma semaine " + (blk ? w : "du " + fmtShort(mon)) + " (progression des charges, forme, poids par rapport à l'objectif, douleurs) et propose 2 ou 3 ajustements précis pour la semaine suivante."
    : "Réponds à ma question : « " + question + " »";
  return "Tu es mon préparateur physique. Réponds en français, en me tutoyant.\n\nMON PROGRAMME ET SES RÈGLES\n" + (P ? (P.contexte || "") + (date > lastDay() ? "\nCe bloc est terminé : je fais des séances libres en attendant le suivant." : "") : "Pas de programme : je compose mes séances moi-même (séances libres) et je suis mon volume par muscle et ma force.") +
    "\n\nAUJOURD'HUI : " + fmtLong(date) + ", " + weekLabel(date).toLowerCase() + ".\nSéance prévue :\n" + planText(date) +
    "\n\nMES SÉANCES DES 21 DERNIERS JOURS (exercice : charge×reps@RIR ; pour les tractions, les dips et les pompes, la charge est le lest ; en séance libre, exercice au temps : durée et marge en secondes ; fractionné : valeur de chaque répétition saisie, FC de fin de répétition entre parenthèses)\n" + hist +
    "\n\nVOLUME DE LA SEMAINE " + (blk ? w : "du " + fmtShort(mon)) + " (séries de travail fractionnées, faites" + (blk ? " / prévues" : "") + ") : " + volText(mon) +
    "\nCHARGE DE LA SEMAINE (durée en min × difficulté sur 10) : " + chargeText(mon) + profilText() +
    "\n\nPESÉES : " + pes + "\nMOYENNES PAR SEMAINE (4 dernières semaines) : " + (avgs.join(", ") || "aucune") + "\nSOMMEIL PAR NUIT : " + (nuits || "non noté") + (sleeps.length ? "\nSOMMEIL MOYEN PAR SEMAINE : " + sleeps.join(", ") : "") + "\nBILANS DE SEMAINE :\n" + bilans + (function () { var fz = fatigueReasons(date); return fz.list.length ? "\nSIGNES DE FATIGUE (alerte de l'application) : " + fz.list.join(" ") : ""; })() +
    "\n\nMA DEMANDE\n" + ask +
    "\n\nFORMAT : 180 mots maximum, phrases courtes ou puces, chiffres précis. Reste dans la logique du programme sans le réécrire. S'il manque des données, dis lesquelles noter. Une séance arrêtée pour manque de temps ou imprévu, ou un exercice remplacé faute de matériel, ne signale pas une baisse de forme. Pas de diagnostic médical : une douleur qui dure ou augmente se montre à un professionnel de santé. Si tu proposes de modifier le programme, rappelle en une ligne que mon coach valide les changements.";
}
function profilText() {
  var b = fcBands(); if (!b) return "";
  return "\nPROFIL CARDIO : FC max " + b.mx.v + " bpm" + (b.mx.est ? " (estimée d'après l'âge)" : " (mesurée)") + ", récupération active < " + b.recupHi + " bpm, endurance fondamentale " + b.efLo + "–" + b.efHi + " bpm.";
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
        { label: "Restaurer", cls: "primary", run: function () { D = normalize(obj.data); migrateCardio(); freezeAll(true); persistNow(); setActive(); S.date = initialDate(); S.mon = mondayOfDate(S.date); S.view = "jour"; render(); toast("Sauvegarde restaurée."); } },
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
  S.view = b.dataset.view; if (S.view === "semaine") S.mon = mondayOfDate(S.date);
  render(); window.scrollTo(0, 0);
});
document.getElementById("masthead").addEventListener("click", function (ev) {
  if (ev.target.closest("[data-act='menu']")) { openMenu(); return; }
  var b = ev.target.closest("[data-act='gotoweek']"); if (!b) return;
  S.mon = mondayOf(Number(b.dataset.w)); S.view = "semaine"; render(); window.scrollTo(0, 0);
});
function edInput(el) {
  if (!S.ed) return;
  var d = S.ed.d, path = el.dataset.path, v = el.value.trim();
  var num = /(^semaines$|\.s$|\.duree$|\.fr\.(effort|recup|reps|series|entre|echauf|calme|vise)$|^run\.(longest|weeks)$)/.test(path);
  setPath(d, path, num ? (v === "" ? null : toNum(v) !== null ? toNum(v) : v) : v);
  var m = path.match(/^seances\.(\d+)\.ex\.(\d+)\.(s|r|rir|rest)$/);
  if (m) { var x = d.seances[Number(m[1])].ex[Number(m[2])]; if (x) x.perso = true; }
  var mp = path.match(/^seances\.(\d+)\.plan\.(\d+)\./);
  if (mp) { var pe = d.seances[Number(mp[1])].plan[Number(mp[2])]; if (pe) pe.perso = true; }
  persist();
}
function edLive() {
  if (!S.ed || !S.ed.sess) return;
  var d = S.ed.d, s = sessByU(d, S.ed.sess); if (!s) return;
  var a = app.querySelector('[data-edlive="sess"]'); if (a && s.kind === "muscu") a.innerHTML = sessNote(d, s);
  var c = app.querySelector('[data-edlive="cardio"]'); if (c && s.kind === "cardio") c.innerHTML = "<b>" + esc(cardioLine(s)) + "</b>";
}
function docFor(col, id) {
  if (col === "seances") { var i = id.lastIndexOf("_"); return seance(id.slice(0, i), id.slice(i + 1), true); }
  if (col === "semaines") {
    if (id.indexOf("L-") === 0) { if (!D.semaines[id]) D.semaines[id] = { lundi: id.slice(2) }; return D.semaines[id]; }
    var w = Number(id.split("-S").pop()); return weekDoc(w, true);
  }
  if (col === "pesees") { if (!D.pesees[id]) D.pesees[id] = { date: id }; return D.pesees[id]; }
  if (col === "profil") { if (!D.profil) D.profil = {}; return D.profil; }
  return null;
}
function onAct(ev) {
  var b = ev.target.closest("[data-act]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  var a = b.dataset.act, doc;
  switch (a) {
    case "goto": if (b.classList.contains("day") && Date.now() - S.swipeAt < 400) break; S.date = b.dataset.date; S.view = "jour"; S.prompt = ""; render(); if (b.classList.contains("wrow") || b.classList.contains("log-item")) window.scrollTo(0, 0); break;
    case "today": S.date = initialDate(); S.stripMon = null; S.prompt = ""; render(); break;
    case "stripweek": stripWeek(Number(b.dataset.d)); break;
    case "menu": openMenu(); break;
    case "smodopen": case "smodundo": case "smodprog": case "smodmode": case "smodautre": case "smodpret": case "smodgo": smodAct(b); break;
    case "view": D.astuceVue = true; persist(); if (b.dataset.v === "reglages") { openMenu(b.dataset.r); break; } S.view = b.dataset.v; render(); window.scrollTo(0, 0); break;
    case "week": S.mon = addDays(S.mon, 7 * Number(b.dataset.d)); render(); break;
    case "sansprog": D.sansProgramme = true; persistNow(); S.date = todayStr(); S.mon = mondayOfDate(S.date); S.view = "jour"; render(); window.scrollTo(0, 0); break;
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
    case "rempk": setRemp(b.dataset.id, b.dataset.ex, b.dataset.k); break;
    case "rempchange": setRemp(b.dataset.id, b.dataset.ex, null); break;
    case "rempmenu":
      doc = docFor("seances", b.dataset.id);
      var rex = progEx(doc, b.dataset.ex), pdef = (P && P.sessions[doc.type]) || {}, pe = (pdef.ex || []).filter(function (x) { return x.id === b.dataset.ex; })[0] || (doc.plan && doc.plan.ex.filter(function (x) { return x.id === b.dataset.ex; })[0]);
      rempMenu(b.dataset.id, b.dataset.ex, { id: b.dataset.ex, name: rex ? rex.name : b.dataset.ex, cat: pe ? exCat(pe) : "", mu: pe ? pe.mu : null, alt: pe ? pe.alt : [] }); break;
    case "modopen": doc = docFor("seances", b.dataset.id); setPath(doc, "mods." + b.dataset.ex, { statut: "remplace" }); persist(); render(); break;
    case "modclose": doc = docFor("seances", b.dataset.id); setPath(doc, "mods." + b.dataset.ex, null); setPath(doc, "remp." + b.dataset.ex, null); persist(); render(); break;
    case "arretopen": doc = docFor("seances", b.dataset.id); doc.arret = { ouvert: true }; persist(); render(); break;
    case "arretclose": doc = docFor("seances", b.dataset.id); delete doc.arret; persist(); render(); break;
    case "librestart": libreDialog(S.date, b.dataset.t); break;
    case "cardiostart": cardioDialog(S.date, null); break;
    case "cardioedit": cardioDialog(S.date, b.dataset.id); break;
    case "fmtmode": doc = docFor("seances", b.dataset.id); setPath(doc, "fmt.mode", b.dataset.v); persist(); render(); break;
    case "addrep": doc = docFor("seances", b.dataset.id); setPath(doc, "nRep." + b.dataset.i, Number(b.dataset.n)); persist(); render(); break;
    case "addser": doc = docFor("seances", b.dataset.id); doc.nSer = Number(b.dataset.n); persist(); render(); break;
    case "progvue": D.vue.prog = b.dataset.v; persist(); render(); break;
    case "fracsel": D.vue.frac = b.dataset.k; persist(); render(); break;
    case "sporttog":
      var sv = D.vue.sports || {}, onl = sportsOn();
      if (sv[b.dataset.v] !== false && onl.length <= 1) { toast("Garde au moins une discipline."); break; }
      sv[b.dataset.v] = sv[b.dataset.v] === false; D.vue.sports = sv; persist(); render(); break;
    case "omstog": D.vue.oms = b.dataset.v === "1"; persist(); render(); break;
    case "libreedit": libreDialog(S.date, null); break;
    case "libreadd": libreMenu(b.dataset.id); break;
    case "librerm": libreRemove(b.dataset.id, b.dataset.u); break;
    case "fillvals":
      doc = docFor("seances", b.dataset.id);
      b.dataset.v.split(";").forEach(function (kv) { var p = kv.split("="); if (p[1] !== "") setPath(doc, b.dataset.base + p[0], Number(p[1])); });
      persist(); render(); break;
    case "courbe":
      var sel = selectedCurves(), ck = b.dataset.k, ci = sel.indexOf(ck);
      if (ci >= 0) sel.splice(ci, 1);
      else if (sel.length >= 4) { toast("4 courbes au plus : retire d'abord une courbe."); break; }
      else sel.push(ck);
      D.vue.courbes = sel; persist(); render(); break;
    case "courbemode": D.vue.mode = b.dataset.v; persist(); render(); break;
    case "volvue": D.vue[b.dataset.k] = b.dataset.v; persist(); render(); break;
    case "ask": ask(b.dataset.q); break;
    case "ed": edAct(b); break;
    case "alerta": applyAlertA(b.dataset.id, b.dataset.v); break;
    case "alertplan": doc = docFor("seances", b.dataset.id); if (b.dataset.v === "garder") doc.alerteA = "garder"; else doc.adapte = { duree: Number(b.dataset.v), raison: "A" }; persist(); render(); break;
    case "unadapt": doc = docFor("seances", b.dataset.id); delete doc.adapte; delete doc.alerteA; if (D.vue.fatigueOk) delete D.vue.fatigueOk[doc.date]; persist(); render(); break;
    case "fatigue": applyFatigue(S.date, b.dataset.v); break;
    case "alertpref": D.vue["alerte" + b.dataset.k] = b.dataset.v === "1"; persist(); render(); break;
    case "alertsens": D.vue.alerteSens = b.dataset.v; persist(); render(); break;
    case "runadj": runAdjust(b.dataset.id); break;
    case "edstartrun": var nr = newDraft(); nr.type = "course"; nr.decharge = false; nr.run = runDefaults(); var lr = lastRef(); if (lr) { nr.run.refDist = lr.dist; nr.run.refTime = lr.t; } nr.nom = "Préparation " + DISTL[nr.run.dist]; regenRun(nr); saveDraft(nr); edOpen(nr, 1); break;
    case "compedit": var Cc = compProg(); if (Cc && Cc.src) { var cd = valuesOf(D.brouillons || {}).filter(function (x) { return x.pid === Cc.id; })[0]; if (!cd) { cd = clone(Cc.src); cd.pid = Cc.id; cd.id = "d" + rndId(6, "abcdefghijkmnpqrstuvwxyz23456789"); saveDraft(cd); } edOpen(cd, 2); } break;
    case "comprm": dialog("Retirer le complément ?", '<p class="small">Ses séances à venir disparaissent d\'Aujourd\'hui. Les séances déjà notées sont conservées.</p>', [{ label: "Retirer", cls: "danger", run: function () { freezeAll(false); D.complement = null; persistNow(); render(); } }, { label: "Annuler", cls: "primary" }]); break;
    case "edstart": edStart(); break;
    case "edresume": if (D.brouillons && D.brouillons[b.dataset.id]) edOpen(D.brouillons[b.dataset.id], 1); break;
    case "edrm":
      var dr = D.brouillons && D.brouillons[b.dataset.id]; if (!dr) break;
      dialog("Supprimer « " + (dr.nom || "ce brouillon") + " » ?", '<p class="small">' + (dr.pid ? "Les modifications en cours sont abandonnées ; le programme installé ne change pas." : "Le brouillon est supprimé de ce téléphone.") + "</p>", [
        { label: "Supprimer", cls: "danger", run: function () { delete D.brouillons[dr.id]; persist(); render(); } }, { label: "Annuler", cls: "primary" }]);
      break;
    case "edcopy": if (P) { var cd = draftFrom(P); saveDraft(cd); edOpen(cd, 1); } break;
    case "edmodify":
      if (!P || !P.src) break;
      var md = valuesOf(D.brouillons || {}).filter(function (x) { return x.pid === P.id; })[0];
      if (!md) { md = clone(P.src); md.pid = P.id; md.id = "d" + rndId(6, "abcdefghijkmnpqrstuvwxyz23456789"); saveDraft(md); }
      edOpen(md, 2); break;
    case "mylink": copyText(location.origin + location.pathname + "#p=0." + bytesToB64u(new TextEncoder().encode(JSON.stringify(P)))).then(function (ok) { toast(ok ? "Lien copié. Ne le partage pas : il contient ton programme." : "Copie impossible sur ce navigateur."); }); break;
    case "objpick": S.objDone = ""; S.objPend = P && P.src && b.dataset.v !== P.src.obj ? b.dataset.v : null; render(); break;
    case "objfrom": S.objFrom = Number(b.dataset.v); render(); break;
    case "objcancel": S.objPend = null; render(); break;
    case "objgo": if (S.objPend) objApply(); break;
    case "export": exportData(); break;
    case "copylink": copyText(D.liens[P.id]).then(function (ok) { toast(ok ? "Lien copié." : "Copie impossible sur ce navigateur."); }); break;
    case "paste-install": var ta = document.getElementById("code-in"); tryInstallFromText(ta ? ta.value : ""); break;
    case "switchprog": D.actif = b.dataset.id; persistNow(); setActive(); S.date = initialDate(); S.mon = mondayOfDate(S.date); S.view = "jour"; render(); break;
    case "wipe":
      dialog("Effacer toutes les données ?", '<p class="small">Le programme, les séances, les pesées et les bilans de ce téléphone seront supprimés. Cette action est définitive.</p>', [
        { label: "Effacer", cls: "danger", run: function () { D = emptyData(); try { localStorage.removeItem(KEY); } catch (err) {} setActive(); S.view = "jour"; render(); toast("Données effacées."); } },
        { label: "Annuler", cls: "primary" }]);
      break;
    case "update": if (swReg && swReg.waiting) swReg.waiting.postMessage("skipWaiting"); break;
  }
}
app.addEventListener("click", onAct);

/* Bande des jours : glisser vers la gauche ou la droite change de semaine */
function stripWeek(d) { S.stripMon = addDays(S.stripMon || mondayOfDate(S.date), 7 * d); S.slide = d > 0 ? "next" : "prev"; render(); }
var swipe = null;
app.addEventListener("pointerdown", function (ev) { var el = ev.target.closest(".daystrip"); swipe = el ? { x: ev.clientX, y: ev.clientY } : null; });
app.addEventListener("pointercancel", function () { swipe = null; });
app.addEventListener("pointerup", function (ev) {
  if (!swipe) return;
  var dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { S.swipeAt = Date.now(); stripWeek(dx < 0 ? 1 : -1); }
});
function onChange(ev) {
  var el = ev.target;
  if (el.dataset.act === "add" && el.value === LIBRE) { el.value = ""; libreDialog(S.date, null); return; }
  if (el.dataset.act === "add" && el.value === "CARDIO") { el.value = ""; cardioDialog(S.date, null); return; }
  if (el.dataset.col === "profil" || (el.dataset.path && /^fmt\./.test(el.dataset.path))) { if (drawerEl().contains(el)) { S.menuDirty = true; S.noMenuSync = true; } render(); return; }
  if (el.dataset.act === "add" && el.value) { var s = seance(S.date, el.value, true); s.ajoutee = true; persist(); render(); return; }
  if (el.dataset.act === "import-file" && el.files && el.files[0]) { importFile(el.files[0]); el.value = ""; return; }
  if (el.dataset.act === "edsel" && S.ed) {
    var dd = S.ed.d;
    if (el.dataset.op === "debut") dd.debut = el.value;
    else if (el.dataset.op === "dayadd" && el.value) dd.jours[Number(el.dataset.d)].push(el.value);
    else if (el.dataset.op === "msem") { dd.semaines = Number(el.value); regenRun(dd); }
    saveDraft(dd); render(); return;
  }
  if (el.dataset.col === "ed" && S.ed) {
    if (/^run\./.test(el.dataset.path)) { var rr = S.ed.d.run; if (el.dataset.path === "run.libre") { rr.obj = el.value.trim() ? "libre" : rr.obj === "libre" ? RUNOBJ[rr.dist][0].k : rr.obj; rr.garder = false; } if (el.dataset.path === "run.date") rr.weeks = ""; rr.force = false; regenRun(S.ed.d); saveDraft(S.ed.d); render(); return; }
    saveDraft(S.ed.d); edLive(); return;
  }
  if (el.dataset.path && ((/\.nom$/.test(el.dataset.path) && !/^smod\./.test(el.dataset.path)) || el.dataset.path === "chrono.temps" || (el.dataset.path === "distanceTest" && el.dataset.col === "seances"))) render();
}
app.addEventListener("change", onChange);

var NUMERIC = /\.(c|r|rir|t|m)$|^kg$|^duree$|^smod\.par\.duree$|^distance$|^distanceTest$|^combats$|^footing$|^sommeil$|^tests\.|^mensu\.|^age$|^fcmax$|^fcrepos$|^deniv$|^fcMoy$|^fcMax$|^puiss$|^distTot$|^reps\.\d+\.\d+\.(d|p|v|fc)$|^fmt\.(effort|recup|reps|series|entre|echauf|calme)$/;
function onInput(ev) {
  var el = ev.target; if (!el.dataset || !el.dataset.path) return;
  if (el.dataset.col === "ed") { edInput(el); return; }
  var doc = docFor(el.dataset.col, el.dataset.id); if (!doc) return;
  var v = el.value.trim();
  if (el.dataset.col === "pesees" && el.dataset.path === "sommeil") setPath(doc, "sommeil", v === "" ? null : parseHours(v) !== null ? parseHours(v) : v);
  else setPath(doc, el.dataset.path, NUMERIC.test(el.dataset.path) ? (v === "" ? null : (toNum(v) !== null ? toNum(v) : v)) : v);
  persist();
  if (el.dataset.col === "pesees") {
    var mon0 = mondayOfDate(el.dataset.id), sw0 = sleepWeek(mon0), a0 = app.querySelector('[data-avg="kg"]'), a1 = app.querySelector('[data-avg="sommeil"]'), a2 = app.querySelector('[data-avg="sommeil-n"]');
    if (a0) a0.textContent = fmt(weekAvg(mon0), 2); if (a1) a1.textContent = fmtHours(sw0.avg); if (a2) a2.textContent = sleepLabel(sw0);
  }
  if (el.dataset.col === "seances") liveUpdate(el.dataset.id);
}
app.addEventListener("input", onInput);
["click", "change", "input"].forEach(function (t) { document.getElementById("drawer").addEventListener(t, t === "click" ? onAct : t === "change" ? onChange : onInput); });


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
var migrated = migrateCardio();
if (freezeAll(true) || migrated) persistNow();
render();
var startCode = extractCode(location.hash);
if (startCode) {
  var link = location.href;
  history.replaceState(null, "", location.pathname + location.search);
  decodeProgram(startCode).then(function (p) { confirmInstall(p, link); }, function (err) { toast(err.message); });
}
})();
