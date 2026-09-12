// ============================================================================
// LE TELEPHONE D'UN PARTICIPANT
//
// Deposer un document, et voir la liste commune se remplir. En phase 1, le
// dernier document pret prend l'ecran tout seul : il n'y a pas encore de tour
// de parole ni de commandes de page, c'est la phase 2.
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
    for (var i = 0; i < fichiers.length; i++) {
      if (fichiers[i].size > limites.tailleMaxMo * 1024 * 1024) {
        return dire('« ' + fichiers[i].name +' » dépasse ' + limites.tailleMaxMo + ' Mo.', 'erreur');
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
        dire('Refusé : ' + refuses.map(function (r) { return r.nom; }).join(', ')
          + ' (format non accepté).', 'erreur');
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
    document.getElementById('code').textContent = etat.code;
    document.getElementById('nom-salle').textContent = etat.nomSalle || '';
    majCommande(etat);

    if (etat.limites) limites = etat.limites;
    if (etat.formats) {
      champFichiers.setAttribute('accept', etat.formats.join(','));
      document.getElementById('pied').textContent =
        'Formats acceptés : PDF, Word, Excel, PowerPoint, images. '
        + limites.tailleMaxMo + ' Mo par fichier. '
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
        affichables += 1;
      } else {
        action = document.createElement('div');
        action.className = 'etat' + (doc.etat === 'erreur' ? ' erreur' : '');
        action.textContent = aLEcran ? 'à l’écran' : (etats[doc.etat] || '');
        action.title = doc.erreur || '';
      }

      ligne.appendChild(titre);
      ligne.appendChild(action);
      liste.appendChild(ligne);
    }

    listeAide.hidden = affichables === 0;
  }

  // --- La télécommande ------------------------------------------------------

  function majCommande(etat) {
    var a = etat.affichage;
    if (!a || !a.documentId) {
      commande.hidden = true;
      return;
    }
    commande.hidden = false;
    commandeNom.textContent = a.nom + (a.prenom ? ' — ' + a.prenom : '');

    // Un document d'une seule page n'a rien à tourner : les boutons
    // disparaissent plutôt que de rester grisés sans qu'on sache pourquoi.
    zonePages.hidden = a.nbPages < 2;
    commandePage.textContent = (a.page + 1) + ' / ' + a.nbPages;
    boutonPrecedent.disabled = a.page <= 0;
    boutonSuivant.disabled = a.page >= a.nbPages - 1;
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
    requete.send(JSON.stringify({ sens: sens }));
  }

  boutonPrecedent.addEventListener('click', function () { tourner(-1); });
  boutonSuivant.addEventListener('click', function () { tourner(1); });

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
    requete.send(JSON.stringify({ documentId: id }));
  }

  // Le meme flux que l'ecran de la salle : la liste se remplit sous les yeux
  // de tout le monde, sans que personne ait a rafraichir sa page.
  var flux = new EventSource('/api/flux');
  flux.addEventListener('etat', function (evenement) {
    try { appliquer(JSON.parse(evenement.data)); } catch (err) { /* on garde l'ancien */ }
  });

  var amorce = new XMLHttpRequest();
  amorce.open('GET', '/api/etat');
  amorce.onload = function () {
    try { appliquer(JSON.parse(amorce.responseText)); } catch (err) { /* le flux suivra */ }
  };
  amorce.send();
}());
