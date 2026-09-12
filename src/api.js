// ============================================================================
// L'AIGUILLAGE
//
//   /scene           l'ecran de la salle : QR code, puis le document courant
//   /salle/<code>    le telephone d'un participant : le depot
//   /page/<id>/<n>   les pages, en images
//
// Ce que le code de salle protege : LE DEPOT, et rien d'autre (§4). Lire
// l'etat reste ouvert — l'ecran de la salle n'a aucun moyen de garder un
// secret, et la frontiere du service est le reseau (§9.3).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { reglages, dossierReunion, tailleMaxOctets } from './config.js';
import {
  json, erreur, viderRequete, servirFichier, servirStatique, lireCorpsJson,
} from './http.js';
import { lireMultipart } from './multipart.js';
import { preparer, typeAccepte, extensionsAcceptees } from './documents.js';
import {
  salle, etatPublic, codeJuste, reconnaitre, afficher, tournerPage,
  ouvrirDocument, documentPret, documentEnEchec, dossierDuDocument,
  peutPiloter, prendreLaMain, rendreLaMain, donnerLaMain, reglerMainLibre,
  retirerDocument, nouvelleReunion,
} from './salle.js';
import { ouvrirFlux } from './flux.js';

const executer = promisify(execFile);
const racinePublique = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// --- Le QR code -------------------------------------------------------------

// L'adresse par laquelle un TELEPHONE joint le service. Le reglage prime : ce
// que voit l'ecran de la salle dans son en-tete Host peut fort bien etre un
// « localhost » que personne d'autre ne peut joindre.
function adressePubliqueOu(req) {
  const reglee = (reglages.adressePublique || '').trim().replace(/\/+$/, '');
  if (reglee) return reglee;
  return `http://${req.headers.host || 'localhost'}`;
}

export function adresseDeLaSalle(req) {
  return `${adressePubliqueOu(req)}/salle/${salle.code}`;
}

async function servirQr(req, res) {
  try {
    const { stdout } = await executer('qrencode',
      ['-t', 'SVG', '-m', '1', '-s', '8', '-o', '-', adresseDeLaSalle(req)],
      { timeout: 15_000, maxBuffer: 4_000_000 });
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    res.end(stdout);
  } catch (err) {
    console.error('[qr]', err.message);
    // L'ecran sait retomber sur l'adresse en toutes lettres : un QR code
    // absent gene, il n'empeche pas de tenir la reunion.
    erreur(res, 500, 'QR code indisponible');
  }
}

// --- Les pages, en images ---------------------------------------------------

function servirPage(res, chemin) {
  // /page/<identifiant sur 16 hex>/p-<numero>.jpg — et rien d'autre. Les deux
  // formes sont verifiees plutot que nettoyees : ici, ce qui n'est pas
  // exactement attendu est refuse.
  const trouve = /^\/page\/([a-f0-9]{16})\/(p-\d+\.jpg)$/.exec(chemin);
  if (!trouve) return erreur(res, 404, 'Page inconnue.');

  const fichier = path.join(dossierDuDocument(trouve[1]), trouve[2]);
  if (!fichier.startsWith(dossierReunion)) return erreur(res, 403, 'Chemin refusé');

  // Une page ne change jamais et son adresse est unique : le cache du
  // navigateur de l'ecran peut la garder, ce qui rend le retour en arriere
  // instantane. La confidentialite tient au fait que l'identifiant disparait
  // avec la reunion.
  servirFichier(res, fichier, { cache: 'private, max-age=3600' });
}

// --- Le depot ---------------------------------------------------------------

