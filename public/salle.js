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

  var limites = { tailleMaxMo: 50, fichiersMax: 10 };
  var mesDocuments = {};

  // --- Ce qu'on retient d'une fois sur l'autre -----------------------------
  // Le prenom et l'identifiant de participant, dans ce navigateur seulement.
  // Rien ne part sur le serveur qui ne soit deja dans un envoi.

  function retenu(cle) {
    try { return localStorage.getItem(cle) || ''; } catch (err) { return ''; }
  }
  function retenir(cle, valeur) {
    try { localStorage.setItem(cle, valeur); } catch (err) { /* navigation privee */ }
  }

  champPrenom.value = retenu('ecr_prenom');
  champPrenom.addEventListener('change', function () {
    retenir('ecr_prenom', champPrenom.value.trim());
  });

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
    document.getElementById('code').textContent = etat.code;
    document.getElementById('nom-salle').textContent = etat.nomSalle || '';

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

      var etatLigne = document.createElement('div');
      etatLigne.className = 'etat' + (doc.etat === 'erreur' ? ' erreur' : '');
      etatLigne.textContent = aLEcran ? 'à l’écran' : (etats[doc.etat] || '');
      etatLigne.title = doc.erreur || '';

      ligne.appendChild(titre);
      ligne.appendChild(etatLigne);
      liste.appendChild(ligne);
    }
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
