// ============================================================================
// LE TELEPHONE D'UN PARTICIPANT
//
// Deposer un document, voir la liste commune se remplir, remettre un document a
// l'ecran et tourner ses pages — le telephone est la telecommande.
//
// Le dernier document converti prend l'ecran tout seul : deposer, c'est montrer.
// Quand l'animateur ferme le tour de parole, seul celui qui a la main pilote ;
// deposer, lui, reste toujours permis.
// ============================================================================

(function () {
  'use strict';

  // Le code est dans l'adresse : /salle/4821. C'est la seule chose qui
  // autorise a deposer, on ne le retient donc nulle part ailleurs.
  var code = (location.pathname.split('/')[2] || '').replace(/\D/g, '');

  var champFichiers = document.getElementById('fichiers');
  var champPrenom = document.getElementById('prenom');
  var boutonChoisir = document.getElementById('choisir');
  var boutonEnvoyer = document.getElementById('envoyer');
  var choisis = document.getElementById('choisis');
  var avancement = document.getElementById('avancement');
  var barre = avancement.firstElementChild;
  var message = document.getElementById('message');
  var liste = document.getElementById('liste');
  var listeVide = document.getElementById('liste-vide');
  var listeAide = document.getElementById('liste-aide');
  var ligneRetenu = document.getElementById('retenu');
  var commande = document.getElementById('commande');
  var commandeNom = document.getElementById('commande-nom');
  var commandePage = document.getElementById('commande-page');
  var zonePages = document.getElementById('pages');
  var boutonPrecedent = document.getElementById('precedent');
  var boutonSuivant = document.getElementById('suivant');
  var boutonLecture = document.getElementById('lecture');
  var sectionMain = document.getElementById('main-salle');
  var mainEtat = document.getElementById('main-etat');
  var boutonPrendre = document.getElementById('prendre');
  var boutonRendre = document.getElementById('rendre');

  // Vrai tant que la main est libre ou qu'elle est a nous. Sert a griser les
  // commandes plutot qu'a laisser cliquer pour se faire refuser.
  var jePilote = true;

  // Vrai si CE telephone mene la reunion. Recalcule a chaque etat recu.
  var jeMene = false;
  // L'adresse de la salle, pour l'invitation. Elle ne voyage pas dans le
  // flux : seule la reponse de /api/etat la donne.
  var adresseSalle = '';

  var limites = { tailleMaxMo: 50, fichiersMax: 10 };
  var mesDocuments = {};
  var dernierEtat = null;

  // --- Ce qu'on retient d'une fois sur l'autre -----------------------------
  // Le prenom et l'identifiant de participant, dans ce navigateur seulement.
  // Rien ne part sur le serveur qui ne soit deja dans un envoi.

  function retenu(cle) {
    try { return localStorage.getItem(cle) || ''; } catch (err) { return ''; }
  }
  function retenir(cle, valeur) {
    try { localStorage.setItem(cle, valeur); } catch (err) { /* navigation privee */ }
  }

  // Un telephone = une personne. Le prenom se saisit une fois, ce navigateur le
  // retient, et il n'y a donc pas d'utilisateur a commuter : si le prenom est
  // faux, on corrige le champ.
  champPrenom.value = retenu('ecr_prenom');
  champPrenom.addEventListener('change', function () {
    retenir('ecr_prenom', champPrenom.value.trim());
    majIdentite();
    // L'animateur doit voir le bon nom dans sa liste de participants.
    seFaireConnaitre();
  });

  function majIdentite() {
    ligneRetenu.textContent = champPrenom.value.trim()
      ? 'Ce téléphone se souvient de vous d’une réunion à l’autre.'
      : '';
  }

  majIdentite();

  // --- Le choix des fichiers ------------------------------------------------

  boutonChoisir.addEventListener('click', function () { champFichiers.click(); });

  champFichiers.addEventListener('change', function () {
    var fichiers = champFichiers.files;
    if (!fichiers || !fichiers.length) {
      choisis.textContent = 'Aucun fichier choisi';
      boutonEnvoyer.disabled = true;
      return;
    }
    var noms = [];
    var total = 0;
    for (var i = 0; i < fichiers.length; i++) {
      noms.push(fichiers[i].name);
      total += fichiers[i].size;
    }
    choisis.textContent = noms.join(', ') + ' — ' + mo(total) + ' Mo';
    boutonEnvoyer.disabled = false;
    dire('', '');
  });

  function mo(octets) {
    return (octets / (1024 * 1024)).toFixed(1).replace('.', ',');
  }

  // La meme liste que documents.js cote serveur. Dupliquee, faute de mieux :
  // cette page n'importe rien, elle doit tourner dans un vieux navigateur.
  var EXTENSIONS_VIDEO = ['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv'];

  function estUneVideo(nom) {
    var point = String(nom).lastIndexOf('.');
    return point >= 0 && EXTENSIONS_VIDEO.indexOf(String(nom).slice(point).toLowerCase()) >= 0;
  }

  function dire(texte, genre) {
    message.textContent = texte;
    message.className = texte ? 'visible ' + genre : '';
  }

  // --- L'envoi --------------------------------------------------------------
  // XMLHttpRequest et non fetch : fetch ne sait pas dire ou en est un ENVOI.
  // Sur un .pptx de quarante mega-octets et un Wi-Fi de salle, une barre qui
  // avance est la difference entre patienter et renvoyer le fichier.

  boutonEnvoyer.addEventListener('click', function () {
    var fichiers = champFichiers.files;
    if (!fichiers || !fichiers.length) return dire('Choisissez d’abord un fichier.', 'erreur');
    if (fichiers.length > limites.fichiersMax) {
      return dire('Trop de documents à la fois (maximum ' + limites.fichiersMax + ').', 'erreur');
    }

    // On refuse ici ce que le serveur refuserait de toute facon : inutile de
    // faire monter quarante mega-octets pour s'entendre dire non a la fin.
    //
    // Chaque fichier a SA limite, comme cote serveur. La premiere version de
    // ce controle appliquait celle des documents a tout : une video de 150 Mo,
    // que le serveur aurait acceptee, etait refusee ici avant meme de partir.
    for (var i = 0; i < fichiers.length; i++) {
      var plafond = estUneVideo(fichiers[i].name)
        ? (limites.tailleMaxVideoMo || limites.tailleMaxMo)
        : limites.tailleMaxMo;
      if (fichiers[i].size > plafond * 1024 * 1024) {
        return dire('« ' + fichiers[i].name + ' » dépasse ' + plafond + ' Mo.', 'erreur');
      }
    }

    var paquet = new FormData();
    paquet.append('prenom', champPrenom.value.trim());
    paquet.append('participant', retenu('ecr_participant'));
    for (var j = 0; j < fichiers.length; j++) paquet.append('documents', fichiers[j]);

    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/depot?code=' + encodeURIComponent(code));

    requete.upload.onprogress = function (evenement) {
      if (!evenement.lengthComputable) return;
      barre.style.width = Math.round((evenement.loaded / evenement.total) * 100) + '%';
    };

    requete.onload = function () {
      finir();
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* voir plus bas */ }

      if (requete.status === 403) {
        return dire('Code de salle incorrect. Rescannez le QR code affiché sur l’écran.', 'erreur');
      }
      if (requete.status !== 200) {
        return dire(reponse.erreur || 'L’envoi a échoué.', 'erreur');
      }

      if (reponse.participant) retenir('ecr_participant', reponse.participant);
      for (var k = 0; k < (reponse.documents || []).length; k++) {
        mesDocuments[reponse.documents[k].id] = true;
      }

      var refuses = reponse.refuses || [];
      if (refuses.length) {
        // Le motif vient du serveur : « format non accepté » ou « dépasse
        // 50 Mo ». L'écrire en dur ici mentirait une fois sur deux.
        dire('Refusé : ' + refuses.map(function (r) {
          return r.nom + ' — ' + (r.motif || 'refusé');
        }).join(', ') + '.', 'erreur');
      } else {
        dire('Envoyé. Le document apparaît sur l’écran dans un instant.', 'bien');
      }

      champFichiers.value = '';
      choisis.textContent = 'Aucun fichier choisi';
      boutonEnvoyer.disabled = true;
    };

    // Une coupure reseau n'a pas de statut : sans ce garde-fou, la page
    // resterait bloquee sur « Envoi… » pour toujours.
    requete.onerror = function () {
      finir();
      dire('Connexion interrompue. Êtes-vous toujours sur le réseau de la salle ?', 'erreur');
    };
    requete.onabort = function () { finir(); };

    boutonEnvoyer.disabled = true;
    boutonEnvoyer.textContent = 'Envoi…';
    barre.style.width = '0%';
    avancement.className = 'visible';
    dire('', '');
    requete.send(paquet);
  });

  function finir() {
    avancement.className = '';
    boutonEnvoyer.textContent = 'Envoyer sur l’écran';
    boutonEnvoyer.disabled = !(champFichiers.files && champFichiers.files.length);
  }

  // --- La liste commune -----------------------------------------------------

  var etats = {
    conversion: 'préparation…',
    pret: 'prêt',
    erreur: 'illisible',
  };

  function appliquer(etat) {
    // Retenu pour pouvoir redessiner la liste sans attendre le flux — au
    // changement d'utilisateur, par exemple.
    dernierEtat = etat;
    if (etat.adresse) adresseSalle = etat.adresse;
    document.getElementById('code').textContent = etat.code;
    document.getElementById('nom-salle').textContent = etat.nomSalle || '';
    // L'animation d'abord : elle décide des boutons de retrait de la liste.
    majAnimation(etat);
    // Puis la main : elle décide si les commandes sont actives.
    majMain(etat);
    majCommande(etat);

    if (etat.limites) limites = etat.limites;
    if (etat.formats) {
      champFichiers.setAttribute('accept', etat.formats.join(','));
      document.getElementById('pied').textContent =
        'Formats acceptés : PDF, Word, Excel, PowerPoint, images, vidéos. '
        + limites.tailleMaxMo + ' Mo par document, '
        + limites.tailleMaxVideoMo + ' Mo pour une vidéo. '
        + 'Les documents sont effacés à la fin de la réunion.';
    }

    // Le code a change : la reunion en cours n'est plus la notre. On le dit,
    // plutot que de laisser un envoi echouer en 403 sans explication.
    if (etat.code !== code) {
      dire('La réunion a changé de code. Rescannez le QR code affiché sur l’écran.', 'erreur');
    }

    var documents = etat.documents || [];
    listeVide.style.display = documents.length ? 'none' : 'block';
    liste.innerHTML = '';
    var affichables = 0;

    for (var i = 0; i < documents.length; i++) {
      var doc = documents[i];
      var aLEcran = !!(etat.affichage && etat.affichage.documentId === doc.id);

      // createElement et textContent plutot qu'une chaine de HTML : un nom de
      // fichier vient d'un telephone, il n'a rien a faire dans innerHTML.
      var ligne = document.createElement('li');
      if (aLEcran) ligne.className = 'affiche';

      var titre = document.createElement('div');
      titre.className = 'titre';
      var nom = document.createElement('span');
      nom.className = 'nom';
      nom.textContent = doc.nom;
      titre.appendChild(nom);
      if (doc.prenom) {
        var qui = document.createElement('span');
        qui.className = 'qui';
        qui.textContent = doc.prenom + (mesDocuments[doc.id] ? ' (vous)' : '');
        titre.appendChild(qui);
      }

      // Un document pret et absent de l'ecran se remet d'un bouton. C'est tout
      // l'interet de garder la liste : on revient sur le budget de tout a
      // l'heure sans le renvoyer depuis son telephone.
      var action;
      if (!aLEcran && doc.etat === 'pret') {
        action = document.createElement('button');
        action.type = 'button';
        action.className = 'afficher';
        action.textContent = 'Afficher';
        // L'identifiant voyage sur le bouton : la liste se reconstruit a
        // chaque evenement du flux, et un ecouteur pose sur chaque bouton
        // serait repose des dizaines de fois dans une reunion.
        action.setAttribute('data-id', doc.id);
        action.disabled = !jePilote;
        affichables += 1;
      } else {
        action = document.createElement('div');
        action.className = 'etat' + (doc.etat === 'erreur' ? ' erreur' : '');
        action.textContent = aLEcran ? 'à l’écran' : (etats[doc.etat] || '');
        action.title = doc.erreur || '';
      }

      ligne.appendChild(titre);
      ligne.appendChild(action);
      if (jeMene) {
        var retrait = document.createElement('button');
        retrait.type = 'button';
        retrait.className = 'retirer';
        retrait.textContent = 'Retirer';
        retrait.setAttribute('data-retirer', doc.id);
        retrait.setAttribute('data-nom', doc.nom);
        ligne.appendChild(retrait);
      }
      liste.appendChild(ligne);
    }

    listeAide.hidden = affichables === 0;
  }

  // --- La main --------------------------------------------------------------

  function moi() {
    return retenu('ecr_participant');
  }

  // Se faire connaître en arrivant, sans rien déposer : sinon on n'existerait
  // qu'après son premier envoi, et l'animateur ne pourrait pas donner la main à
  // quelqu'un qui veut commenter le document d'un autre.
  function seFaireConnaitre() {
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/rejoindre?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.onload = function () {
      if (requete.status !== 200) return;
      try {
        var reponse = JSON.parse(requete.responseText);
        if (reponse.participant) retenir('ecr_participant', reponse.participant);
        if (dernierEtat) appliquer(dernierEtat);   // « (vous) » et l'état de la main
      } catch (err) { /* on repassera au prochain envoi */ }
    };
    requete.send(JSON.stringify({ participant: moi(), prenom: champPrenom.value.trim() }));
  }

  function majMain(etat) {
    // Main libre : la rubrique entière disparaît. Un bouton « Prendre la main »
    // qui ne sert à rien est un bouton sur lequel on appuie quand même.
    if (etat.laMainEstLibre) {
      sectionMain.hidden = true;
      jePilote = true;
      return;
    }

    sectionMain.hidden = false;
    var aMoi = !!(etat.mainA && etat.mainA === moi());
    // L'animateur pilote toujours, meme quand quelqu'un d'autre a la main.
    jePilote = aMoi || !!(etat.animateur && etat.animateur === moi());

    var porteur = null;
    for (var i = 0; i < (etat.participants || []).length; i++) {
      if (etat.participants[i].id === etat.mainA) porteur = etat.participants[i];
    }

    if (aMoi) mainEtat.textContent = 'Vous avez la main sur l’écran.';
    else if (porteur) {
      mainEtat.textContent = (porteur.prenom || 'Quelqu’un') + ' a la main sur l’écran.';
    } else mainEtat.textContent = 'Personne n’a la main. À prendre.';

    boutonPrendre.hidden = aMoi || !!etat.mainA;
    boutonRendre.hidden = !aMoi;
  }

  function commanderLaMain(action) {
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/main?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.onload = function () {
      if (requete.status === 200) return dire('', '');
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* défaut */ }
      dire(reponse.erreur || 'Impossible pour l’instant.', 'erreur');
    };
    requete.onerror = function () { dire('Connexion interrompue.', 'erreur'); };
    requete.send(JSON.stringify({ action: action, participant: moi() }));
  }

  boutonPrendre.addEventListener('click', function () { commanderLaMain('prendre'); });
  boutonRendre.addEventListener('click', function () { commanderLaMain('rendre'); });

  // --- La télécommande ------------------------------------------------------

  function majCommande(etat) {
    var a = etat.affichage;
    if (!a || !a.documentId) {
      commande.hidden = true;
      return;
    }
    commande.hidden = false;
    commandeNom.textContent = a.nom + (a.prenom ? ' — ' + a.prenom : '');

    // Une vidéo n'a pas de pages, mais elle se met en marche et s'arrête. Une
    // vidéo ne démarre jamais toute seule : le son partirait dans une salle qui
    // parle encore d'autre chose.
    var estVideo = !!a.video;
    boutonLecture.hidden = !estVideo;
    boutonLecture.disabled = !jePilote;
    boutonLecture.textContent = a.lecture ? 'Mettre en pause' : 'Lire';

    // Un document d'une seule page n'a rien à tourner : les boutons
    // disparaissent plutôt que de rester grisés sans qu'on sache pourquoi.
    zonePages.hidden = estVideo || a.nbPages < 2;
    commandePage.textContent = (a.page + 1) + ' / ' + a.nbPages;
    // Grisés plutôt que muets quand quelqu'un d'autre a la main : on voit tout
    // de suite que ce n'est pas à soi de piloter.
    boutonPrecedent.disabled = !jePilote || a.page <= 0;
    boutonSuivant.disabled = !jePilote || a.page >= a.nbPages - 1;
  }

  function tourner(sens) {
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/page?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');

    requete.onload = function () {
      if (requete.status === 200) return dire('', '');
      if (requete.status === 403) {
        return dire('Code de salle incorrect. Rescannez le QR code affiché sur l’écran.', 'erreur');
      }
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* message par défaut */ }
      dire(reponse.erreur || 'Impossible de tourner la page.', 'erreur');
    };
    requete.onerror = function () {
      dire('Connexion interrompue. Êtes-vous toujours sur le réseau de la salle ?', 'erreur');
    };

    // On n'attend pas la réponse pour réagir : les boutons restent actifs, et
    // c'est VOULU. Le serveur tient le compte des pages, deux appuis rapides
    // avancent donc bien de deux pages — c'est pour cela qu'on lui envoie un
    // sens plutôt qu'un numéro. L'écran, lui, sera informé par le flux.
    requete.send(JSON.stringify({ sens: sens, participant: moi() }));
  }

  boutonPrecedent.addEventListener('click', function () { tourner(-1); });
  boutonSuivant.addEventListener('click', function () { tourner(1); });

  boutonLecture.addEventListener('click', function () {
    if (!dernierEtat) return;
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/video?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.onload = function () {
      if (requete.status === 200) return dire('', '');
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* défaut */ }
      dire(reponse.erreur || 'Impossible pour l’instant.', 'erreur');
    };
    requete.onerror = function () { dire('Connexion interrompue.', 'erreur'); };
    requete.send(JSON.stringify({
      lecture: !dernierEtat.affichage.lecture,
      participant: moi(),
    }));
  });

  // Un seul ecouteur, pose une fois pour toutes sur la liste.
  liste.addEventListener('click', function (evenement) {
    var cible = evenement.target;
    if (!cible || cible.tagName !== 'BUTTON') return;
    var id = cible.getAttribute('data-id');
    if (id) remettreALEcran(id, cible);
  });

  function remettreALEcran(id, bouton) {
    bouton.disabled = true;
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/afficher?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');

    requete.onload = function () {
      bouton.disabled = false;
      if (requete.status === 200) return dire('', '');
      if (requete.status === 403) {
        return dire('Code de salle incorrect. Rescannez le QR code affiché sur l’écran.', 'erreur');
      }
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* message par défaut */ }
      dire(reponse.erreur || 'Impossible d’afficher ce document.', 'erreur');
    };
    requete.onerror = function () {
      bouton.disabled = false;
      dire('Connexion interrompue. Êtes-vous toujours sur le réseau de la salle ?', 'erreur');
    };

    // L'écran bascule tout seul : c'est le flux qui l'en informera, pas cette
    // réponse. Ici on n'attend qu'un accusé de réception.
    requete.send(JSON.stringify({ documentId: id, participant: moi() }));
  }

  // Le meme flux que l'ecran de la salle : la liste se remplit sous les yeux
  // de tout le monde, sans que personne ait a rafraichir sa page.

  // --- L'animation ------------------------------------------------------------
  //
  // Un participant revendique le rôle depuis son téléphone ; lui seul
  // administre. Tout ce qui suit ne s'affiche que sur SON téléphone.

  var sectionAnimation = document.getElementById('animation');
  var messageAnimation = document.getElementById('message-animation');
  var menerEtat = document.getElementById('mener-etat');
  var messageMener = document.getElementById('message-mener');
  var boutonRevendiquer = document.getElementById('revendiquer');
  var boutonQuitter = document.getElementById('quitter');
  var regime = document.getElementById('regime');
  var boutonBasculer = document.getElementById('basculer');
  var boutonLiberer = document.getElementById('liberer');
  var listeParticipants = document.getElementById('participants');
  var curseur = document.getElementById('luminosite');
  var valeurLuminosite = document.getElementById('luminosite-valeur');
  var choixRetour = document.getElementById('retour');

  function direDans(ou, texte, genre) {
    ou.textContent = texte;
    ou.className = texte ? 'visible ' + genre : '';
  }

  // Une commande : le code de salle dans l'adresse, et TOUJOURS l'identifiant
  // de celui qui parle dans « participant ». La personne visée, s'il y en a
  // une, s'appelle « cible » — le serveur refuserait qu'on se désigne soi-même
  // pour se donner des droits.
  function commander(chemin, corps, ou, ensuite) {
    corps.participant = moi();
    var requete = new XMLHttpRequest();
    requete.open('POST', chemin + '?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.onload = function () {
      var reponse = {};
      try { reponse = JSON.parse(requete.responseText); } catch (err) { /* défaut */ }
      if (requete.status !== 200) {
        return direDans(ou, reponse.erreur || 'La commande a échoué.', 'erreur');
      }
      direDans(ou, '', '');
      if (ensuite) ensuite(reponse);
    };
    requete.onerror = function () {
      direDans(ou, 'Connexion interrompue. Êtes-vous toujours sur le réseau de la salle ?', 'erreur');
    };
    requete.send(JSON.stringify(corps));
  }

  function majAnimation(etat) {
    var monId = moi();
    jeMene = !!(etat.animateur && monId && etat.animateur === monId);

    // La rubrique « Mener la réunion », visible de tous.
    if (jeMene) {
      menerEtat.textContent = 'Vous menez cette réunion.';
    } else if (etat.animateur) {
      menerEtat.textContent = 'Réunion menée par '
        + (etat.animateurPrenom || 'un participant sans prénom') + '.';
    } else {
      menerEtat.textContent = 'Personne ne mène la réunion. Celui qui s’en charge '
        + 'administre l’écran depuis son téléphone : tour de parole, retrait '
        + 'd’un document, fin de réunion.';
    }
    boutonRevendiquer.hidden = !!etat.animateur;
    boutonQuitter.hidden = !jeMene;

    sectionAnimation.hidden = !jeMene;
    if (!jeMene) {
      arreterPresence();
      return;
    }
    demarrerPresence();

    regime.textContent = etat.laMainEstLibre
      ? 'La main est libre : chacun peut afficher un document et tourner les pages.'
      : 'Le tour de parole est fermé : une seule personne pilote l’écran à la fois.';
    boutonBasculer.textContent = etat.laMainEstLibre
      ? 'Fermer le tour de parole'
      : 'Rendre la main libre';
    boutonLiberer.hidden = etat.laMainEstLibre || !etat.mainA;

    // On ne réécrit pas un réglage qu'on est en train de manipuler : le curseur
    // sauterait sous le doigt à chaque battement du flux.
    if (document.activeElement !== curseur) {
      curseur.value = etat.luminosite === undefined ? 100 : etat.luminosite;
      valeurLuminosite.textContent = curseur.value + ' %';
    }
    if (document.activeElement !== choixRetour) {
      choixRetour.value = String(etat.retourAccueilMinutes === undefined ? 0 : etat.retourAccueilMinutes);
    }

    listeParticipants.innerHTML = '';
    var participants = etat.participants || [];
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var li = document.createElement('li');

      var titre = document.createElement('div');
      titre.className = 'titre';
      var nom = document.createElement('span');
      nom.className = 'nom';
      nom.textContent = (p.prenom || 'Sans prénom') + (p.id === monId ? ' (vous)' : '');
      titre.appendChild(nom);
      if (etat.mainA === p.id) {
        var qui = document.createElement('span');
        qui.className = 'qui';
        qui.textContent = 'a la main';
        titre.appendChild(qui);
      }
      li.appendChild(titre);

      if (p.id !== monId) {
        var actions = document.createElement('div');
        actions.className = 'actions';
        if (!etat.laMainEstLibre && etat.mainA !== p.id) {
          actions.appendChild(boutonDe('Donner la main', 'afficher', 'donner', p.id));
        }
        // L'écran de la salle n'a pas de pupitre : lui confier la réunion la
        // mettrait entre les mains d'un appareil qui ne peut rien en faire.
        if (p.prenom !== 'Écran') {
          actions.appendChild(boutonDe('Lui confier la réunion', 'afficher', 'confier', p.id));
        }
        li.appendChild(actions);
      }
      listeParticipants.appendChild(li);
    }
  }

  function boutonDe(libelle, classe, geste, cible) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = libelle;
    b.setAttribute('data-geste', geste);
    b.setAttribute('data-cible', cible);
    return b;
  }

  // Mener, ne plus mener.
  boutonRevendiquer.addEventListener('click', function () {
    commander('/api/animation', { action: 'revendiquer' }, messageMener);
  });
  boutonQuitter.addEventListener('click', function () {
    commander('/api/animation', { action: 'quitter' }, messageMener);
  });

  // Le pupitre.
  document.getElementById('qr-ecran').addEventListener('click', function () {
    commander('/api/accueil', {}, messageAnimation);
  });
  boutonBasculer.addEventListener('click', function () {
    if (!dernierEtat) return;
    commander('/api/animateur/main-libre', { valeur: !dernierEtat.laMainEstLibre }, messageAnimation);
  });
  boutonLiberer.addEventListener('click', function () {
    commander('/api/animateur/donner', { cible: null }, messageAnimation);
  });

  listeParticipants.addEventListener('click', function (evenement) {
    var cible = evenement.target;
    if (!cible || cible.tagName !== 'BUTTON') return;
    var geste = cible.getAttribute('data-geste');
    var qui = cible.getAttribute('data-cible');
    if (geste === 'donner') {
      commander('/api/animateur/donner', { cible: qui }, messageAnimation);
    } else if (geste === 'confier') {
      if (!window.confirm('Confier la réunion ? Vous ne pourrez plus l’administrer.')) return;
      commander('/api/animateur/transmettre', { cible: qui }, messageAnimation);
    }
  });

  // La luminosité s'envoie au relâchement du curseur, pas à chaque pixel.
  curseur.addEventListener('input', function () {
    valeurLuminosite.textContent = curseur.value + ' %';
  });
  curseur.addEventListener('change', function () {
    commander('/api/animateur/confort', { luminosite: Number(curseur.value) }, messageAnimation);
  });
  choixRetour.addEventListener('change', function () {
    commander('/api/animateur/confort', { retourAccueilMinutes: Number(choixRetour.value) }, messageAnimation);
  });

  document.getElementById('terminer').addEventListener('click', function () {
    // Un geste sans retour se confirme. La fenêtre du navigateur est la seule
    // qu'on ne puisse pas rater.
    if (!window.confirm('Terminer la réunion ? Les documents seront effacés et le code changera.')) return;
    commander('/api/animateur/terminer', {}, messageAnimation, function (reponse) {
      // Le code a changé : l'adresse de CETTE page ne vaut plus rien. On suit
      // la nouvelle réunion, en simple participant — le rôle ne survit pas à
      // la réunion qu'il menait.
      if (reponse.code) location.replace('/salle/' + reponse.code);
    });
  });

  // Retirer un document : sur la liste commune, téléphone de l'animateur.
  liste.addEventListener('click', function (evenement) {
    var cible = evenement.target;
    if (!cible || cible.tagName !== 'BUTTON') return;
    var id = cible.getAttribute('data-retirer');
    if (!id) return;
    if (!window.confirm('Retirer « ' + cible.getAttribute('data-nom') + ' » ? Le fichier sera effacé.')) return;
    commander('/api/animateur/retirer', { documentId: id }, message);
  });

  // --- Le signe de vie de l'animateur -----------------------------------------
  //
  // Le secours du rôle repose sur lui : sans nouvelles du téléphone de
  // l'animateur pendant dix minutes, le rôle redevient revendicable. Un
  // téléphone verrouillé suspend sa page, et donc ces signes de vie — c'est
  // voulu : c'est ce qui distingue « il est là » de « il est parti ».

  var minuteriePresence = null;

  function envoyerPresence() {
    if (document.hidden) return;
    var requete = new XMLHttpRequest();
    requete.open('POST', '/api/presence?code=' + encodeURIComponent(code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.send(JSON.stringify({ participant: moi() }));
  }

  function demarrerPresence() {
    if (minuteriePresence) return;
    minuteriePresence = setInterval(envoyerPresence, 60 * 1000);
  }

  function arreterPresence() {
    if (!minuteriePresence) return;
    clearInterval(minuteriePresence);
    minuteriePresence = null;
  }

  // Au réveil du téléphone, un signe de vie TOUT DE SUITE — et pas seulement
  // s'il se croit animateur. Un animateur resté verrouillé plus que le délai a
  // appris que le rôle était libre ; si personne ne l'a repris, ce signe de vie
  // le lui rend, et le serveur prévient tout le monde.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) envoyerPresence();
  });

  // --- Inviter quelqu'un -------------------------------------------------------

  var zoneInvitation = document.getElementById('invitation');
  var imageInvitation = document.getElementById('qr-invitation');
  var secoursInvitation = document.getElementById('qr-invitation-secours');

  document.getElementById('inviter').addEventListener('click', function () {
    zoneInvitation.hidden = !zoneInvitation.hidden;
    if (zoneInvitation.hidden) return;
    imageInvitation.style.display = '';
    secoursInvitation.style.display = 'none';
    // Le code dans l'adresse de l'image, pour deux raisons : depuis Internet le
    // serveur l'exige — le QR code ENCODE le code de la salle —, et sans lui le
    // navigateur resservirait le QR code d'une réunion précédente.
    imageInvitation.src = '/api/qr.svg?code=' + encodeURIComponent(code);
    document.getElementById('adresse-invitation').textContent =
      (adresseSalle || (location.origin + '/salle/' + code)) + ' — code ' + code;
  });

  // qrencode en panne : l'adresse en toutes lettres, comme sur l'écran.
  imageInvitation.onerror = function () {
    imageInvitation.style.display = 'none';
    secoursInvitation.style.display = 'block';
    secoursInvitation.textContent = adresseSalle || (location.origin + '/salle/' + code);
  };

  // L'état et le flux se lisent AVEC le code : depuis Internet, sans lui, le
  // serveur ne dit plus rien — c'est ce qui l'empêchait de donner le code et
  // les documents de la réunion à n'importe qui. Sur le réseau de la salle, le
  // code est simplement ignoré.
  var suffixeCode = '?code=' + encodeURIComponent(code);

  var flux = new EventSource('/api/flux' + suffixeCode);
  flux.addEventListener('etat', function (evenement) {
    try { appliquer(JSON.parse(evenement.data)); } catch (err) { /* on garde l'ancien */ }
  });
  // Un refus du serveur (code périmé, trop d'essais) FERME le flux pour de bon :
  // un EventSource ne se reconnecte pas après un statut d'erreur. C'est heureux
  // — il ne va pas marteler le serveur avec un code faux jusqu'à se faire
  // bloquer — mais il faut le dire, sinon la page reste figée sans explication.
  flux.onerror = function () {
    if (flux.readyState === 2 && !dernierEtat) {
      dire('Cette réunion n’est plus accessible. Rescannez le QR code affiché sur l’écran.', 'erreur');
    }
  };

  var amorce = new XMLHttpRequest();
  amorce.open('GET', '/api/etat' + suffixeCode);
  amorce.onload = function () {
    if (amorce.status === 429) {
      var trop = {};
      try { trop = JSON.parse(amorce.responseText); } catch (err) { /* défaut */ }
      return dire(trop.erreur || 'Trop de codes incorrects. Réessayez plus tard.', 'erreur');
    }
    if (amorce.status === 403) {
      return dire('La réunion a changé de code. Rescannez le QR code affiché sur l’écran.', 'erreur');
    }
    try { appliquer(JSON.parse(amorce.responseText)); } catch (err) { /* le flux suivra */ }
  };
  amorce.send();

  seFaireConnaitre();
}());
