// ============================================================================
// LA LECTURE DES ENVOIS DE FICHIERS (multipart/form-data)
//
// Ecrit a la main pour tenir la promesse du projet : aucune dependance npm.
//
// Le corps est charge en memoire avant d'etre decoupe, et c'est un choix
// assume : la limite de taille est de quelques dizaines de mega-octets, un
// magasin depose quelques documents a la fois, et un analyseur en flux serait
// trois fois plus long pour un gain que personne ne verrait ici.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');

function frontiere(req) {
  const type = req.headers['content-type'] || '';
  const trouve = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!trouve) return null;
  return (trouve[1] || trouve[2]).trim();
}

// Un nom de fichier venu du dehors ne touche jamais le disque tel quel : on ne
// garde que le dernier segment, et seulement des caracteres inoffensifs.
export function nomSain(nom) {
  const base = path.basename(String(nom || '').replace(/\\/g, '/'));
  const propre = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').trim();
  return propre.slice(0, 120) || 'document';
}

function entetesDeLaPartie(bloc) {
  const entetes = {};
  for (const ligne of bloc.toString('utf8').split('\r\n')) {
    const index = ligne.indexOf(':');
    if (index > 0) entetes[ligne.slice(0, index).toLowerCase().trim()] = ligne.slice(index + 1).trim();
  }
  return entetes;
}

function attribut(disposition, cle) {
  // filename*=UTF-8''mon%20fichier.pdf a la priorite : c'est la forme que les
  // navigateurs emploient des qu'un accent apparait.
  const etoile = new RegExp(`${cle}\\*=[^']*''([^;]+)`, 'i').exec(disposition);
  if (etoile) {
    try { return decodeURIComponent(etoile[1]); } catch { /* on retombe plus bas */ }
  }
  const simple = new RegExp(`${cle}="([^"]*)"|${cle}=([^;]+)`, 'i').exec(disposition);
  return simple ? (simple[1] ?? simple[2] ?? '').trim() : '';
}

export async function lireMultipart(req, { maxOctets, maxFichiers, dossier }) {
  const limite = frontiere(req);
  if (!limite) throw new Error("Envoi illisible : la limite du formulaire est absente");

  // Sortir de cette boucle par une exception DETRUIRAIT la requete — Node
  // ferme le flux des qu'on l'abandonne en cours de route — et le client
  // recevrait une coupure reseau au lieu du message « fichier trop volumineux ».
  // On continue donc de lire jusqu'au bout, en jetant ce qu'on a deja pris, et
  // on ne refuse qu'une fois l'envoi termine.
  const morceaux = [];
  let taille = 0;
  let depasse = false;

  for await (const morceau of req) {
    taille += morceau.length;
    if (taille > maxOctets) {
      depasse = true;
      morceaux.length = 0; // inutile de garder en memoire ce qu'on va refuser
      // Passe une certaine demesure, on renonce a la politesse : il ne s'agit
      // plus d'un client qui s'est trompe de fichier.
      if (taille > maxOctets * 4) { req.destroy(); break; }
      continue;
    }
    morceaux.push(morceau);
  }

  if (depasse) throw new Error('TROP_GROS');
  const corps = Buffer.concat(morceaux);

  const separateur = Buffer.from(`--${limite}`);
  const champs = {};
  const fichiers = [];

  let position = corps.indexOf(separateur);
  if (position < 0) throw new Error('Envoi illisible : aucune partie trouvée');

  while (position >= 0) {
    let debut = position + separateur.length;
    if (corps.slice(debut, debut + 2).toString() === '--') break; // derniere frontiere
    if (corps.slice(debut, debut + 2).equals(CRLF)) debut += 2;

    const finEntetes = corps.indexOf(DOUBLE_CRLF, debut);
    if (finEntetes < 0) break;

    const entetes = entetesDeLaPartie(corps.slice(debut, finEntetes));
    const contenuDebut = finEntetes + DOUBLE_CRLF.length;

    const suivant = corps.indexOf(separateur, contenuDebut);
    if (suivant < 0) break;
    // Le CRLF qui precede la frontiere appartient au separateur, pas au contenu :
    // l'oublier ajoute deux octets a chaque fichier et corrompt les PDF.
    const contenu = corps.slice(contenuDebut, suivant - CRLF.length);

    const disposition = entetes['content-disposition'] || '';
    const nomChamp = attribut(disposition, 'name');
    const nomFichier = attribut(disposition, 'filename');

    if (nomFichier) {
      if (contenu.length > 0) {
        if (fichiers.length >= maxFichiers) throw new Error('TROP_DE_FICHIERS');
        const nom = nomSain(nomFichier);
        // Prefixe numerote : deux « scan.pdf » deposes ensemble ne doivent pas
        // s'ecraser l'un l'autre.
        const chemin = path.join(dossier, `${String(fichiers.length).padStart(2, '0')}-${nom}`);
        fs.mkdirSync(dossier, { recursive: true });
        fs.writeFileSync(chemin, contenu);
        fichiers.push({ champ: nomChamp, nom, chemin, taille: contenu.length });
      }
    } else if (nomChamp) {
      champs[nomChamp] = contenu.toString('utf8');
    }

    position = suivant;
  }

  return { champs, fichiers };
}
