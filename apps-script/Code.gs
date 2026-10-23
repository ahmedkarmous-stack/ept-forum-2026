/**
 * EPT Forum Enterprises 2026 - Backend (Google Apps Script)
 *
 *  - doPost : webhook Tally (inscription)  OU  API check-in (JSON {action:"checkin", code, token})
 *  - doGet  : API lecture (verify / list / stats)
 *
 * Base de données : feuille "Inscriptions" (colonne A = code, clé unique).
 * Secret : propriété de script API_TOKEN (voir setup()).
 */

const ADMIN_EMAIL = "forumept2026@ept.ucar.tn";
const SHEET_NAME = "Inscriptions";
const HEADERS = [
  "code", "created_at", "first_name", "last_name", "email", "phone",
  "profession", "school", "organisation", "workshop",
  "checked_in", "checked_in_at", "checked_in_by"
];

/* ------------------------------------------------------------------ */
/*  Installation                                                       */
/* ------------------------------------------------------------------ */

/** À exécuter une fois depuis l'éditeur. Crée la feuille et le token. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  // Projet autonome (non lié à un Sheet) : on crée le Sheet et on mémorise son id.
  if (!SpreadsheetApp.getActiveSpreadsheet() && !props.getProperty("SHEET_ID")) {
    props.setProperty("SHEET_ID", SpreadsheetApp.create("EPT Forum - Inscriptions").getId());
  }
  const sh = getSheet_();
  if (!props.getProperty("API_TOKEN")) {
    props.setProperty("API_TOKEN", Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8));
  }
  Logger.log("Feuille : " + sh.getParent().getUrl());
  Logger.log("TOKEN (à saisir dans le dashboard / scanner) : " + props.getProperty("API_TOKEN"));
}

function getSheet_() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) throw new Error("Script non lié à un Sheet : définir la propriété SHEET_ID.");
    ss = SpreadsheetApp.openById(id);
  }
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  // Format texte partout : évite que Sheets convertisse dates / téléphones / booléens.
  sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat("@");
  return sh;
}

/* ------------------------------------------------------------------ */
/*  Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function valeur(f) {
  if (f.options && Array.isArray(f.value)) {
    return f.value.map(function (id) {
      const o = f.options.find(function (x) { return x.id === id; });
      return o ? o.text : id;
    }).join(", ");
  }
  if (Array.isArray(f.value)) return f.value.join(", ");
  return (f.value === null || f.value === undefined || f.value === "") ? "-" : String(f.value);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ligne(label, val) {
  return '<tr><td style="padding:6px 10px;border:1px solid #ddd;background:#f5f5f5"><b>' +
         esc(label) + '</b></td><td style="padding:6px 10px;border:1px solid #ddd">' +
         esc(val) + '</td></tr>';
}

/** Associe un label de formulaire à une colonne (tolérant aux petites variations). */
function fieldKey_(label) {
  const l = String(label).toLowerCase();
  if (l.indexOf("first name") >= 0) return "first_name";
  if (l.indexOf("last name") >= 0) return "last_name";
  if (l.indexOf("email") >= 0) return "email";
  if (l.indexOf("phone") >= 0) return "phone";
  if (l.indexOf("profession") >= 0) return "profession";
  if (l.indexOf("school") >= 0) return "school";
  if (l.indexOf("organisation") >= 0 || l.indexOf("organization") >= 0) return "organisation";
  if (l.indexOf("workshop") >= 0) return "workshop";
  return null;
}

