# Écran Partagé

Dans une salle de réunion, **chacun envoie un document sur l'écran depuis son
téléphone**. On scanne un QR code affiché sur l'écran, on choisit un fichier, il
apparaît.

Pas de câble à brancher, pas de logiciel à installer, pas de compte. Et rien qui
reste : une réunion terminée ne laisse aucune trace sur le NAS.

Le cahier de projet — décisions, pièges déjà payés ailleurs, phases — est dans
[`PROJET.md`](PROJET.md). Ce fichier-ci dit **où en est le code** et **comment
s'en servir**.

---

## Où en est le projet

**Les quatre phases du cahier sont livrées**, déployées et éprouvées au banc
dans le conteneur. Ce qui reste à faire n'est pas du code : voir la fin de ce
fichier.

| Phase | État |
| --- | --- |
| 1 — l'écran affiche quelque chose | **fait** |
| 2 — le tour de parole | **fait** |
| 3 — la fin de réunion (bouton « Terminer ») | **fait** |
| 4 — le confort (vidéos, atténuation, télécommande clavier) | **fait** |

### Ce que ça fait

- `/scene` affiche le QR code et le code de salle en grand, puis bascule sur le
  document dès qu'il est prêt ;
- `/salle/<code>` reçoit les fichiers depuis un téléphone, avec une barre
  d'avancement et la liste commune de ce qui a été déposé ;
- tout ce qui entre — PDF, Word, Excel, PowerPoint, images — devient une suite
  d'images de pages ;
- le lien temps réel (SSE) prévient l'écran sans qu'il ait rien à demander ;
- l'écran annonce « réception d'un document… » pendant la conversion, pour
  qu'on ne croie pas à une panne ;
- **« Afficher »** remet à l'écran un document déjà déposé, sans le renvoyer :
  il reste disponible jusqu'à la fin de la réunion ;
- **« Précédente / Suivante »** font défiler les pages depuis le téléphone, qui
  devient la télécommande.

### Un téléphone = une personne

Chacun scanne avec son propre téléphone et saisit son prénom une fois ; ce
navigateur le retient d'une réunion à l'autre. **Il n'y a pas d'utilisateur à
commuter** : quand le tour de Bruno vient, Bruno envoie depuis son téléphone. Si
un prénom est faux, on corrige le champ.

### Le tour de parole

Un **réglage**, pas une hiérarchie (§5), que l'animateur bascule depuis son téléphone :

- **main libre** — le cas par défaut. Chacun affiche ce qu'il veut et tourne les
  pages. Sur une réunion à trois, c'est ce qu'on veut : personne n'a envie de
  demander la parole.
- **tour de parole fermé** — un seul téléphone pilote l'écran à la fois. Celui
  qui a la main la garde jusqu'à ce qu'il la rende, ou que l'animateur la donne
  à quelqu'un d'autre.

**Déposer n'a jamais rien à voir avec la main** : on prépare son document
pendant que quelqu'un d'autre présente.

### L'animateur

Un participant parmi les autres, qui **revendique** le rôle depuis son téléphone
(« Je mène la réunion »). Le premier qui le fait l'obtient, et **lui seul
administre** : tour de parole, main, retrait d'un document, confort de l'écran,
fin de réunion. Son pupitre n'apparaît que sur son téléphone.

- Il peut **confier la réunion** à un autre participant, ou ne plus la mener.
- **Son nom s'affiche à l'écran** — c'est la vraie protection contre une prise
  de rôle abusive : elle se voit de toute la salle.
- Il **pilote toujours** l'écran, même quand quelqu'un d'autre a la main.
- **Le secours** : sans signe de vie de son téléphone pendant dix minutes, le
  rôle redevient revendicable — sans quoi un téléphone perdu bloquerait la
  réunion. Tant que personne ne l'a repris, le moindre signe de vie le lui rend.
  À savoir : un téléphone verrouillé suspend sa page, donc ses signes de vie.

Personne ne mène la réunion au départ, et elle fonctionne très bien ainsi.

### Un retardataire

**« Inviter quelqu'un »**, sur chaque téléphone : le QR code s'affiche sur le
téléphone, qu'on tend à la personne qui arrive. La présentation en cours n'est
pas interrompue. L'animateur peut aussi remettre le QR code plein écran depuis
son téléphone, et le petit QR code de la barre du bas reste scannable en
s'approchant.

### Les vidéos, et leurs limites

Une vidéo n'est **pas convertie** : elle est servie telle quelle à une balise
`<video>`. Il n'y a pas de ffmpeg dans l'image — transcoder une vidéo de réunion
sur un NAS prendrait plus longtemps que la réunion.

