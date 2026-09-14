// ============================================================================
// LA PAGE D'INSTALLATION DE L'ECRAN
//
// Donner l'adresse de l'ecran, jeton compris, a celui qui installe la salle —
// sans l'obliger a fouiller le journal du conteneur dans DSM, et sans la donner
// a personne d'autre.
//
//   /installer               l'adresse de l'ecran, a copier ou ouvrir
//   POST /installer/jeton    changer le jeton (l'ancienne adresse cesse aussitot)
//
// QUI Y A DROIT : un acces DIRECT au service, c'est-a-dire par Tailscale ou
// depuis le NAS lui-meme. Jamais par Internet, jamais par le reseau local du
// magasin. Voir accesDirect(), dont tout depend.
// ============================================================================

import { reglages } from './config.js';
import { json, erreur, lireCorpsJson } from './http.js';
import { jetonEcran, changerJeton } from './acces.js';
import { fermerFluxEcrans } from './flux.js';

// Un acces DIRECT, et non par le proxy inverse de DSM.
//
// Mesure faite sur le NAS (port publie sur 127.0.0.1) : par Tailscale comme
// depuis le NAS, le conteneur voit la connexion arriver de la passerelle de
// Docker, SANS X-Forwarded-For, avec le nom d'hote tape dans la barre
// d'adresse. Par Internet, DSM ajoute TOUJOURS X-Forwarded-For
// ($proxy_add_x_forwarded_for) et n'aiguille que le nom public.
//
// Quatre conditions, toutes necessaires :
//
//   1. aucun en-tete de proxy — tout le trafic d'Internet en porte un ;
//   2. pas le nom d'hote public ;
//   3. une prise qui vient de la boucle locale ou d'un reseau de Docker. Si un
//      jour le port etait de nouveau publie sur toutes les interfaces, un
//      appareil du Wi-Fi du magasin arriverait sous sa propre adresse
//      (celle du reseau local) et serait refuse ;
//   4. un nom d'hote qui est une adresse IP, « localhost » ou un nom Tailscale
//      (*.ts.net). Contre le « DNS rebinding » : une page malveillante visitee
//      depuis un appareil du tailnet pourrait sinon viser le service sous un
//      nom a elle et lire la reponse.
export function accesDirect(req) {
  const entetes = req.headers || {};
  if (entetes['x-forwarded-for'] || entetes['x-real-ip'] || entetes.forwarded) return false;

  const hote = String(entetes.host || '').toLowerCase();
  const nomHote = hote.startsWith('[') ? hote.slice(0, hote.indexOf(']') + 1) : hote.split(':')[0];

  if (reglages.adressePublique) {
    try {
      if (hote === new URL(reglages.adressePublique).host.toLowerCase()) return false;
    } catch {
      // Adresse publique illisible : les autres conditions suffisent.
    }
  }

  const prise = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  const priseLocale = prise === '::1'
    || /^127\./.test(prise)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(prise);
  if (!priseLocale) return false;

  const nomAccepte = nomHote === 'localhost'
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(nomHote)
    || /^\[[0-9a-f:]+\]$/.test(nomHote)
    || nomHote.endsWith('.ts.net');
  return nomAccepte;
}

