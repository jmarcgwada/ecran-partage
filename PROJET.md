# Écran Partagé — cahier de projet

> Document de démarrage destiné à Claude Code. Il porte les décisions déjà
> prises, ce qui se réutilise, et surtout les pièges déjà payés ailleurs.
> À lire en entier avant d'écrire la première ligne.

---

## 1. Ce que c'est

Dans une salle de réunion, **chacun envoie un document sur l'écran depuis son
téléphone**, à tour de rôle. On scanne un QR code affiché sur l'écran, on choisit
un fichier, il apparaît. Le suivant prend la main quand c'est son tour.

Pas de câble à brancher, pas de logiciel à installer, pas de compte.

### Ce que ce n'est PAS

- **Pas de partage d'écran en direct.** On envoie des *documents*, pas le contenu
  vivant d'un portable. Le partage d'écran temps réel est un tout autre métier
  (WebRTC, capture, latence) et n'a rien à faire dans une première version.
- **Pas de monétisation.** Ni tarif, ni file d'attente à valider, ni journal de
  recette. C'est la grande différence avec le service d'impression dont ce projet
  descend, et elle
  simplifie énormément : personne n'a besoin de « valider » avant l'affichage.
- **Pas un service exposé sur Internet.** Une réunion se tient dans une salle,
  sur un réseau. Voir §4.

---

## 2. Faisabilité : le verdict

**Faisable, et sans difficulté technique majeure.** La raison est simple : les
quatre morceaux difficiles sont déjà écrits et éprouvés dans un service
d'impression jumeau, tournant en production sur le même NAS.

| Morceau | État |
| --- | --- |
| Recevoir un fichier depuis un téléphone, sans dépendance npm | **fait** (`src/multipart.js`) |
| Transformer n'importe quoi en pages affichables | **fait** (`src/documents.js`, LibreOffice + poppler) |
| Fabriquer un QR code | **fait** (`qrencode`) |
| Servir tout ça depuis un conteneur sur le NAS | **fait** (Dockerfile, compose) |

Ce qu'il reste à inventer est modeste : **une page pour l'écran**, **un tour de
parole**, et **un lien temps réel** entre le serveur et l'écran.

Le vrai risque n'est pas logiciel, il est **matériel** : voir §4.

---

## 3. L'architecture, et pourquoi

```
   Téléphones                    NAS (conteneur)                 Écran de la salle
   ──────────                    ───────────────                 ─────────────────
   /salle/<code>   ──POST──▶   fichier reçu, converti
   (dépôt)                     en pages images
                                      │
                                      └── SSE ──▶  /scene  (navigateur plein écran)
                                                   affiche la page courante
```

### Décision 1 — l'écran est un NAVIGATEUR, pas un protocole de diffusion

L'écran de la salle ouvre **une page web en plein écran**, une fois pour toutes.
Le serveur lui pousse quoi afficher.

*Pourquoi pas Chromecast, DLNA ou AirPlay ?* Parce qu'ils imposent chacun leur
format, leur découverte réseau et leurs limites — **aucun des trois ne sait
afficher un PDF**, qui est justement le format de réunion par excellence. Un
navigateur, lui, affiche tout ce qu'on lui donne, se déboguer se fait à l'œil, et
la même page marche sur un boîtier Android, un Raspberry Pi, un portable déjà
branché au vidéoprojecteur, ou une box TV.

Garder l'option DLNA en tête pour une v2 (§10), pas pour la v1.

### Décision 2 — les documents sont convertis en IMAGES côté serveur

Un PDF, un `.docx`, un `.pptx` deviennent une suite de JPEG, une par page, via
LibreOffice puis `pdftoppm`. L'écran n'affiche que des images.

*Pourquoi ?* Parce que le lecteur PDF intégré des navigateurs de téléviseurs et
de boîtiers Android est absent, ancien ou fantaisiste. Une image s'affiche
partout, sans exception. Le pipeline existe déjà et il est éprouvé.

Les **vidéos** font exception : elles sont servies telles quelles à une balise
`<video>`. Voir les limites en §10.

