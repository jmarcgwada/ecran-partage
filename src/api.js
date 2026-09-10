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
  json, erreur, viderRequete, servirFichier, servirStatique,
} from './http.js';
import { lireMultipart } from './multipart.js';
import { preparer, typeAccepte, extensionsAcceptees } from './documents.js';
import {
  salle, etatPublic, codeJuste, reconnaitre,
  ouvrirDocument, documentPret, documentEnEchec, dossierDuDocument,
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
      if (chemin === '/api/qr.svg' && req.method === 'GET') return await servirQr(req, res);

      if (chemin.startsWith('/page/')) return servirPage(res, chemin);

      if (chemin === '/scene') return servirFichier(res, path.join(racinePublique, 'scene.html'));
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
