// FA 4 IT — js/app.js
// Point d'entrée de l'application.
// Rôle : lire l'adresse (la partie après le « # »), afficher l'écran
// correspondant, allumer le bon onglet et réagir aux appuis sur les boutons.

// « import » récupère des fonctions écrites dans un autre fichier (un module).
import { afficherMessage, carteVide } from './ui.js';

/* --------------------------------------------------------------------------
   1. La liste des écrans
   Chaque écran a :
   - un titre (affiché en haut) ;
   - l'onglet à allumer en bas ;
   - une fonction « contenu » qui renvoie le HTML de l'écran ;
   - éventuellement une fonction « actions » qui renvoie les gros boutons
     affichés en bas, au niveau du pouce.
   -------------------------------------------------------------------------- */

const ecrans = {
  programme: {
    titre: 'Programme',
    onglet: 'programme',
    contenu: () => `
      ${carteVide('Aucun bloc pour l’instant', 'Vous créerez vos blocs, semaines et jours à l’étape 4.')}

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
    `,
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
    contenu: () => carteVide('Sauvegarde', 'L’export et l’import de vos données arriveront à l’étape 3.'),
  },
};

/* --------------------------------------------------------------------------
   2. Lire l'adresse
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
   3. Afficher l'écran demandé
   -------------------------------------------------------------------------- */

function afficherEcran() {
  const { nom, parametres } = lireAdresse();
  const ecran = ecrans[nom] || ecrans.programme;

  // Titre de l'onglet du navigateur et grand titre de l'écran
  document.title = `${ecran.titre} · FA 4 IT`;
  document.getElementById('titre').textContent = ecran.titre;

  // Contenu de l'écran
  document.getElementById('ecran').innerHTML = ecran.contenu(parametres);

  // Gros boutons du bas (s'il y en a)
  const htmlActions = ecran.actions ? ecran.actions(parametres) : '';
  document.getElementById('actions').innerHTML = htmlActions;
  document.body.classList.toggle('avec-actions', htmlActions !== '');

  // Onglet actif
  for (const onglet of document.querySelectorAll('.onglet')) {
    const actif = onglet.dataset.onglet === ecran.onglet;
    onglet.classList.toggle('actif', actif);
    if (actif) {
      onglet.setAttribute('aria-current', 'page');
    } else {
      onglet.removeAttribute('aria-current');
    }
  }

  // On revient en haut de la page à chaque changement d'écran
  window.scrollTo(0, 0);
}

/* --------------------------------------------------------------------------
   4. Ce que fait chaque bouton
   Un bouton déclare son action avec data-action="nom-de-l-action".
   -------------------------------------------------------------------------- */

const actionsBoutons = {
  bientot: () => afficherMessage('Disponible à l’étape 4'),
  tester: (bouton) => afficherMessage(`Appui sur « ${bouton.textContent.trim()} »`),
};

// Un seul « écouteur » pour tous les boutons de l'app : on cherche l'élément
// touché qui porte un data-action, puis on lance la fonction correspondante.
document.addEventListener('click', (evenement) => {
  const bouton = evenement.target.closest('[data-action]');
  if (!bouton) return;
  const action = actionsBoutons[bouton.dataset.action];
  if (action) action(bouton);
});

/* --------------------------------------------------------------------------
   5. Démarrage
   -------------------------------------------------------------------------- */

// Quand la partie après le « # » change (appui sur un onglet, bouton retour),
// on réaffiche l'écran.
window.addEventListener('hashchange', afficherEcran);

// Premier affichage au lancement de l'app
afficherEcran();