// FA 4 IT — js/sauvegarde.js
// L'écran « Sauvegarde » : état des données, export, import, copie de secours,
// lien avec le Google Sheets du coach, données d'exemple, version de l'app,
// protection du stockage et effacement.
// Fournit aussi le rappel de sauvegarde affiché dans l'onglet Séance.

import {
  lireBlocs, remplacerTousLesBlocs, lireReglage, ecrireReglage, etatStockage,
  garderCopieDeSecours, lireCopieDeSecours, supprimerCopieDeSecours, restaurerCopieDeSecours,
} from './db.js';
import { compter, construireSauvegarde, lireSauvegarde } from './modele.js';
import { carteReglageSheets, boutonsSheets, changementsSheets } from './sheets.js';
import { afficherMessage, pluriel, formaterDateHeure, formaterTaille } from './ui.js';

const JOURS_AVANT_RAPPEL = 7;   // au-delà, l'app vous rappelle d'exporter

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

/** Nombre de jours depuis la dernière sauvegarde (Infinity si jamais). */
function joursDepuis(dateIso) {
  return dateIso ? (Date.now() - new Date(dateIso).getTime()) / 86400000 : Infinity;
}

/** Prévient les autres écrans que les données ont changé (app.js réaffiche l'écran). */
function signalerChangement() {
  window.dispatchEvent(new Event('donnees-modifiees'));
}

/**
 * Version de l'app installée sur cet appareil, lue dans le nom du cache du
 * service worker (« fa4it-v3 » → « v3 »). null si l'app n'est pas en cache.
 */
async function versionInstallee() {
  if (!('caches' in window)) return null;
  const versions = (await caches.keys())
    .map((nom) => nom.match(/^fa4it-v(\d+)$/))
    .filter(Boolean)
    .map((trouve) => Number(trouve[1]));
  return versions.length > 0 ? `v${Math.max(...versions)}` : null;
}

/* --------------------------------------------------------------------------
   Rappel de sauvegarde (affiché en haut de l'onglet Séance)
   -------------------------------------------------------------------------- */

/** Carte de rappel si des séances sont enregistrées et qu'aucun export n'a été fait depuis 7 jours. */
export async function carteRappelSauvegarde() {
  const total = compter(await lireBlocs());
  if (total.seriesFaites === 0) return '';
  const derniere = await lireReglage('derniereSauvegarde');
  const jours = joursDepuis(derniere);
  if (jours <= JOURS_AVANT_RAPPEL) return '';
  const titre = derniere
    ? `Dernière sauvegarde il y a ${pluriel(Math.floor(jours), 'jour')}`
    : 'Aucune sauvegarde pour l’instant';
  return `
    <section class="carte">
      <p class="alerte"><strong>${titre}</strong><br>Exportez vos données : c’est la seule protection si l’iPhone est réinitialisé ou si l’app est supprimée.</p>
      <a class="bouton bouton-large" href="#/sauvegarde">Sauvegarder maintenant</a>
    </section>
  `;
}

/* --------------------------------------------------------------------------
   L'écran
   -------------------------------------------------------------------------- */

function carteCopieDeSecours(copie) {
  if (!copie) return '';
  return `
    <section class="carte">
      <h2>Copie de secours</h2>
      <p>Copie automatique du ${formaterDateHeure(copie.date)}, faite avant ${copie.raison} : ${resumeDonnees(compter(copie.blocs))}.</p>
      <p class="texte-secondaire">L’app garde une copie juste avant chaque import ou effacement. Elle vous protège d’une fausse manœuvre, pas de la perte de l’iPhone : pour cela, seul l’export compte.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="restaurer-copie">Revenir à cette copie</button>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="supprimer-copie">Supprimer la copie</button>
    </section>
  `;
}