**C'est donc le navigateur de l'écran qui décide s'il sait la lire.** `.mp4`
(H.264) et `.webm` passent partout. `.mov` et `.mkv` sont des emballages qui
peuvent contenir n'importe quoi : l'écran restera noir, sans un mot, si le codec
lui est étranger. On les accepte quand même — refuser d'avance un fichier qui
aurait marché serait pire.

Une vidéo **arrive en pause** et démarre quand quelqu'un appuie sur « Lire »
depuis son téléphone : le son ne part pas dans une salle qui parle encore
d'autre chose. Si le navigateur de l'écran refuse de démarrer sur ordre du
serveur — certains exigent un geste humain — les contrôles natifs restent
visibles sous la vidéo.

**Limite : 200 Mo**, contre 50 Mo pour un document. Pas 500 Mo, et la raison
n'est pas le disque : `multipart.js` charge le corps de la requête en mémoire
avant de le découper. C'est le prix de l'absence de dépendance npm.

### Le confort de l'écran

Réglable depuis le téléphone de l'animateur, poussé à l'écran par le flux, sans rien rouvrir :

- **Luminosité des documents.** Une page blanche sur un vidéoprojecteur, lumière
  éteinte, éblouit. On atténue l'image plutôt que de l'inverser : inverser
  rendrait le texte confortable et massacrerait la moindre photo. La barre du
  bas, elle, n'est jamais atténuée — elle doit rester lisible.
- **Retour au QR code après un délai d'inactivité.** *À zéro par défaut*, et ce
  n'est pas de la timidité : une discussion de vingt minutes sur une même
  diapositive est le cas normal d'une réunion, et escamoter le document sous le
  nez de ceux qui en parlent serait pire que le mal.
- **« Revenir à l'accueil maintenant »**, pour montrer le code à un retardataire
  sans rien effacer.

### La télécommande au clavier

Sur `/scene`, pour un écran branché à un mini-PC ou à un portable : **flèches**
pour les pages, **Échap** pour revenir à l'accueil.

L'écran se fait connaître comme un participant nommé **« Écran »**. C'est ce qui
le soumet au même tour de parole que les téléphones : quand la main n'est pas
libre, l'animateur peut la lui donner comme à n'importe qui. Lui inventer un
passe-droit qu'on peut s'envoyer soi-même n'en aurait pas été un.

### Ce qui n'est pas fait

Les quatre phases du cahier sont livrées. Ce qui reste est hors de son périmètre
— et le §1 le dit : **ce n'est pas du partage d'écran en direct.** On envoie des
documents, pas le contenu vivant d'un portable.

### L'effacement, et ses trois voies

Le §9 ne souffre pas d'exception : une réunion terminée ne laisse rien.

- **« Terminer la réunion »**, depuis le téléphone de l'animateur : les fichiers quittent le
  disque, un nouveau code est tiré, l'écran revient au QR code d'accueil.
- **Le démarrage efface tout** et tire un nouveau code. Conséquence à connaître :
  redémarrer le conteneur met fin à la réunion en cours.
- **Le filet de sécurité** efface une réunion que personne n'a terminée, après
  quelques heures d'inactivité (`ECR_EFFACEMENT_HEURES`, 4 par défaut).

L'animateur peut aussi **retirer un document** envoyé par erreur : là encore le
fichier quitte le disque, il n'est pas seulement retiré d'une liste.

---

## Comment ça marche

```
   Téléphones                    NAS (conteneur)                 Écran de la salle
   ──────────                    ───────────────                 ─────────────────
   /salle/<code>   ──POST──▶   fichier reçu, converti
   (dépôt)                     en pages images
                                      │
                                      └── SSE ──▶  /scene  (navigateur plein écran)
```

| Fichier | Ce qu'il porte |
| --- | --- |
| `src/salle.js` | **la seule vérité** sur l'état de la réunion. Tout le reste ne fait que le lire ou le modifier par ses fonctions. |
| `src/documents.js` | la conversion : LibreOffice → PDF → `pdftoppm` → images de pages |
| `src/flux.js` | le lien temps réel vers l'écran (SSE), trente lignes |
| `src/api.js` | l'aiguillage, le dépôt, le QR code, le service des pages |
| `src/multipart.js` | la lecture des envois, **copiée telle quelle** du service d'impression |
| `src/http.js` | la plomberie HTTP, reprise et allégée (ni session ni mot de passe ici) |

