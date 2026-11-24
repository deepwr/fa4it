// FA 4 IT — js/db.js
// Tout ce qui touche au stockage sur l'appareil (IndexedDB).
// Les autres fichiers n'utilisent IndexedDB qu'à travers les fonctions ci-dessous.
//
// La base « fa4it » contient deux « magasins » (des sortes de tiroirs) :
// - blocs    : un enregistrement par bloc, avec tout son contenu ;
// - reglages : des petites valeurs (ex. date de la dernière sauvegarde) et la
//              copie de secours faite avant chaque import ou effacement.
//
// Règle d'or pour les futures versions : ne jamais changer NOM_BASE, et
// n'augmenter VERSION_BASE qu'avec une migration écrite dans onupgradeneeded.

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

/**
 * Lit un bloc, le modifie et l'enregistre, en une seule opération.
 * « modification » est une fonction qui reçoit le bloc et le change ;
 * ce qu'elle renvoie est renvoyé à la fin.
 * Comme tout se passe dans une seule transaction, deux saisies très
 * rapprochées passent l'une après l'autre, sans s'écraser.
 */
export async function modifierBloc(id, modification) {
  const base = await ouvrirBase();
  return new Promise((resoudre, rejeter) => {
    const transaction = base.transaction('blocs', 'readwrite');
    const magasin = transaction.objectStore('blocs');
    let resultat;
    let probleme = null;

    const lecture = magasin.get(id);
    lecture.onsuccess = () => {
      const bloc = lecture.result;
      if (!bloc) {
        probleme = new Error('Ce bloc n’existe plus.');
        transaction.abort();
        return;
      }
      try {
        resultat = modification(bloc);
        bloc.modifieLe = new Date().toISOString();
        magasin.put(bloc);
      } catch (erreur) {
        probleme = erreur;
        transaction.abort();
      }
    };

    transaction.oncomplete = () => resoudre(resultat);
    transaction.onerror = () => rejeter(probleme ?? transaction.error);
    transaction.onabort = () => rejeter(probleme ?? transaction.error ?? new Error('Enregistrement annulé.'));
  });
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
   Copie de secours
   Juste avant une opération qui remplace des données (import du coach, import
   d'une sauvegarde, exemple, effacement), l'app garde une copie de tous les
   blocs dans les réglages. Une seule copie : la suivante remplace la précédente.
   Elle protège d'une fausse manœuvre, pas de la perte de l'iPhone (elle est
   stockée au même endroit que les données) : l'export reste indispensable.
   -------------------------------------------------------------------------- */

const CLE_COPIE = 'copieDeSecours';

/** Garde une copie de tous les blocs. « raison » complète la phrase « faite avant … ». */
export async function garderCopieDeSecours(raison) {
  const blocs = await lireBlocs();
  if (blocs.length === 0) return;   // rien à protéger : la copie précédente est conservée
  await ecrireReglage(CLE_COPIE, { date: new Date().toISOString(), raison, blocs });
}

/** La copie de secours ({ date, raison, blocs }), ou null s'il n'y en a pas. */
export function lireCopieDeSecours() {
  return lireReglage(CLE_COPIE);
}

export async function supprimerCopieDeSecours() {
  const base = await ouvrirBase();
  const transaction = base.transaction('reglages', 'readwrite');
  transaction.objectStore('reglages').delete(CLE_COPIE);
  await terminer(transaction);
}

/**
 * Remet la copie de secours à la place des données actuelles, en une seule
 * transaction (tout ou rien). Les données actuelles deviennent la nouvelle copie :
 * on peut donc revenir en arrière en restaurant à nouveau.
 */
export async function restaurerCopieDeSecours(raisonNouvelleCopie) {
  const base = await ouvrirBase();
  return new Promise((resoudre, rejeter) => {
    const transaction = base.transaction(['blocs', 'reglages'], 'readwrite');
    const magasinBlocs = transaction.objectStore('blocs');
    const magasinReglages = transaction.objectStore('reglages');
    let copie = null;
    let probleme = null;

    const lectureCopie = magasinReglages.get(CLE_COPIE);
    lectureCopie.onsuccess = () => {
      copie = lectureCopie.result?.valeur ?? null;
      if (!copie) {
        probleme = new Error('Il n’y a pas de copie de secours.');
        transaction.abort();
        return;
      }
      const lectureActuels = magasinBlocs.getAll();
      lectureActuels.onsuccess = () => {
        const actuels = lectureActuels.result;
        magasinBlocs.clear();
        for (const bloc of copie.blocs) magasinBlocs.put(bloc);
        if (actuels.length > 0) {
          magasinReglages.put({ cle: CLE_COPIE, valeur: { date: new Date().toISOString(), raison: raisonNouvelleCopie, blocs: actuels } });
        } else {
          magasinReglages.delete(CLE_COPIE);
        }
      };
    };

    transaction.oncomplete = () => resoudre(copie);
    transaction.onerror = () => rejeter(probleme ?? transaction.error);
    transaction.onabort = () => rejeter(probleme ?? transaction.error ?? new Error('Restauration annulée.'));
  });
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