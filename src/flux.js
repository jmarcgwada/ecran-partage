// ============================================================================
// LE LIEN TEMPS REEL VERS L'ECRAN (Server-Sent Events)
//
// A SENS UNIQUE, et c'est tout l'interet : le serveur pousse « affiche
// maintenant telle page », les commandes, elles, arrivent des telephones par
// de simples POST. Un WebSocket serait de trop — et surtout il rouvrirait le
// piege des en-tetes du proxy inverse DSM, deja paye sur WebPhone.
//
// Trente lignes, aucune dependance, et une reconnexion automatique offerte par
// le navigateur.
// ============================================================================

import { etatPublic, surChangement } from './salle.js';

const abonnes = new Set();

// Un commentaire SSE, ignore par le navigateur, mais qui traverse la
// connexion : sans lui, un intermediaire un peu zele referme un flux muet au
// bout de quelques minutes et l'ecran se fige sans que personne comprenne.
const BATTEMENT_MS = 20_000;

function ecrire(res, evenement, donnees) {
  try {
    res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`);
  } catch {
    abonnes.delete(res);
  }
}

export function ouvrirFlux(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // no-transform en plus de no-cache : c'est lui qui demande a un
    // intermediaire de ne pas mettre le flux en tampon.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Le vieux drapeau de nginx — celui du proxy inverse DSM. Sans effet en
    // direct, indispensable le jour ou la page passe par lui, sinon le flux
    // arrive par paquets avec des secondes de retard.
    'x-accel-buffering': 'no',
  });

  // Le navigateur attendra trois secondes avant de se reconnecter. Par defaut
  // il en attend deux ou trois selon l'implementation : on le dit, pour que
  // l'ecran d'une salle se rattrape vite apres un redemarrage du conteneur.
  res.write('retry: 3000\n\n');

  abonnes.add(res);

  // L'etat courant tout de suite : un ecran qui se reconnecte doit retrouver
  // la page affichee sans attendre le prochain changement.
  ecrire(res, 'etat', etatPublic());

  const battement = setInterval(() => {
    try { res.write(': battement\n\n'); } catch { /* la fermeture s'en charge */ }
  }, BATTEMENT_MS);

  const fermer = () => {
    clearInterval(battement);
    abonnes.delete(res);
  };
  req.on('close', fermer);
  req.on('error', fermer);
  res.on('error', fermer);
}

export function nombreDAbonnes() {
  return abonnes.size;
}

// Un seul type d'evenement, qui porte l'etat entier. La charge est minuscule
// (quelques centaines d'octets) et cela evite la classe de pannes ou l'ecran
// applique les changements dans le desordre apres une reconnexion.
surChangement((vue) => {
  for (const res of [...abonnes]) ecrire(res, 'etat', vue);
});
