// FA 4 IT — js/app.js
// Point d'entrée de l'application.
// Rôle : lire l'adresse (la partie après le « # »), afficher l'écran
// correspondant, allumer le bon onglet et réagir aux boutons et aux champs.

// « import » récupère des fonctions écrites dans d'autres fichiers (des modules).
import { afficherMessage, carteVide, carteErreur, echapper, pluriel, formaterDate, majusculeInitiale } from './ui.js';
import { lireBlocs, demanderStockagePersistant } from './db.js';
import { compter } from './modele.js';
import { ecranSauvegarde, boutonsSauvegarde, changementsSauvegarde } from './sauvegarde.js';

/* --------------------------------------------------------------------------
   1. Morceaux d'écran
   -------------------------------------------------------------------------- */

/** Carte résumant un bloc (lecture seule pour l'instant ; modifiable à l'étape 4). */
function carteResumeBloc(bloc) {
  const total = compter([bloc]);
  return `
    <section class="carte">
      <h2>${echapper(bloc.nom)}</h2>
      <p class="texte-secondaire">${echapper(majusculeInitiale(bloc.objectif))} · début le ${formaterDate(bloc.dateDebut)}</p>
      <p>${pluriel(total.semaines, 'semaine')} · ${pluriel(total.jours, 'jour')} · ${pluriel(total.seriesFaites, 'série faite', 'séries faites')}</p>
    </section>
  `;
}

const CARTE_DESIGN = `
  <section class="carte">
    <h2>Aperçu du design</h2>
    <p class="texte-secondaire">Carte temporaire pour vérifier les couleurs, les arrondis et les champs. Elle disparaîtra à l’étape 4.</p>

    <div class="rangee">
      <button class="bouton" type="button" data-action="tester">Principal</button>
      <button class="bouton bouton-secondaire" type="button" data-action="tester">Secondaire</button>
    </div>

    <div class="groupe">
      <label class="etiquette" for="essai-charge">Charge réalisée (kg)</label>
      <input id="essai-charge" class="champ" type="text" inputmode="decimal" placeholder="Ex. 102,5" autocomplete="off">
    </div>

    <div class="groupe">
      <label class="etiquette" for="essai-alerte">Champ en alerte</label>
      <input id="essai-alerte" class="champ en-alerte" type="text" inputmode="decimal" value="150" autocomplete="off">
    </div>

    <p class="alerte" role="note">⚠︎ Exemple d’alerte : charge max autorisée dépassée.</p>
  </section>
`;

/* --------------------------------------------------------------------------
   2. La liste des écrans
   Chaque écran a :
   - un titre (affiché en haut) ;
   - l'onglet à allumer en bas ;
   - une fonction « contenu » qui renvoie le HTML de l'écran. Elle est
     « async » quand elle doit d'abord lire des données dans la base ;
   - éventuellement une fonction « actions » qui renvoie les gros boutons
     affichés en bas, au niveau du pouce.
   -------------------------------------------------------------------------- */

const ecrans = {
  programme: {
    titre: 'Programme',
    onglet: 'programme',
    contenu: async () => {
      const blocs = await lireBlocs();
      const liste = blocs.length > 0
        ? blocs.map(carteResumeBloc).join('')
        : carteVide('Aucun bloc pour l’instant', 'Chargez l’exemple depuis l’onglet Sauvegarde. Vous pourrez créer vos propres blocs à l’étape 4.');
      return liste + CARTE_DESIGN;
    },
    actions: () => `
      <button class="bouton" type="button" data-action="bientot">+ Nouveau bloc</button>
    `,
  },

  seance: {
    titre: 'Séance',
    onglet: 'seance',
    contenu: () => carteVide('Aucune séance ouverte', 'Le mode séance arrivera à l’étape 5.'),
  },

  historique: {
    titre: 'Historique',
    onglet: 'historique',
    contenu: () => carteVide('Pas encore de données', 'L’e1RM et l’historique arriveront à l’étape 6.'),
  },

  sauvegarde: {
    titre: 'Sauvegarde',
    onglet: 'sauvegarde',
    contenu: ecranSauvegarde,
  },
};

