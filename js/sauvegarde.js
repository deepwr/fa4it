// FA 4 IT — js/sauvegarde.js
// L'écran « Sauvegarde » : état des données, export, import, données
// d'exemple, protection du stockage et effacement.

import { lireBlocs, remplacerTousLesBlocs, lireReglage, ecrireReglage, etatStockage } from './db.js';
import { compter, construireSauvegarde, lireSauvegarde } from './modele.js';
import { afficherMessage, pluriel, formaterDateHeure, formaterTaille } from './ui.js';

const JOURS_AVANT_RAPPEL = 7;   // au-delà, la date de dernière sauvegarde passe en rose

// Le fichier de sauvegarde est préparé dès l'ouverture de l'écran. Ainsi,
// l'appui sur « Exporter » ouvre immédiatement la feuille de partage d'iOS,
// qui n'accepte de s'ouvrir que juste après un appui.
let fichierPret = null;

/* --------------------------------------------------------------------------
   Petits outils
   -------------------------------------------------------------------------- */

function resumeDonnees(total) {
  return [
    pluriel(total.blocs, 'bloc'),
    pluriel(total.semaines, 'semaine'),
    pluriel(total.jours, 'jour'),
    pluriel(total.seriesFaites, 'série faite', 'séries faites'),
  ].join(' · ');
}

function nomDeFichier() {
  const maintenant = new Date();
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  const date = `${maintenant.getFullYear()}-${deuxChiffres(maintenant.getMonth() + 1)}-${deuxChiffres(maintenant.getDate())}`;
  const heure = `${deuxChiffres(maintenant.getHours())}h${deuxChiffres(maintenant.getMinutes())}`;
  return `fa4it-sauvegarde-${date}-${heure}.json`;
}

function texteProtection(persistant) {
  if (persistant === true) return 'activée';
  if (persistant === false) return 'pas encore accordée';
  return 'non disponible sur ce navigateur';
}

/** Prévient les autres écrans que les données ont changé (app.js réaffiche l'écran). */
function signalerChangement() {
  window.dispatchEvent(new Event('donnees-modifiees'));
}

/* --------------------------------------------------------------------------
   L'écran
   -------------------------------------------------------------------------- */

export async function ecranSauvegarde() {
  const blocs = await lireBlocs();
  const total = compter(blocs);
  const derniere = await lireReglage('derniereSauvegarde');
  const stockage = await etatStockage();

  // JSON.stringify(…, null, 2) : texte indenté, lisible par un humain
  const contenu = JSON.stringify(construireSauvegarde(blocs), null, 2);
  fichierPret = new File([contenu], nomDeFichier(), { type: 'application/json' });

  const joursDepuis = derniere ? (Date.now() - new Date(derniere).getTime()) / 86400000 : Infinity;
  const rappel = total.blocs > 0 && joursDepuis > JOURS_AVANT_RAPPEL;

  return `
    <section class="carte">
      <h2>Vos données</h2>
      <p>${resumeDonnees(total)}</p>
      <p class="${rappel ? 'alerte' : 'texte-secondaire'}">
        ${rappel ? '⚠︎ ' : ''}Dernière sauvegarde : ${derniere ? formaterDateHeure(derniere) : 'jamais'}
      </p>
    </section>

    <section class="carte">
      <h2>Exporter</h2>
      <p class="texte-secondaire">Crée un fichier .json avec toutes vos données. Sur iPhone, choisissez « Enregistrer dans Fichiers », de préférence dans iCloud Drive.</p>
      <button class="bouton bouton-large" type="button" data-action="exporter">Exporter mes données</button>
    </section>

    <section class="carte">
      <h2>Importer</h2>
      <p class="texte-secondaire">Remplace toutes les données de l’app par celles d’un fichier de sauvegarde.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="choisir-fichier">Importer un fichier…</button>
      <input id="fichier-import" type="file" accept=".json,application/json" data-changement="importer" hidden>
    </section>

    <section class="carte">
      <h2>Données d’exemple</h2>
      <p class="texte-secondaire">Un bloc de 4 semaines × 3 jours, dont 3 semaines déjà réalisées, pour tester l’app.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="charger-exemple">Charger l’exemple</button>
    </section>

    <section class="carte">
      <h2>Stockage sur cet appareil</h2>
      <p>Protection contre l’effacement automatique : <strong>${texteProtection(stockage.persistant)}</strong></p>
      <p>Espace utilisé : ${formaterTaille(stockage.utilise)}</p>
      <p class="texte-secondaire">iOS accorde plus volontiers cette protection quand l’app est installée sur l’écran d’accueil. Elle ne remplace jamais l’export.</p>
    </section>

    <section class="carte">
      <h2>Tout effacer</h2>
      <p class="texte-secondaire">Supprime définitivement toutes les données de cet appareil.</p>
      <button class="bouton bouton-alerte bouton-large" type="button" data-action="tout-effacer">Tout effacer</button>
    </section>
  `;
}

