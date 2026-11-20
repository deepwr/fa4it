// FA 4 IT — js/db.js
// Tout ce qui touche au stockage sur l'appareil (IndexedDB).
// Les autres fichiers n'utilisent IndexedDB qu'à travers les fonctions ci-dessous.
//
// La base « fa4it » contient deux « magasins » (des sortes de tiroirs) :
// - blocs    : un enregistrement par bloc, avec tout son contenu ;
// - reglages : des petites valeurs (ex. date de la dernière sauvegarde).

const NOM_BASE = 'fa4it';
const VERSION_BASE = 1;   // à augmenter seulement si la structure de la base change

let promesseBase = null;

/* --------------------------------------------------------------------------
   Ouverture de la base (une seule fois, puis réutilisée)
   -------------------------------------------------------------------------- */

function ouvrirBase() {
  if (promesseBase) return promesseBase;

  promesseBase = new Promise((resoudre, rejeter) => {
    if (!('indexedDB' in window)) {
      rejeter(new Error('Ce navigateur ne permet pas d’enregistrer des données.'));
      return;
    }

    const demande = indexedDB.open(NOM_BASE, VERSION_BASE);

    // Appelé à la toute première ouverture (ou quand VERSION_BASE augmente) :
    // on crée les magasins.
    demande.onupgradeneeded = () => {
      const base = demande.result;
      if (!base.objectStoreNames.contains('blocs')) {
        base.createObjectStore('blocs', { keyPath: 'id' });
      }
      if (!base.objectStoreNames.contains('reglages')) {
        base.createObjectStore('reglages', { keyPath: 'cle' });
      }
    };

    demande.onsuccess = () => {
      const base = demande.result;
      // Si une version plus récente de l'app doit modifier la base, on la laisse faire.
      base.onversionchange = () => base.close();
      resoudre(base);
    };

    demande.onerror = () => rejeter(demande.error);
    demande.onblocked = () => console.warn('Base bloquée : fermez les autres onglets de FA 4 IT.');
  });

  // En cas d'échec, on permettra un nouvel essai au prochain appel.
  promesseBase.catch(() => {
    promesseBase = null;
  });

  return promesseBase;
}

/* --------------------------------------------------------------------------
   Deux outils pour attendre la fin d'une opération IndexedDB
   -------------------------------------------------------------------------- */

/** Attend le résultat d'une lecture. */
function attendre(demande) {
  return new Promise((resoudre, rejeter) => {
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error);
  });
}

/** Attend qu'une écriture soit réellement enregistrée sur l'appareil. */
function terminer(transaction) {
  return new Promise((resoudre, rejeter) => {
    transaction.oncomplete = () => resoudre();
    transaction.onerror = () => rejeter(transaction.error);
    transaction.onabort = () => rejeter(transaction.error ?? new Error('Enregistrement annulé.'));
  });
}

/* --------------------------------------------------------------------------
   Blocs
   -------------------------------------------------------------------------- */

/** Tous les blocs, du plus récent au plus ancien (selon la date de début). */
export async function lireBlocs() {
  const base = await ouvrirBase();
  const blocs = await attendre(base.transaction('blocs').objectStore('blocs').getAll());
  return blocs.sort((a, b) => (b.dateDebut ?? '').localeCompare(a.dateDebut ?? ''));
}

/** Un bloc précis, ou undefined s'il n'existe pas. */
export async function lireBloc(id) {
  const base = await ouvrirBase();
  return attendre(base.transaction('blocs').objectStore('blocs').get(id));
}

/** Crée ou met à jour un bloc complet. */
export async function enregistrerBloc(bloc) {
  const base = await ouvrirBase();
  bloc.modifieLe = new Date().toISOString();
  const transaction = base.transaction('blocs', 'readwrite');
  transaction.objectStore('blocs').put(bloc);
  await terminer(transaction);
  return bloc;
}

/** Supprime un bloc. */
export async function supprimerBloc(id) {
  const base = await ouvrirBase();
  const transaction = base.transaction('blocs', 'readwrite');
  transaction.objectStore('blocs').delete(id);
  await terminer(transaction);
}

/**
 * Remplace tous les blocs par une nouvelle liste.
 * C'est « tout ou rien » : si une écriture échoue, les anciennes données restent intactes.
 */
export async function remplacerTousLesBlocs(blocs) {
  const base = await ouvrirBase();
  const transaction = base.transaction('blocs', 'readwrite');
  const magasin = transaction.objectStore('blocs');
  magasin.clear();
  for (const bloc of blocs) {
    magasin.put(bloc);
  }
  await terminer(transaction);
}

/* --------------------------------------------------------------------------
   Réglages (petites valeurs)
   -------------------------------------------------------------------------- */

export async function lireReglage(cle, valeurParDefaut = null) {
  const base = await ouvrirBase();
  const enregistrement = await attendre(base.transaction('reglages').objectStore('reglages').get(cle));
  return enregistrement ? enregistrement.valeur : valeurParDefaut;
}

export async function ecrireReglage(cle, valeur) {
  const base = await ouvrirBase();
  const transaction = base.transaction('reglages', 'readwrite');
  transaction.objectStore('reglages').put({ cle, valeur });
  await terminer(transaction);
}

/* --------------------------------------------------------------------------
   Protection du stockage
   -------------------------------------------------------------------------- */

/**
 * Demande à iOS de ne pas effacer automatiquement les données de l'app.
 * Il n'y a pas de fenêtre de confirmation : iOS décide seul, selon des critères
 * qui lui sont propres (l'installation sur l'écran d'accueil aide).
 */
export async function demanderStockagePersistant() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** État du stockage : protection accordée ou non, espace utilisé. */
export async function etatStockage() {
  const etat = { persistant: null, utilise: null, quota: null };
  if (navigator.storage?.persisted) {
    etat.persistant = await navigator.storage.persisted();
  }
  if (navigator.storage?.estimate) {
    const estimation = await navigator.storage.estimate();
    etat.utilise = estimation.usage ?? null;
    etat.quota = estimation.quota ?? null;
  }
  return etat;
}