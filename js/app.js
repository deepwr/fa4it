// FA 4 IT — js/app.js
// Point d'entrée de l'application.
// Rôle : lire l'adresse (la partie après le « # »), afficher l'écran
// correspondant, gérer le menu ☰ et le bouton ⌂, et réagir aux boutons et aux champs.
// v16 : plus de barre d'onglets en bas ; l'app s'ouvre sur l'accueil (voir accueil.js).
// v19 : transitions entre écrans, bouton ‹ et geste de retour (voir navigation.js).

// « import » récupère des fonctions écrites dans d'autres fichiers (des modules).
import { carteErreur } from './ui.js';
import { demanderStockagePersistant } from './db.js';
import { ecransProgrammation, boutonsProgrammation, changementsProgrammation } from './programmation.js';
import { ecransSeance, boutonsSeance, changementsSeance } from './seance.js';
import { ecransSuivi, boutonsSuivi } from './suivi.js';
import { ecransHistorique, changementsHistorique } from './historique.js';
import { ecransVitesse, boutonsVitesse, changementsVitesse } from './vitesse.js';
import { ecranSauvegarde, boutonsSauvegarde, changementsSauvegarde } from './sauvegarde.js';
import { ecransAccueil } from './accueil.js';
import {
  demarrerPile, noterChangementAdresse, noterTitre, restaurerPositionCourante, jouerTransition,
  preparerBoutonRetour, configurerNavigation, attendreFinGeste, sansAnimation,
} from './navigation.js';

/* --------------------------------------------------------------------------
   1. La liste des écrans
   Chaque écran indique la page à allumer dans le menu (onglet) et une fonction « afficher »
   qui renvoie { titre, html, actions } :
   - titre   : le grand titre en haut ;
   - html    : le contenu de l'écran ;
   - actions : les gros boutons du bas, au niveau du pouce (facultatif).
   -------------------------------------------------------------------------- */

