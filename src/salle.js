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

  // Le tour de parole, prevu par le modele du cahier (§7) mais pas encore
  // employe : en phase 1, le dernier document depose s'affiche, point.
  mainA: null,
  laMainEstLibre: true,

  participants: [],
  documents: [],
  affichage: { documentId: null, page: 0 },
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
  salle.participants = [];
  salle.documents = [];
  salle.affichage = { documentId: null, page: 0 };
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
    erreur: null,
  };
  salle.documents.push(document);
  fs.mkdirSync(dossierDuDocument(document.id), { recursive: true });
  toucher();
  signaler();
  return document;
}

export function documentPret(document, pages) {
  document.etat = 'pret';
  document.pages = pages.map((nom) => `/page/${document.id}/${nom}`);
  toucher();
  // Phase 1 : pas de tour de parole, le dernier document pret prend l'ecran.
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
  salle.affichage = { documentId: document.id, page: numero };
  toucher();
  signaler();
  return true;
}

export function revenirAAccueil() {
  salle.affichage = { documentId: null, page: 0 };
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
    documents: salle.documents.map((d) => ({
      id: d.id,
      nom: d.nom,
      prenom: d.prenom,
      etat: d.etat,
      erreur: d.erreur,
      nbPages: d.pages.length,
    })),
    affichage: {
      documentId: courant ? courant.id : null,
      page: salle.affichage.page,
      nbPages: courant ? courant.pages.length : 0,
      nom: courant ? courant.nom : null,
      prenom: courant ? courant.prenom : null,
      image: courant ? courant.pages[salle.affichage.page] || null : null,
    },
    // L'ecran s'en sert pour montrer « réception d'un document… » : c'est vrai
    // des qu'UN document est en cours, meme si un autre est deja affiche.
    reception: salle.documents.some((d) => d.etat === 'conversion'),
  };
}
