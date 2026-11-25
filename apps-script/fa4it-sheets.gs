/**
 * FA 4 IT — liaison avec le Google Sheets du coach (Google Apps Script)
 *
 * Ce script n'est pas utilisé par l'app sur GitHub : il se colle dans un projet
 * Apps Script (script.google.com) créé avec VOTRE compte Google, qui a les droits
 * de modification sur le classeur du coach. Publié en « application Web », il
 * reçoit les résultats envoyés par l'app et les écrit dans le classeur.
 *
 * Ce qu'il écrit : seulement des nombres, seulement dans les colonnes de
 * l'athlète (RPE RESSENTI, MVBT, POIDS), seulement dans des cases vides ou qui
 * contiennent déjà un nombre. Il ne touche jamais à la programmation du coach.
 *
 * Avant d'écrire sur une ligne, il vérifie qu'elle n'a pas bougé depuis l'import
 * du CSV (mêmes exercice, variante, séries, répétitions et intensité). Si le coach
 * a inséré ou modifié des lignes, il refuse et l'app vous demande de réimporter.
 *
 * IMPORTANT : le dépôt GitHub est public. Ne remplacez CODE_SECRET que dans
 * l'éditeur Apps Script, jamais dans la copie de ce fichier sur votre Mac.
 */

const ID_CLASSEUR = '16Nvj_jSEe6QeRa_vQncfTuNXS1JnL0bpZaIiUZhohCM';   // le classeur « Djelyssa »
const CODE_SECRET = 'A_REMPLACER';   // votre code (12 caractères ou plus), le même que dans l'app

// Titres des colonnes de l'athlète, les seules où le script a le droit d'écrire
// (selon les jours, le coach les titre « RPE RESSENTI », « MVBT », « POIDS » ou « ATHLÈTES »).
const COLONNES_AUTORISEES = /^(RPE RESSENTI|MVBT|VITESSE|POIDS|ATHLETES?)\b/;

/** À lancer une fois depuis l'éditeur (bouton « Exécuter ») pour autoriser l'accès au classeur. */
function verifier() {
  const classeur = SpreadsheetApp.openById(ID_CLASSEUR);
  Logger.log('Accès autorisé au classeur « ' + classeur.getName() + ' ».');
}

/** Test de connexion depuis l'app : renvoie le nom du classeur et de ses onglets. */
function doGet(e) {
  if (!codeValide(e)) return repondre({ ok: false, erreur: 'Code secret incorrect.' });
  const classeur = SpreadsheetApp.openById(ID_CLASSEUR);
  return repondre({ ok: true, classeur: classeur.getName(), onglets: classeur.getSheets().map((f) => f.getName()) });
}

/**
 * Écriture des résultats. Demande reçue (numéros de ligne et de colonne à partir de 1) :
 * { onglet, lignes: [{ ligne, controle: [{ colonne, texte }], valeurs: [{ colonne, valeur }] }] }
 */
function doPost(e) {
  if (!codeValide(e)) return repondre({ ok: false, erreur: 'Code secret incorrect.' });

  let demande;
  try {
    demande = JSON.parse(e.postData.contents);
  } catch (erreur) {
    return repondre({ ok: false, erreur: 'Demande illisible.' });
  }

  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    const feuille = trouverOnglet(SpreadsheetApp.openById(ID_CLASSEUR), demande.onglet);
    if (!feuille) return repondre({ ok: false, erreur: 'Onglet « ' + demande.onglet + ' » introuvable dans le classeur.' });

    const derniereLigne = Math.max(feuille.getLastRow(), 1);
    const colonnesLues = {};
    const lireColonne = (numero) => {
      if (!colonnesLues[numero]) {
        colonnesLues[numero] = feuille.getRange(1, numero, derniereLigne, 1).getDisplayValues().map((ligne) => ligne[0]);
      }
      return colonnesLues[numero];
    };

    let ecrites = 0;
    const refusees = [];

    for (const ligne of demande.lignes || []) {
      const n = ligne.ligne;
      if (!Number.isInteger(n) || n < 1 || n > derniereLigne) {
        refusees.push({ ligne: n, raison: 'ligne hors du tableau' });
        continue;
      }

      // 1. La ligne est-elle toujours celle qui a été importée ?
      const aChange = (ligne.controle || []).some((c) =>
        !Number.isInteger(c.colonne) || c.colonne < 1 || texteNet(lireColonne(c.colonne)[n - 1]) !== texteNet(c.texte));
      if (aChange) {
        refusees.push({ ligne: n, raison: 'la ligne a changé depuis l’import : réimportez le CSV du coach' });
        continue;
      }

      // 2. Chaque valeur va dans une colonne de l'athlète, dans une case vide ou déjà chiffrée.
      for (const v of ligne.valeurs || []) {
        if (!Number.isInteger(v.colonne) || v.colonne < 1 || typeof v.valeur !== 'number' || !isFinite(v.valeur)) continue;
        const colonne = lireColonne(v.colonne);
        const titre = titreAuDessus(colonne, n);
        if (!COLONNES_AUTORISEES.test(titre)) {
          refusees.push({ ligne: n, raison: 'colonne « ' + (titre || '?') + ' » non autorisée' });
          continue;
        }
        const actuelle = colonne[n - 1];
        if (actuelle !== '' && !estNombre(actuelle)) {
          refusees.push({ ligne: n, raison: 'case déjà remplie avec du texte (« ' + actuelle + ' »)' });
          continue;
        }
        feuille.getRange(n, v.colonne).setValue(v.valeur);
        ecrites += 1;
      }
    }

    return repondre({ ok: true, ecrites: ecrites, refusees: refusees });
  } finally {
    verrou.releaseLock();
  }
}

/* --------------------------------------------------------------------------
   Petits outils
   -------------------------------------------------------------------------- */

function codeValide(e) {
  return CODE_SECRET !== 'A_REMPLACER' && CODE_SECRET.length >= 12
    && Boolean(e && e.parameter) && e.parameter.cle === CODE_SECRET;
}

function repondre(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}

/** L'onglet par son nom, en tolérant les espaces en trop et les majuscules (« PEAKING  »). */
function trouverOnglet(classeur, nom) {
  const exact = classeur.getSheetByName(String(nom));
  if (exact) return exact;
  const cherche = String(nom).trim().toLowerCase();
  return classeur.getSheets().find((f) => f.getName().trim().toLowerCase() === cherche) || null;
}

function texteNet(texte) {
  return String(texte == null ? '' : texte).replace(/\s+/g, ' ').trim();
}

function sansAccents(texte) {
  return texteNet(texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function estNombre(texte) {
  return /^-?\d+([.,]\d+)?$/.test(String(texte).replace(/\s/g, ''));
}

/** Titre de la colonne pour la ligne n : premier texte (non chiffré) en remontant. */
function titreAuDessus(colonne, n) {
  for (let i = n - 2; i >= 0; i -= 1) {
    const valeur = colonne[i];
    if (valeur === '' || estNombre(valeur)) continue;
    return sansAccents(valeur);
  }
  return '';
}