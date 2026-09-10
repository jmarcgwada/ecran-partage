// ============================================================================
// LA PLOMBERIE HTTP
//
// Reprise d'Impression Express, allegee de ce qui n'a pas de sens ici : pas de
// session ni de mot de passe, une reunion se protege par le code de salle et
// par le reseau (§9.3), pas par des comptes.
//
// Rien dans ce fichier ne connait les reunions : c'est volontaire.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

export function json(res, code, corps, { fermer = false } = {}) {
  const texte = JSON.stringify(corps);
  const entetes = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texte),
    'cache-control': 'no-store',
  };
  // Repondre avant d'avoir tout lu condamne la connexion : Node ne la
  // reutilisera pas. Sans le dire au client, celui-ci la garde dans sa reserve
  // et sa requete SUIVANTE part dans le vide. L'en-tete est donc obligatoire
  // partout ou l'on repond en cours d'envoi — et il ne suffit pas seul, il va
  // avec viderRequete.
  if (fermer) entetes.connection = 'close';
  res.writeHead(code, entetes);
  res.end(texte);
}

export function erreur(res, code, message, options) {
  json(res, code, { erreur: message }, options);
}

// A ATTENDRE avant de repondre a un envoi refuse en cours de route — un fichier
// trop gros, typiquement. Rend true si le client a bien fini d'envoyer.
//
// Trois facons de se tromper, eprouvees dans cet ordre :
//   - ignorer le reste : il parasite la requete suivante sur la meme connexion ;
//   - fermer d'autorite : la coupure arrive au client avant qu'il ait lu le
//     message « fichier trop volumineux », il ne voit qu'une erreur reseau ;
//   - vider sans attendre : au moment de repondre, la requete est encore
//     incomplete, Node condamne donc la connexion — sans le dire au client, qui
//     la garde dans sa reserve et perd sa requete suivante.
//
// Il faut donc laisser le client finir, PUIS repondre. Le delai est la pour les
// cas absurdes : un envoi de plusieurs gigaoctets ne merite pas qu'on l'ecoute
// jusqu'au bout.
export function viderRequete(req, delaiMs = 5000) {
  if (req.readableEnded) return Promise.resolve(true);

  return new Promise((resoudre) => {
    const minuterie = setTimeout(() => { req.destroy(); resoudre(false); }, delaiMs);
    const fini = (abouti) => { clearTimeout(minuterie); resoudre(abouti); };
    req.on('end', () => fini(true));
    req.on('error', () => fini(false));
    req.on('close', () => fini(false));
    req.resume();
  });
}

const typesMime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function servirFichier(res, chemin, { cache = null } = {}) {
  let infos;
  try {
    infos = fs.statSync(chemin);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Introuvable');
  }
  const extension = path.extname(chemin).toLowerCase();
  const entetes = {
    'content-type': typesMime[extension] || 'application/octet-stream',
    'content-length': infos.size,
  };

  // Les pages et leur code doivent etre revalides a chaque visite. Sans cela,
  // l'ecran de la salle garde l'ancienne page apres une mise a jour, et l'on
  // cherche longtemps un bouton pourtant bien deploye. C'est d'autant plus
  // vrai ici que l'ecran, lui, n'est jamais rafraichi a la main.
  if (['.html', '.js', '.css'].includes(extension)) entetes['cache-control'] = 'no-cache';
  if (cache) entetes['cache-control'] = cache;

  res.writeHead(200, entetes);
  fs.createReadStream(chemin).pipe(res);
}

export function servirStatique(res, racine, cheminDemande) {
  // Un chemin normalise qui sortirait de la racine est un chemin qu'on refuse :
  // sans ce garde-fou, /../../etc/passwd serait servi sans broncher.
  const relatif = path.normalize(cheminDemande).replace(/^([/\\])+/, '');
  const cible = path.join(racine, relatif);
  if (!cible.startsWith(racine)) return erreur(res, 403, 'Chemin refusé');
  servirFichier(res, cible);
}

export async function lireCorpsJson(req, maxOctets = 1_000_000) {
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > maxOctets) throw new Error('Corps de requête trop volumineux');
    morceaux.push(morceau);
  }
  if (!taille) return {};
  return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
}
