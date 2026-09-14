// ============================================================================
// LA PORTE PUBLIQUE
//
// Le service est joignable depuis Internet, par le proxy inverse de DSM. Ce
// fichier repond a deux questions, et a elles seules :
//
//   - cette requete vient-elle d'Internet ?
//   - cette adresse a-t-elle deja trop essaye de codes faux ?
//
// Pourquoi il le faut. Tant que le service ne vivait que sur le reseau de la
// salle, l'etat de la reunion etait lisible sans code : l'ecran doit l'afficher
// sans rien prouver. Depuis Internet, ce meme etat donnait LE CODE, LA LISTE DES
// DOCUMENTS et L'ADRESSE DE LEURS PAGES a n'importe qui. Depuis Internet, rien
// ne se lit donc plus sans le code.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { reglages, dossierDonnees } from './config.js';

// La requete arrive-t-elle par la porte PUBLIQUE ?
//
// Ce qui la distingue, c'est le NOM D'HOTE demande — pas l'adresse de la prise.
// Derriere le proxy inverse, toute requete semble venir du NAS lui-meme ; et sur
// ce NAS, Tailscale relaie meme le tailnet vers la boucle locale. L'adresse de
// la prise ne dit donc rien.
//
// Le nom d'hote, lui, est fiable : DSM aiguille ses regles de proxy d'apres ce
// nom, une requete venue d'Internet ne peut pas nous atteindre en en annoncant un
// autre — elle ne serait pas routee jusqu'ici.
export function vientDeInternet(req) {
  const hote = String(req.headers.host || '').toLowerCase();

  if (reglages.adressePublique) {
    try {
      return hote === new URL(reglages.adressePublique).host.toLowerCase();
    } catch {
      // Adresse publique illisible : on retombe sur la regle prudente ci-dessous.
    }
  }

  // Aucune adresse publique declaree : on ne sait pas distinguer. On tient alors
  // tout passage par un proxy pour venu du dehors — c'est le choix prudent.
  return Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
}

// L'adresse du client, pour compter ses essais.
//
// La DERNIERE entree de X-Forwarded-For, et non la premiere. Le proxy AJOUTE
// l'adresse qu'il voit a la fin de l'en-tete ; tout ce qui precede, c'est le
// client qui l'a ecrit. Prendre la premiere laisserait un attaquant s'inventer
// une adresse neuve a chaque essai, et la limite ne limiterait plus rien.
//
// Si le proxy REMPLACE l'en-tete au lieu de le completer, il n'y a qu'une
// entree : la derniere reste la bonne. Ce choix tient donc dans les deux cas.
export function adresseDuClient(req) {
  const transmise = String(req.headers['x-forwarded-for'] || '');
  const entrees = transmise.split(',').map((e) => e.trim()).filter(Boolean);
  if (entrees.length) return entrees[entrees.length - 1];

  const prise = (req.socket && req.socket.remoteAddress) || 'inconnue';
  return prise.replace(/^::ffff:/, '');   // IPv4 vue a travers IPv6
}

// --- La limite des codes faux -------------------------------------------------
//
// Un code de quatre chiffres, c'est dix mille possibilites : un script les
// essaie toutes en quelques minutes. Au-dela d'un certain nombre d'echecs, une
// adresse attend.
//
// On compte les ECHECS, pas les essais : un participant qui tape juste n'est
// jamais freine. Rien n'est ecrit sur le disque — une adresse IP est une donnee
// personnelle, la conserver pour compter jusqu'a dix serait disproportionne.
//
// Ce que cette limite ne fait PAS : arreter un attaquant qui dispose de
// milliers d'adresses. Elle transforme quelques minutes en plusieurs jours pour
// une adresse seule ; le code, lui, change a chaque reunion.

const FENETRE_MS = 10 * 60 * 1000;
const echecs = new Map();   // adresse -> [horodatages des echecs]

function recents(adresse, maintenant) {
  const gardes = (echecs.get(adresse) || []).filter((t) => maintenant - t < FENETRE_MS);
  if (gardes.length) echecs.set(adresse, gardes);
  else echecs.delete(adresse);
  return gardes;
}