Trois décisions à ne pas défaire sans relire le cahier : l'écran est **un
navigateur** et non un protocole de diffusion (§3.1), les documents deviennent
**des images** et non des PDF servis tels quels (§3.2), et le lien temps réel est
**du SSE** et non du WebSocket (§3.3).

---

## Les adresses

| Adresse | Pour qui |
| --- | --- |
| `/scene?jeton=…` | l'écran de la salle, à ouvrir en plein écran une fois pour toutes — **avec son jeton** |
| `/salle/<code>` | les participants — c'est là que mène le QR code |
| `/` | celui qui installe l'écran : un lien vers `/scene`, rien d'autre |
| `/api/etat` | l'état public, pour déboguer d'un coup de `curl` |
| `/api/afficher` | remettre un document à l'écran — `POST`, code de salle exigé |
| `/api/page` | tourner une page — `POST {sens:-1\|1}`, code de salle exigé |
| `/api/video` | lire ou mettre en pause — `POST {lecture:true\|false}` |
| `/video/<id>` | la vidéo elle-même, avec les requêtes de plage |
| `/api/flux` | le flux d'évènements |
| `/api/sante` | pour le contrôle de santé du conteneur |

---

## Faire tourner

### Sur le poste, pour développer

```bash
node server.js
```

L'adresse de l'écran, jeton compris, s'affiche au démarrage : ouvrez-la telle
quelle. Sans le jeton, l'écran explique ce qui manque et n'ouvre rien.

**Sur Windows, la conversion ne marchera pas** : LibreOffice, poppler et
`qrencode` ne sont pas dans le PATH. C'est normal et sans gravité — le QR code
retombe sur l'adresse en toutes lettres, et un document déposé apparaît « illisible »
dans la liste. La conversion s'éprouve dans le conteneur (voir plus bas).

> Attention en passant : sur Windows, `convert` est l'utilitaire de conversion
> FAT→NTFS du système, pas ImageMagick. Sans conséquence — le conteneur est en
> Debian — mais cela explique les messages d'erreur déroutants si vous déposez
> une image sur le poste.

### Sur le NAS

```bash
docker compose up -d --build
```

Puis, sur l'écran de la salle, ouvrir en plein écran l'adresse **avec son jeton**
que donne le journal du conteneur.

### Sur Internet

Le cahier voulait ce service hors d'Internet (§9.3). Il peut y être, pour que
des téléphones en 4G rejoignent la réunion — à condition de passer par le
**proxy inverse de DSM** et de régler l'**adresse publique** :

1. un nom de domaine qui pointe vers la box ;
2. dans DSM : un certificat Let's Encrypt pour ce nom, une règle de proxy
   inverse `https://<nom>:443` → `http://127.0.0.1:8802`, et **l'association du
   certificat à ce service** (oubliée, DSM sert le certificat du NAS et le
   navigateur refuse) ;
3. **ensuite seulement**, l'adresse publique dans `data/reglages.json` —
   avant, tous les QR codes mèneraient vers une adresse morte.

#### L'écran de la salle, par l'adresse publique

L'écran n'a pas de code à présenter : c'est lui qui l'affiche. Il présente donc
un **jeton d'écran**, en local comme par Internet :

```
https://<adresse publique>/scene?jeton=<jeton>
```

L'adresse complète s'affiche **dans le journal du conteneur**, au démarrage, dès
que l'adresse publique est réglée — et **nulle part ailleurs** :

```
[http]   l'écran par l'adresse publique : https://…/scene?jeton=…
```

- **Jamais sur un téléphone**, pas même celui de l'animateur : n'importe qui peut
  devenir animateur, et le jeton ouvre *toutes* les réunions à venir, pas
  seulement la sienne.
- **Durable** : il vit dans `data/jeton-ecran` et survit aux redémarrages — un
  écran s'ouvre une fois pour toutes. **Pour en changer**, supprimer ce fichier et
  redémarrer ; l'ancienne adresse cesse aussitôt de fonctionner.
- **Hors de la limite des codes faux** : dans une salle, l'écran et les téléphones
  sortent souvent par la même adresse Internet, et dix fautes de frappe d'un
  participant ne doivent pas éteindre l'écran. Sans risque : 256 bits ne se
  devinent pas. Pour la même raison, un jeton faux n'est pas compté comme un
  échec — un écran resté sur un ancien jeton ne bloque pas la salle.

---

## Ce que le code de salle protège, et ce qu'il ne protège pas

Il ferme **les gestes** : déposer un document, en remettre un à l'écran, tourner
les pages, et tout ce que fait l'animateur. Sans lui, on ne fait rien.