/* --------------------------------------------------------------------------
   3. Lire l'adresse
   Exemple : « #/seance » donne { nom: 'seance', parametres: [] }.
   Plus tard, « #/jour/12 » donnera { nom: 'jour', parametres: ['12'] }.
   -------------------------------------------------------------------------- */

function lireAdresse() {
  const morceaux = location.hash
    .replace(/^#\/?/, '')   // enlève le « # » et le « / » du début
    .split('/')             // coupe aux « / »
    .filter(Boolean);       // retire les morceaux vides
  return { nom: morceaux[0] || 'programme', parametres: morceaux.slice(1) };
}

/* --------------------------------------------------------------------------
   4. Afficher l'écran demandé
   -------------------------------------------------------------------------- */

// Numéro du dernier affichage demandé : si l'on change d'onglet pendant qu'un
// écran lit encore ses données, on ignore le résultat devenu inutile.
let dernierAffichage = 0;

async function afficherEcran() {
  const numero = ++dernierAffichage;
  const { nom, parametres } = lireAdresse();
  const ecran = ecrans[nom] || ecrans.programme;

  // Titre et onglet actif : tout de suite
  document.title = `${ecran.titre} · FA 4 IT`;
  document.getElementById('titre').textContent = ecran.titre;
  for (const onglet of document.querySelectorAll('.onglet')) {
    const actif = onglet.dataset.onglet === ecran.onglet;
    onglet.classList.toggle('actif', actif);
    if (actif) {
      onglet.setAttribute('aria-current', 'page');
    } else {
      onglet.removeAttribute('aria-current');
    }
  }

  // Contenu : peut demander un peu de temps (lecture de la base)
  let html;
  try {
    html = await ecran.contenu(parametres);
  } catch (erreur) {
    console.error(erreur);
    html = carteErreur(erreur);
  }
  if (numero !== dernierAffichage) return;   // un autre écran a été demandé entre-temps

  document.getElementById('ecran').innerHTML = html;

  // Gros boutons du bas (s'il y en a)
  const htmlActions = ecran.actions ? ecran.actions(parametres) : '';
  document.getElementById('actions').innerHTML = htmlActions;
  document.body.classList.toggle('avec-actions', htmlActions !== '');
}

/* --------------------------------------------------------------------------
   5. Ce que font les boutons et les champs
   Un bouton déclare son action avec data-action="nom-de-l-action".
   Un champ déclare la sienne avec data-changement="nom-de-l-action".
   -------------------------------------------------------------------------- */

const actionsBoutons = {
  bientot: () => afficherMessage('Disponible à l’étape 4'),
  tester: (bouton) => afficherMessage(`Appui sur « ${bouton.textContent.trim()} »`),
  ...boutonsSauvegarde,   // « ... » ajoute ici toutes les actions de sauvegarde.js
};

const actionsChangements = {
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

// Même principe pour les champs dont la valeur change (ex. choix d'un fichier).
document.addEventListener('change', (evenement) => {
  const champ = evenement.target.closest('[data-changement]');
  if (!champ) return;
  const action = actionsChangements[champ.dataset.changement];
  if (action) lancer(action, champ);
});

/* --------------------------------------------------------------------------
   6. Démarrage
   -------------------------------------------------------------------------- */

// Quand la partie après le « # » change (appui sur un onglet, bouton retour),
// ou quand des données sont modifiées, on réaffiche l'écran.
window.addEventListener('hashchange', afficherEcran);
window.addEventListener('donnees-modifiees', afficherEcran);

// Premier affichage au lancement de l'app
afficherEcran();

// On demande à iOS de protéger les données contre l'effacement automatique.
demanderStockagePersistant().catch((erreur) => console.warn('Protection du stockage :', erreur));