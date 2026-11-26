// FA 4 IT — js/modele.js
// La forme des données. Toute l'app s'appuie sur cette structure :
//
// Bloc
//  ├─ nom, objectif, dateDebut (AAAA-MM-JJ), notes
//  ├─ source : nom de l'onglet du coach s'il a été importé d'un CSV (sinon vide)
//  └─ semaines : [ Semaine ]
//       ├─ numero, notes
//       └─ jours : [ Jour ]
//            ├─ nom, datePrevue, dateRealisee
//            ├─ envoiSheets : date et heure du dernier envoi au Google Sheets du coach (ou null)
//            └─ exercices : [ Exercice ]   (l'ordre de la liste = l'ordre dans la séance)
//                 ├─ nom, mouvement (squat, bench, deadlift ou autre)
//                 ├─ formatCompetition : vrai si c'est le mouvement en format compétition
//                 │                      (seul ce cas compte dans l'e1RM ; faux pour une variante)
//                 ├─ consignes : texte libre (repos, fourchettes, indications du coach)
//                 ├─ prescription : { nbSeries, repetitions, rpeCible, chargeMax }
//                 ├─ echauffement : [ Série ]   (ramp-up ; la dernière ligne = last warm-up)
//                 ├─ origine : case de la ligne dans le Sheets du coach (si importé), sinon null
//                 │            { ligne, colonnes: { rpe, vitesse, charge }, controle: [{ colonne, texte }] }
//                 └─ series : [ Série réalisée ]   (séries de travail, une ligne par série)
//                      ├─ charge, repetitions, rpe, vitesse (moyenne, m/s), faite
//                      └─ vbt : mesure vidéo de la série (facultatif, aussi sur le last warm-up)
//                               { date, disque (m), angle (° de biais, 0 = de face), vitesse (m/s, celle mise dans la série),
//                                 reps: [{ vitesse, max, amplitude (m), duree (s), debut, fin (s), douteuse }],
//                                 trajectoire: { pas (s), x, y (mm, depuis le 1er point, y vers le haut ;
//                                                x redressé si filmé de biais) } }
//                               La vidéo elle-même n'est jamais gardée.
//
// Unités : charges en kg, vitesses en m/s. Une valeur inconnue vaut null.

export const NOM_APP = 'FA 4 IT';
export const VERSION_FORMAT = 1;   // version du format des fichiers de sauvegarde

// Mouvements de référence : la clé est enregistrée, le libellé est affiché.
export const MOUVEMENTS = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  autre: 'Autre',
};

export const OBJECTIFS = ['accumulation', 'intensification', 'peaking', 'décharge', 'autre'];

/**
 * Vrai si l'exercice est un des trois mouvements en format compétition :
 * « Squat », « Bench – Comp », « Soulevé de terre (compétition) »…
 * Faux pour une variante (tempo, pause, prise serrée, déficit, roumain…) et
 * pour les accessoires. Ce n'est qu'une proposition : modifiable dans Programme.
 */
export function estFormatCompetition(nom, mouvement) {
  if (!['squat', 'bench', 'deadlift'].includes(mouvement)) return false;
  const texte = String(nom ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\bcomp/.test(texte)) return true;   // comp, compet, compétition
  const seul = texte.replace(/[^a-z]+/g, ' ').trim();
  return ['squat', 'bench', 'bench press', 'deadlift', 'developpe couche', 'souleve de terre', 'sdt'].includes(seul);
}

/** Propose un mouvement de référence d'après le nom (modifiable ensuite). */
export function devinerMouvement(nom) {
  const texte = String(nom ?? '').toLowerCase();
  if (texte.includes('squat')) return 'squat';
  if (/bench|couché|couche/.test(texte)) return 'bench';
  if (/deadlift|soulevé|souleve|terre/.test(texte)) return 'deadlift';
  return 'autre';
}

/* --------------------------------------------------------------------------
   Identifiants et lecture des valeurs
   -------------------------------------------------------------------------- */