function clean_(v) {
  v = (v === null || v === undefined) ? "" : String(v).trim();
  return v === "-" ? "" : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tokenOk_(t) {
  const expected = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  if (!expected || !t) return false;
  t = String(t);
  if (t.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function rowToObj_(r) {
  const o = {};
  HEADERS.forEach(function (h, i) { o[h] = r[i] === undefined ? "" : String(r[i]); });
  o.checked_in = o.checked_in === "TRUE";
  return o;
}

function publicPerson_(o) {
  return {
    code: o.code, first_name: o.first_name, last_name: o.last_name,
    profession: o.profession, workshop: o.workshop, school: o.school, organisation: o.organisation
  };
}

/** Index de ligne (1-based, feuille) d'un code, ou -1. */
function findRow_(sh, code) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const codes = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) if (String(codes[i][0]) === code) return i + 2;
  return -1;
}

/* ------------------------------------------------------------------ */
/*  Écriture des inscriptions (dédoublonnée sur le code)               */
/* ------------------------------------------------------------------ */

/**
 * rec : {code, created_at, first_name, ... workshop}
 * @return {boolean} true si créé, false si le code existait déjà.
 */
function addRegistration_(rec) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    if (findRow_(sh, rec.code) !== -1) return false;
    const row = HEADERS.map(function (h) {
      if (h === "checked_in") return "FALSE";
      return rec[h] === undefined ? "" : String(rec[h]);
    });
    sh.getRange(sh.getLastRow() + 1, 1, 1, HEADERS.length).setNumberFormat("@").setValues([row]);
    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

/** Importe plusieurs inscriptions d'un coup (idempotent). @return {added, skipped} */
function addRegistrationsBulk_(recs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    const known = {};
    if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { known[String(r[0])] = true; });
    const rows = [];
    recs.forEach(function (rec) {
      if (known[rec.code]) return;
      known[rec.code] = true;
      rows.push(HEADERS.map(function (h) {
        if (h === "checked_in") return "FALSE";
        return rec[h] === undefined ? "" : String(rec[h]);
      }));
    });
    if (rows.length) sh.getRange(last + 1, 1, rows.length, HEADERS.length).setNumberFormat("@").setValues(rows);
    SpreadsheetApp.flush();
    return { added: rows.length, skipped: recs.length - rows.length };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  POST : webhook Tally ou check-in                                   */
/* ------------------------------------------------------------------ */

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "bad_json" });
  }

  // --- API (scanner) ---
  if (payload && payload.action) {
    if (!tokenOk_(payload.token)) return json_({ ok: false, error: "unauthorized" });
    if (payload.action === "checkin") return json_(checkin_(String(payload.code || "").trim(), payload.by || ""));
    return json_({ ok: false, error: "unknown_action" });
  }

  // --- Webhook Tally ---
  return handleTally_(payload);
}

function handleTally_(payload) {
  const fields = payload.data.fields;
  const responseId = payload.data.responseId || Utilities.getUuid();
  const code = "EPT26-" + responseId;

  const rec = { code: code, created_at: payload.createdAt || new Date().toISOString() };
  fields.forEach(function (f) {
    const k = fieldKey_(f.label);
    if (k) rec[k] = clean_(valeur(f));
  });

  const created = addRegistration_(rec);
  if (!created) return ContentService.createTextOutput("duplicate"); // webhook renvoyé : pas de 2e mail

  try {
    sendMails_(fields, payload, code, rec);
  } catch (err) {
    // L'inscription est enregistrée ; l'échec d'un mail ne doit pas faire renvoyer le webhook.
    console.error("Envoi mail échoué : " + err);
  }
  return ContentService.createTextOutput("ok");
}