**Il ferme aussi la lecture, d'où que l'on vienne.** Ce n'était pas le cas au
départ, et c'était une fuite sur deux fronts : depuis Internet, l'état donnait à
n'importe qui le code, la liste des documents et l'adresse de leurs pages ; sur
le réseau local, la même lecture restait ouverte, parce que l'écran n'avait rien
à présenter — n'importe quel appareil branché sur le Wi-Fi du magasin lisait les
documents d'une réunion en cours. Depuis que l'écran a un jeton, plus aucune
exception. La porte (`src/acces.js`) :

- refuse l'état, le flux et le QR code sans le code (le QR code *encode* le
  code) ; n'ouvre l'écran de la salle qu'avec son jeton, et dit sinon ce qui
  manque ;
- limite les codes faux : dix par adresse en dix minutes, puis attente — et
  une adresse bloquée n'apprend plus rien, même en visant juste. **En local
  aussi**, où tous les accès directs arrivent de la même adresse (la passerelle
  de Docker, mesuré) et partagent donc une même limite ;
- identifie le client par la **dernière** entrée de `X-Forwarded-For`, celle
  qu'ajoute le proxy. Vérifié à travers le vrai proxy de DSM : un en-tête
  inventé ne débloque rien.

Ce que la limite ne fait pas : arrêter un attaquant disposant de milliers
d'adresses. Elle transforme quelques minutes en jours pour une adresse seule ;
le code, lui, change à chaque réunion.

Même remarque pour l'identifiant de participant : il est tiré au sort par le
téléphone et voyage en clair. Il empêche les gestes involontaires, pas un
participant décidé à reprendre la main.

### Ne publier le port que sur la boucle locale

Une limite que le code ne peut pas fermer seul : **un appareil qui atteint
directement le port du service** (le Wi-Fi du magasin, par exemple) peut écrire
lui-même un `X-Forwarded-For`, s'inventer une adresse à chaque essai et deviner
le code en une minute. Aucune marque du proxy n'est infalsifiable.

La parade, **appliquée dans le `docker-compose.yml`** : ne publier le port que
sur la boucle locale du NAS (`127.0.0.1:8802:8802`), pour que **tout passe
obligatoirement par DSM**. Son en-tête fait foi : sa configuration ajoute
l'adresse réelle du client (`$proxy_add_x_forwarded_for`), et le service lit la
dernière entrée. Vérifié : le port refuse désormais toute connexion depuis le
réseau local, et l'adresse publique répond.

Pour une installation neuve, dans cet ordre, pour ne jamais couper le service :

1. dans DSM, changer la destination du proxy inverse pour `http://127.0.0.1:8802`
   (cela fonctionne tout de suite, la boucle locale étant déjà incluse) ;
2. vérifier que l'adresse publique répond toujours ;
3. seulement alors, publier le port sur `127.0.0.1` dans le compose.

Ce que cela coûte : l'écran du magasin passe lui aussi par l'adresse publique,
et dépend donc d'Internet — comme les téléphones, dont le QR code encode déjà
cette adresse.

Si un jour cela ne suffit plus, il ne faudra pas durcir le code de salle mais
changer de conception : des comptes, ou un jeton par participant.

## Les réglages

Dans `docker-compose.yml`. Ils ne servent qu'au premier démarrage : ensuite c'est
`data/reglages.json` qui commande.

| Variable | Défaut | À quoi ça sert |
| --- | --- | --- |
| `ECR_HTTP_PORT` | `8802` | le port |
| `ECR_NOM_SALLE` | `Salle de réunion` | affiché sur l'écran et sur les téléphones |
| `ECR_ADRESSE_PUBLIQUE` | *(vide)* | **l'adresse par laquelle un TÉLÉPHONE joint le service** — c'est elle qu'on encode dans le QR code |
| `ECR_TAILLE_MAX_MO` | `50` | par document |
| `ECR_TAILLE_MAX_VIDEO_MO` | `200` | par vidéo — plafonné par la mémoire, pas par le disque |
| `ECR_LUMINOSITE` | `100` | atténuation des documents à l'écran, de 40 à 100 |
| `ECR_RETOUR_ACCUEIL_MINUTES` | `0` | retour au QR code après ce temps d'inactivité ; `0` = jamais |
| `ECR_FICHIERS_MAX` | `10` | par envoi |
| `ECR_EFFACEMENT_HEURES` | `4` | le filet du §9.2 : inactivité au bout de laquelle tout s'efface |
| `ECR_CODES_FAUX_MAX` | `10` | depuis Internet : codes faux par adresse en dix minutes avant mise en attente |
| `ECR_ANIMATEUR_ABSENT_MINUTES` | `10` | secours du rôle d'animateur : délai sans signe de vie avant qu'il redevienne revendicable |