### Décision 3 — le lien temps réel est du SSE, pas du WebSocket

Le serveur pousse à l'écran « affiche maintenant telle page ». C'est **à sens
unique** : les commandes, elles, arrivent des téléphones par de simples POST.

`Server-Sent Events` suffit donc, tient en trente lignes de Node sans
dépendance, et **évite le piège des en-têtes WebSocket du proxy inverse DSM**
qui a déjà coûté du temps ailleurs.

> Si un jour la page passe par le proxy inverse DSM, penser à désactiver la
> mise en tampon, sinon le flux SSE arrive par paquets avec des secondes de
> retard. Sur le réseau de la salle, en direct, la question ne se pose pas.

### Décision 4 — un code de salle, pas de comptes

L'écran affiche en permanence, en petit, un **code à quatre chiffres**. Le QR
code mène à `/salle/<code>`. Sans le code, on ne dépose rien.

C'est l'équivalent d'un code de retrait en magasin : assez pour empêcher
le bureau d'à côté d'envoyer une photo pendant la réunion, sans rien à
administrer. Le code change à chaque nouvelle réunion.

---

## 4. Le matériel de la salle — le vrai sujet

Par ordre de préférence :

1. **Un mini-PC ou un Raspberry Pi en mode kiosque** branché en HDMI. Le plus
   fiable, une trentaine d'euros, navigateur à jour, plein écran automatique.
2. **Un portable déjà branché au vidéoprojecteur.** Zéro achat : on ouvre la
   page, F11, c'est fini.
3. **Un boîtier Android** (box TV, Chromecast with Google TV, Fire TV) avec un
   navigateur installé. Fonctionne, mais la navigation à la télécommande pour
   ouvrir une URL est pénible — à faire une fois et à laisser ouvert.
4. **Le navigateur intégré d'un téléviseur.** À éviter. Ils sont vieux, lents,
   et beaucoup ne gèrent pas le plein écran ni le SSE correctement.

**À vérifier avant de commencer** : l'écran choisi peut-il joindre le NAS ? Une
salle de réunion sur un réseau invité isolé ne verra pas le serveur — c'est le
premier point à éprouver, avant d'écrire du code.

Penser aussi à **empêcher la mise en veille** de l'écran (réglage du système, et
côté page : `navigator.wakeLock` quand il est disponible).

---

## 5. Les écrans du service

| Adresse | Pour qui | Quoi |
| --- | --- | --- |
| `/scene` | l'écran de la salle | plein écran : le document courant, le QR code et le code de salle en incrustation |
| `/salle/<code>` | les participants | dépôt d'un fichier, et les commandes de celui qui a la main |
| `/animateur` | celui qui mène | ouvrir/fermer la réunion, donner la main, retirer un document |

L'animateur n'a pas besoin d'être une personne différente : sur une petite
réunion, la page `/salle` suffit et tout le monde peut avancer les pages.
**Prévoir un réglage « tout le monde peut prendre la main » / « seul l'animateur
distribue la parole ».**

---

## 6. Le déroulé d'une réunion

1. On ouvre `/scene` sur l'écran. Il affiche **un QR code plein cadre** et le
   code de salle : c'est l'écran d'accueil.
2. Chacun scanne, arrive sur `/salle/<code>`, saisit son prénom (facultatif) et
   dépose un ou plusieurs fichiers. Ils apparaissent dans une **liste commune**,
   visible de tous les téléphones.
3. Celui qui a la main appuie sur **Afficher** à côté de son document : l'écran
   bascule dessus. Il fait défiler les pages depuis son téléphone — le téléphone
   devient la télécommande.
4. Il rend la main ; le suivant prend la sienne.
5. **Terminer la réunion** efface tout : documents, liste, code. L'écran revient
   au QR code d'accueil, avec un nouveau code.

Le point 5 n'est pas une option. Voir §9.

---

## 7. Le modèle de données

Tout vit en mémoire, plus un dossier de fichiers temporaires. **Rien à
persister** : une réunion terminée ne laisse aucune trace.

