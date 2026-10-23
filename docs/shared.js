/* Partagé par index.html et scan.html : config, token, appels API. */
(function () {
  // Renseigner l'URL /exec ici (non secrète) pour que le staff n'ait que le token à saisir.
  var DEFAULT_API_URL = "";

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }

  var EPT = {
    apiUrl: function () { return ls("ept_api_url") || DEFAULT_API_URL; },
    token: function () { return ls("ept_token") || ""; },
    save: function (url, token) { if (url) ls("ept_api_url", url.trim()); ls("ept_token", token.trim()); },
    logout: function () { ls("ept_token", null); },
    pref: function (k, v) { return ls("ept_pref_" + k, v); },
    configured: function () { return !!(EPT.apiUrl() && EPT.token()); },

    get: function (params) {
      var q = new URLSearchParams(Object.assign({ token: EPT.token() }, params));
      return EPT._req(EPT.apiUrl() + "?" + q.toString(), {});
    },
    post: function (body) {
      return EPT._req(EPT.apiUrl(), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // requête "simple" : pas de preflight
        body: JSON.stringify(Object.assign({ token: EPT.token() }, body))
      });
    },
    _req: function (url, opts) {
      return fetch(url, opts).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) {
          var err = new Error(j.error || "error");
          err.code = j.error;
          throw err;
        }
        return j;
      });
    },

    /** Affiche le formulaire de connexion ; appelle onReady() une fois validé. */
    login: function (onReady) {
      var box = document.getElementById("login");
      var urlIn = document.getElementById("login-url");
      var tokIn = document.getElementById("login-token");
      var msg = document.getElementById("login-msg");
      urlIn.value = EPT.apiUrl();
      urlIn.parentElement.style.display = DEFAULT_API_URL ? "none" : "";
      box.hidden = false;
      document.getElementById("login-form").onsubmit = function (ev) {
        ev.preventDefault();
        msg.textContent = "Vérification…";
        EPT.save(urlIn.value, tokIn.value);
        EPT.get({ action: "ping" }).then(function () {
          box.hidden = true; onReady();
        }).catch(function (e) {
          EPT.logout();
          msg.textContent = e.code === "unauthorized" ? "Token invalide." : "Connexion impossible (URL ou réseau).";
        });
      };
    },

    esc: function (s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    },
    fmtDate: function (iso) {
      if (!iso) return "";
      var d = new Date(iso);
      return isNaN(d) ? iso : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  };
  window.EPT = EPT;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
