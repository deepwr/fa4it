// FA 4 IT — js/db.js
// Tout ce qui touche au stockage sur l'appareil (IndexedDB).
// Les autres fichiers n'utilisent IndexedDB qu'à travers les fonctions ci-dessous.
//
// La base « fa4it » contient trois « magasins » (des sortes de tiroirs) :
// - blocs    : un enregistrement par bloc, avec tout son contenu ;
// - traces   : (v17) les trajectoires de barre des mesures vidéo, une par série filmée.
//              Elles pèsent 90 % des données mais aucun écran ne les affiche : rangées à part,
//              elles ne sont plus relues à chaque écran. Dans le bloc, la mesure garde
//              seulement leur numéro (serie.vbt.trace) ;
// - reglages : des petites valeurs (ex. date de la dernière sauvegarde) et la
//              copie de secours faite avant chaque import ou effacement.
//
// Les autres fichiers ne voient pas la différence : on peut toujours enregistrer un bloc
// dont une mesure contient sa trajectoire (serie.vbt.trajectoire) ; elle est rangée à part
// au moment de l'écriture. L'export, lui, remet chaque trajectoire dans sa mesure.
//
// Règle d'or pour les futures versions : ne jamais changer NOM_BASE, et
// n'augmenter VERSION_BASE qu'avec une migration écrite dans onupgradeneeded.

import { compter } from './modele.js';