```js
salle = {
  code: '4821',                  // quatre chiffres, régénéré à chaque réunion
  ouverte: true,
  mainA: '<participantId>',      // qui pilote l'écran, null = personne
  laMainEstLibre: true,          // réglage : chacun peut la prendre
  participants: [{ id, prenom, vuLe }],
  documents: [{
    id, prenom, nom,             // « Budget 2026.pptx »
    pages: ['/page/<id>/0.jpg', …],
    video: null,                 // ou le chemin du fichier, pour une vidéo
    erreur: null,
  }],
  affichage: { documentId, page: 0 },   // ce que l'écran montre
}
```

---

## 8. Ce qu'on reprend du service d'impression

Quatre fichiers viennent d'un service d'impression écrit pour le même NAS, et
éprouvé en production. **Copier les fichiers, ne pas les importer** : les deux
projets doivent rester indépendants.

| Fichier | Ce qu'on en fait |
| --- | --- |
| `src/multipart.js` | tel quel — lecture des envois sans dépendance npm |
| `src/documents.js` | à alléger : garder la conversion en PDF puis en images, jeter le comptage de pages tarifaire et la mesure d'encre |
| `src/http.js` | tel quel — réponses, statique, `viderRequete` |
| `Dockerfile` | même base ; **retirer CUPS et Ghostscript**, garder LibreOffice, poppler, qrencode, img2pdf |
| `docker-compose.yml` | même forme, **`network_mode: bridge` obligatoire** |
| `tests/depot.mjs` | modèle du banc d'essai : monter le vrai serveur en mémoire et le solliciter comme un navigateur |

**Port : 8802** (voir la note « Ports du NAS » — 8801 est pris par Impression
Express). Penser à mettre cette note à jour une fois le projet déployé.

---

## 9. Confidentialité — non négociable

Une réunion voit passer des documents qu'aucun des participants n'a envie de
retrouver quelque part. Trois règles, à ne pas assouplir :

1. **Fin de réunion = effacement.** Les fichiers et les images de pages sont
   supprimés du disque, pas seulement retirés d'une liste.
2. **Filet de sécurité** : effacement automatique après quelques heures
   d'inactivité, au cas où personne ne clique sur « Terminer ». Une réunion
   oubliée ne doit pas laisser un `.pptx` confidentiel sur le NAS pendant un
   mois.
3. **Rien sur Internet.** Le service reste sur le réseau local et le tailnet. Ne
   pas créer de règle de proxy inverse DSM pour ce projet. Si l'accès à distance
   devient nécessaire, passer par `tailscale serve`, jamais par `funnel`.

---

## 10. Pièges connus — tous déjà payés ailleurs

Ceux-ci ont coûté du temps sur d'autres services du même NAS. Les lire évite de
les repayer.

### Sur le dépôt de fichiers

- **Sortir d'une boucle `for await (… of req)` par une exception DÉTRUIT la
  requête**, donc la connexion : le téléphone reçoit une coupure réseau au lieu
  du message « fichier trop volumineux ». Lire jusqu'au bout en jetant les
  octets, refuser après. Voir `viderRequete` dans `src/http.js`.
- Les **noms de fichiers accentués** arrivent encodés de deux façons (RFC 2047 et
  RFC 2231). `multipart.js` gère déjà les deux.
- Une **vidéo de réunion peut peser des centaines de mégaoctets**. Fixer une
  limite haute mais réelle, et l'annoncer sur la page de dépôt.

### Sur la conversion

- **LibreOffice exige `-env:UserInstallation`** pointant vers un profil à lui,
  sinon deux conversions simultanées se bloquent l'une l'autre, en silence.
  **Ce profil va dans le répertoire temporaire, jamais dans le dossier du
  document** : il pèse quelques mégaoctets, appartient à root, et survit à la
  conversion.
- **ImageMagick n'écrit pas de PDF** sous Debian (politique de sécurité par
  défaut) : passer par un PNG intermédiaire.

### Sur le conteneur et le NAS

