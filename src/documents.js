// ============================================================================
// LES DOCUMENTS
//
// Tout ce qui entre devient une SUITE D'IMAGES, une par page. L'ecran de la
// salle n'affiche jamais autre chose.
//
// Pourquoi des images et pas le document tel quel : le lecteur PDF integre des
// navigateurs de televiseurs et de boitiers Android est absent, ancien ou
// fantaisiste. Une image, elle, s'affiche partout sans exception.
//
// Trois chemins, selon ce qu'on depose :
//   PDF          -> pdftoppm directement
//   photo/image  -> une seule page, convertie en JPEG (pas d'aller-retour par
//                   un PDF : c'est plus rapide et la photo reste nette)
//   Word, Excel… -> LibreOffice vers un PDF, puis pdftoppm
//
// Allege du service d'impression : le comptage tarifaire des pages et la mesure
// du remplissage en encre n'ont plus lieu d'etre, une reunion ne se facture pas.
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executer = promisify(execFile);

const IMAGES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif']);
const BUREAUTIQUE = new Set([
  '.doc', '.docx', '.odt', '.rtf', '.txt', '.md',
  '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp',
]);

// Les videos font exception a tout le reste : elles ne sont pas converties, on
// les sert telles quelles a une balise <video> (§3.2). Aucun ffmpeg dans
// l'image — transcoder une video de reunion sur un NAS prendrait plus longtemps
// que la reunion.
//
// C'est donc LE NAVIGATEUR DE L'ECRAN qui decide s'il sait lire le fichier.
// mp4 (H.264) et webm passent partout ; .mov et .mkv sont des emballages qui
// peuvent contenir n'importe quoi, et l'ecran restera noir sans un mot si le
// codec lui est etranger. On les accepte quand meme : refuser d'avance un
// fichier qui aurait marche serait pire.
const VIDEOS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv']);

export const extensionsAcceptees = ['.pdf', ...IMAGES, ...BUREAUTIQUE, ...VIDEOS];

export function typeAccepte(nom) {
  return extensionsAcceptees.includes(path.extname(nom).toLowerCase());
}

export function estUneVideo(nom) {
  return VIDEOS.has(path.extname(nom).toLowerCase());
}

// 1600 points sur le plus grand cote : au-dela, on alourdit le transfert vers
// l'ecran sans que personne, a trois metres, y gagne quoi que ce soit.
const COTE_MAX = 1600;

async function versPdfBureautique(source, dossierSortie) {
  // -env:UserInstallation est obligatoire : sans profil a lui, LibreOffice
  // refuse de demarrer une deuxieme fois en parallele, EN SILENCE. Deux
  // participants qui deposent en meme temps, c'est le cas normal ici.
  //
  // Ce profil va dans le repertoire temporaire, JAMAIS dans le dossier du
  // document : il y pese quelques mega-octets, il survit a la conversion, il
  // appartient a root — et il finirait par etre affiche comme une page.
  const profil = path.join(os.tmpdir(), `libreoffice-${path.basename(dossierSortie)}`);
  await executer('soffice', [
    `-env:UserInstallation=file://${profil}`,
    '--headless', '--norestore', '--invisible',
    '--convert-to', 'pdf',
    '--outdir', dossierSortie,
    source,
  ], { timeout: 300_000 });

  const attendu = path.join(dossierSortie, `${path.basename(source, path.extname(source))}.pdf`);
  if (!fs.existsSync(attendu)) throw new Error('LibreOffice n’a produit aucun PDF');
  return attendu;
}

async function versImageUnique(source, destination) {
  const extension = path.extname(source).toLowerCase();
  if (extension === '.heic' || extension === '.heif') {
    // Les photos d'iPhone. ImageMagick ne les lit pas toujours, heif-convert si.
    await executer('heif-convert', [source, destination], { timeout: 180_000 });
    return;
  }
  // -auto-orient : sans lui, une photo prise en tenant le telephone de travers
  // s'affiche couchee sur l'ecran de la salle.
  await executer('convert', [
    source, '-auto-orient', '-resize', `${COTE_MAX}x${COTE_MAX}>`, '-quality', '88', destination,
  ], { timeout: 180_000 });
}

