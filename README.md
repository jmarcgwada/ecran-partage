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

**Phase 1 livrée.** L'écran affiche quelque chose, et c'est déjà utilisable en
réunion : un participant dépose, le document apparaît.

| Phase | État |
| --- | --- |
| 1 — l'écran affiche quelque chose | **fait** |
| 2 — le tour de parole | à faire |
| 3 — la fin de réunion (bouton « Terminer ») | *partiellement* — voir ci-dessous |
| 4 — le confort (vidéos, mode sombre, télécommande) | à faire |

### Ce que la phase 1 fait

- `/scene` affiche le QR code et le code de salle en grand, puis bascule sur le
  document dès qu'il est prêt ;
- `/salle/<code>` reçoit les fichiers depuis un téléphone, avec une barre
  d'avancement et la liste commune de ce qui a été déposé ;
- tout ce qui entre — PDF, Word, Excel, PowerPoint, images — devient une suite
  d'images de pages ;
- le lien temps réel (SSE) prévient l'écran sans qu'il ait rien à demander ;
- l'écran annonce « réception d'un document… » pendant la conversion, pour
  qu'on ne croie pas à une panne.

### Ce que la phase 1 ne fait PAS encore

- **Pas de tour de parole** : le dernier document prêt prend l'écran. C'est le
  comportement prévu par le cahier pour cette phase.
- **Pas de commandes de page** : seule la première page d'un document s'affiche.
  Le modèle de données porte déjà le numéro de page, la phase 2 n'a qu'à poser
  les boutons.
- **Pas de bouton « Terminer »** ni de page `/animateur`.

### Un écart assumé au découpage en phases

Le §11 range l'effacement en phase 3. Il est **déjà là**, parce que le §9 le
déclare non négociable et que la phase 1 écrit dès maintenant des documents
confidentiels sur le NAS :

- **le démarrage efface tout** et tire un nouveau code (conséquence à connaître :
  redémarrer le conteneur met fin à la réunion en cours) ;
- **le filet de sécurité** efface une réunion oubliée après quelques heures
  d'inactivité (`ECR_EFFACEMENT_HEURES`, 4 par défaut).

Ce qui manque de la phase 3, c'est le **bouton** : aujourd'hui on termine une
réunion en redémarrant le conteneur.

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
| `src/multipart.js` | la lecture des envois, **copiée telle quelle** d'Impression Express |
| `src/http.js` | la plomberie HTTP, reprise et allégée (ni session ni mot de passe ici) |

Trois décisions à ne pas défaire sans relire le cahier : l'écran est **un
navigateur** et non un protocole de diffusion (§3.1), les documents deviennent
**des images** et non des PDF servis tels quels (§3.2), et le lien temps réel est
**du SSE** et non du WebSocket (§3.3).

---

## Les adresses

| Adresse | Pour qui |
| --- | --- |
| `/scene` | l'écran de la salle, à ouvrir en plein écran une fois pour toutes |
| `/salle/<code>` | les participants — c'est là que mène le QR code |
| `/` | celui qui installe l'écran : un lien vers `/scene`, rien d'autre |
| `/api/etat` | l'état public, pour déboguer d'un coup de `curl` |
| `/api/flux` | le flux d'évènements |
| `/api/sante` | pour le contrôle de santé du conteneur |

---

## Faire tourner

### Sur le poste, pour développer

```bash
node server.js
```

Le code de salle s'affiche au démarrage. Ouvrez `http://localhost:8802/scene`.

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

Puis, sur l'écran de la salle, ouvrir `http://<nas>:8802/scene` en plein écran.

**Ce service ne va pas sur Internet** (§9.3) : pas de règle de proxy inverse DSM
pour lui. Si l'accès à distance devient nécessaire, `tailscale serve`, jamais
`funnel`.

---

## Les réglages

Dans `docker-compose.yml`. Ils ne servent qu'au premier démarrage : ensuite c'est
`data/reglages.json` qui commande.

| Variable | Défaut | À quoi ça sert |
| --- | --- | --- |
| `ECR_HTTP_PORT` | `8802` | le port |
| `ECR_NOM_SALLE` | `Salle de réunion` | affiché sur l'écran et sur les téléphones |
| `ECR_ADRESSE_PUBLIQUE` | *(vide)* | **l'adresse par laquelle un TÉLÉPHONE joint le service** — c'est elle qu'on encode dans le QR code |
| `ECR_TAILLE_MAX_MO` | `50` | par fichier |
| `ECR_FICHIERS_MAX` | `10` | par envoi |
| `ECR_EFFACEMENT_HEURES` | `4` | le filet du §9.2 : inactivité au bout de laquelle tout s'efface |

### `ECR_ADRESSE_PUBLIQUE`, le réglage qui compte

Laissé vide, le QR code encode l'adresse par laquelle **l'écran de la salle** a
ouvert la page. Cela suffit tant que tout le monde est sur le même réseau — mais
si l'écran ouvre `http://localhost:8802/scene`, le QR code mènera les téléphones
sur *leur* localhost, c'est-à-dire nulle part.

Dès que l'écran et les téléphones ne voient pas le serveur par la même adresse,
réglez-la : `http://192.168.0.10:8802`.

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
   projet (§4), et il n'est pas logiciel. À vérifier avant tout le reste.
2. **La conversion dans le conteneur** : `docker exec ecran-partage node tests/depot.mjs`
   doit passer sans aucun `IGNORE`.
3. **La lisibilité à trois mètres**, sur l'écran choisi.
4. **Le délai** entre le dépôt et l'affichage, mesuré avec un vrai `.pptx`.