const NOM_BASE = 'fa4it';
const VERSION_BASE = 2;   // v17 : magasin « traces » (migration plus bas)
const CLE_COPIE = 'copieDeSecours';
const CLE_RESUME_COPIE = 'copieDeSecoursResume';   // date, raison, nombres : sans relire la copie entière

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
    // on crée les magasins, puis on migre les données d'une version précédente.
    // Tout se passe dans une seule transaction : si quoi que ce soit échoue,
    // la base reste exactement comme avant (version 1, données intactes).
    demande.onupgradeneeded = (evenement) => {
      const base = demande.result;
      const transaction = demande.transaction;
      if (!base.objectStoreNames.contains('blocs')) {
        base.createObjectStore('blocs', { keyPath: 'id' });
      }
      if (!base.objectStoreNames.contains('reglages')) {
        base.createObjectStore('reglages', { keyPath: 'cle' });
      }
      if (!base.objectStoreNames.contains('traces')) {
        base.createObjectStore('traces', { keyPath: 'id' });
      }
      if (evenement.oldVersion >= 1 && evenement.oldVersion < 2) {
        migrerVersTraces(transaction);
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

/**
 * Migration v1 → v2 (v17) : chaque trajectoire quitte son bloc pour le magasin « traces ».
 * Le résumé de la copie de secours est aussi préparé (l'écran Sauvegarde n'a plus à la relire).
 */
function migrerVersTraces(transaction) {
  const blocs = transaction.objectStore('blocs');
  const traces = transaction.objectStore('traces');
  const reglages = transaction.objectStore('reglages');
  blocs.openCursor().onsuccess = (evenement) => {
    const curseur = evenement.target.result;
    if (!curseur) return;
    const bloc = curseur.value;
    for (const trace of sortirTraces(bloc)) traces.put(trace);
    curseur.update(bloc);
    curseur.continue();
  };
  const lectureCopie = reglages.get(CLE_COPIE);
  lectureCopie.onsuccess = () => {
    const copie = lectureCopie.result?.valeur;
    if (copie?.blocs) reglages.put({ cle: CLE_RESUME_COPIE, valeur: resumeCopie(copie) });
  };
}

/* --------------------------------------------------------------------------
   Trajectoires (magasin « traces »)
   -------------------------------------------------------------------------- */

/** Toutes les mesures vidéo d'un bloc (séries et échauffement). */
function mesuresDuBloc(bloc) {
  const mesures = [];
  for (const semaine of bloc?.semaines ?? []) {
    for (const jour of semaine.jours ?? []) {
      for (const exercice of jour.exercices ?? []) {
        for (const serie of [...(exercice.series ?? []), ...(exercice.echauffement ?? [])]) {
          if (serie?.vbt && typeof serie.vbt === 'object') mesures.push(serie.vbt);
        }
      }
    }
  }
  return mesures;
}

/** Numéros des trajectoires dont un bloc a besoin. */
function tracesDuBloc(bloc) {
  return new Set(mesuresDuBloc(bloc).map((vbt) => vbt.trace).filter(Boolean));
}

function nouvelIdTrace() {
  return window.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sort les trajectoires d'un bloc (le bloc est modifié) et renvoie celles à ranger dans « traces ».
 * Une mesure qui a déjà un numéro le garde.
 */
function sortirTraces(bloc) {
  const aRanger = [];
  for (const vbt of mesuresDuBloc(bloc)) {
    if (vbt.trajectoire && typeof vbt.trajectoire === 'object') {
      const id = typeof vbt.trace === 'string' && vbt.trace ? vbt.trace : nouvelIdTrace();
      aRanger.push({ ...vbt.trajectoire, id });
      vbt.trace = id;
    }
    delete vbt.trajectoire;
  }
  return aRanger;
}

/** Remet chaque trajectoire dans sa mesure (pour l'export et la copie de secours). */
function remettreTraces(bloc, parId) {
  for (const vbt of mesuresDuBloc(bloc)) {
    const trace = vbt.trace ? parId.get(vbt.trace) : null;
    if (trace) {
      const { id, ...trajectoire } = trace;
      vbt.trajectoire = trajectoire;
    }
    delete vbt.trace;
  }
  return bloc;
}

/**
 * Blocs complets (trajectoires remises dans les mesures), du plus récent au plus ancien.
 * Fonction pure, sans accès à la base : sert aussi au « worker » qui prépare l'export.
 */
export function completerBlocs(blocs, traces) {
  const parId = new Map(traces.map((trace) => [trace.id, trace]));
  return blocs
    .map((bloc) => remettreTraces(bloc, parId))
    .sort((a, b) => (b.dateDebut ?? '').localeCompare(a.dateDebut ?? ''));
}

/** Résumé de la copie de secours : ce que l'écran Sauvegarde affiche. */
function resumeCopie(copie) {
  return { date: copie.date, raison: copie.raison, total: compter(copie.blocs) };
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

/**
 * Tous les blocs AVEC leurs trajectoires remises dans les mesures (serie.vbt.trajectoire),
 * comme avant la v17. Plus lent : seulement pour l'export et la copie de secours.
 */
export async function lireBlocsComplets() {
  const base = await ouvrirBase();
  const transaction = base.transaction(['blocs', 'traces']);
  const [blocs, traces] = await Promise.all([
    attendre(transaction.objectStore('blocs').getAll()),
    attendre(transaction.objectStore('traces').getAll()),
  ]);
  return completerBlocs(blocs, traces);
}

/** La trajectoire d'une mesure ({ pas, x, y }), ou null. */
export async function lireTrace(id) {
  if (!id) return null;
  const base = await ouvrirBase();
  const trace = await attendre(base.transaction('traces').objectStore('traces').get(id));
  if (!trace) return null;
  const { id: _numero, ...trajectoire } = trace;
  return trajectoire;
}

/**
 * Écrit un bloc et tient le magasin « traces » à jour, dans la même transaction :
 * nouvelles trajectoires rangées, celles que le bloc n'utilise plus (série remesurée,
 * retirée…) supprimées. « avant » = numéros utilisés par la version précédente du bloc.
 */
function ecrireBloc(transaction, bloc, avant) {
  const traces = transaction.objectStore('traces');
  for (const trace of sortirTraces(bloc)) traces.put(trace);
  transaction.objectStore('blocs').put(bloc);
  const apres = tracesDuBloc(bloc);
  for (const id of avant) {
    if (!apres.has(id)) traces.delete(id);
  }
}

/** Crée ou met à jour un bloc complet. */
export async function enregistrerBloc(bloc) {
  const base = await ouvrirBase();
  bloc.modifieLe = new Date().toISOString();
  const transaction = base.transaction(['blocs', 'traces'], 'readwrite');
  const lecture = transaction.objectStore('blocs').get(bloc.id);
  lecture.onsuccess = () => ecrireBloc(transaction, bloc, tracesDuBloc(lecture.result));
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
    const transaction = base.transaction(['blocs', 'traces'], 'readwrite');
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
        const avant = tracesDuBloc(bloc);
        resultat = modification(bloc);
        bloc.modifieLe = new Date().toISOString();
        ecrireBloc(transaction, bloc, avant);
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

/** Supprime un bloc (et ses trajectoires). */
export async function supprimerBloc(id) {
  const base = await ouvrirBase();
  const transaction = base.transaction(['blocs', 'traces'], 'readwrite');
  const lecture = transaction.objectStore('blocs').get(id);
  lecture.onsuccess = () => {
    for (const trace of tracesDuBloc(lecture.result)) transaction.objectStore('traces').delete(trace);
    transaction.objectStore('blocs').delete(id);
  };
  await terminer(transaction);
}

/**
 * Remplace les blocs dans une transaction déjà ouverte sur « blocs » et « traces » :
 * trajectoires rangées à part, puis suppression de celles que plus aucun bloc n'utilise.
 */
function remplacerDansTransaction(transaction, blocs) {
  const magasinBlocs = transaction.objectStore('blocs');
  const magasinTraces = transaction.objectStore('traces');
  magasinBlocs.clear();
  const utilisees = new Set();
  for (const bloc of blocs) {
    for (const trace of sortirTraces(bloc)) magasinTraces.put(trace);
    magasinBlocs.put(bloc);
    for (const id of tracesDuBloc(bloc)) utilisees.add(id);
  }
  const cles = magasinTraces.getAllKeys();
  cles.onsuccess = () => {
    for (const cle of cles.result) {
      if (!utilisees.has(cle)) magasinTraces.delete(cle);
    }
  };
}

/**
 * Remplace tous les blocs par une nouvelle liste.
 * C'est « tout ou rien » : si une écriture échoue, les anciennes données restent intactes.
 */
export async function remplacerTousLesBlocs(blocs) {
  const base = await ouvrirBase();
  const transaction = base.transaction(['blocs', 'traces'], 'readwrite');
  remplacerDansTransaction(transaction, blocs);
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

// La copie est complète (trajectoires comprises) : on peut y revenir même si
// les trajectoires actuelles ont été supprimées entre-temps.

/** Écrit la copie et son résumé (dans une transaction ouverte sur « reglages »). */
function ecrireCopie(transaction, copie) {
  const reglages = transaction.objectStore('reglages');
  reglages.put({ cle: CLE_COPIE, valeur: copie });
  reglages.put({ cle: CLE_RESUME_COPIE, valeur: resumeCopie(copie) });
}

function effacerCopie(transaction) {
  const reglages = transaction.objectStore('reglages');
  reglages.delete(CLE_COPIE);
  reglages.delete(CLE_RESUME_COPIE);
}

/** Garde une copie de tous les blocs. « raison » complète la phrase « faite avant … ». */
export async function garderCopieDeSecours(raison) {
  const blocs = await lireBlocsComplets();
  if (blocs.length === 0) return;   // rien à protéger : la copie précédente est conservée
  const base = await ouvrirBase();
  const transaction = base.transaction('reglages', 'readwrite');
  ecrireCopie(transaction, { date: new Date().toISOString(), raison, blocs });
  await terminer(transaction);
}

/** La copie de secours complète ({ date, raison, blocs }), ou null s'il n'y en a pas. Lente : seulement pour la restaurer. */
export function lireCopieDeSecours() {
  return lireReglage(CLE_COPIE);
}

/** Ce que l'écran Sauvegarde affiche de la copie ({ date, raison, total }), ou null. Rapide. */
export async function lireResumeCopie() {
  return lireReglage(CLE_RESUME_COPIE);
}

export async function supprimerCopieDeSecours() {
  const base = await ouvrirBase();
  const transaction = base.transaction('reglages', 'readwrite');
  effacerCopie(transaction);
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
    const transaction = base.transaction(['blocs', 'reglages', 'traces'], 'readwrite');
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
      const lectureTraces = transaction.objectStore('traces').getAll();
      lectureTraces.onsuccess = () => {
        // Les données actuelles, trajectoires comprises, deviennent la nouvelle copie
        const parId = new Map(lectureTraces.result.map((trace) => [trace.id, trace]));
        const actuels = lectureActuels.result.map((bloc) => remettreTraces(bloc, parId));
        const aRestaurer = structuredClone(copie.blocs);
        remplacerDansTransaction(transaction, aRestaurer);
        if (actuels.length > 0) {
          ecrireCopie(transaction, { date: new Date().toISOString(), raison: raisonNouvelleCopie, blocs: actuels });
        } else {
          effacerCopie(transaction);
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