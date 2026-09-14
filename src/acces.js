// ============================================================================
// LA PORTE
//
// Une seule porte, et elle est fermee d'ou que l'on vienne : rien de la reunion
// ne se lit sans le code de salle — ou, pour l'ecran, sans son jeton.
//
// Ce n'etait pas le cas au depart, et c'etait une fuite sur deux fronts :
//
//   - depuis Internet, l'etat de la reunion donnait LE CODE, LA LISTE DES
//     DOCUMENTS et L'ADRESSE DE LEURS PAGES a n'importe qui ;
//   - sur le reseau local, la meme lecture restait ouverte, parce que l'ecran de
//     la salle n'avait rien a presenter. N'importe quel appareil branche sur le
//     Wi-Fi du magasin lisait les documents d'une reunion en cours.
//
// Depuis que l'ecran a un jeton, plus aucune exception n'est necessaire.
//
// Ce fichier repond a trois questions, et a elles seules :
//   - de quelle adresse vient cette requete ?
//   - cette adresse a-t-elle deja trop essaye de codes faux ?
//   - ce jeton est-il celui de l'ecran ?
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { reglages, dossierDonnees } from './config.js';

// L'adresse du client, pour compter ses essais.
//
// La DERNIERE entree de X-Forwarded-For, et non la premiere. Le proxy inverse de
// DSM AJOUTE l'adresse qu'il voit a la fin de l'en-tete ; tout ce qui precede,
// c'est le client qui l'a ecrit. Prendre la premiere laisserait un attaquant
// s'inventer une adresse neuve a chaque essai. Verifie a travers le vrai proxy.
//
// Sans cet en-tete, l'adresse de la prise — et ici elle ne distingue personne :
// mesure faite sur le NAS, le conteneur voit TOUTES les connexions directes
// arriver de la passerelle de Docker (172.17.0.1), qu'elles viennent du reseau
// local, du tailnet ou du NAS lui-meme. Les acces directs partagent donc une
// meme limite. C'est acceptable : les participants arrivent par l'adresse
// publique, et l'ecran presente un jeton, qui passe outre.
//
// LIMITE CONNUE, que le code ne peut pas fermer seul : un appareil qui atteint
// directement le port du service peut ecrire lui-meme un X-Forwarded-For, et
// s'inventer une adresse a chaque essai. Aucune marque du proxy n'est
// infalsifiable. La parade est ailleurs : ne publier le port que sur la boucle
// locale du NAS, pour que tout passe obligatoirement par DSM. Voir le README.
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
// essaie toutes en quelques minutes par Internet, en une minute sur un reseau
// local. Au-dela d'un certain nombre d'echecs, une adresse attend.
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
// L'ecran de la salle n'a pas de code a presenter : c'est lui qui l'AFFICHE. Il
// presente donc un jeton, dans son adresse, en local comme par Internet :
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
//     l'adresse est bloquee : l'ecran et les telephones d'une salle partagent
//     souvent une meme adresse, et dix fautes de frappe d'un participant
//     eteindraient l'ecran en pleine reunion. Aucun risque a cela : 256 bits ne
//     se devinent pas, contrairement a quatre chiffres. Pour la meme raison, un
//     jeton faux n'est pas compte comme un echec.

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

// Changer le jeton : un nouveau, ecrit sur le disque, et l'ancien refuse des la
// requete suivante. Depuis la page d'installation (installation.js), qui coupe
// aussi les ecrans deja branches avec l'ancien.
export function changerJeton() {
  jetonEnMemoire = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(dossierDonnees, { recursive: true });
  fs.writeFileSync(fichierJeton(), jetonEnMemoire, { mode: 0o600 });
  return jetonEnMemoire;
}

// Pour le banc d'essai : oublier le jeton en memoire, comme un redemarrage.
export function oublierJetonEnMemoire() {
  jetonEnMemoire = null;
}
