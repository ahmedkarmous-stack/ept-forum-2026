/**
 * Import ponctuel des inscriptions déjà reçues par mail
 * (sujet "Nouvelle inscription : ..."). Idempotent : dédoublonné sur le "Code QR".
 *
 * Exécuter importFromGmail() depuis l'éditeur. Relançable sans risque.
 */

function importFromGmail() {
  const recs = [];
  let start = 0;
  const PAGE = 100;
  let threads;
  do {
    threads = GmailApp.search('subject:"Nouvelle inscription :"', start, PAGE);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        const rec = parseRegistrationMail_(m.getBody());
        if (rec) recs.push(rec);
        else Logger.log("Mail ignoré (pas de Code QR) : " + m.getSubject());
      });
    });
    start += PAGE;
  } while (threads.length === PAGE);

  const res = addRegistrationsBulk_(recs);
  Logger.log("Mails analysés : " + recs.length + " | ajoutés : " + res.added + " | déjà présents : " + res.skipped);
}

/** Parse le tableau HTML (paires label/valeur). Retourne null sans Code QR. */
function parseRegistrationMail_(html) {
  const pairs = {};
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const label = htmlText_(m[1]);
    const val = htmlText_(m[2]);
    if (label) pairs[label] = val;
  }
  const code = pairs["Code QR"];
  if (!code || code.indexOf("EPT26-") !== 0) return null;

  const rec = { code: code, created_at: pairs["Date"] || "" };
  Object.keys(pairs).forEach(function (label) {
    const k = fieldKey_(label);
    if (k) rec[k] = clean_(pairs[label]);
  });
  return rec;
}

function htmlText_(s) {
  return s.replace(/<[^>]*>/g, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
          .trim();
}
