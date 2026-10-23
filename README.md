# EPT Forum Enterprises 2026 – Inscriptions + scanner QR

Tally → Apps Script → Google Sheet → dashboard + scanner (GitHub Pages).

```
apps-script/  Code.gs (webhook + API), Import.gs (rattrapage Gmail), Tests.gs, appsscript.json
docs/         index.html (dashboard), scan.html (scanner PWA), shared.js, sw.js, manifest, icônes
tests/        sample-tally-payload.json
```

## 1. Sheet + Apps Script

1. Créer un Google Sheet (n'importe quel nom). **Extensions → Apps Script** (ou ouvrir votre projet existant lié au webhook).
2. Remplacer `Code.gs` par [apps-script/Code.gs](apps-script/Code.gs), ajouter `Import.gs` et `Tests.gs`.
   Optionnel : *Paramètres du projet → Afficher appsscript.json* et y coller [apps-script/appsscript.json](apps-script/appsscript.json) (fuseau Tunis + scopes).
3. Exécuter **`setup()`** (accepter les autorisations). Dans *Exécutions / Journal*, copier le **TOKEN** généré.
   Il est stocké dans *Paramètres du projet → Propriétés du script* (`API_TOKEN`) ; modifiable à tout moment.
   Si le script n'est pas lié au Sheet, ajouter la propriété `SHEET_ID`.
4. **Déployer → Nouveau déploiement → Application Web** : exécuter *en tant que moi*, accès *tout le monde*. Copier l'URL `/exec`.
   - Si vous mettez à jour un projet déjà déployé : **Gérer les déploiements → ✏️ → Nouvelle version**. L'URL `/exec` ne change pas, **le webhook Tally n'a donc rien à modifier**.
   - Si l'URL change (nouveau déploiement), mettre à jour le webhook dans Tally : *Form → Integrations → Webhooks*.

## 2. Rattrapage des inscriptions existantes

Exécuter **`importFromGmail()`**. Il lit les mails « Nouvelle inscription : … » et ajoute les lignes manquantes. Relançable sans risque (dédoublonné sur le code). Résumé dans le journal.

## 3. Tests

Dans l'éditeur : exécuter **`runAllTests()`** (parsing Tally, webhook en double, valide / déjà scanné / inconnu, parser d'import).
Après le déploiement : **`testConcurrentCheckinHttp()`** envoie 3 check-in simultanés du même QR ; exactement un doit réussir.
Test bout en bout du webhook :
```
curl -L -X POST -H "Content-Type: text/plain" --data @tests/sample-tally-payload.json "<URL /exec>"
```
(réponse `ok`, puis `duplicate` si renvoyé ; la ligne apparaît dans le Sheet.) Supprimer ensuite la ligne de test.

Checklist manuelle : Android Chrome et iPhone Safari → ouvrir `scan.html` en HTTPS, autoriser la caméra, scanner un QR valide (vert), le même (orange), un QR quelconque (rouge), saisie manuelle.

## 4. GitHub Pages

1. Pousser le dépôt (aucune donnée réelle ni token dedans), puis *Settings → Pages → Branch `master`/`main`, dossier `/docs`*.
2. Optionnel : renseigner `DEFAULT_API_URL` en haut de [docs/shared.js](docs/shared.js) pour que le staff n'ait que le token à saisir.
3. Ouvrir `https://<user>.github.io/<repo>/` (dashboard) et `/scan.html` (scanner). À la première ouverture : saisir l'URL `/exec` (si non préconfigurée) et le token ; ils sont gardés dans le navigateur.
4. Sur téléphone : *Ajouter à l'écran d'accueil* pour installer le scanner.

## 5. Fonctionnement

- **Inscription** : `doPost` écrit d'abord la ligne dans le Sheet (dédoublonnée sur `code` sous verrou), puis envoie les deux mails comme avant. Un webhook renvoyé ne crée ni doublon ni second mail.
- **API** (toutes les routes exigent `token`) : `GET ?action=verify&code=…` (ne modifie rien), `list`, `stats`, `ping` ; `POST {action:"checkin", code, token, by}` atomique via `LockService`.
- **Scanner** : vert VALIDE (bouton « Valider l'entrée », ou check-in automatique via la case), orange DÉJÀ SCANNÉ, rouge INCONNU ; bip + vibration ; délai anti-doublon de 4 s ; saisie manuelle ; compteur présents / inscrits.
- **Sécurité** : le QR ne contient que `EPT26-<id>`. Le token n'est ni dans le code ni dans le dépôt. L'API ne renvoie aucune donnée sans token.

## Limites connues

- Le token est transmis dans l'URL des requêtes GET (nécessaire pour Apps Script en lecture). Utiliser un token dédié et le changer après le forum.
- Apps Script impose un temps de réponse d'environ 1 à 2 s par requête et des quotas gratuits (largement suffisants pour quelques centaines de participants).
- `main.dart` à la racine est un fichier vide préexistant sans lien avec ce projet.