async function pagesDuPdf(pdf, dossier) {
  // pdftoppm numerote lui-meme : prefixe « p » -> p-1.jpg, p-2.jpg…
  // Le nombre de chiffres suit le nombre de pages (p-01.jpg au-dela de neuf),
  // d'ou la relecture du dossier plutot qu'un nom devine.
  await executer('pdftoppm', [
    '-jpeg', '-jpegopt', 'quality=88', '-scale-to', String(COTE_MAX),
    pdf, path.join(dossier, 'p'),
  ], { timeout: 300_000 });

  return fs.readdirSync(dossier)
    .filter((nom) => /^p-\d+\.jpg$/.test(nom))
    .sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));
}

// Prend un fichier depose et rend { pages: ['p-1.jpg', …] } — ou { erreur } si
// le document est illisible. Un document illisible ne fait jamais echouer tout
// le depot : la ligne apparait en rouge sur les telephones et la reunion suit
// son cours.
//
// `dossier` est le dossier PROPRE de ce document : il ne contient que lui, et
// s'efface d'un seul coup a la fin de la reunion.
export async function preparer(fichier, dossier) {
  const extension = path.extname(fichier.nom).toLowerCase();

  try {
    // Une video n'a rien a preparer : elle est deja prete, c'est le navigateur
    // de l'ecran qui fera le travail.
    if (VIDEOS.has(extension)) return { video: path.basename(fichier.chemin) };

    if (IMAGES.has(extension)) {
      await versImageUnique(fichier.chemin, path.join(dossier, 'p-1.jpg'));
      return { pages: ['p-1.jpg'] };
    }

    let pdf;
    if (extension === '.pdf') {
      pdf = fichier.chemin;
    } else if (BUREAUTIQUE.has(extension)) {
      pdf = await versPdfBureautique(fichier.chemin, dossier);
    } else {
      return { erreur: `Format non accepté (${extension || 'inconnu'})` };
    }

    const pages = await pagesDuPdf(pdf, dossier);
    if (!pages.length) throw new Error('aucune page produite');
    return { pages };
  } catch (err) {
    const detail = String(err.stderr || err.message || err).split('\n')[0].slice(0, 200);
    return { erreur: `Conversion impossible : ${detail}` };
  }
}

// Le TOUT PREMIER appel a LibreOffice dans un conteneur neuf coute une douzaine
// de secondes, contre moins de deux ensuite — mesure faite sur le NAS. Ce n'est
// pas le profil qui est en cause (un profil neuf ne coute qu'une demi-seconde),
// c'est le chargement initial de LibreOffice lui-meme.
//
// Douze secondes, c'est au-dela de la barre que le cahier se fixe (§12) : on
// croit a une panne et on renvoie le fichier. On paye donc ce demarrage au
// lancement du conteneur, quand personne n'attend, plutot que sur le dos du
// premier participant.
//
// Ne fait jamais echouer le demarrage : LibreOffice absent, c'est une reunion
// sans .pptx, pas un service en panne.
export async function prechaufferBureautique() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'prechauffe-'));
  try {
    const source = path.join(dossier, 'prechauffe.txt');
    fs.writeFileSync(source, 'préchauffage');
    await versPdfBureautique(source, dossier);
    return { ok: true };
  } catch (err) {
    return { ok: false, motif: String(err.message || err).split('\n')[0].slice(0, 120) };
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// Les outils de conversion sont dans le CONTENEUR, pas sur le poste Windows.
// Le banc d'essai s'en sert pour savoir s'il peut esperer de vraies pages ou
// s'il doit se contenter d'eprouver la plomberie.
export async function outilsPresents() {
  try {
    await executer('pdftoppm', ['-v'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