/** Crée un identifiant unique, par exemple « 3f2b8c1e-… ». */
export function nouvelId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Date du jour au format AAAA-MM-JJ (heure de l'appareil). */
export function aujourdhui() {
  const maintenant = new Date();
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${deuxChiffres(maintenant.getMonth() + 1)}-${deuxChiffres(maintenant.getDate())}`;
}

/**
 * Convertit « 102,5 », « 102.5 » ou 102.5 en nombre.
 * Renvoie null si la valeur est vide ou illisible.
 */
export function lireNombre(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  const texte = String(valeur).replace(',', '.').trim();
  if (texte === '') return null;
  const nombre = Number(texte);
  return Number.isFinite(nombre) ? nombre : null;
}

function lireTexte(valeur) {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

function lireDate(valeur) {
  return typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valeur) ? valeur.slice(0, 10) : null;
}

/* --------------------------------------------------------------------------
   Création d'éléments neufs (utilisé à partir de l'étape 4)
   -------------------------------------------------------------------------- */

export function nouveauBloc(nom = 'Nouveau bloc') {
  const maintenant = new Date().toISOString();
  return {
    id: nouvelId(),
    nom,
    objectif: 'accumulation',
    dateDebut: aujourdhui(),
    notes: '',
    source: '',
    semaines: [],
    creeLe: maintenant,
    modifieLe: maintenant,
  };
}

export function nouvelleSemaine(numero) {
  return { id: nouvelId(), numero, notes: '', jours: [] };
}

export function nouveauJour(nom = 'Nouveau jour') {
  return { id: nouvelId(), nom, datePrevue: null, dateRealisee: null, exercices: [] };
}

export function nouvelExercice(nom = 'Nouvel exercice', mouvement = 'autre') {
  return {
    id: nouvelId(),
    nom,
    mouvement,
    formatCompetition: estFormatCompetition(nom, mouvement),
    consignes: '',
    prescription: { nbSeries: 3, repetitions: 5, rpeCible: null, chargeMax: null },
    echauffement: [],
    series: [],
  };
}

export function nouvelleSerie(repetitions = null) {
  return { charge: null, repetitions, rpe: null, vitesse: null, faite: false };
}

/* --------------------------------------------------------------------------
   Nettoyage des données lues dans un fichier
   Chaque fonction accepte des données « brutes » (venant d'un fichier) et
   renvoie un objet propre et complet, avec des valeurs par défaut.
   -------------------------------------------------------------------------- */

function normaliserSerie(brute) {
  const serie = {
    charge: lireNombre(brute?.charge),
    repetitions: lireNombre(brute?.repetitions),
    rpe: lireNombre(brute?.rpe),
    vitesse: lireNombre(brute?.vitesse),
    faite: brute?.faite === true,
  };
  const mesure = normaliserMesureVbt(brute?.vbt);
  if (mesure) serie.vbt = mesure;
  return serie;
}

/** Mesure vidéo d'une série (voir le schéma en haut), ou null si absente ou illisible. */
function normaliserMesureVbt(brute) {
  if (!brute || typeof brute !== 'object' || !Array.isArray(brute.reps)) return null;
  const nombre = (valeur) => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null);
  const reps = brute.reps.slice(0, 50)
    .map((rep) => ({
      vitesse: nombre(rep?.vitesse),
      max: nombre(rep?.max),
      amplitude: nombre(rep?.amplitude),
      duree: nombre(rep?.duree),
      debut: nombre(rep?.debut),
      fin: nombre(rep?.fin),
      douteuse: rep?.douteuse === true,
    }))
    .filter((rep) => rep.vitesse !== null);
  const points = (liste) => (Array.isArray(liste) ? liste.slice(0, 20000).map((v) => nombre(v) ?? 0) : []);
  const trace = brute.trajectoire;
  let trajectoire = null;
  if (trace && nombre(trace.pas) > 0) {
    const x = points(trace.x);
    const y = points(trace.y);
    if (x.length > 0 && x.length === y.length) trajectoire = { pas: trace.pas, x, y };
  }
  return {
    date: lireTexte(brute.date) || null,
    disque: nombre(brute.disque),
    angle: nombre(brute.angle) ?? 0,
    vitesse: nombre(brute.vitesse),
    reps,
    trajectoire,
  };
}

/** Case d'origine dans le Sheets du coach (numéros à partir de 0), ou null. */
function normaliserOrigine(brute) {
  const position = (valeur) => (Number.isInteger(valeur) && valeur >= 0 ? valeur : undefined);
  if (!brute || position(brute.ligne) === undefined) return null;
  const colonnes = {};
  for (const cle of ['rpe', 'vitesse', 'charge']) {
    if (position(brute.colonnes?.[cle]) !== undefined) colonnes[cle] = brute.colonnes[cle];
  }
  const controle = Array.isArray(brute.controle)
    ? brute.controle.filter((c) => position(c?.colonne) !== undefined).map((c) => ({ colonne: c.colonne, texte: typeof c.texte === 'string' ? c.texte : '' }))
    : [];
  return { ligne: brute.ligne, colonnes, controle };
}

function normaliserExercice(brut) {
  const lu = lireTexte(brut?.mouvement).toLowerCase();
  const mouvement = Object.hasOwn(MOUVEMENTS, lu) ? lu : 'autre';
  const nom = lireTexte(brut?.nom) || 'Exercice sans nom';
  const prescription = brut?.prescription ?? {};
  return {
    id: lireTexte(brut?.id) || nouvelId(),
    nom,
    mouvement,
    // Ancienne sauvegarde (sans ce champ) : déduit du nom
    formatCompetition: typeof brut?.formatCompetition === 'boolean' ? brut.formatCompetition : estFormatCompetition(nom, mouvement),
    consignes: lireTexte(brut?.consignes),
    prescription: {
      nbSeries: lireNombre(prescription.nbSeries),
      repetitions: lireNombre(prescription.repetitions),
      rpeCible: lireNombre(prescription.rpeCible),
      chargeMax: lireNombre(prescription.chargeMax),
    },
    echauffement: Array.isArray(brut?.echauffement) ? brut.echauffement.map(normaliserSerie) : [],
    origine: normaliserOrigine(brut?.origine),
    series: Array.isArray(brut?.series) ? brut.series.map(normaliserSerie) : [],
  };
}

function normaliserJour(brut) {
  return {
    id: lireTexte(brut?.id) || nouvelId(),
    nom: lireTexte(brut?.nom) || 'Jour sans nom',
    datePrevue: lireDate(brut?.datePrevue),
    dateRealisee: lireDate(brut?.dateRealisee),
    envoiSheets: lireTexte(brut?.envoiSheets) || null,
    exercices: Array.isArray(brut?.exercices) ? brut.exercices.map(normaliserExercice) : [],
  };
}

function normaliserSemaine(brute, position) {
  return {
    id: lireTexte(brute?.id) || nouvelId(),
    numero: lireNombre(brute?.numero) ?? position + 1,
    notes: lireTexte(brute?.notes),
    jours: Array.isArray(brute?.jours) ? brute.jours.map(normaliserJour) : [],
  };
}

export function normaliserBloc(brut) {
  if (!brut || typeof brut !== 'object') {
    throw new Error('Un des blocs du fichier est illisible.');
  }
  if (!Array.isArray(brut.semaines)) {
    throw new Error(`Le bloc « ${lireTexte(brut.nom) || 'sans nom'} » n’a pas de liste de semaines.`);
  }
  const maintenant = new Date().toISOString();
  return {
    id: lireTexte(brut.id) || nouvelId(),
    nom: lireTexte(brut.nom) || 'Bloc sans nom',
    objectif: lireTexte(brut.objectif) || 'autre',
    dateDebut: lireDate(brut.dateDebut),
    notes: lireTexte(brut.notes),
    source: lireTexte(brut.source),
    semaines: brut.semaines.map(normaliserSemaine),
    creeLe: lireTexte(brut.creeLe) || maintenant,
    modifieLe: lireTexte(brut.modifieLe) || maintenant,
  };
}

/* --------------------------------------------------------------------------
   Comptages et fichiers de sauvegarde
   -------------------------------------------------------------------------- */

/** Compte les blocs, semaines, jours, exercices et séries faites. */
export function compter(blocs) {
  const total = { blocs: blocs.length, semaines: 0, jours: 0, exercices: 0, seriesFaites: 0 };
  for (const bloc of blocs) {
    for (const semaine of bloc.semaines) {
      total.semaines += 1;
      for (const jour of semaine.jours) {
        total.jours += 1;
        for (const exercice of jour.exercices) {
          total.exercices += 1;
          total.seriesFaites += exercice.series.filter((serie) => serie.faite).length;
        }
      }
    }
  }
  return total;
}

/** Prépare le contenu d'un fichier de sauvegarde. */
export function construireSauvegarde(blocs) {
  return {
    app: NOM_APP,
    format: VERSION_FORMAT,
    exporteLe: new Date().toISOString(),
    blocs,
  };
}

/**
 * Lit le texte d'un fichier de sauvegarde, le vérifie et le nettoie.
 * Renvoie { exporteLe, blocs } ou lance une erreur au message clair.
 */
export function lireSauvegarde(texteJson) {
  let donnees;
  try {
    donnees = JSON.parse(texteJson);
  } catch {
    throw new Error('Ce fichier n’est pas un fichier JSON valide.');
  }
  if (donnees?.app !== NOM_APP || !Array.isArray(donnees.blocs)) {
    throw new Error('Ce fichier n’est pas une sauvegarde FA 4 IT.');
  }
  if (Number(donnees.format) > VERSION_FORMAT) {
    throw new Error('Cette sauvegarde vient d’une version plus récente de l’app. Mettez l’app à jour, puis réessayez.');
  }
  return {
    exporteLe: lireTexte(donnees.exporteLe) || null,
    blocs: donnees.blocs.map(normaliserBloc),
  };
}
