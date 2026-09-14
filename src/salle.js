// ============================================================================
// LA SALLE
//
// Une seule reunion a la fois, entierement en memoire, plus un dossier de
// fichiers temporaires. RIEN n'est persiste : une reunion terminee ne laisse
// aucune trace, ni sur le disque ni au redemarrage (§9).
//
// Ce fichier est la seule verite sur l'etat de la reunion. Tout le reste
// (l'API, le flux temps reel, les pages) ne fait que le lire ou le modifier
// par les fonctions d'ici.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { dossierReunion, reglages } from './config.js';

export const salle = {
  code: '0000',
  ouverte: true,
  ouverteLe: 0,
  derniereActivite: 0,

  // Le tour de parole (§5, §7). Libre par defaut : chacun pilote l'ecran.
  mainA: null,
  laMainEstLibre: true,

  // L'animateur : un participant qui l'a revendique. null tant que personne ne
  // l'a fait — la reunion fonctionne tres bien sans.
  animateur: null,

  participants: [],
  documents: [],
  affichage: { documentId: null, page: 0, lecture: false },
};

// --- Les abonnes au changement ---------------------------------------------
// Le flux temps reel s'inscrit ici. La salle ne sait pas ce qu'est un SSE, et
// c'est ce qui permet au banc d'essai d'ecouter les changements sans ouvrir de
// connexion HTTP.

const temoins = new Set();

export function surChangement(fn) {
  temoins.add(fn);
  return () => temoins.delete(fn);
}

function signaler() {
  const vue = etatPublic();
  for (const fn of temoins) {
    try { fn(vue); } catch (err) { console.error('[salle] témoin', err); }
  }
}

// Les reglages de confort de l'ecran vivent dans config.js, pas ici — mais
// l'ecran les recoit par le MEME flux. Il faut donc pouvoir reveiller les
// temoins sans qu'aucun document n'ait bouge.
export function signalerChangement() {
  signaler();
}

// --- Le code de salle -------------------------------------------------------

function nouveauCode() {
  // randomInt et non Math.random : ce code est la seule chose qui empeche le
  // bureau d'a cote de deposer une photo pendant la reunion.
  return String(crypto.randomInt(1000, 10000));
}

