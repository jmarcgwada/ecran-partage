// ============================================================================
// ECRAN PARTAGE — chacun envoie un document sur l'ecran de la salle
//
//   /scene         a ouvrir en plein ecran sur l'ecran de la salle
//   /salle/<code>  ou menent les QR codes : le telephone des participants
//
// Pas de compte, pas de cable, rien a installer. Et rien qui reste : une
// reunion terminee ne laisse aucune trace sur le NAS.
// ============================================================================

import http from 'node:http';

import { initDossiers, reglages } from './src/config.js';
import {
  nouvelleReunion, effacerSiOubliee, retourAccueilSiInactif, surveillerAnimateur,
} from './src/salle.js';
import { oublierLesVieuxEchecs, jetonEcran } from './src/acces.js';
import { creerGestionnaire } from './src/api.js';
import { prechaufferBureautique } from './src/documents.js';

const port = Number(process.env.ECR_HTTP_PORT) || 8802;

initDossiers();

// Le demarrage EFFACE tout et tire un nouveau code. L'etat d'une reunion vit
// en memoire : apres un redemarrage, les fichiers restes sur le disque
// n'appartiendraient plus a personne. Autant qu'ils disparaissent — c'est
// aussi la seule lecture honnete du §9.
//
// Consequence a connaitre : redemarrer le conteneur met fin a la reunion en
// cours et change le code de salle.
const code = nouvelleReunion();

const serveur = http.createServer(creerGestionnaire());

serveur.listen(port, () => {
  console.log(`[http] Écran Partagé sur le port ${port}`);
  console.log(`[http]   l'écran de la salle : http://localhost:${port}/scene`);
  console.log(`[http]   code de salle       : ${code}`);
  if (!reglages.adressePublique) {
    console.log("[http]   adresse publique non réglée : le QR code encodera l'adresse par laquelle l'écran a ouvert la page");
  } else {
    // L'adresse de l'ecran par la porte publique, jeton compris. Le journal du
    // conteneur est reserve a qui administre le NAS : c'est le seul endroit ou
    // le jeton se lit — jamais sur un telephone. Voir acces.js.
    const base = reglages.adressePublique.replace(/\/+$/, '');
    console.log(`[http]   l'écran par l'adresse publique : ${base}/scene?jeton=${jetonEcran()}`);
  }
});

serveur.on('error', (err) => {
  console.error(`[http] ${err.message}`);
  process.exit(1);
});

// LibreOffice est reveille des le demarrage, pour que le premier .docx de la
// reunion ne soit pas le plus lent. Mesure sur le NAS : douze secondes a froid,
// moins de deux ensuite. En arriere-plan — le service repond deja pendant ce
// temps-la, et un PDF, lui, n'a pas besoin de LibreOffice.
prechaufferBureautique().then((resultat) => {
  if (resultat.ok) console.log('[conversion] LibreOffice prêt');
  else console.log(`[conversion] LibreOffice indisponible : ${resultat.motif}`);
});

// Deux surveillances, une seule minuterie. Toutes les minutes, parce que le
// retour a l'accueil se regle EN MINUTES : un battement de dix minutes rendrait
// un reglage de cinq minutes fantaisiste.
//
//   retourAccueilSiInactif — le confort du §11 : l'ecran redonne le QR code
//                            apres un moment sans rien faire. Les documents
//                            restent, ce n'est pas une fin de reunion.
//   effacerSiOubliee       — le filet du §9.2 : une reunion que personne n'a
//                            terminee finit par s'effacer, pour de bon.
//   surveillerAnimateur    — le secours du role : un animateur dont le
//                            telephone s'est tu ne previent personne de son
//                            depart. C'est le serveur qui le constate, et qui
//                            fait apparaitre sur les telephones le bouton pour
//                            reprendre le role.
const rythme = setInterval(() => {
  retourAccueilSiInactif();
  effacerSiOubliee();
  surveillerAnimateur();
  oublierLesVieuxEchecs();   // les adresses sorties de la fenetre des codes faux
}, 60 * 1000);

let fermeture = false;
function arreter(signal) {
  if (fermeture) return;
  fermeture = true;
  console.log(`\n[app] arrêt demandé (${signal})`);
  clearInterval(rythme);
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[app] exception non gérée :', err);
});
