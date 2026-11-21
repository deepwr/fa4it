// FA 4 IT — js/app.js
// Point d'entrée de l'application.
// Rôle : lire l'adresse (la partie après le « # »), afficher l'écran
// correspondant, allumer le bon onglet et réagir aux boutons et aux champs.

// « import » récupère des fonctions écrites dans d'autres fichiers (des modules).
import { carteVide, carteErreur } from './ui.js';
import { demanderStockagePersistant } from './db.js';
import { ecransProgrammation, boutonsProgrammation, changementsProgrammation } from './programmation.js';
import { ecranSauvegarde, boutonsSauvegarde, changementsSauvegarde } from './sauvegarde.js';

/* --------------------------------------------------------------------------
   1. La liste des écrans
   Chaque écran indique l'onglet à allumer et une fonction « afficher »
   qui renvoie { titre, html, actions } :
   - titre   : le grand titre en haut ;
   - html    : le contenu de l'écran ;
   - actions : les gros boutons du bas, au niveau du pouce (facultatif).
   -------------------------------------------------------------------------- */

const ecrans = {
  ...ecransProgrammation,   // programme, bloc, semaine, jour (voir programmation.js)

  seance: {
    onglet: 'seance',
    afficher: async () => ({
      titre: 'Séance',
      html: carteVide('Aucune séance ouverte', 'Le mode séance arrivera à l’étape 5.'),
    }),
  },

  historique: {
    onglet: 'historique',
    afficher: async () => ({
      titre: 'Historique',
      html: carteVide('Pas encore de données', 'L’e1RM et l’historique arriveront à l’étape 6.'),
    }),
  },

  sauvegarde: {
    onglet: 'sauvegarde',
    afficher: async () => ({
      titre: 'Sauvegarde',
      html: await ecranSauvegarde(),
    }),
  },
};

/* --------------------------------------------------------------------------
   2. Lire l'adresse
   Exemple : « #/jour/a/b/c » donne { nom: 'jour', parametres: ['a', 'b', 'c'] }.
   -------------------------------------------------------------------------- */

function lireAdresse() {
  const morceaux = location.hash
    .replace(/^#\/?/, '')   // enlève le « # » et le « / » du début
    .split('/')             // coupe aux « / »
    .filter(Boolean);       // retire les morceaux vides
  return { nom: morceaux[0] || 'programme', parametres: morceaux.slice(1) };
}

/* --------------------------------------------------------------------------
   3. Afficher l'écran demandé
   -------------------------------------------------------------------------- */

function allumerOnglet(nomOnglet) {
  for (const onglet of document.querySelectorAll('.onglet')) {
    const actif = onglet.dataset.onglet === nomOnglet;
    onglet.classList.toggle('actif', actif);
    if (actif) {
      onglet.setAttribute('aria-current', 'page');
    } else {
      onglet.removeAttribute('aria-current');
    }
  }
}

// Numéro du dernier affichage demandé : si l'on change d'écran pendant qu'un
// écran lit encore ses données, on ignore le résultat devenu inutile.
let dernierAffichage = 0;

/**
 * « evenement » dit pourquoi on affiche :
 * - changement d'adresse : on remonte en haut de l'écran ;
 * - données modifiées : on garde la position, ou on amène un élément précis à l'écran.
 */
async function afficherEcran(evenement) {
  const numero = ++dernierAffichage;
  const { nom, parametres } = lireAdresse();
  const ecran = ecrans[nom] || ecrans.programme;
  allumerOnglet(ecran.onglet);

  let vue;
  try {
    vue = await ecran.afficher(parametres);
  } catch (erreur) {
    console.error(erreur);
    vue = {
      titre: 'Oups',
      html: carteErreur(erreur),
      actions: '<a class="bouton bouton-secondaire" href="#/programme">Retour au programme</a>',
    };
  }
  if (numero !== dernierAffichage) return;   // un autre écran a été demandé entre-temps

  document.title = `${vue.titre} · FA 4 IT`;
  document.getElementById('titre').textContent = vue.titre;
  document.getElementById('ecran').innerHTML = vue.html;

  const htmlActions = vue.actions ?? '';
  document.getElementById('actions').innerHTML = htmlActions;
  document.body.classList.toggle('avec-actions', htmlActions !== '');

  // Position de l'écran
  const cible = evenement?.detail?.cible;
  if (cible) {
    document.getElementById(cible)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (evenement?.type !== 'donnees-modifiees') {
    window.scrollTo(0, 0);
  }
}

/* --------------------------------------------------------------------------
   4. Ce que font les boutons et les champs
   Un bouton déclare son action avec data-action="nom-de-l-action".
   Un champ déclare la sienne avec data-changement="nom-de-l-action".
   -------------------------------------------------------------------------- */

const actionsBoutons = {
  ...boutonsProgrammation,   // « ... » ajoute ici toutes les actions de programmation.js
  ...boutonsSauvegarde,
};

const actionsChangements = {
  ...changementsProgrammation,
  ...changementsSauvegarde,
};

/** Lance une action et affiche clairement toute erreur. */
async function lancer(action, element) {
  try {
    await action(element);
  } catch (erreur) {
    console.error(erreur);
    window.alert(`Oups : ${erreur?.message ?? erreur}`);
  }
}

// Un seul « écouteur » pour tous les boutons de l'app : on cherche l'élément
// touché qui porte un data-action, puis on lance la fonction correspondante.
document.addEventListener('click', (evenement) => {
  const bouton = evenement.target.closest('[data-action]');
  if (!bouton) return;
  const action = actionsBoutons[bouton.dataset.action];
  if (action) lancer(action, bouton);
});

// Même principe pour les champs dont la valeur change. L'événement « change »
// part quand on quitte un champ modifié (ou qu'on choisit un fichier, une date…).
document.addEventListener('change', (evenement) => {
  const champ = evenement.target.closest('[data-changement]');
  if (!champ) return;
  const action = actionsChangements[champ.dataset.changement];
  if (action) lancer(action, champ);
});

/* --------------------------------------------------------------------------
   5. Démarrage
   -------------------------------------------------------------------------- */

// Quand la partie après le « # » change (onglet, lien, bouton retour),
// ou quand des données sont modifiées, on réaffiche l'écran.
window.addEventListener('hashchange', afficherEcran);
window.addEventListener('donnees-modifiees', afficherEcran);

// Premier affichage au lancement de l'app
afficherEcran();

// On demande à iOS de protéger les données contre l'effacement automatique.
demanderStockagePersistant().catch((erreur) => console.warn('Protection du stockage :', erreur));