// ============================================================================
// LES REGLAGES
//
// Meme parti pris qu'Impression Express : un fichier de verite dans le dossier
// de donnees, les variables d'environnement ne donnant que la valeur du tout
// premier demarrage.
//
// A NE PAS confondre avec les documents de la reunion : les reglages
// survivent au redemarrage, les documents JAMAIS (voir §9 du cahier).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

export const dossierDonnees = process.env.ECR_DATA_DIR || path.join(process.cwd(), 'data');

// Tout ce qu'une reunion depose vit ici, et rien d'autre : ce dossier est vide
// au demarrage et se vide a la fin. Il doit donc pouvoir etre efface en entier
// sans reflechir — d'ou sa separation d'avec reglages.json.
export const dossierReunion = path.join(dossierDonnees, 'reunion');

const fichierReglages = path.join(dossierDonnees, 'reglages.json');

const defauts = {
  nomSalle: process.env.ECR_NOM_SALLE || 'Salle de réunion',

  // L'adresse par laquelle un TELEPHONE joint le service. C'est elle qu'on
  // encode dans le QR code : sans elle, on encode l'adresse vue par l'ecran de
  // la salle, qui peut fort bien etre un « localhost » que personne d'autre ne
  // peut joindre. Vide = on deduit de l'en-tete Host, ce qui suffit tant que
  // l'ecran ouvre la page par la meme adresse que les telephones.
  adressePublique: process.env.ECR_ADRESSE_PUBLIQUE || '',

  limites: {
    // 50 Mo : de quoi laisser passer un .pptx bourre d'images sans discuter.
    // La vidéo, elle, viendra en phase 4 avec une limite a elle.
    tailleMaxMo: Number(process.env.ECR_TAILLE_MAX_MO) || 50,
    fichiersMax: Number(process.env.ECR_FICHIERS_MAX) || 10,
  },

  // Le filet de securite du §9.2 : une reunion que personne n'a pris la peine
  // de terminer ne doit pas laisser un document confidentiel sur le NAS
  // pendant un mois. Compte a partir de la DERNIERE activite, pas du debut :
  // une reunion de six heures n'est pas effacee sous le nez des participants.
  effacementApresHeures: Number(process.env.ECR_EFFACEMENT_HEURES) || 4,
};

function fusionner(base, ajout) {
  const sortie = { ...base };
  for (const [cle, valeur] of Object.entries(ajout || {})) {
    if (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) {
      sortie[cle] = fusionner(base[cle] || {}, valeur);
    } else if (valeur !== undefined) {
      sortie[cle] = valeur;
    }
  }
  return sortie;
}

export const reglages = { ...defauts };

export function initDossiers() {
  fs.mkdirSync(dossierDonnees, { recursive: true });
  fs.mkdirSync(dossierReunion, { recursive: true });

  try {
    const lus = JSON.parse(fs.readFileSync(fichierReglages, 'utf8'));
    Object.assign(reglages, fusionner(defauts, lus));
  } catch {
    // Premier demarrage, ou fichier abime : les defauts font l'affaire et le
    // fichier sera reecrit a la premiere modification.
  }
}

export function enregistrerReglages(modifs) {
  Object.assign(reglages, fusionner(reglages, modifs));
  fs.mkdirSync(dossierDonnees, { recursive: true });
  fs.writeFileSync(fichierReglages, JSON.stringify(reglages, null, 2));
  return reglages;
}

export const tailleMaxOctets = () => reglages.limites.tailleMaxMo * 1024 * 1024;