function sendMails_(fields, payload, code, rec) {
  const email = rec.email || "";
  const prenom = rec.first_name || "";
  const nom = rec.last_name || "";
  const workshop = rec.workshop || "-";

  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=" +
                encodeURIComponent(code);
  const qrBlob = UrlFetchApp.fetch(qrUrl).getBlob().setName("qrcode-" + code + ".png");

  // 1) Mail au participant
  if (email) {
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">' +
      '<p>Bonjour ' + esc(prenom) + ' ' + esc(nom) + ',</p>' +
      '<p>Votre inscription à l\'<b>EPT Forum Enterprises</b> est confirmée.</p>' +
      '<p>Présentez ce QR code à l\'entrée pour votre check-in :</p>' +
      '<p style="text-align:center"><img src="cid:qrcode" width="260" height="260" alt="QR code"></p>' +
      '<p style="text-align:center;color:#666;font-size:12px">Code : ' + esc(code) + '</p>' +
      '<p>Atelier : <b>' + esc(workshop) + '</b></p>' +
      '<p>À bientôt !<br>L\'équipe EPT Forum</p></div>';

    GmailApp.sendEmail(email, "EPT Forum Enterprises - Votre QR code d'accès", "", {
      name: "EPT Forum",
      htmlBody: html,
      inlineImages: { qrcode: qrBlob },
      attachments: [qrBlob]
    });
  }

  // 2) Mail récapitulatif pour l'organisation (format inchangé : sert aussi à l'import Gmail)
  const lignes = fields.map(function (f) { return ligne(f.label, valeur(f)); }).join("");
  const htmlAdmin =
    '<div style="font-family:Arial,sans-serif;max-width:560px">' +
    '<h3>Nouvelle inscription</h3>' +
    '<table style="border-collapse:collapse;width:100%">' +
    lignes +
    ligne("Code QR", code) +
    ligne("Date", payload.createdAt || new Date().toISOString()) +
    '</table>' +
    '<p><img src="cid:qrcode" width="160" height="160" alt="QR code"></p></div>';

  GmailApp.sendEmail(ADMIN_EMAIL, "Nouvelle inscription : " + prenom + " " + nom, "", {
    name: "EPT Forum - Inscriptions",
    replyTo: email || ADMIN_EMAIL,
    htmlBody: htmlAdmin,
    inlineImages: { qrcode: qrBlob }
  });
}

/* ------------------------------------------------------------------ */
/*  GET : API de lecture                                               */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!tokenOk_(p.token)) return json_({ ok: false, error: "unauthorized" });

  try {
    switch (p.action) {
      case "ping":   return json_({ ok: true });
      case "verify": return json_(Object.assign({ ok: true }, verify_(String(p.code || "").trim())));
      case "list":   return json_({ ok: true, items: listAll_() });
      case "stats":  return json_({ ok: true, stats: stats_(listAll_()) });
      default:       return json_({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function listAll_() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues().map(rowToObj_);
}

/** Ne modifie rien. */
function verify_(code) {
  if (!code) return { status: "unknown" };
  const sh = getSheet_();
  const row = findRow_(sh, code);
  if (row === -1) return { status: "unknown" };
  const o = rowToObj_(sh.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  if (o.checked_in) return { status: "already_checked_in", person: publicPerson_(o), checked_in_at: o.checked_in_at };
  return { status: "valid", person: publicPerson_(o) };
}

/** Check-in atomique (verrou global). */
function checkin_(code, by) {
  if (!code) return { ok: true, status: "unknown" };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    const row = findRow_(sh, code);
    if (row === -1) return { ok: true, status: "unknown" };
    const o = rowToObj_(sh.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
    if (o.checked_in) {
      return { ok: true, status: "already_checked_in", person: publicPerson_(o), checked_in_at: o.checked_in_at };
    }
    const now = new Date().toISOString();
    const iCheck = HEADERS.indexOf("checked_in") + 1;
    sh.getRange(row, iCheck, 1, 3).setValues([["TRUE", now, String(by || "")]]);
    SpreadsheetApp.flush();
    return { ok: true, status: "checked_in", person: publicPerson_(o), checked_in_at: now };
  } finally {
    lock.releaseLock();
  }
}

function stats_(items) {
  const s = {
    total: items.length, checked_in: 0, rate: 0,
    by_profession: {}, workshop: { Yes: 0, No: 0, Other: 0 },
    by_school: {}, checked_by_profession: {}
  };
  items.forEach(function (o) {
    const prof = o.profession || "Other";
    s.by_profession[prof] = (s.by_profession[prof] || 0) + 1;
    if (o.checked_in) {
      s.checked_in++;
      s.checked_by_profession[prof] = (s.checked_by_profession[prof] || 0) + 1;
    }
    if (o.workshop === "Yes") s.workshop.Yes++; else if (o.workshop === "No") s.workshop.No++; else s.workshop.Other++;
    if (o.school) s.by_school[o.school] = (s.by_school[o.school] || 0) + 1;
  });
  s.rate = s.total ? Math.round((s.checked_in / s.total) * 1000) / 10 : 0;
  return s;
}