async function recevoirDepot(req, res, url) {
  // Le code se verifie AVANT de lire quoi que ce soit — mais on laisse tout de
  // meme le telephone finir son envoi avant de repondre, sinon il recoit une
  // coupure reseau au lieu du message « code de salle incorrect ».
  if (!codeJuste(url.searchParams.get('code'))) {
    await viderRequete(req);
    return erreur(res, 403, 'Code de salle incorrect.', { fermer: true });
  }

  const recu = path.join(dossierReunion, `.recu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  let envoi;
  try {
    envoi = await lireMultipart(req, {
      maxOctets: tailleMaxOctets(),
      maxFichiers: reglages.limites.fichiersMax,
      dossier: recu,
    });
  } catch (err) {
    fs.rmSync(recu, { recursive: true, force: true });
    const abouti = await viderRequete(req);
    const options = { fermer: !abouti };
    if (err.message === 'TROP_GROS') {
      return erreur(res, 413,
        `Fichier trop volumineux (maximum ${reglages.limites.tailleMaxMo} Mo).`, options);
    }
    if (err.message === 'TROP_DE_FICHIERS') {
      return erreur(res, 413,
        `Trop de documents à la fois (maximum ${reglages.limites.fichiersMax}).`, options);
    }
    console.error('[depot]', err);
    return erreur(res, 400, "L'envoi n'a pas pu être lu.", options);
  }

  if (!envoi.fichiers.length) {
    fs.rmSync(recu, { recursive: true, force: true });
    return erreur(res, 400, 'Aucun document dans cet envoi.');
  }

  const participant = reconnaitre(envoi.champs.participant, envoi.champs.prenom);

  const acceptes = [];
  const refuses = [];
  for (const fichier of envoi.fichiers) {
    if (!typeAccepte(fichier.nom)) {
      refuses.push({ nom: fichier.nom, motif: 'Format non accepté' });
      fs.rmSync(fichier.chemin, { force: true });
      continue;
    }
    const document = ouvrirDocument({ nom: fichier.nom, prenom: participant.prenom });
    // Le fichier quitte le dossier de reception pour celui du document : c'est
    // ce qui rend l'effacement de fin de reunion aussi simple qu'un rmSync.
    const source = path.join(dossierDuDocument(document.id), `source${path.extname(fichier.nom).toLowerCase()}`);
    fs.renameSync(fichier.chemin, source);
    acceptes.push({ document, fichier: { nom: fichier.nom, chemin: source } });
  }

  fs.rmSync(recu, { recursive: true, force: true });

  // On repond TOUT DE SUITE, sans attendre la conversion : LibreOffice peut
  // prendre plusieurs secondes sur un .pptx, et un telephone qui attend une
  // reponse est un telephone dont on croit qu'il a plante. L'ecran, lui,
  // affiche « réception d'un document… » et bascule des que c'est pret.
  json(res, 200, {
    participant: participant.id,
    documents: acceptes.map((a) => ({ id: a.document.id, nom: a.document.nom })),
    refuses,
  });

  convertirEnSerie(acceptes);
}

// En SERIE et non en parallele : trois .pptx deposes ensemble lanceraient trois
// LibreOffice sur le NAS, qui n'a pas de coeurs a revendre. L'un apres l'autre,
// chacun apparait a l'ecran des qu'il est pret.
async function convertirEnSerie(acceptes) {
  for (const { document, fichier } of acceptes) {
    try {
      const resultat = await preparer(fichier, dossierDuDocument(document.id));
      if (resultat.erreur) documentEnEchec(document, resultat.erreur);
      else documentPret(document, resultat.pages);
    } catch (err) {
      console.error('[conversion]', err);
      documentEnEchec(document, 'Conversion impossible.');
    }
  }
}

// --- Remettre un document a l'ecran -----------------------------------------
//
// Un document depose reste disponible toute la reunion : y revenir ne coute
// aucun renvoi de fichier, juste une ligne sur le reseau. C'est la difference
// entre « je vous remontre le budget » et « attendez, je le renvoie ».
//
// Le code de salle est exige, comme pour le depot : changer ce que tout le
// monde voit est un geste au moins aussi engageant que d'ajouter un document.
// En revanche la main est libre — n'importe quel participant peut le faire. Le
// reglage « seul l'animateur distribue la parole » (§5) viendra avec la page
// de l'animateur.
async function mettreALEcran(req, res, url) {
  const corps = await corpsAvecCode(req, res, url);
  if (!corps) return undefined;

  if (!peutPiloter(corps.participant)) return refusDeLaMain(res);

  // afficher() refuse de lui-meme un document inconnu ou pas encore converti :
  // on ne veut pas d'un ecran noir parce qu'on a clique trop tot.
  if (!afficher(corps.documentId, corps.page)) {
    return erreur(res, 404, "Ce document n'est pas affichable.");
  }
  return json(res, 200, { affichage: etatPublic().affichage });
}

// Le code de salle, puis le corps. Les deux memes gestes sur toutes les
// commandes, y compris le viderRequete sans lequel un refus arrive au telephone
// sous forme de coupure reseau.
async function corpsAvecCode(req, res, url) {
  if (!codeJuste(url.searchParams.get('code'))) {
    await viderRequete(req);
    erreur(res, 403, 'Code de salle incorrect.', { fermer: true });
    return null;
  }
  try {
    return await lireCorpsJson(req);
  } catch {
    erreur(res, 400, 'Demande illisible.');
    return null;
  }
}

function refusDeLaMain(res) {
  const qui = salle.participants.find((p) => p.id === salle.mainA);
  return erreur(res, 409, qui && qui.prenom
    ? `${qui.prenom} a la main sur l’écran.`
    : "Quelqu'un d'autre a la main sur l’écran.");
}

// Se faire connaitre en arrivant sur /salle, sans rien deposer. Sans cela, on
// n'existerait qu'apres son premier envoi — et l'animateur ne pourrait pas
// donner la main a quelqu'un qui n'a encore rien envoye, ce qui est pourtant le
// cas de celui qui veut commenter le document d'un autre.
async function rejoindre(req, res, url) {
  const corps = await corpsAvecCode(req, res, url);
  if (!corps) return undefined;
  const participant = reconnaitre(corps.participant, corps.prenom);
  return json(res, 200, { participant: participant.id });
}

// --- La main ----------------------------------------------------------------

async function gererLaMain(req, res, url) {
  const corps = await corpsAvecCode(req, res, url);
  if (!corps) return undefined;

  if (corps.action === 'rendre') {
    if (!rendreLaMain(corps.participant)) return erreur(res, 409, "Vous n'avez pas la main.");
    return json(res, 200, { mainA: salle.mainA });
  }
  if (!prendreLaMain(corps.participant)) return refusDeLaMain(res);
  return json(res, 200, { mainA: salle.mainA });
}

// --- L'animateur ------------------------------------------------------------
//
// Aucune barriere de plus que le code de salle : le cahier ne veut pas de
// comptes (§4), et l'animateur d'une reunion est celui qui ouvre cette page.
// C'est assez pour empecher le bureau d'a cote, et cela n'a jamais pretendu
// etre davantage.

async function routerAnimateur(req, res, url, chemin) {
  const corps = await corpsAvecCode(req, res, url);
  if (!corps) return undefined;

  if (chemin === '/api/animateur/main-libre') {
    return json(res, 200, { laMainEstLibre: reglerMainLibre(corps.valeur) });
  }
  if (chemin === '/api/animateur/donner') {
    if (!donnerLaMain(corps.participant)) return erreur(res, 404, 'Participant inconnu.');
    return json(res, 200, { mainA: salle.mainA });
  }
  if (chemin === '/api/animateur/retirer') {
    if (!retirerDocument(corps.documentId)) return erreur(res, 404, 'Document inconnu.');
    return json(res, 200, { retire: true });
  }
  if (chemin === '/api/animateur/terminer') {
    // Le geste du §9.1 : les fichiers quittent le disque, un nouveau code est
    // tire, et l'ecran revient au QR code d'accueil.
    return json(res, 200, { code: nouvelleReunion() });
  }
  return erreur(res, 404, 'Commande inconnue.');
}

// Tourner une page du document affiche. Le telephone envoie un SENS, pas un
// numero : voir tournerPage() pour la raison, qui se sent des qu'on appuie deux
// fois de suite sur « Suivante ».
async function tourner(req, res, url) {
  const corps = await corpsAvecCode(req, res, url);
  if (!corps) return undefined;

  if (!peutPiloter(corps.participant)) return refusDeLaMain(res);

  const page = tournerPage(corps.sens);
  if (page === null) return erreur(res, 404, "Aucun document n'est affiché.");
  return json(res, 200, { affichage: etatPublic().affichage });
}

// --- Aiguillage -------------------------------------------------------------

export function creerGestionnaire() {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const chemin = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (chemin === '/api/sante' && req.method === 'GET') return json(res, 200, { ok: true });
      if (chemin === '/api/flux' && req.method === 'GET') return ouvrirFlux(req, res);
      if (chemin === '/api/etat' && req.method === 'GET') {
        return json(res, 200, {
          ...etatPublic(),
          adresse: adresseDeLaSalle(req),
          limites: reglages.limites,
          formats: extensionsAcceptees,
        });
      }
      if (chemin === '/api/depot' && req.method === 'POST') return await recevoirDepot(req, res, url);
      if (chemin === '/api/afficher' && req.method === 'POST') return await mettreALEcran(req, res, url);
      if (chemin === '/api/page' && req.method === 'POST') return await tourner(req, res, url);
      if (chemin === '/api/rejoindre' && req.method === 'POST') return await rejoindre(req, res, url);
      if (chemin === '/api/main' && req.method === 'POST') return await gererLaMain(req, res, url);
      if (chemin.startsWith('/api/animateur/') && req.method === 'POST') {
        return await routerAnimateur(req, res, url, chemin);
      }
      if (chemin === '/api/qr.svg' && req.method === 'GET') return await servirQr(req, res);

      if (chemin.startsWith('/page/')) return servirPage(res, chemin);

      if (chemin === '/scene') return servirFichier(res, path.join(racinePublique, 'scene.html'));
      if (chemin === '/animateur') return servirFichier(res, path.join(racinePublique, 'animateur.html'));
      if (/^\/salle\/\d{4}$/.test(chemin)) {
        return servirFichier(res, path.join(racinePublique, 'salle.html'));
      }
      if (chemin === '/') return servirFichier(res, path.join(racinePublique, 'index.html'));

      return servirStatique(res, racinePublique, chemin);
    } catch (err) {
      console.error('[http]', chemin, err);
      if (!res.headersSent) erreur(res, 500, 'Erreur interne.');
      else res.end();
    }
  };
}
