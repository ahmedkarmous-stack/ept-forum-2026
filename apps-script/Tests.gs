/**
 * Tests (à exécuter depuis l'éditeur Apps Script). Lancer runAllTests().
 * Les données de test utilisent le préfixe TEST- et sont supprimées à la fin.
 */

function runAllTests() {
  testTallyPayloadParsing();
  testDuplicateWebhook();
  testVerifyStates();
  testImportParser();
  testSchoolNormalization();
  testDelete();
  Logger.log("OK - tests locaux passés. Lancer ensuite testConcurrentCheckinHttp() (nécessite le déploiement).");
}

function assert_(cond, msg) { if (!cond) throw new Error("ECHEC : " + msg); Logger.log("ok : " + msg); }

function fakePayload_(id, email) {
  return {
    eventType: "FORM_RESPONSE",
    createdAt: "2026-10-21T22:20:48.029Z",
    data: {
      responseId: id,
      fields: [
        { label: "First Name", type: "INPUT_TEXT", value: "Test" },
        { label: "Last Name", type: "INPUT_TEXT", value: "Participant" },
        { label: "Email Address", type: "INPUT_EMAIL", value: email || "" },
        { label: "Phone Number (Optional)", type: "INPUT_PHONE_NUMBER", value: "+21612345678" },
        { label: "What is your profession?", type: "MULTIPLE_CHOICE", value: ["id1"],
          options: [{ id: "id1", text: "Student" }, { id: "id2", text: "Engineer" }] },
        { label: "School Name", type: "INPUT_TEXT", value: "EPT" },
        { label: "Organisation Name", type: "INPUT_TEXT", value: "-" },
        { label: "Do you intend to attend a workshop?", type: "MULTIPLE_CHOICE", value: ["y"],
          options: [{ id: "y", text: "Yes" }, { id: "n", text: "No" }] }
      ]
    }
  };
}

function deleteTestRows_() {
  const sh = getSheet_();
  for (let r = sh.getLastRow(); r >= 2; r--) {
    if (String(sh.getRange(r, 1).getValue()).indexOf("EPT26-TEST-") === 0) sh.deleteRow(r);
  }
}

function recFromPayload_(p) {
  const rec = { code: "EPT26-" + p.data.responseId, created_at: p.createdAt };
  p.data.fields.forEach(function (f) { const k = fieldKey_(f.label); if (k) rec[k] = clean_(valeur(f)); });
  return rec;
}

function testTallyPayloadParsing() {
  const rec = recFromPayload_(fakePayload_("TEST-parse"));
  assert_(rec.code === "EPT26-TEST-parse", "code = EPT26-<responseId>");
  assert_(rec.profession === "Student", "option id -> texte (profession)");
  assert_(rec.workshop === "Yes", "option id -> texte (workshop)");
  assert_(rec.organisation === "", "'-' -> vide (organisation)");
  assert_(rec.phone === "+21612345678", "téléphone conservé");
}

function testDuplicateWebhook() {
  deleteTestRows_();
  const rec = recFromPayload_(fakePayload_("TEST-dup"));
  assert_(addRegistration_(rec) === true, "1er webhook : créé");
  assert_(addRegistration_(rec) === false, "2e webhook identique : ignoré");
  const n = listAll_().filter(function (o) { return o.code === rec.code; }).length;
  assert_(n === 1, "une seule ligne en base");
  deleteTestRows_();
}

function testVerifyStates() {
  deleteTestRows_();
  addRegistration_(recFromPayload_(fakePayload_("TEST-states")));
  const code = "EPT26-TEST-states";

  assert_(verify_(code).status === "valid", "verify : valid");
  assert_(verify_(code).status === "valid", "verify ne modifie rien");
  assert_(verify_("EPT26-NOPE").status === "unknown", "verify : unknown");

  const c1 = checkin_(code, "test");
  assert_(c1.status === "checked_in", "1er check-in : checked_in");
  const c2 = checkin_(code, "test");
  assert_(c2.status === "already_checked_in", "2e check-in : already_checked_in");
  assert_(c2.checked_in_at === c1.checked_in_at, "heure du 1er check-in conservée");
  assert_(verify_(code).status === "already_checked_in", "verify : already_checked_in");
  assert_(checkin_("EPT26-NOPE", "t").status === "unknown", "check-in code inconnu rejeté");
  deleteTestRows_();
}

function testImportParser() {
  const html = '<table>' + ligne("First Name", "Aya") + ligne("Last Name", "B & C") +
    ligne("Email Address", "aya@x.tn") + ligne("What is your profession?", "Engineer") +
    ligne("Organisation Name", "-") + ligne("Code QR", "EPT26-TEST-imp") +
    ligne("Date", "2026-10-21T22:20:48.029Z") + '</table>';
  const rec = parseRegistrationMail_(html);
  assert_(rec && rec.code === "EPT26-TEST-imp", "import : code extrait");
  assert_(rec.last_name === "B & C", "import : entités HTML décodées");
  assert_(rec.organisation === "", "import : '-' -> vide");
  assert_(parseRegistrationMail_("<table></table>") === null, "import : mail sans code ignoré");
}

/**
 * Deux check-in simultanés du même QR via HTTP (vrai parallélisme).
 * Prérequis : application web déployée. Attendu : 1 "checked_in" + 1 "already_checked_in".
 */
function testConcurrentCheckinHttp() {
  deleteTestRows_();
  addRegistration_(recFromPayload_(fakePayload_("TEST-race")));
  const token = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  const url = ScriptApp.getService().getUrl();
  const req = {
    url: url, method: "post", contentType: "text/plain", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ action: "checkin", code: "EPT26-TEST-race", token: token, by: "race" })
  };
  const res = UrlFetchApp.fetchAll([req, req, req]).map(function (r) {
    return JSON.parse(r.getContentText()).status;
  });
  Logger.log(JSON.stringify(res));
  const ok = res.filter(function (s) { return s === "checked_in"; }).length;
  assert_(ok === 1, "exactement un check-in réussi sur 3 simultanés");
  deleteTestRows_();
}

function testSchoolNormalization() {
  ["ept", "Ept", "EPT", " e.p.t ", "Ecole Polytechnique de Tunisie", "École polytechnique de Tunisie", "polytechnique tunis"]
    .forEach(function (s) { assert_(canonicalSchool_(s) === "EPT", "école '" + s + "' -> EPT"); });
  assert_(canonicalSchool_("insat") === "INSAT", "insat -> INSAT");
  assert_(canonicalSchool_("Sup'Com") === "SUP'COM" && canonicalSchool_("supcom") === "SUP'COM", "supcom -> SUP'COM");
  assert_(canonicalSchool_("-") === "" && canonicalSchool_("") === "", "'-' ou vide -> vide");
  assert_(canonicalSchool_("ecole sup de commerce") === canonicalSchool_("ECOLE SUP DE COMMERCE"), "école inconnue : même résultat quelle que soit la casse");
}

function testDelete() {
  deleteTestRows_();
  addRegistration_(recFromPayload_(fakePayload_("TEST-del")));
  assert_(delete_("EPT26-TEST-del").status === "deleted", "delete : supprimé");
  assert_(verify_("EPT26-TEST-del").status === "unknown", "delete : plus en base");
  assert_(delete_("EPT26-TEST-del").status === "unknown", "delete : 2e appel -> unknown");
}