const ecrans = {
  ...ecransAccueil,         // accueil : verset du jour et tuiles (voir accueil.js)
  ...ecransProgrammation,   // programme, bloc, semaine, jour (voir programmation.js)
  ...ecransSeance,          // seance (voir seance.js)
  ...ecransSuivi,           // suivi (voir suivi.js)
  ...ecransHistorique,      // historique (voir historique.js)
  // Mesure vidéo (#/vbt/…) : le code (labo-vbt.js + vbt-analyse.js, ~80 Ko) n'est chargé
  // qu'à la première mesure, pas à l'ouverture de l'app (v18).
  vbt: { onglet: 'seance', afficher: async (parametres) => (await charger('./labo-vbt.js')).ecransLabo.vbt.afficher(parametres) },
  ...ecransVitesse,         // détail d'une série et vitesse à charge égale (voir vitesse.js)

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
   Exemple : « #/seance/a/b/c » donne { nom: 'seance', parametres: ['a', 'b', 'c'] }.
   -------------------------------------------------------------------------- */

function lireAdresse(adresse = location.hash) {
  const morceaux = adresse
    .replace(/^#\/?/, '')   // enlève le « # » et le « / » du début
    .split('/')             // coupe aux « / »
    .filter(Boolean);       // retire les morceaux vides
  return { nom: morceaux[0] || 'accueil', parametres: morceaux.slice(1) };
}

/* --------------------------------------------------------------------------
   3. Afficher l'écran demandé
   -------------------------------------------------------------------------- */

/** Allume la page en cours dans le menu ; sur l'accueil, le logo remplace le bouton ⌂. */
function allumerPage(nomPage) {
  for (const lien of document.querySelectorAll('.menu-lien')) {
    if (lien.dataset.page === nomPage) {
      lien.setAttribute('aria-current', 'page');
    } else {
      lien.removeAttribute('aria-current');
    }
  }
  const surAccueil = nomPage === 'accueil';
  document.body.classList.toggle('page-accueil', surAccueil);
  document.getElementById('bouton-accueil').hidden = surAccueil;
  document.getElementById('marque').hidden = !surAccueil;
}

/* --------------------------------------------------------------------------
   Le menu ☰
   -------------------------------------------------------------------------- */

let minuteurMenu;

function ouvrirMenu() {
  clearTimeout(minuteurMenu);
  for (const id of ['menu', 'menu-fond']) {
    document.getElementById(id).classList.remove('se-ferme');
    document.getElementById(id).hidden = false;   // il apparaît en fondu (styles.css)
  }
  document.getElementById('bouton-menu').setAttribute('aria-expanded', 'true');
  // On place le focus sur la page en cours (ou la première) : pratique au clavier et avec VoiceOver
  const menu = document.getElementById('menu');
  (menu.querySelector('.menu-lien[aria-current="page"]') ?? menu.querySelector('.menu-lien'))?.focus();
}

/** Ferme le menu : en fondu (0,18 s), ou tout de suite quand on change d'écran. */
function fermerMenu({ rendreLeFocus = false, toutDeSuite = false } = {}) {
  const menu = document.getElementById('menu');
  const fond = document.getElementById('menu-fond');
  if (menu.hidden) return;
  const bouton = document.getElementById('bouton-menu');
  bouton.setAttribute('aria-expanded', 'false');
  const cacher = () => {
    for (const element of [menu, fond]) {
      element.hidden = true;
      element.classList.remove('se-ferme');
    }
  };
  clearTimeout(minuteurMenu);
  if (toutDeSuite || sansAnimation()) {
    cacher();
  } else {
    menu.classList.add('se-ferme');
    fond.classList.add('se-ferme');
    minuteurMenu = setTimeout(cacher, 180);
  }
  if (rendreLeFocus) bouton.focus();
}

// Touche Échap (clavier) : ferme le menu
document.addEventListener('keydown', (evenement) => {
  if (evenement.key === 'Escape') fermerMenu({ rendreLeFocus: true });
});

// Numéro du dernier affichage demandé : si l'on change d'écran pendant qu'un
// écran lit encore ses données, on ignore le résultat devenu inutile.
let dernierAffichage = 0;

/** Lit les données d'un écran et prépare son contenu, sans rien changer à l'écran. */
async function preparerVue(adresse) {
  const { nom, parametres } = lireAdresse(adresse);
  const ecran = ecrans[nom] || ecrans.accueil;
  try {
    return await ecran.afficher(parametres);
  } catch (erreur) {
    console.error(erreur);
    return {
      titre: 'Oups',
      html: carteErreur(erreur),
      actions: '<a class="bouton bouton-secondaire" href="#/accueil">Retour à l’accueil</a>',
    };
  }
}

/** Allume dans le menu la page d'une adresse (et ⌂ ou le logo). */
function allumerAdresse(adresse) {
  const { nom } = lireAdresse(adresse);
  allumerPage((ecrans[nom] || ecrans.accueil).onglet);
}

/** Met un contenu préparé à l'écran. */
function appliquerVue(vue, adresse) {
  allumerAdresse(adresse);
  document.title = `${vue.titre} · FA 4 IT`;
  document.getElementById('titre').textContent = vue.titre;
  document.getElementById('ecran').innerHTML = vue.html;
  const htmlActions = vue.actions ?? '';
  document.getElementById('actions').innerHTML = htmlActions;
  document.body.classList.toggle('avec-actions', htmlActions !== '');
}

/** Position de l'écran : en haut, comme on l'avait laissé (retour), ou sur un élément précis. */
function positionner(evenement, changement) {
  const cible = evenement?.detail?.cible;
  if (cible) {
    document.getElementById(cible)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else if (changement?.restaurer) {
    restaurerPositionCourante();
  } else if (!['donnees-modifiees', 'adresse-remplacee'].includes(evenement?.type)) {
    window.scrollTo(0, 0);
  }
}

/**
 * « evenement » dit pourquoi on affiche :
 * - changement d'adresse : nouvel écran (en haut) ou retour (position retrouvée), avec transition ;
 * - données modifiées : on garde la position, ou on amène un élément précis à l'écran.
 * Les données sont lues AVANT la transition : l'animation n'attend jamais la base.
 */
async function afficherEcran(evenement) {
  const numero = ++dernierAffichage;
  let changement = null;
  if (evenement?.type === 'hashchange') {
    changement = noterChangementAdresse();
    if (changement === null) return;   // déjà affiché par le geste de retour
  }
  await attendreFinGeste();
  const adresse = location.hash;
  const vue = await preparerVue(adresse);
  if (numero !== dernierAffichage) return;   // un autre écran a été demandé entre-temps

  await jouerTransition(changement?.type ?? null, () => {
    fermerMenu({ toutDeSuite: true });
    appliquerVue(vue, adresse);
    noterTitre(vue.titre);
    preparerBoutonRetour();
    positionner(evenement, changement);
  }, changement ?? {});
}

/* --------------------------------------------------------------------------
   4. Ce que font les boutons et les champs
   Un bouton déclare son action avec data-action="nom-de-l-action".
   Un champ déclare la sienne avec data-changement="nom-de-l-action".
   -------------------------------------------------------------------------- */

/* Modules chargés seulement au premier usage */
const modulesCharges = new Map();   // chemin → module, une fois chargé

/** Charge un module (une seule fois) et le garde sous la main. */
async function charger(chemin) {
  if (!modulesCharges.has(chemin)) modulesCharges.set(chemin, await import(chemin));
  return modulesCharges.get(chemin);
}

/**
 * Actions d'un module chargé au premier usage. Quand ses boutons sont à l'écran, le module
 * est déjà chargé : l'action est alors appelée tout de suite, sans attendre (l'iPhone
 * n'ouvre le choix d'une vidéo que juste après un appui).
 */
function aLaDemande(chemin, export_, noms) {
  return Object.fromEntries(noms.map((nom) => [nom, (element) => {
    const module = modulesCharges.get(chemin);
    return module ? module[export_][nom](element) : charger(chemin).then((m) => m[export_][nom](element));
  }]));
}
const boutonsLabo = aLaDemande('./labo-vbt.js', 'boutonsLabo',
  ['labo-choisir', 'labo-analyser', 'labo-arreter', 'labo-revoir', 'labo-ajuster', 'labo-valider', 'vbt-remplir', 'vbt-retour']);
const changementsLabo = aLaDemande('./labo-vbt.js', 'changementsLabo', ['labo-video', 'vbt-reglage']);

const actionsBoutons = {
  'menu-ouvrir': ouvrirMenu,
  'menu-fermer': () => fermerMenu({ rendreLeFocus: true }),
  ...boutonsProgrammation,   // « ... » ajoute ici toutes les actions de programmation.js
  ...boutonsSeance,
  ...boutonsSuivi,
  ...boutonsLabo,
  ...boutonsVitesse,
  ...boutonsSauvegarde,
};

const actionsChangements = {
  ...changementsProgrammation,
  ...changementsSeance,
  ...changementsHistorique,
  ...changementsLabo,
  ...changementsVitesse,
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

// Un lien du menu vers la page déjà ouverte ferme simplement le menu
// (vers une autre page, le menu disparaît avec la transition).
document.addEventListener('click', (evenement) => {
  const lien = evenement.target.closest('.menu-lien');
  if (lien && lien.getAttribute('href') === location.hash) fermerMenu();
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
window.addEventListener('adresse-remplacee', afficherEcran);

// Au lancement, l'app s'ouvre sur l'accueil. L'iPhone ouvre l'adresse enregistrée
// à l'installation (« #/seance ») : on la remplace, sans créer d'étape « retour ».
if (['', '#', '#/', '#/seance'].includes(location.hash)) {
  history.replaceState(null, '', '#/accueil');
}

// La pile des écrans (v19) et ce dont le geste de retour a besoin
demarrerPile();
configurerNavigation({
  preparerVue,
  appliquerVue,
  allumerAdresse,
  gesteAutorise: () => !location.hash.startsWith('#/vbt/'),   // pas pendant une mesure vidéo
});

// Premier affichage au lancement de l'app
afficherEcran();

// On demande à iOS de protéger les données contre l'effacement automatique.
demanderStockagePersistant().catch((erreur) => console.warn('Protection du stockage :', erreur));
