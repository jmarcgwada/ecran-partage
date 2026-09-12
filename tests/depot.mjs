// ============================================================================
// LE BANC D'ESSAI
//
// Il monte le vrai serveur HTTP dans le processus, sur un port libre, et le
// sollicite comme le feraient un telephone et l'ecran de la salle. Ce qu'on
// cherche a prendre en defaut, c'est la plomberie qu'on ne voit pas :
//
//   - un envoi refuse doit RENDRE UN MESSAGE, pas couper la connexion ;
//   - le code de salle doit vraiment fermer le depot ;
//   - l'ecran doit etre prevenu par le flux, sans avoir rien demande ;
//   - aucun chemin de disque ne doit sortir dans l'etat public ;
//   - la fin de reunion doit effacer les fichiers POUR DE VRAI.
//
// La conversion, elle, ne s'eprouve que la ou LibreOffice et poppler existent,
// c'est-a-dire DANS LE CONTENEUR. Sur le poste Windows, ces controles-la
// s'annoncent « ignore » plutot que de mentir.
//
// Lancement :  node tests/depot.mjs
//              docker exec ecran-partage node tests/depot.mjs
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ecran-partage-'));
process.env.ECR_DATA_DIR = dossier;

let echecs = 0;
function verifier(titre, condition, detail = '') {
  console.log(`${condition ? 'OK    ' : 'ECHEC '} ${titre}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}
function ignore(titre, motif) {
  console.log(`IGNORE ${titre} — ${motif}`);
}

const { initDossiers, dossierReunion } = await import('../src/config.js');
const { creerGestionnaire } = await import('../src/api.js');
const salleModule = await import('../src/salle.js');
const { outilsPresents } = await import('../src/documents.js');

initDossiers();
const code = salleModule.nouvelleReunion();

const serveur = http.createServer(creerGestionnaire());
await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
const port = serveur.address().port;
const base = `http://127.0.0.1:${port}`;

// --- Deux outils ------------------------------------------------------------

// Un PDF, fabrique ici avec de vraies positions dans la table d'index : un PDF
// approximatif serait peut-etre rattrape par poppler, et le controle ne
// prouverait plus rien. Chaque page porte son numero, pour qu'on puisse verifier
// a l'oeil que c'est bien la bonne qui s'affiche.
function pdfDePages(nbPages) {
  const objets = ['<</Type/Catalog/Pages 2 0 R>>'];

  const enfants = [];
  for (let p = 0; p < nbPages; p++) enfants.push(`${3 + p * 2} 0 R`);
  objets.push(`<</Type/Pages/Kids[${enfants.join(' ')}]/Count ${nbPages}>>`);

  const police = 3 + nbPages * 2;
  for (let p = 0; p < nbPages; p++) {
    const texte = `BT /F1 36 Tf 40 400 Td (Page ${p + 1}) Tj ET`;
    objets.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${4 + p * 2} 0 R/Resources<</Font<</F1 ${police} 0 R>>>>>>`);
    objets.push(`<</Length ${texte.length}>>\nstream\n${texte}\nendstream`);
  }
  objets.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');

  let corps = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((objet, index) => {
    positions.push(corps.length);
    corps += `${index + 1} 0 obj\n${objet}\nendobj\n`;
  });

  const debutIndex = corps.length;
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const position of positions) {
    corps += `${String(position).padStart(10, '0')} 00000 n \n`;
  }
  corps += `trailer\n<</Size ${objets.length + 1}/Root 1 0 R>>\nstartxref\n${debutIndex}\n%%EOF\n`;
  return Buffer.from(corps, 'latin1');
}

// L'ecran de la salle, vu du banc : une oreille sur le flux SSE.
function ecouterLeFlux() {
  const evenements = [];
  let attente = null;
  let tampon = '';

  const requete = http.get(`${base}/api/flux`, (reponse) => {
    reponse.setEncoding('utf8');
    reponse.on('data', (morceau) => {
      tampon += morceau;
      let coupure = tampon.indexOf('\n\n');
      while (coupure >= 0) {
        const bloc = tampon.slice(0, coupure);
        tampon = tampon.slice(coupure + 2);
        const ligne = bloc.split('\n').find((l) => l.startsWith('data: '));
        if (ligne) {
          try {
            evenements.push(JSON.parse(ligne.slice(6)));
            if (attente) attente();
          } catch { /* un bloc partiel, le suivant portera l'etat */ }
        }
        coupure = tampon.indexOf('\n\n');
      }
    });
  });

  return {
    evenements,
    entetes: new Promise((resoudre) => requete.on('response', (r) => resoudre(r.headers))),
    // Attend qu'un etat satisfasse la condition, ou rend null au bout du delai.
    attendre(condition, delaiMs = 8000) {
      return new Promise((resoudre) => {
        const voir = () => evenements.find(condition);
        const deja = voir();
        if (deja) return resoudre(deja);
        const minuterie = setTimeout(() => { attente = null; resoudre(null); }, delaiMs);
        attente = () => {
          const trouve = voir();
          if (!trouve) return;
          clearTimeout(minuterie);
          attente = null;
          resoudre(trouve);
        };
      });
    },
    fermer() { requete.destroy(); },
  };
}

const flux = ecouterLeFlux();
const entetesDuFlux = await flux.entetes;

verifier('le flux s’annonce comme un flux d’évènements',
  (entetesDuFlux['content-type'] || '').startsWith('text/event-stream'), entetesDuFlux['content-type']);
verifier('le flux demande à ne pas être mis en tampon',
  entetesDuFlux['x-accel-buffering'] === 'no' && /no-transform/.test(entetesDuFlux['cache-control'] || ''),
  entetesDuFlux['cache-control']);
verifier('l’écran reçoit l’état sans rien demander',
  (await flux.attendre((e) => e.code === code, 3000)) !== null);

// --- Le code de salle -------------------------------------------------------

function depot(codeUtilise, nomFichier, contenu, champs = {}) {
  const paquet = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) paquet.append(cle, valeur);
  paquet.append('documents', new Blob([contenu]), nomFichier);
  return fetch(`${base}/api/depot?code=${encodeURIComponent(codeUtilise)}`, {
    method: 'POST', body: paquet,
  });
}

const contenu = pdfDePages(1);

const mauvais = await depot(String((Number(code) + 1) % 10000).padStart(4, '0'), 'espion.pdf', contenu);
verifier('sans le bon code, on ne dépose rien', mauvais.status === 403, String(mauvais.status));
verifier('le refus dit pourquoi, en clair',
  /[Cc]ode de salle/.test((await mauvais.json()).erreur || ''));

// Le refus ci-dessus repond sans avoir lu tout le corps : si la connexion n'est
// pas fermee proprement, CETTE requete-ci part en erreur reseau.
verifier('le serveur répond encore après un refus de code',
  (await fetch(`${base}/api/sante`)).ok);

// --- Le depot qui aboutit ---------------------------------------------------

const reponse = await depot(code, 'réunion été 2026.pdf', contenu, { prenom: 'Amélie' });
const recu = await reponse.json();

verifier('dépôt accepté avec le bon code', reponse.status === 200, String(reponse.status));
verifier('un identifiant de document est rendu',
  Array.isArray(recu.documents) && /^[a-f0-9]{16}$/.test(recu.documents[0].id));
verifier('le nom accentué est conservé',
  recu.documents[0].nom === 'réunion été 2026.pdf', recu.documents[0].nom);
verifier('un identifiant de participant est attribué',
  /^[a-f0-9]{16}$/.test(recu.participant || ''));

const identifiant = recu.documents[0].id;

// L'ecran doit apprendre l'arrivee du document AVANT meme qu'il soit converti :
// c'est ce qui lui permet d'afficher « réception d'un document… » au lieu de
// laisser croire a une panne (§12).
verifier('l’écran est prévenu de la réception avant la conversion',
  (await flux.attendre((e) => e.reception === true, 3000)) !== null);

// --- La conversion ----------------------------------------------------------

const converti = await flux.attendre((e) => {
  const document = e.documents.find((d) => d.id === identifiant);
  return document && document.etat !== 'conversion';
}, 60_000);

verifier('la conversion rend une réponse, aboutie ou non', converti !== null);

const outils = await outilsPresents();
const document = converti ? converti.documents.find((d) => d.id === identifiant) : null;

if (!outils) {
  ignore('la conversion produit de vraies pages', 'poppler absent (poste Windows)');
  verifier('sans les outils, l’échec est dit proprement',
    document !== null && document.etat === 'erreur' && !!document.erreur,
    document ? document.erreur || '' : 'aucun document');
} else {
  verifier('la conversion produit de vraies pages',
    document !== null && document.etat === 'pret' && document.nbPages >= 1,
    document ? `${document.etat} / ${document.nbPages} page(s)` : 'aucun document');

  verifier('le document prend l’écran tout seul',
    converti.affichage.documentId === identifiant && !!converti.affichage.image);

  const image = await fetch(base + converti.affichage.image);
  verifier('la page se sert bien comme une image',
    image.status === 200 && image.headers.get('content-type') === 'image/jpeg',
    `${image.status} / ${image.headers.get('content-type')}`);
  verifier('l’image n’est pas vide', (await image.arrayBuffer()).byteLength > 1000);
}

// --- Remettre un document a l'ecran -----------------------------------------
//
// Ce qui doit tenir : le code de salle protege ce geste comme il protege le
// depot — changer ce que toute la salle voit n'est pas moins engageant que
// d'ajouter un document.

const afficherAvec = (codeUtilise, documentId, page) =>
  fetch(`${base}/api/afficher?code=${encodeURIComponent(codeUtilise)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentId, page }),
  });

const codeFaux = String((Number(code) + 1) % 10000).padStart(4, '0');

verifier('sans le bon code, on ne remet rien à l’écran',
  (await afficherAvec(codeFaux, identifiant)).status === 403);
verifier('le serveur répond encore après ce refus',
  (await fetch(`${base}/api/sante`)).ok);
verifier('un document inconnu n’est pas affichable',
  (await afficherAvec(code, '00112233445566ff')).status === 404);

if (!outils) {
  ignore('un document déjà déposé se remet à l’écran', 'aucune page convertie hors conteneur');
  // Le pendant du controle ci-dessus : ce qui n'a pas pu etre converti ne doit
  // pas pouvoir etre affiche — sinon l'ecran passe au noir en pleine reunion.
  verifier('un document illisible n’est pas affichable',
    (await afficherAvec(code, identifiant)).status === 404);
} else {
  // Un deuxieme document prend l'ecran tout seul (phase 1), puis on revient
  // sur le premier SANS le renvoyer : c'est tout l'objet de la manoeuvre.
  const second = await depot(code, 'le suivant.pdf', contenu, { prenom: 'Bruno' });
  const idSecond = (await second.json()).documents[0].id;
  const prisParLeSecond = await flux.attendre((e) => e.affichage.documentId === idSecond, 60_000);
  verifier('le document suivant prend l’écran', prisParLeSecond !== null);

  const retour = await afficherAvec(code, identifiant);
  verifier('un document déjà déposé se remet à l’écran', retour.status === 200, String(retour.status));
  verifier('la réponse dit ce qui est désormais affiché',
    (await retour.json()).affichage.documentId === identifiant);
  verifier('l’écran est prévenu du retour en arrière',
    (await flux.attendre((e) => e.affichage.documentId === identifiant, 5000)) !== null);

  // La page demandee est retenue, et bornee : une page 99 sur un document
  // d'une page ne doit pas laisser l'ecran sans image.
  await afficherAvec(code, identifiant, 99);
  const borne = await fetch(`${base}/api/etat`).then((r) => r.json());
  verifier('une page hors des limites est ramenée dans le document',
    borne.affichage.page === borne.affichage.nbPages - 1 && !!borne.affichage.image,
    `page ${borne.affichage.page} sur ${borne.affichage.nbPages}`);
}

// --- Tourner les pages ------------------------------------------------------

const tourner = (codeUtilise, sens) =>
  fetch(`${base}/api/page?code=${encodeURIComponent(codeUtilise)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sens }),
  });

verifier('sans le bon code, on ne tourne pas les pages',
  (await tourner(codeFaux, 1)).status === 403);
verifier('le serveur répond encore après ce refus',
  (await fetch(`${base}/api/sante`)).ok);

if (!outils) {
  ignore('les pages se tournent depuis le téléphone', 'aucune page convertie hors conteneur');
} else {
  const troisPages = await depot(code, 'rapport.pdf', pdfDePages(3), { prenom: 'Camille' });
  const idTrois = (await troisPages.json()).documents[0].id;
  const pret = await flux.attendre((e) => {
    const d = e.documents.find((x) => x.id === idTrois);
    return d && d.etat === 'pret';
  }, 60_000);
  verifier('le document de trois pages est converti',
    pret !== null && pret.documents.find((d) => d.id === idTrois).nbPages === 3);

  await afficherAvec(code, idTrois, 0);
  const page = async () => (await fetch(`${base}/api/etat`).then((r) => r.json())).affichage;

  verifier('la page suivante avance d’une page',
    (await tourner(code, 1).then((r) => r.json())).affichage.page === 1);
  verifier('la page précédente recule d’une page',
    (await tourner(code, -1).then((r) => r.json())).affichage.page === 0);
  verifier('on ne recule pas avant la première page',
    (await tourner(code, -1).then((r) => r.json())).affichage.page === 0);

  // LE controle qui justifie d'envoyer un SENS et non un numero de page : deux
  // appuis partis ensemble, depuis un telephone qui croit encore etre page 0,
  // doivent avancer de DEUX pages. Avec un numero, le second ecraserait le
  // premier et l'on n'avancerait que d'une.
  await Promise.all([tourner(code, 1), tourner(code, 1)]);
  verifier('deux appuis rapides avancent de deux pages',
    (await page()).page === 2, `page ${(await page()).page}`);

  verifier('on ne dépasse pas la dernière page',
    (await tourner(code, 1).then((r) => r.json())).affichage.page === 2);

  // L'ecran doit suivre : une page tournee est un evenement comme un autre.
  verifier('l’écran est prévenu du changement de page',
    (await flux.attendre((e) => e.affichage.documentId === idTrois && e.affichage.page === 2, 5000)) !== null);

  const image = await fetch(base + (await page()).image);
  verifier('la troisième page se sert bien comme une image',
    image.status === 200 && image.headers.get('content-type') === 'image/jpeg');

  await afficherAvec(code, identifiant, 0);   // on remet l'écran où il était
}

// --- Le tour de parole ------------------------------------------------------
//
// Ce qui doit tenir : quand l'animateur ferme le tour de parole, un seul
// telephone pilote l'ecran — mais TOUT LE MONDE peut continuer a deposer, on
// prepare son document pendant que quelqu'un d'autre presente.

const poster = (chemin, corps, codeUtilise = code) =>
  fetch(`${base}${chemin}?code=${encodeURIComponent(codeUtilise)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });

const etatDe = () => fetch(`${base}/api/etat`).then((r) => r.json());

verifier('on ne rejoint pas la salle sans le bon code',
  (await poster('/api/rejoindre', {}, codeFaux)).status === 403);

const camille = (await poster('/api/rejoindre', { prenom: 'Camille' }).then((r) => r.json())).participant;
const bruno = (await poster('/api/rejoindre', { prenom: 'Bruno' }).then((r) => r.json())).participant;

verifier('rejoindre la salle attribue un participant',
  /^[a-f0-9]{16}$/.test(camille) && /^[a-f0-9]{16}$/.test(bruno) && camille !== bruno);
// Par identifiant, et non en comptant les prenoms : les depots precedents ont
// deja cree des participants nommes Camille et Bruno, et un compte ne tiendrait
// donc que sur un poste ou la conversion echoue. C'est le conteneur qui l'a dit.
const vus = (await etatDe()).participants;
verifier('les participants apparaissent dans l’état, avec leur prénom',
  vus.some((p) => p.id === camille && p.prenom === 'Camille')
  && vus.some((p) => p.id === bruno && p.prenom === 'Bruno'));
verifier('la main est libre par défaut', (await etatDe()).laMainEstLibre === true);

// L'animateur ferme le tour de parole.
verifier('l’animateur ne ferme rien sans le bon code',
  (await poster('/api/animateur/main-libre', { valeur: false }, codeFaux)).status === 403);
verifier('l’animateur ferme le tour de parole',
  (await poster('/api/animateur/main-libre', { valeur: false }).then((r) => r.json())).laMainEstLibre === false);
verifier('personne n’a la main au moment de fermer', (await etatDe()).mainA === null);

// Tant que personne ne l'a prise, personne ne pilote — c'est ce qui evite que
// le premier a cliquer emporte l'ecran sans l'avoir demande.
verifier('la main à prendre, personne ne pilote',
  (await poster('/api/afficher', { documentId: identifiant, participant: camille })).status === 409);

verifier('Camille prend la main',
  (await poster('/api/main', { action: 'prendre', participant: camille })).status === 200);
verifier('Bruno ne peut pas la lui prendre',
  (await poster('/api/main', { action: 'prendre', participant: bruno })).status === 409);
verifier('le refus dit qui a la main',
  /Camille/.test((await poster('/api/main', { action: 'prendre', participant: bruno }).then((r) => r.json())).erreur || ''));

// Celui qui a la main passe le controle de la main : le 404 qui suit vient du
// document (non converti hors conteneur), pas du tour de parole.
verifier('celui qui a la main n’est pas arrêté par le tour de parole',
  (await poster('/api/afficher', { documentId: identifiant, participant: camille })).status !== 409);
verifier('les autres sont arrêtés, sur l’affichage comme sur les pages',
  (await poster('/api/afficher', { documentId: identifiant, participant: bruno })).status === 409
  && (await poster('/api/page', { sens: 1, participant: bruno })).status === 409);

// Deposer n'a jamais rien a voir avec la main.
verifier('déposer reste permis à celui qui n’a pas la main',
  (await depot(code, 'preparation.pdf', contenu, { prenom: 'Bruno' })).status === 200);

verifier('Bruno ne peut pas rendre une main qu’il n’a pas',
  (await poster('/api/main', { action: 'rendre', participant: bruno })).status === 409);
verifier('Camille rend la main',
  (await poster('/api/main', { action: 'rendre', participant: camille })).status === 200);
verifier('Bruno peut alors la prendre',
  (await poster('/api/main', { action: 'prendre', participant: bruno })).status === 200);

// L'animateur passe outre : c'est tout l'objet de sa page.
verifier('l’animateur donne la main à quelqu’un d’autre',
  (await poster('/api/animateur/donner', { participant: camille }).then((r) => r.json())).mainA === camille);
verifier('l’animateur ne donne pas la main à un inconnu',
  (await poster('/api/animateur/donner', { participant: '00112233445566ff' })).status === 404);
verifier('l’animateur peut reprendre la main à tout le monde',
  (await poster('/api/animateur/donner', { participant: null }).then((r) => r.json())).mainA === null);

verifier('la main redevenue libre, chacun pilote de nouveau',
  (await poster('/api/animateur/main-libre', { valeur: true })).status === 200
  && (await poster('/api/page', { sens: 1, participant: bruno })).status !== 409);

// --- Retirer un document ----------------------------------------------------

const aRetirer = (await depot(code, 'erreur de manip.pdf', contenu, { prenom: 'Bruno' }).then((r) => r.json()))
  .documents[0].id;
const dossierRetire = salleModule.dossierDuDocument(aRetirer);

verifier('le document retiré existe bien sur le disque avant', fs.existsSync(dossierRetire));
verifier('on ne retire rien sans le bon code',
  (await poster('/api/animateur/retirer', { documentId: aRetirer }, codeFaux)).status === 403);
verifier('le document est toujours là après ce refus', fs.existsSync(dossierRetire));
verifier('l’animateur retire un document',
  (await poster('/api/animateur/retirer', { documentId: aRetirer })).status === 200);
verifier('le document a quitté l’état',
  !(await etatDe()).documents.some((d) => d.id === aRetirer));
// Le controle qui compte pour le §9 : retirer d'une liste ne serait pas retirer.
verifier('et il a quitté le disque', !fs.existsSync(dossierRetire));
verifier('retirer un document inconnu est refusé',
  (await poster('/api/animateur/retirer', { documentId: '00112233445566ff' })).status === 404);

// --- Ce qui ne doit pas sortir ---------------------------------------------

const etat = await fetch(`${base}/api/etat`).then((r) => r.json());
verifier('aucun chemin de disque dans l’état public',
  !/[A-Za-z]:\\|\/data\/|\/tmp\//.test(JSON.stringify(etat)), JSON.stringify(etat).slice(0, 120));

const brute = (chemin) => new Promise((resoudre) => {
  http.request({ host: '127.0.0.1', port, path: chemin }, (r) => { r.resume(); resoudre(r.statusCode); }).end();
});

verifier('remontée de dossier refusée',
  [403, 404].includes(await brute('/../server.js')));
verifier('une page au nom fantaisiste est refusée',
  await brute('/page/zzz/p-1.jpg') === 404);
verifier('une page d’un document inconnu est refusée',
  await brute('/page/00112233445566ff/p-1.jpg') === 404);
verifier('un fichier qui n’est pas une page est refusé',
  await brute(`/page/${identifiant}/source.pdf`) === 404);

// --- Les pages du service ---------------------------------------------------

verifier('la page de l’écran est servie', await brute('/scene') === 200);
verifier('la page de l’animateur est servie', await brute('/animateur') === 200);
verifier('la page du téléphone est servie', await brute(`/salle/${code}`) === 200);
verifier('une adresse de salle qui n’est pas un code est refusée',
  await brute('/salle/abcd') === 404);

// --- Les refus --------------------------------------------------------------

const vide = await fetch(`${base}/api/depot?code=${code}`, { method: 'POST', body: new FormData() });
verifier('dépôt vide refusé', vide.status === 400, String(vide.status));

const gros = new FormData();
gros.append('documents', new Blob([new Uint8Array(51 * 1024 * 1024)]), 'gros.pdf');
const reponseGros = await fetch(`${base}/api/depot?code=${code}`, { method: 'POST', body: gros });
verifier('envoi trop volumineux refusé', reponseGros.status === 413, String(reponseGros.status));
verifier('le refus annonce la limite en clair',
  /50 Mo/.test((await reponseGros.json()).erreur || ''));
verifier('le serveur répond encore après un refus en cours d’envoi',
  (await fetch(`${base}/api/sante`)).ok);

const mauvaisType = await depot(code, 'programme.exe', Buffer.from([0]));
const refuse = await mauvaisType.json();
verifier('un format non accepté est signalé sans faire échouer le dépôt',
  mauvaisType.status === 200 && refuse.refuses.length === 1
  && /Format non accepté/.test(refuse.refuses[0].motif));

// --- La fin de reunion ------------------------------------------------------
//
// Le controle qui compte pour le §9 : les fichiers quittent le disque, ils ne
// sont pas seulement retires d'une liste.

const avant = fs.readdirSync(dossierReunion);
verifier('la réunion a bien des fichiers sur le disque avant d’être terminée', avant.length > 0);

const ancienCode = code;

// Le controle qui compte le plus de toute cette section : un mauvais code ne
// doit pas pouvoir mettre fin a la reunion de tout le monde.
verifier('un mauvais code ne termine pas la réunion',
  (await poster('/api/animateur/terminer', {}, codeFaux)).status === 403);
verifier('la réunion est toujours là après ce refus',
  (await etatDe()).documents.length > 0 && fs.readdirSync(dossierReunion).length > 0);

const nouveau = (await poster('/api/animateur/terminer', {}).then((r) => r.json())).code;

verifier('le disque est vidé pour de vrai', fs.readdirSync(dossierReunion).length === 0);
verifier('un nouveau code est tiré', /^\d{4}$/.test(nouveau) && nouveau !== ancienCode, nouveau);
verifier('plus aucun document dans l’état', salleModule.etatPublic().documents.length === 0);
verifier('l’écran est revenu à l’accueil',
  salleModule.etatPublic().affichage.documentId === null);
verifier('sans document à l’écran, il n’y a pas de page à tourner',
  (await tourner(nouveau, 1)).status === 404);
verifier('l’écran est prévenu de la fin de réunion',
  (await flux.attendre((e) => e.code === nouveau, 3000)) !== null);
verifier('les pages de l’ancienne réunion ne se servent plus',
  await brute(`/page/${identifiant}/p-1.jpg`) === 404);

// --- Le filet du §9.2 -------------------------------------------------------

const { reglages } = await import('../src/config.js');
await depot(nouveau, 'oublie.pdf', contenu);
verifier('rien n’est effacé tant que la réunion est active',
  salleModule.effacerSiOubliee() === false);

reglages.effacementApresHeures = 0;   // « inactive depuis toujours »
verifier('une réunion oubliée finit par être effacée',
  salleModule.effacerSiOubliee() === true);
verifier('et son disque avec elle', fs.readdirSync(dossierReunion).length === 0);

// --- Fin --------------------------------------------------------------------

flux.fermer();
serveur.close();
fs.rmSync(dossier, { recursive: true, force: true });

console.log(echecs ? `\n${echecs} contrôle(s) en échec.` : '\nTout est passé.');
process.exit(echecs ? 1 : 0);