export async function ecranSauvegarde() {
  const blocs = await lireBlocs();
  const total = compter(blocs);
  const derniere = await lireReglage('derniereSauvegarde');
  const copie = await lireCopieDeSecours();
  const stockage = await etatStockage();
  const version = await versionInstallee();

  // JSON.stringify(…, null, 2) : texte indenté, lisible par un humain
  const contenu = JSON.stringify(construireSauvegarde(blocs), null, 2);
  fichierPret = new File([contenu], nomDeFichier(), { type: 'application/json' });

  const rappel = total.blocs > 0 && joursDepuis(derniere) > JOURS_AVANT_RAPPEL;

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
      <p class="texte-secondaire">Crée un fichier .json avec toutes vos données. Sur iPhone, choisissez « Enregistrer dans Fichiers », puis iCloud Drive › FA 4 IT : le fichier est alors aussi à l’abri hors de l’iPhone.</p>
      <button class="bouton bouton-large" type="button" data-action="exporter">Exporter mes données</button>
    </section>

    <section class="carte">
      <h2>Importer</h2>
      <p class="texte-secondaire">Remplace toutes les données de l’app par celles d’un fichier de sauvegarde (par exemple sur un nouvel iPhone). Une copie de secours des données actuelles est gardée.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="choisir-fichier">Importer un fichier…</button>
      <input id="fichier-import" type="file" accept=".json,application/json" data-changement="importer" hidden>
    </section>

    ${carteCopieDeSecours(copie)}

    ${await carteReglageSheets()}

    <section class="carte">
      <h2>Données d’exemple</h2>
      <p class="texte-secondaire">Un bloc de 4 semaines × 3 jours, dont 3 semaines déjà réalisées, pour tester l’app.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="charger-exemple">Charger l’exemple</button>
    </section>

    <section class="carte">
      <h2>Application</h2>
      <p>Version installée : <strong>${version ?? 'inconnue'}</strong></p>
      <p class="texte-secondaire">Les mises à jour s’installent toutes seules quand vous ouvrez l’app avec du réseau, puis s’appliquent à l’ouverture suivante. Elles ne touchent jamais à vos données.</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="rechercher-mise-a-jour">Rechercher une mise à jour</button>
      <a class="bouton bouton-secondaire bouton-large" href="#/labo">Labo VBT (essai)</a>
    </section>

    <section class="carte">
      <h2>Stockage sur cet appareil</h2>
      <p>Protection contre l’effacement automatique : <strong>${texteProtection(stockage.persistant)}</strong></p>
      <p>Espace utilisé : ${formaterTaille(stockage.utilise)}</p>
      <p class="texte-secondaire">iOS accorde plus volontiers cette protection quand l’app est installée sur l’écran d’accueil. Elle ne remplace jamais l’export.</p>
    </section>

    <section class="carte">
      <h2>Tout effacer</h2>
      <p class="texte-secondaire">Supprime toutes les données de l’app. Une copie de secours est gardée jusqu’au prochain import ou effacement.</p>
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
   Import, exemple, copie de secours et effacement
   -------------------------------------------------------------------------- */

/** Remplace toutes les données, après confirmation s'il y a déjà des données. */
async function remplacerAvecConfirmation(nouveauxBlocs, origine, raisonCopie) {
  const actuel = compter(await lireBlocs());
  const nouveau = compter(nouveauxBlocs);

  if (actuel.blocs > 0) {
    const accord = window.confirm(
      `Remplacer vos données actuelles (${resumeDonnees(actuel)})\n` +
      `par ${origine} (${resumeDonnees(nouveau)}) ?\n\n` +
      'Une copie de secours des données actuelles sera gardée (écran Sauvegarde).'
    );
    if (!accord) return;
  }

  await garderCopieDeSecours(raisonCopie);
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
  await remplacerAvecConfirmation(sauvegarde.blocs, `le fichier « ${fichier.name} »${date}`, `l’import du fichier « ${fichier.name} »`);
}

async function chargerExemple() {
  const reponse = await fetch('data/exemple.json');
  if (!reponse.ok) {
    throw new Error(`Le fichier data/exemple.json est introuvable (erreur ${reponse.status}).`);
  }
  const sauvegarde = lireSauvegarde(await reponse.text());
  await remplacerAvecConfirmation(sauvegarde.blocs, 'les données d’exemple', 'le chargement des données d’exemple');
}

async function restaurerCopie() {
  const copie = await lireCopieDeSecours();
  if (!copie) return;
  const actuel = compter(await lireBlocs());
  const accord = window.confirm(
    `Revenir à la copie du ${formaterDateHeure(copie.date)} (${resumeDonnees(compter(copie.blocs))}) ?\n\n` +
    `Les données actuelles (${resumeDonnees(actuel)}) deviendront la nouvelle copie de secours : vous pourrez y revenir.`
  );
  if (!accord) return;
  await restaurerCopieDeSecours(`le retour à la copie du ${formaterDateHeure(copie.date)}`);
  afficherMessage('Copie restaurée');
  signalerChangement();
}

async function supprimerCopie() {
  if (!window.confirm('Supprimer la copie de secours ? Vos données actuelles ne changent pas.')) return;
  await supprimerCopieDeSecours();
  afficherMessage('Copie supprimée');
  signalerChangement();
}

async function toutEffacer() {
  const total = compter(await lireBlocs());
  if (total.blocs === 0) {
    afficherMessage('Il n’y a rien à effacer');
    return;
  }
  if (!window.confirm(`Effacer ${resumeDonnees(total)} ?`)) return;
  if (!window.confirm('Dernière vérification : avez-vous exporté vos données ? Effacer quand même ?')) return;

  await garderCopieDeSecours('l’effacement des données');
  await remplacerTousLesBlocs([]);
  afficherMessage('Données effacées');
  signalerChangement();
}

/* --------------------------------------------------------------------------
   Mises à jour de l'app
   -------------------------------------------------------------------------- */

async function rechercherMiseAJour() {
  const inscription = await navigator.serviceWorker?.getRegistration();
  if (!inscription) {
    afficherMessage('Mode hors ligne pas encore installé : rouvrez l’app');
    return;
  }
  try {
    await inscription.update();
  } catch {
    afficherMessage('Pas de réseau : réessayez plus tard');
    return;
  }
  afficherMessage(inscription.installing || inscription.waiting
    ? 'Nouvelle version trouvée : elle s’installe…'
    : 'Vous avez la dernière version');
}

/* --------------------------------------------------------------------------
   Ce que app.js branche sur les boutons (data-action) et les champs (data-changement)
   -------------------------------------------------------------------------- */

export const boutonsSauvegarde = {
  'exporter': exporter,
  'choisir-fichier': choisirFichier,
  'charger-exemple': chargerExemple,
  'restaurer-copie': restaurerCopie,
  'supprimer-copie': supprimerCopie,
  'rechercher-mise-a-jour': rechercherMiseAJour,
  'tout-effacer': toutEffacer,
  ...boutonsSheets,   // Google Sheets du coach : tester, envoyer une séance ou un bloc
};

export const changementsSauvegarde = {
  'importer': importer,
  ...changementsSheets,   // adresse et code du script Google
};