function echapper(texte) {
  return String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function introuvable(res) {
  // 404 et pas 403 : depuis Internet ou le Wi-Fi du magasin, rien ne doit
  // laisser deviner qu'une page d'installation existe.
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  return res.end('Introuvable');
}

export async function routerInstallation(req, res, chemin) {
  if (!accesDirect(req)) return introuvable(res);

  if (chemin === '/installer' && req.method === 'GET') return pageInstallation(req, res);

  if (chemin === '/installer/jeton' && req.method === 'POST') {
    // Contre une page malveillante qui ferait envoyer un formulaire depuis un
    // appareil du tailnet : un formulaire HTML ne sait pas envoyer de JSON, et
    // l'origine, quand le navigateur la donne, doit etre la notre.
    const type = String(req.headers['content-type'] || '');
    const origine = req.headers.origin;
    if (!type.startsWith('application/json')) return erreur(res, 415, 'Demande refusée.');
    if (origine && origine !== `http://${req.headers.host}` && origine !== `https://${req.headers.host}`) {
      return erreur(res, 403, 'Demande refusée.');
    }
    try {
      await lireCorpsJson(req);
    } catch {
      return erreur(res, 400, 'Demande illisible.');
    }
    changerJeton();
    fermerFluxEcrans();
    return json(res, 200, { ok: true });
  }

  return introuvable(res);
}

function pageInstallation(req, res) {
  const jeton = jetonEcran();
  const publique = (reglages.adressePublique || '').trim().replace(/\/+$/, '');
  const directe = `http://${req.headers.host}`;

  const adresses = [];
  if (publique) {
    adresses.push({
      titre: 'Adresse de l’écran',
      aide: 'À ouvrir sur l’écran de la salle, où qu’il soit : il suffit d’Internet.',
      url: `${publique}/scene?jeton=${encodeURIComponent(jeton)}`,
    });
  }
  adresses.push({
    titre: publique ? 'Par Tailscale' : 'Adresse de l’écran',
    aide: 'Seulement depuis un appareil de votre réseau Tailscale.',
    url: `${directe}/scene?jeton=${encodeURIComponent(jeton)}`,
  });

  const blocs = adresses.map((a, i) => `
  <section>
    <h2>${echapper(a.titre)}</h2>
    <p class="aide">${echapper(a.aide)}</p>
    <input id="adresse-${i}" readonly value="${echapper(a.url)}">
    <div class="boutons">
      <button type="button" data-copier="adresse-${i}">Copier l’adresse</button>
      <a class="bouton secondaire" href="${echapper(a.url)}" target="_blank" rel="noreferrer">Ouvrir l’écran</a>
    </div>
  </section>`).join('');

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Installer l’écran — Écran Partagé</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#0b0d10;color:#f2f4f7;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}
  main{max-width:44rem;margin:0 auto;padding:2rem 1.2rem 3rem}
  h1{font-size:1.5rem;margin:0 0 .4rem}
  h2{font-size:1.05rem;margin:0 0 .3rem}
  .intro{color:#c3cad4;margin:0 0 1.6rem}
  ol{color:#c3cad4;padding-left:1.3rem;margin:0 0 1.8rem}
  li{margin-bottom:.35rem}
  section{background:#141920;border:1px solid #232a34;border-radius:.9rem;padding:1rem 1.1rem;margin-bottom:1rem}
  .aide{color:#8a93a0;font-size:.92rem;margin:0 0 .6rem}
  input{width:100%;padding:.75rem .8rem;background:#0b0d10;border:1px solid #232a34;border-radius:.6rem;color:#f2f4f7;font:14px ui-monospace,Menlo,Consolas,monospace}
  .boutons{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.7rem}
  button,.bouton{display:inline-block;padding:.7rem 1.1rem;border:none;border-radius:.6rem;background:#4da3ff;color:#04121f;font:600 .95rem system-ui,sans-serif;cursor:pointer;text-decoration:none}
  .secondaire{background:transparent;color:#f2f4f7;border:1px solid #232a34}
  .danger{background:transparent;color:#ff6b6b;border:1px solid #ff6b6b}
  .avis{min-height:1.4rem;color:#4ade80;font-size:.92rem;margin:.5rem 0 0}
  .avis.erreur{color:#ff6b6b}
  .garde{color:#8a93a0;font-size:.9rem}
</style></head>
<body><main>
  <h1>Installer l’écran de la salle</h1>
  <p class="intro">Cette page n’est visible que depuis Tailscale ou le NAS. Elle donne
  l’adresse de l’écran, qui contient une clé : le « jeton ».</p>

  <ol>
    <li>Copiez l’adresse ci-dessous et ouvrez-la sur l’écran de la salle (télé, projecteur, mini-PC).</li>
    <li>Passez en plein écran (touche F11), puis ajoutez l’adresse aux favoris.</li>
    <li>Les participants scannent le QR code affiché : c’est tout.</li>
  </ol>
${blocs}
  <p class="avis" id="avis"></p>

  <section>
    <h2>Changer le jeton</h2>
    <p class="aide">Si l’adresse de l’écran a circulé. L’ancienne adresse cesse aussitôt
    de fonctionner : l’écran de la salle devra être rouvert avec la nouvelle.</p>
    <button type="button" class="danger" id="changer">Changer le jeton</button>
  </section>

  <p class="garde">Ne transmettez cette adresse qu’à l’appareil de la salle : elle ouvre
  l’écran de toutes les réunions à venir, pas seulement de celle-ci.</p>
</main>
<script>
(function () {
  var avis = document.getElementById('avis');
  function dire(texte, erreur) { avis.textContent = texte; avis.className = erreur ? 'avis erreur' : 'avis'; }

  // Pas de navigator.clipboard : il exige une page en HTTPS, et l'adresse
  // Tailscale est en http://. La selection + execCommand marche partout.
  document.addEventListener('click', function (e) {
    var id = e.target && e.target.getAttribute('data-copier');
    if (!id) return;
    var champ = document.getElementById(id);
    champ.focus(); champ.select(); champ.setSelectionRange(0, champ.value.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    dire(ok ? 'Adresse copiée.' : 'Copie impossible ici : l’adresse est sélectionnée, faites Ctrl+C.', !ok);
  });

  document.getElementById('changer').addEventListener('click', function () {
    if (!window.confirm('Changer le jeton ? L’écran de la salle devra être rouvert avec la nouvelle adresse.')) return;
    var r = new XMLHttpRequest();
    r.open('POST', '/installer/jeton');
    r.setRequestHeader('content-type', 'application/json');
    r.onload = function () {
      if (r.status === 200) location.reload();
      else dire('Le jeton n’a pas pu être changé.', true);
    };
    r.onerror = function () { dire('Connexion interrompue.', true); };
    r.send('{}');
  });
}());
</script>
</body></html>`;

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  return res.end(html);
}