- **`network_mode: bridge` est obligatoire** : la réserve d'adresses privées de
  Docker est épuisée sur ce NAS, et créer un réseau dédié échoue avec un message
  qui ne parle pas de saturation.
- **Ajouter un paquet à un bloc `apt` existant invalide le cache** et fait
  retélécharger tout LibreOffice — une demi-heure. Mettre chaque ajout dans sa
  propre couche.
- Le conteneur ne voit **pas** la multidiffusion du réseau local : toute
  découverte type mDNS/Bonjour ne trouvera rien, sans la moindre erreur.

### Sur l'interface

- **Un formulaire HTML invalide ne déclenche pas l'événement `submit`** : le
  bouton ne fait alors rien, sans un mot. Attention aux `step` calés sur `min`.
  Mettre `novalidate` et vérifier soi-même, pour pouvoir nommer le champ fautif.
- **Servir les fichiers statiques en `no-cache`**, sinon l'écran de la salle
  garde l'ancienne page après une mise à jour.
- **Les notifications système exigent une page en HTTPS.** Sans objet ici, mais
  à savoir si l'on veut prévenir quelqu'un.

---

## 11. Les phases

Chaque phase est utilisable telle quelle. Ne pas commencer la suivante avant
d'avoir éprouvé la précédente sur le vrai écran.

**Phase 1 — l'écran affiche quelque chose**
`/scene` avec le QR code et le code de salle, `/salle/<code>` avec le dépôt, la
conversion en images, le SSE, et l'affichage d'un document. Pas de tour de
parole : le dernier déposé s'affiche. *C'est déjà utile en réunion.*

**Phase 2 — le tour de parole**
La liste commune, « prendre la main », les commandes page précédente / suivante
depuis le téléphone, le réglage « chacun peut prendre la main ».

**Phase 3 — la fin de réunion**
Bouton « Terminer », effacement réel, nouveau code, filet de sécurité par
inactivité.

**Phase 4 — le confort**
Vidéos, retour à l'écran d'accueil après un délai, mode sombre pour ne pas
éblouir, `wakeLock`, éventuellement une télécommande au clavier pour l'écran.

---

## 12. Comment vérifier

Reprendre la méthode du service d'impression, qui a trouvé de vrais défauts :

- **Un banc d'essai qui monte le vrai serveur HTTP en mémoire** et le sollicite
  comme un navigateur (`tests/depot.mjs` sert de modèle). Zéro dépendance.
- **Éprouver la conversion DANS le conteneur**, pas sur le poste Windows :
  LibreOffice et poppler n'y sont pas. Copier `tests/` dans l'image pour pouvoir
  lancer les bancs sur un conteneur déployé.
- **Regarder l'écran pour de vrai.** Une page de réunion se juge à trois mètres :
  taille du QR code, lisibilité du code de salle, temps entre le dépôt et
  l'affichage. Aucun banc ne dira si c'est trop petit.
- **Mesurer le délai** entre l'envoi depuis le téléphone et l'apparition à
  l'écran. Au-delà de trois ou quatre secondes pour un PDF de quelques pages, il
  faut afficher un état d'attente sur l'écran, sinon on croit à une panne et on
  renvoie le fichier.

---

## 13. Ce qui reste à décider

Questions à poser avant de coder :

1. **Où se tient la réunion ?** Le magasin, ou une salle sur un autre réseau ?
   Cela conditionne tout l'accès.
2. **Quel écran ?** Voir §4. S'il faut acheter un boîtier, autant le choisir
   avant d'écrire la page.
3. **Combien de participants**, et déposent-ils de grosses vidéos ? Cela fixe la
   limite de taille et l'espace disque à prévoir.
4. **Une réunion à la fois, ou plusieurs salles en parallèle ?** La v1 suppose
   **une seule salle**. Plusieurs salles simultanées changent le modèle de
   données — à trancher tout de suite, c'est structurant.
5. **Faut-il garder une trace ?** Le présent document dit non, et c'est le choix
   sain. Si quelqu'un veut « récupérer les documents de la réunion », le dire
   maintenant : cela contredit le §9 et demande une autre conception.