/* --------------------------------------------------------------------------
   Export
   -------------------------------------------------------------------------- */

async function noterSauvegarde() {
  await ecrireReglage('derniereSauvegarde', new Date().toISOString());
  afficherMessage('Sauvegarde exportée');
  signalerChangement();
}

/** Téléchargement classique (utilisé sur Mac). */
function telecharger(fichier) {
  const adresse = URL.createObjectURL(fichier);
  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = fichier.name;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 10000);
}

async function exporter() {
  if (!fichierPret) return;
  const fichier = fichierPret;

  // Sur un écran tactile (iPhone), on ouvre la feuille de partage d'iOS.
  const ecranTactile = window.matchMedia('(pointer: coarse)').matches;
  if (ecranTactile && navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: 'Sauvegarde FA 4 IT' });
      await noterSauvegarde();
      return;
    } catch (erreur) {
      if (erreur.name === 'AbortError') return;   // feuille de partage fermée sans rien choisir
      // Autre problème : on se rabat sur le téléchargement classique ci-dessous.
    }
  }

  telecharger(fichier);
  await noterSauvegarde();
}

/* --------------------------------------------------------------------------
   Import, exemple et effacement
   -------------------------------------------------------------------------- */

/** Remplace toutes les données, après confirmation s'il y a déjà des données. */
async function remplacerAvecConfirmation(nouveauxBlocs, origine) {
  const actuel = compter(await lireBlocs());
  const nouveau = compter(nouveauxBlocs);

  if (actuel.blocs > 0) {
    const accord = window.confirm(
      `Remplacer vos données actuelles (${resumeDonnees(actuel)})\n` +
      `par ${origine} (${resumeDonnees(nouveau)}) ?\n\n` +
      'C’est définitif. En cas de doute, exportez d’abord vos données.'
    );
    if (!accord) return;
  }

  await remplacerTousLesBlocs(nouveauxBlocs);
  afficherMessage('Données chargées');
  signalerChangement();
}

function choisirFichier() {
  document.getElementById('fichier-import').click();
}

async function importer(champ) {
  const fichier = champ.files?.[0];
  champ.value = '';   // permet de choisir à nouveau le même fichier plus tard
  if (!fichier) return;

  const sauvegarde = lireSauvegarde(await fichier.text());
  const date = sauvegarde.exporteLe ? `, exporté le ${formaterDateHeure(sauvegarde.exporteLe)}` : '';
  await remplacerAvecConfirmation(sauvegarde.blocs, `le fichier « ${fichier.name} »${date}`);
}

async function chargerExemple() {
  const reponse = await fetch('data/exemple.json');
  if (!reponse.ok) {
    throw new Error(`Le fichier data/exemple.json est introuvable (erreur ${reponse.status}).`);
  }
  const sauvegarde = lireSauvegarde(await reponse.text());
  await remplacerAvecConfirmation(sauvegarde.blocs, 'les données d’exemple');
}

async function toutEffacer() {
  const total = compter(await lireBlocs());
  if (total.blocs === 0) {
    afficherMessage('Il n’y a rien à effacer');
    return;
  }
  if (!window.confirm(`Effacer définitivement ${resumeDonnees(total)} ?`)) return;
  if (!window.confirm('Dernière vérification : avez-vous exporté vos données ? Effacer quand même ?')) return;

  await remplacerTousLesBlocs([]);
  afficherMessage('Données effacées');
  signalerChangement();
}

/* --------------------------------------------------------------------------
   Ce que app.js branche sur les boutons (data-action) et les champs (data-changement)
   -------------------------------------------------------------------------- */

export const boutonsSauvegarde = {
  'exporter': exporter,
  'choisir-fichier': choisirFichier,
  'charger-exemple': chargerExemple,
  'tout-effacer': toutEffacer,
};

export const changementsSauvegarde = {
  'importer': importer,
};