### `ECR_ADRESSE_PUBLIQUE`, le réglage qui compte

Laissé vide, le QR code encode l'adresse par laquelle **l'écran de la salle** a
ouvert la page. Cela suffit tant que tout le monde est sur le même réseau — mais
si l'écran ouvre `http://localhost:8802/scene`, le QR code mènera les téléphones
sur *leur* localhost, c'est-à-dire nulle part.

Dès que l'écran et les téléphones ne voient pas le serveur par la même adresse,
réglez-la : `http://192.0.2.10:8802`.

---

## Comment vérifier

```bash
node tests/depot.mjs
```

Le banc monte le vrai serveur HTTP dans le processus et le sollicite comme le
feraient un téléphone et l'écran. Il rend `1` si un contrôle échoue.

Les contrôles qui ne peuvent pas aboutir sur le poste s'annoncent **`IGNORE`**
plutôt que de se déclarer réussis. Pour éprouver la conversion pour de vrai,
il faut le conteneur — le banc y voyage exprès :

```bash
docker exec ecran-partage node tests/depot.mjs
```

Ce que le banc cherche à prendre en défaut : un envoi refusé doit **rendre un
message et non couper la connexion**, le code de salle doit vraiment fermer le
dépôt, l'écran doit être prévenu sans avoir rien demandé, aucun chemin de disque
ne doit sortir dans l'état public, et la fin de réunion doit effacer les fichiers
**pour de vrai**.

### Ce qui a été mesuré, sur le NAS

Délai entre le dépôt et l'affichage à l'écran, conteneur `ecran-partage` :

| Document | Délai |
| --- | --- |
| PDF, 1 page | ~740 ms |
| PDF, 12 pages | ~320 ms |
| Passage par LibreOffice (`.txt`, `.docx`, `.pptx`…), conteneur chaud | ~1,8 s |
| Passage par LibreOffice, **tout premier document d'un conteneur neuf** | **12,4 s** |
| Vidéo | immédiat — aucune conversion |

La réponse au téléphone, elle, tombe en moins de 10 ms : le serveur répond
avant de convertir, exprès.

Ces douze secondes sont le démarrage à froid de LibreOffice — et non le profil
`-env:UserInstallation`, qu'on pourrait croire coupable : un profil neuf ne
coûte qu'une demi-seconde (2,25 s contre 2,05 s, mesuré). C'est pourquoi le
serveur **réveille LibreOffice au démarrage**, en arrière-plan, pour que le
premier participant ne paye pas l'addition. Le journal le dit :

```
[conversion] LibreOffice prêt
```

### Ce qu'aucun banc ne dira

- le QR code est-il assez grand pour être scanné **à trois mètres** ?
- le code de salle est-il lisible depuis le fond de la pièce ?
- combien de temps s'écoule entre le dépôt et l'affichage ? Au-delà de trois ou
  quatre secondes pour un PDF de quelques pages, il faut revoir l'état d'attente.

Cela se regarde sur le vrai écran, et c'est le premier point à éprouver avant
d'attaquer la phase 2.

---

## Ce qui reste à éprouver avant d'aller plus loin

1. **L'écran de la salle peut-il joindre le NAS ?** C'est le vrai risque du
   projet (§4), et il n'est pas logiciel. Rien n'est réglé tant que ce point ne
   l'est pas — ni le code ni la mesure n'y peuvent quoi que ce soit.
2. **La lisibilité à trois mètres**, sur l'écran choisi : taille du QR code,
   lisibilité du code de salle.
3. **Un vrai `.pptx` déposé depuis un vrai téléphone**, pour confirmer les
   mesures ci-dessus hors laboratoire.

~~La conversion dans le conteneur~~ — **fait** : le banc passe ses 118 contrôles
dans le conteneur, sans aucun `IGNORE`.

4. **La lecture d'une vraie vidéo sur le vrai écran.** La plomberie est éprouvée
   — requêtes de plage, `206`, `416`, plage par la fin, lecture et pause — mais
   **aucune vidéo réelle n'a jamais été lue** : il n'y avait pas de fichier
   neutre à disposition, et le `ffmpeg` du NAS est amputé de son encodeur H.264.
   Déposez un clip depuis un téléphone, c'est le seul vrai test.
