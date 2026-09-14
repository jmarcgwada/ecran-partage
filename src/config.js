// ============================================================================
// LES REGLAGES
//
// Meme parti pris que le service d'impression dont ce projet descend : un seul
// fichier de verite dans le dossier de donnees, les variables d'environnement
// ne donnant que la valeur du tout premier demarrage.
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
    tailleMaxMo: Number(process.env.ECR_TAILLE_MAX_MO) || 50,
    // Une video de reunion pese des centaines de mega-octets (§10). « Limite
    // haute mais REELLE » : 200 Mo, et la vraie contrainte n'est pas le disque
    // mais la MEMOIRE. multipart.js charge le corps de la requete en entier
    // avant de le decouper — c'est un choix assume pour rester sans dependance,
    // mais il plafonne ce qu'on peut recevoir. Monter a 500 Mo ferait tenir un
    // gigaoctet en memoire le temps d'un envoi, sur un NAS qui fait tourner
    // quinze autres conteneurs.
    tailleMaxVideoMo: Number(process.env.ECR_TAILLE_MAX_VIDEO_MO) || 200,
    fichiersMax: Number(process.env.ECR_FICHIERS_MAX) || 10,
  },

  // --- Le confort de l'ecran (§11, phase 4) ---------------------------------

  // Un document blanc sur un videoprojecteur, lumiere eteinte, eblouit. On
  // attenue l'image entiere plutot que de l'inverser : inverser rendrait le
  // texte lisible mais massacrerait la moindre photo.
  // 100 = tel quel. En dessous de 50, on ne lit plus rien.
  luminosite: Number(process.env.ECR_LUMINOSITE) || 100,

  // Retour a l'ecran d'accueil apres ce nombre de minutes SANS ACTIVITE, pour
  // que le QR code redevienne visible et qu'un retardataire puisse rejoindre.
  //
  // Zero par defaut, et ce n'est pas de la timidite : une discussion de vingt
  // minutes sur une meme diapositive est le cas NORMAL d'une reunion. Escamoter
  // le document sous le nez de ceux qui en parlent serait pire que le mal.
  // Le reglage s'active depuis /animateur, en connaissance de cause.
  retourAccueilMinutes: Number(process.env.ECR_RETOUR_ACCUEIL_MINUTES) || 0,

  // Le secours du role d'animateur : s'il part ou perd son telephone, le role
  // redevient revendicable apres ce delai SANS SIGNE DE VIE de sa part. Sans ce
  // secours, plus personne ne pourrait terminer la reunion.
  //
  // A savoir : un telephone verrouille suspend sa page, donc ses signes de vie.
  // Un animateur qui range son telephone plus longtemps que ce delai laisse le
  // role a prendre — et l'ecran affiche alors qui l'a repris.
  animateurAbsentMinutes: Number(process.env.ECR_ANIMATEUR_ABSENT_MINUTES) || 10,

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
export const tailleMaxVideoOctets = () => reglages.limites.tailleMaxVideoMo * 1024 * 1024;