// Rend { bloque: false } ou { bloque: true, minutes } — les minutes a attendre
// avant que le plus ancien echec sorte de la fenetre.
export function etatDesEssais(adresse) {
  const maximum = Number(reglages.codesFauxMax) || 10;
  const maintenant = Date.now();
  const passes = recents(adresse, maintenant);
  if (passes.length < maximum) return { bloque: false };
  const plusAncien = Math.min(...passes);
  return {
    bloque: true,
    minutes: Math.max(1, Math.ceil((FENETRE_MS - (maintenant - plusAncien)) / 60000)),
  };
}

export function noterEchec(adresse) {
  const liste = recents(adresse, Date.now());
  liste.push(Date.now());
  echecs.set(adresse, liste);
}

// Appele par la minuterie du serveur : sans ce menage, la table garderait pour
// toujours les adresses qui ne reviennent jamais.
export function oublierLesVieuxEchecs() {
  const maintenant = Date.now();
  for (const adresse of [...echecs.keys()]) recents(adresse, maintenant);
}

// Pour le banc d'essai : repartir d'une table vide entre deux series.
export function toutOublier() {
  echecs.clear();
}

// --- Le jeton de l'ecran ------------------------------------------------------
//
// L'ecran de la salle n'a pas de code a presenter : c'est lui qui l'AFFICHE. Tant
// qu'il s'ouvrait sur le reseau local, il n'en avait pas besoin. Quand la salle
// de reunion est ailleurs, il doit passer par la porte publique — et presenter
// quelque chose. C'est ce jeton, dans l'adresse de l'ecran :
//
//   https://<adresse publique>/scene?jeton=...
//
// Trois partis pris :
//
//   - DURABLE. Il vit dans le dossier de donnees et survit aux redemarrages :
//     l'ecran s'ouvre une fois pour toutes, un jeton qui changerait a chaque
//     deploiement casserait son adresse. Pour en changer, supprimer le fichier
//     et redemarrer ; l'ancienne adresse cesse aussitot de fonctionner.
//
//   - JAMAIS AFFICHE sur un telephone, pas meme celui de l'animateur. N'importe
//     qui peut devenir animateur, et le jeton ouvre TOUTES les reunions a venir,
//     pas seulement celle-ci : ce serait un acces permanent offert a quiconque a
//     mene une reunion une fois. Il se lit dans le journal du conteneur, reserve
//     a qui administre le NAS.
//
//   - HORS DE LA LIMITE DES CODES FAUX. Un jeton valide passe meme quand
//     l'adresse est bloquee : dans une salle, l'ecran et les telephones sortent
//     souvent par la meme adresse Internet, et dix fautes de frappe d'un
//     participant eteindraient l'ecran en pleine reunion. Aucun risque a cela :
//     256 bits ne se devinent pas, contrairement a quatre chiffres. Pour la meme
//     raison, un jeton faux n'est pas compte comme un echec.

const fichierJeton = () => path.join(dossierDonnees, 'jeton-ecran');
let jetonEnMemoire = null;

export function jetonEcran() {
  if (jetonEnMemoire) return jetonEnMemoire;

  try {
    const lu = fs.readFileSync(fichierJeton(), 'utf8').trim();
    // Un fichier tronque ou vide ne vaut pas jeton : on en refait un plutot que
    // d'accepter un secret de trois caracteres.
    if (lu.length >= 40) jetonEnMemoire = lu;
  } catch {
    // Premier demarrage : pas encore de jeton.
  }

  if (!jetonEnMemoire) {
    jetonEnMemoire = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(dossierDonnees, { recursive: true });
    fs.writeFileSync(fichierJeton(), jetonEnMemoire, { mode: 0o600 });
  }
  return jetonEnMemoire;
}

// Comparaison a duree constante, sur des empreintes de meme longueur : le temps
// de reponse ne doit rien dire des premiers caracteres justes.
export function jetonJuste(propose) {
  if (!propose) return false;
  const a = crypto.createHash('sha256').update(String(propose)).digest();
  const b = crypto.createHash('sha256').update(jetonEcran()).digest();
  return crypto.timingSafeEqual(a, b);
}

// Pour le banc d'essai : oublier le jeton en memoire, comme un redemarrage.
export function oublierJetonEnMemoire() {
  jetonEnMemoire = null;
}
