// ============================================================================
// LA PAGE DE CELUI QUI MENE
//
// Quatre gestes, et pas un de plus : ouvrir ou fermer le tour de parole, donner
// la main a quelqu'un, retirer un document envoye par erreur, et terminer la
// reunion.
//
// L'animateur n'est pas un compte : c'est celui qui a ouvert cette page avec le
// code de la salle. Le cahier ne veut pas de comptes (§4), et la frontiere du
// service reste le reseau (§9.3).
// ============================================================================

(function () {
  'use strict';

  var entree = document.getElementById('entree');
  var pupitre = document.getElementById('pupitre');
  var champCode = document.getElementById('code-saisi');
  var messageEntree = document.getElementById('message-entree');
  var message = document.getElementById('message');
  var regime = document.getElementById('regime');
  var boutonBasculer = document.getElementById('basculer');
  var boutonLiberer = document.getElementById('liberer');
  var listeParticipants = document.getElementById('participants');
  var participantsVides = document.getElementById('participants-vides');
  var listeDocuments = document.getElementById('documents');
  var documentsVides = document.getElementById('documents-vides');

  var code = '';
  var dernierEtat = null;

  // Retenu le temps de l'onglet seulement : une page d'animateur qui se
  // rouvrirait deverrouillee le lendemain, sur un code perime, ne rendrait
  // service a personne.
  try { code = sessionStorage.getItem('ecr_animateur') || ''; } catch (err) { code = ''; }

  function dire(ou, texte, genre) {
    ou.textContent = texte;
    ou.className = texte ? 'visible ' + genre : '';
  }

  // --- Entrer -----------------------------------------------------------------

  function essayerLeCode(propose) {
    // Une commande sans effet fait un excellent test de code : « donner la main
    // a personne » quand personne ne l'a ne change rien, et repond 403 si le
    // code est faux.
    envoyer('/api/animateur/donner', { participant: null }, propose, function (statut) {
      if (statut === 200) {
        code = propose;
        try { sessionStorage.setItem('ecr_animateur', code); } catch (err) { /* tant pis */ }
        entree.hidden = true;
        pupitre.hidden = false;
        dire(messageEntree, '', '');
        if (dernierEtat) appliquer(dernierEtat);
      } else {
        dire(messageEntree, 'Code incorrect. Il est affiché sur l’écran de la salle.', 'erreur');
      }
    });
  }

  document.getElementById('entrer').addEventListener('click', function () {
    var propose = champCode.value.replace(/\D/g, '');
    if (propose.length !== 4) {
      return dire(messageEntree, 'Le code fait quatre chiffres.', 'erreur');
    }
    essayerLeCode(propose);
  });

  champCode.addEventListener('keydown', function (evenement) {
    if (evenement.key === 'Enter') document.getElementById('entrer').click();
  });

  // --- Les commandes ----------------------------------------------------------

  function envoyer(chemin, corps, codeUtilise, ensuite) {
    var requete = new XMLHttpRequest();
    requete.open('POST', chemin + '?code=' + encodeURIComponent(codeUtilise || code));
    requete.setRequestHeader('content-type', 'application/json');
    requete.onload = function () {
      if (ensuite) return ensuite(requete.status, requete.responseText);
      if (requete.status !== 200) {
        var reponse = {};
        try { reponse = JSON.parse(requete.responseText); } catch (err) { /* défaut */ }
        dire(message, reponse.erreur || 'La commande a échoué.', 'erreur');
      } else dire(message, '', '');
    };
    requete.onerror = function () {
      if (ensuite) return ensuite(0, '');
      dire(message, 'Connexion interrompue.', 'erreur');
    };
    requete.send(JSON.stringify(corps));
  }

  boutonBasculer.addEventListener('click', function () {
    if (!dernierEtat) return;
    envoyer('/api/animateur/main-libre', { valeur: !dernierEtat.laMainEstLibre });
  });

  boutonLiberer.addEventListener('click', function () {
    envoyer('/api/animateur/donner', { participant: null });
  });

  document.getElementById('terminer').addEventListener('click', function () {
    // Un geste sans retour se confirme. Pas de fenêtre maison : celle du
    // navigateur est la seule qu'on ne puisse pas rater.
    if (!window.confirm('Terminer la réunion ? Les documents seront effacés et le code changera.')) return;
    envoyer('/api/animateur/terminer', {}, null, function (statut, texte) {
      if (statut !== 200) return dire(message, 'La réunion n’a pas pu être terminée.', 'erreur');
      var reponse = {};
      try { reponse = JSON.parse(texte); } catch (err) { /* le flux dira le code */ }
      // Le code a changé : celui qu'on avait en poche ne vaut plus rien.
      code = reponse.code || '';
      try { sessionStorage.setItem('ecr_animateur', code); } catch (err) { /* tant pis */ }
      dire(message, 'Réunion terminée. Nouveau code : ' + code, 'bien');
    });
  });

  listeParticipants.addEventListener('click', function (evenement) {
    var cible = evenement.target;
    if (!cible || cible.tagName !== 'BUTTON') return;
    envoyer('/api/animateur/donner', { participant: cible.getAttribute('data-id') });
  });

  listeDocuments.addEventListener('click', function (evenement) {
    var cible = evenement.target;
    if (!cible || cible.tagName !== 'BUTTON') return;
    var nom = cible.getAttribute('data-nom');
    if (!window.confirm('Retirer « ' + nom + ' » ? Le fichier sera effacé.')) return;
    envoyer('/api/animateur/retirer', { documentId: cible.getAttribute('data-id') });
  });

  // --- L'affichage ------------------------------------------------------------

  function ligne(texte, secondaire, bouton) {
    var li = document.createElement('li');
    var titre = document.createElement('div');
    titre.className = 'titre';
    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = texte;
    titre.appendChild(nom);
    if (secondaire) {
      var sous = document.createElement('span');
      sous.className = 'qui';
      sous.textContent = secondaire;
      titre.appendChild(sous);
    }
    li.appendChild(titre);
    if (bouton) li.appendChild(bouton);
    return li;
  }

  function boutonAction(libelle, classe, attributs) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = libelle;
    for (var cle in attributs) {
      if (Object.prototype.hasOwnProperty.call(attributs, cle)) b.setAttribute(cle, attributs[cle]);
    }
    return b;
  }

  function appliquer(etat) {
    dernierEtat = etat;
    document.getElementById('nom-salle').textContent = etat.nomSalle || '';

    // Tant qu'on n'est pas entré, la page ne montre PAS le code : l'afficher en
    // en-tête le donnerait à qui ouvre l'adresse par curiosité, ce qui rendrait
    // la saisie ci-dessous parfaitement décorative.
    if (pupitre.hidden) {
      document.getElementById('code').textContent = '····';
      return;
    }
    document.getElementById('code').textContent = etat.code;

    regime.textContent = etat.laMainEstLibre
      ? 'La main est libre : chacun peut afficher un document et tourner les pages.'
      : 'Le tour de parole est fermé : une seule personne pilote l’écran à la fois.';
    boutonBasculer.textContent = etat.laMainEstLibre
      ? 'Fermer le tour de parole'
      : 'Rendre la main libre';
    boutonLiberer.hidden = etat.laMainEstLibre || !etat.mainA;

    var participants = etat.participants || [];
    participantsVides.hidden = participants.length > 0;
    listeParticipants.innerHTML = '';
    for (var i = 0; i < participants.length; i++) {
      var p = participants[i];
      var aLaMain = etat.mainA === p.id;
      var action = null;
      if (aLaMain) {
        action = document.createElement('div');
        action.className = 'etat';
        action.textContent = 'a la main';
      } else if (!etat.laMainEstLibre) {
        action = boutonAction('Donner la main', 'afficher', { 'data-id': p.id });
      }
      listeParticipants.appendChild(ligne(p.prenom || 'Sans nom', '', action));
    }

    var documents = etat.documents || [];
    documentsVides.hidden = documents.length > 0;
    listeDocuments.innerHTML = '';
    for (var j = 0; j < documents.length; j++) {
      var d = documents[j];
      var retrait = boutonAction('Retirer', 'retirer', { 'data-id': d.id, 'data-nom': d.nom });
      var li = ligne(d.nom, d.prenom, retrait);
      if (etat.affichage && etat.affichage.documentId === d.id) li.className = 'affiche';
      listeDocuments.appendChild(li);
    }
  }

  if (code) {
    entree.hidden = true;
    pupitre.hidden = false;
  }

  var flux = new EventSource('/api/flux');
  flux.addEventListener('etat', function (evenement) {
    try { appliquer(JSON.parse(evenement.data)); } catch (err) { /* on garde l'ancien */ }
  });
}());