export function codeJuste(propose) {
  const attendu = salle.code;
  const a = Buffer.from(String(propose ?? ''));
  const b = Buffer.from(attendu);
  // Comparaison a duree constante, et longueurs comparees d'abord : sans cela
  // timingSafeEqual leve au lieu de rendre false.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Le menage --------------------------------------------------------------

// EFFACE POUR DE VRAI : les fichiers quittent le disque, ils ne sont pas
// seulement retires d'une liste (§9.1). C'est la difference entre « la reunion
// est finie » et « le .pptx confidentiel est encore sur le NAS ».
function viderLeDisque() {
  try {
    fs.rmSync(dossierReunion, { recursive: true, force: true });
  } catch (err) {
    console.error('[salle] effacement incomplet :', err.message);
  }
  fs.mkdirSync(dossierReunion, { recursive: true });
}

export function nouvelleReunion() {
  viderLeDisque();
  salle.code = nouveauCode();
  salle.ouverte = true;
  salle.ouverteLe = Date.now();
  salle.derniereActivite = Date.now();
  salle.mainA = null;
  salle.animateur = null;
  salle.participants = [];
  salle.documents = [];
  salle.affichage = { documentId: null, page: 0, lecture: false };
  signaler();
  return salle.code;
}

// Le filet du §9.2. Une reunion que personne n'a pris la peine de terminer ne
// doit pas laisser trainer ses documents. On compte a partir de la DERNIERE
// activite : une reunion longue n'est pas effacee sous le nez des participants.
export function effacerSiOubliee() {
  if (!salle.documents.length) return false;
  const limite = reglages.effacementApresHeures * 3600 * 1000;
  if (Date.now() - salle.derniereActivite < limite) return false;
  console.log('[salle] réunion inactive : effacement automatique');
  nouvelleReunion();
  return true;
}

function toucher() {
  salle.derniereActivite = Date.now();
}

// --- Les participants -------------------------------------------------------

export function reconnaitre(participantId, prenom) {
  const id = participantId && /^[a-f0-9]{16}$/.test(participantId)
    ? participantId
    : crypto.randomBytes(8).toString('hex');

  let participant = salle.participants.find((p) => p.id === id);
  if (!participant) {
    participant = { id, prenom: '', vuLe: 0 };
    salle.participants.push(participant);
  }
  if (prenom) participant.prenom = String(prenom).slice(0, 40);
  participant.vuLe = Date.now();
  toucher();
  return participant;
}

// --- Le tour de parole ------------------------------------------------------
//
// Deux regimes, et c'est un REGLAGE, pas une hierarchie (§5) :
//
//   la main est libre  — le cas par defaut. Chacun affiche ce qu'il veut et
//                        tourne les pages. Sur une reunion a trois, c'est ce
//                        qu'on veut : personne n'a envie de demander la parole.
//   la main se prend   — un seul telephone pilote l'ecran a la fois. Celui qui
//                        l'a la garde jusqu'a ce qu'il la rende, ou que
//                        l'animateur la donne a quelqu'un d'autre.
//
// Ce qui est protege, c'est le PILOTAGE de l'ecran. Deposer reste toujours
// permis : on prepare son document pendant que quelqu'un d'autre presente.
//
// L'identifiant de participant n'est pas un secret — il est tire au sort par le
// telephone et voyage en clair. Il empeche les gestes involontaires, pas un
// participant decide a reprendre la main. La vraie frontiere reste le reseau de
// la salle et le code (§9.3) : une reunion n'est pas un systeme de comptes.

export function peutPiloter(participantId) {
  // L'animateur pilote toujours : il mene la reunion, il doit pouvoir remettre
  // le QR code a l'ecran pendant que quelqu'un d'autre a la main.
  if (estAnimateur(participantId)) return true;
  if (salle.laMainEstLibre) return true;
  if (!salle.mainA) return false;      // la main est a prendre
  return salle.mainA === participantId;
}

export function prendreLaMain(participantId) {
  if (!participantId) return false;
  if (salle.mainA && salle.mainA !== participantId) return false;
  salle.mainA = participantId;
  toucher();
  signaler();
  return true;
}

export function rendreLaMain(participantId) {
  if (salle.mainA !== participantId) return false;
  salle.mainA = null;
  toucher();
  signaler();
  return true;
}

// Le geste de l'animateur : donner la main a quelqu'un, ou la liberer. Ne
// demande l'accord de personne — c'est tout l'objet de la page /animateur.
export function donnerLaMain(participantId) {
  if (participantId && !salle.participants.some((p) => p.id === participantId)) return false;
  salle.mainA = participantId || null;
  toucher();
  signaler();
  return true;
}

export function reglerMainLibre(valeur) {
  salle.laMainEstLibre = !!valeur;
  // En passant au tour de parole, personne n'a la main : elle est a prendre.
  // La donner d'office au dernier qui a parle serait une surprise.
  if (!salle.laMainEstLibre) salle.mainA = null;
  toucher();
  signaler();
  return salle.laMainEstLibre;
}

// --- L'animateur ------------------------------------------------------------
//
// Un participant parmi les autres, qui a REVENDIQUE le role depuis son
// telephone. Lui seul administre : fermer le tour de parole, donner la main,
// retirer un document, regler l'ecran, terminer la reunion.
//
// Trois regles :
//   - le premier qui revendique l'obtient ; tant qu'il est la, personne ne le
//     lui prend ;
//   - il peut le transmettre a un autre participant, ou le quitter ;
//   - s'il ne donne plus signe de vie pendant quelques minutes, le role
//     redevient revendicable. Sans ce secours, un telephone perdu bloquerait la
//     reunion : plus personne ne pourrait la terminer.
//
// Le nom de l'animateur est affiche a l'ecran. C'est la vraie protection contre
// une prise de role abusive : elle se voit de toute la salle.
//
// Comme pour la main, l'identifiant n'est pas un secret — voir plus haut.

function participantPar(id) {
  return salle.participants.find((p) => p.id === id) || null;
}

function present(participant) {
  return !!participant
    && Date.now() - participant.vuLe < reglages.animateurAbsentMinutes * 60 * 1000;
}

export function estAnimateur(participantId) {
  if (!participantId || salle.animateur !== participantId) return false;
  return present(participantPar(participantId));
}

// Un signe de vie. N'appelle PAS toucher() : etre la n'est pas une activite de
// la reunion. Sans cette distinction, un telephone ouvert sur la table
// empecherait le retour a l'accueil et le filet d'effacement du §9.2.
export function signalerPresence(participantId) {
  const participant = participantPar(participantId);
  if (!participant) return false;

  // Le cas du telephone qui se reveille : l'animateur l'avait range plus
  // longtemps que le delai de secours, les telephones ont appris que le role
  // etait libre — mais personne ne l'a repris. Il le retrouve, et il faut le
  // DIRE aux telephones, sinon ils continueraient d'afficher le role a prendre.
  const revenant = salle.animateur === participantId && !present(participant);

  participant.vuLe = Date.now();
  if (revenant) signaler();
  return true;
}

export function revendiquerAnimation(participantId) {
  const participant = participantPar(participantId);
  if (!participant) return false;
  if (salle.animateur && salle.animateur !== participantId && estAnimateur(salle.animateur)) return false;
  salle.animateur = participantId;
  participant.vuLe = Date.now();
  toucher();
  signaler();
  return true;
}

export function transmettreAnimation(depuis, vers) {
  if (!estAnimateur(depuis)) return false;
  const cible = participantPar(vers);
  if (!cible) return null;
  salle.animateur = cible.id;
  // Le nouvel animateur est repute present a l'instant de la transmission :
  // sinon, si son telephone dormait depuis dix minutes, le role lui echapperait
  // aussitot recu.
  cible.vuLe = Date.now();
  toucher();
  signaler();
  return true;
}

export function quitterAnimation(participantId) {
  if (salle.animateur !== participantId) return false;
  salle.animateur = null;
  toucher();
  signaler();
  return true;
}

// Appelee par la minuterie du serveur. Le depart d'un animateur n'est un
// evenement pour personne — son telephone se tait, voila tout. Il faut donc que
// le serveur le constate et PREVIENNE les telephones, sinon ils continueraient
// d'afficher « animée par Camille » et personne ne verrait le bouton pour
// reprendre le role.
let dernierAnimateurSignaleParti = null;
export function surveillerAnimateur() {
  if (salle.animateur && !estAnimateur(salle.animateur)) {
    if (dernierAnimateurSignaleParti === salle.animateur) return false;
    dernierAnimateurSignaleParti = salle.animateur;
    signaler();
    return true;
  }
  dernierAnimateurSignaleParti = null;
  return false;
}

// --- Les documents ----------------------------------------------------------

export function dossierDuDocument(id) {
  return path.join(dossierReunion, id);
}

// Le document nait « en conversion » et apparait TOUT DE SUITE dans l'etat :
// c'est ce qui permet a l'ecran d'afficher « réception d'un document… » au lieu
// de rester sur le QR code pendant que LibreOffice travaille. Sans cela, on
// croit a une panne et on renvoie le fichier (§12).
export function ouvrirDocument({ nom, prenom }) {
  const document = {
    id: crypto.randomBytes(8).toString('hex'),
    nom: String(nom || 'document').slice(0, 120),
    prenom: String(prenom || '').slice(0, 40),
    deposeLe: Date.now(),
    etat: 'conversion',
    pages: [],
    video: null,      // le nom du fichier, pour une video servie telle quelle
    erreur: null,
  };
  salle.documents.push(document);
  fs.mkdirSync(dossierDuDocument(document.id), { recursive: true });
  toucher();
  signaler();
  return document;
}

export function documentPret(document, resultat) {
  document.etat = 'pret';
  if (resultat.video) document.video = resultat.video;
  else document.pages = (resultat.pages || []).map((nom) => `/page/${document.id}/${nom}`);
  toucher();
  // Deposer, c'est montrer : le dernier document pret prend l'ecran. Le tour de
  // parole, lui, ne gouverne que ce qu'on fait ENSUITE.
  afficher(document.id, 0);
  return document;
}

export function documentEnEchec(document, message) {
  document.etat = 'erreur';
  document.erreur = message;
  toucher();
  signaler();
  return document;
}

export function documentPar(id) {
  return salle.documents.find((d) => d.id === id) || null;
}

export function afficher(documentId, page = 0) {
  const document = documentPar(documentId);
  if (!document || document.etat !== 'pret') return false;
  const numero = Math.max(0, Math.min(Number(page) || 0, document.pages.length - 1));
  // Une video arrive en pause : elle demarrera quand quelqu'un le decidera
  // depuis son telephone, pas en surprenant la salle avec du son.
  salle.affichage = { documentId: document.id, page: numero, lecture: false };
  toucher();
  signaler();
  return true;
}

// Lire ou mettre en pause la video affichee. L'ecran suit par le flux.
export function reglerLecture(enLecture) {
  const document = documentPar(salle.affichage.documentId);
  if (!document || !document.video) return false;
  salle.affichage.lecture = !!enLecture;
  toucher();
  signaler();
  return true;
}

// Le retour a l'accueil du §11, phase 4 : au bout d'un moment sans rien faire,
// l'ecran redonne le QR code, pour qu'un retardataire puisse rejoindre sans
// demander a personne. Les documents, eux, restent : ce n'est pas une fin de
// reunion.
export function retourAccueilSiInactif() {
  const minutes = reglages.retourAccueilMinutes;
  if (!minutes || !salle.affichage.documentId) return false;
  if (Date.now() - salle.derniereActivite < minutes * 60 * 1000) return false;
  revenirAAccueil();
  return true;
}

// Tourner une page du document AFFICHE. Le sens plutot qu'un numero de page :
// le telephone qui commande peut avoir une seconde de retard sur l'ecran, et
// deux appuis rapides sur « Suivante » doivent avancer de deux pages, pas
// d'une seule. C'est le serveur qui sait ou l'on en est.
//
// Rend le nouveau numero de page, ou null s'il n'y a rien a tourner.
export function tournerPage(sens) {
  const document = documentPar(salle.affichage.documentId);
  if (!document || document.etat !== 'pret') return null;

  const cible = salle.affichage.page + (Number(sens) >= 0 ? 1 : -1);
  // On s'arrete aux bords sans rien signaler : une page de plus apres la
  // derniere n'est pas une erreur, c'est la fin du document.
  if (cible < 0 || cible >= document.pages.length) return salle.affichage.page;

  salle.affichage = { documentId: document.id, page: cible };
  toucher();
  signaler();
  return cible;
}

// Retirer un document : geste de l'animateur, pour la diapositive envoyee par
// erreur. EFFACE le dossier du document, pages comprises — le §9 ne souffre pas
// d'exception, retirer d'une liste ne serait pas retirer.
export function retirerDocument(id) {
  const index = salle.documents.findIndex((d) => d.id === id);
  if (index < 0) return false;

  salle.documents.splice(index, 1);
  try {
    fs.rmSync(dossierDuDocument(id), { recursive: true, force: true });
  } catch (err) {
    console.error('[salle] retrait incomplet :', err.message);
  }

  // S'il etait a l'ecran, l'ecran revient a l'accueil : afficher le document
  // d'a cote serait une surprise, et laisser l'ancien serait un mensonge.
  if (salle.affichage.documentId === id) salle.affichage = { documentId: null, page: 0, lecture: false };

  toucher();
  signaler();
  return true;
}

export function revenirAAccueil() {
  salle.affichage = { documentId: null, page: 0, lecture: false };
  toucher();
  signaler();
}

// --- La vue publique --------------------------------------------------------
//
// Ce que voient l'ecran et les telephones. AUCUN chemin de disque n'en sort :
// les pages sont des adresses HTTP, et l'identifiant du document, tire au sort
// sur huit octets, est ce qui les rend indevinables depuis le reseau.

export function etatPublic() {
  const courant = documentPar(salle.affichage.documentId);
  return {
    code: salle.code,
    ouverte: salle.ouverte,
    nomSalle: reglages.nomSalle,
    laMainEstLibre: salle.laMainEstLibre,
    mainA: salle.mainA,
    // L'animateur n'est annonce que s'il est LA : un animateur parti depuis
    // plus que le delai de secours n'en est plus un, et le role est a prendre.
    animateur: estAnimateur(salle.animateur) ? salle.animateur : null,
    animateurPrenom: estAnimateur(salle.animateur)
      ? ((participantPar(salle.animateur) || {}).prenom || '')
      : null,
    // Les participants servent a la page de l'animateur, qui doit pouvoir
    // donner la main a quelqu'un en le nommant. Leur identifiant circule donc —
    // il n'a jamais ete un secret, voir le commentaire du tour de parole.
    participants: salle.participants.map((p) => ({ id: p.id, prenom: p.prenom })),
    documents: salle.documents.map((d) => ({
      id: d.id,
      nom: d.nom,
      prenom: d.prenom,
      etat: d.etat,
      erreur: d.erreur,
      nbPages: d.pages.length,
      estVideo: !!d.video,
    })),
    // Le confort de l'ecran (§11, phase 4) : l'ecran s'y conforme sans qu'on
    // ait a le rouvrir, puisque tout passe par le flux.
    luminosite: reglages.luminosite,
    retourAccueilMinutes: reglages.retourAccueilMinutes,
    affichage: {
      documentId: courant ? courant.id : null,
      page: salle.affichage.page,
      nbPages: courant ? courant.pages.length : 0,
      nom: courant ? courant.nom : null,
      prenom: courant ? courant.prenom : null,
      image: courant ? courant.pages[salle.affichage.page] || null : null,
      video: courant && courant.video ? `/video/${courant.id}` : null,
      lecture: !!salle.affichage.lecture,
    },
    // L'ecran s'en sert pour montrer « réception d'un document… » : c'est vrai
    // des qu'UN document est en cours, meme si un autre est deja affiche.
    reception: salle.documents.some((d) => d.etat === 'conversion'),
  };
}
