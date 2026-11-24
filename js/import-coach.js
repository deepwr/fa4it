// FA 4 IT — js/import-coach.js
// Import (et mise à jour) du programme du coach depuis un fichier CSV exporté
// de Google Sheets (un onglet = un bloc). Sur le Mac : ouvrir l'onglet, puis
// Fichier > Télécharger > Valeurs séparées par des virgules (.csv). Sur l'iPhone :
// lien d'export de l'onglet ouvert dans Safari (voir le guide de l'étape).
//
// Ce que l'import comprend :
// - les semaines placées côte à côte (« SEMAINE 1- 16/11 », « TAPER - 16/12 »…) ;
// - les jours empilés, chacun commençant par une ligne d'en-tête « EXERCICE… » ;
// - les colonnes repérées par leur titre : EXERCICE, VARIATIONS, SETS, REPS,
//   INTENSITÉ, REPOS, INDICATIONS (les autres colonnes sont ignorées) ;
// - une ligne sans nom d'exercice continue l'exercice du dessus.
//
// Règles de mise à jour (le coach remplit les semaines au fur et à mesure) :
// - chaque semaine est reconnue par sa date (« SEMAINE 2- 23/11 »), pas par sa place :
//   une colonne supprimée ou insérée par le coach ne décale rien ;
// - les semaines et jours nouveaux sont ajoutés ;
// - les jours pas encore commencés sont remplacés par la version du fichier ;
// - les jours déjà commencés ou faits ne sont JAMAIS modifiés ;
// - avant de toucher aux données, l'app montre ce qui va changer et demande confirmation.

import { lireBlocs, lireBloc, enregistrerBloc, modifierBloc } from './db.js';
import { nouvelId, nouveauBloc, devinerMouvement } from './modele.js';
import { formaterNombre, pluriel, afficherMessage } from './ui.js';

// Jours d'entraînement : 1er jour du programme = lundi, 2e = mardi, 3e = jeudi, 4e = samedi.
// (0 = lundi, 1 = mardi, 2 = mercredi, 3 = jeudi, 4 = vendredi, 5 = samedi, 6 = dimanche)
// Au-delà (5e jour…), pas de date automatique.
const JOURS_D_ENTRAINEMENT = [0, 1, 3, 5];

/* ==========================================================================
   1. Lire le fichier CSV (texte → tableau de lignes et de cellules)
   Gère les cellules entre guillemets, qui peuvent contenir des virgules
   (« 72,5 ») ou des guillemets doublés (« 3-6"" » pour 3-6").
   ========================================================================== */

export function lireCsv(texte) {
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let entreGuillemets = false;
  const t = texte.replace(/^﻿/, '');   // retire une éventuelle marque invisible en début de fichier

  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (entreGuillemets) {
      if (c === '"' && t[i + 1] === '"') {
        cellule += '"';
        i += 1;
      } else if (c === '"') {
        entreGuillemets = false;
      } else {
        cellule += c;
      }
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === ',') {
      ligne.push(cellule);
      cellule = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      ligne.push(cellule);
      lignes.push(ligne);
      ligne = [];
      cellule = '';
    } else {
      cellule += c;
    }
  }
  if (cellule !== '' || ligne.length > 0) {
    ligne.push(cellule);
    lignes.push(ligne);
  }
  return lignes;
}

/* ==========================================================================
   2. Petits outils de texte et de dates
   ========================================================================== */

/** « Intensité  » → « INTENSITE » (sans accents, majuscules, espaces nettoyés). */
function simplifier(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** « TRICEPS POULIE HAUTE » → « Triceps poulie haute ». */
function joli(texte) {
  const propre = String(texte ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return propre.charAt(0).toUpperCase() + propre.slice(1);
}

function dateIso(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Lundi de la semaine indiquée dans un titre comme « SEMAINE 2- 23/11 ».
 * L'année n'est pas écrite : on prend celle qui donne la date la plus proche d'aujourd'hui.
 */
function lundiDepuisTitre(titre) {
  const trouve = String(titre).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!trouve) return null;
  const jour = Number(trouve[1]);
  const mois = Number(trouve[2]) - 1;
  const maintenant = Date.now();
  const annee = new Date().getFullYear();
  const candidates = [annee - 1, annee, annee + 1].map((a) => new Date(Date.UTC(a, mois, jour, 12)));
  const date = candidates.sort((a, b) => Math.abs(a - maintenant) - Math.abs(b - maintenant))[0];
  const decalage = (date.getUTCDay() + 6) % 7;   // 0 = lundi
  date.setUTCDate(date.getUTCDate() - decalage);
  return date;
}

function ajouterJours(date, nombre) {
  const copie = new Date(date);
  copie.setUTCDate(copie.getUTCDate() + nombre);
  return copie;
}

/* ==========================================================================
   3. Comprendre une ligne d'exercice
   ========================================================================== */

const NOMBRE = '(\\d+(?:\\.\\d+)?)';

/** Charge max d'une série dégressive : arrondie au 0,25 kg INFÉRIEUR (c'est un maximum). */
function arrondirAuQuartInferieur(charge) {
  return Math.floor(charge * 4) / 4;
}

/**
 * Lit la colonne INTENSITÉ. Renvoie { rpe, charge, consigne } ou { probleme }.
 *   « @6 max=95kg », « @6/7max =72,5kg » → RPE 6 ou 7 (le plus haut), charge max
 *   « @6[130/140]kg »                      → RPE 6, charge max 140 (la plus haute)
 *   « 125kg »                              → charge max 125, sans RPE
 *   « @6 »                                 → RPE 6, sans charge
 *   « RIR=2 »                              → RPE 8 (RPE = 10 − RIR)
 *   « -17% »                               → charge max = 17 % de moins que la ligne du dessus
 */
export function lireIntensite(texte, chargeDuDessus = null) {
  const brut = String(texte ?? '').trim();
  if (brut === '') return { rpe: null, charge: null };
  const s = brut.toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');
  let m;

  if ((m = s.match(new RegExp(`^rir=?${NOMBRE}$`)))) {
    return { rpe: Math.max(1, 10 - Number(m[1])), charge: null };
  }
  if ((m = s.match(new RegExp(`^-${NOMBRE}%$`)))) {
    const pourcent = Number(m[1]);
    if (chargeDuDessus === null) {
      return { rpe: null, charge: null, consigne: `−${formaterNombre(pourcent)} % de la série du dessus` };
    }
    return {
      rpe: null,
      charge: arrondirAuQuartInferieur(chargeDuDessus * (1 - pourcent / 100)),
      consigne: `−${formaterNombre(pourcent)} % de ${formaterNombre(chargeDuDessus)} kg`,
    };
  }
  if ((m = s.match(new RegExp(`^${NOMBRE}kg$`)))) {
    return { rpe: null, charge: Number(m[1]) };
  }
  if ((m = s.match(new RegExp(`^@${NOMBRE}(?:/${NOMBRE})?(.*)$`)))) {
    const rpe = Math.max(Number(m[1]), m[2] ? Number(m[2]) : 0);
    if (rpe < 1 || rpe > 10) return { probleme: `RPE impossible : « ${brut} »` };
    const reste = m[3];
    if (reste === '') return { rpe, charge: null };
    let r;
    if ((r = reste.match(new RegExp(`^max=?${NOMBRE}(?:kg)?$`)))) {
      return { rpe, charge: Number(r[1]) };
    }
    if ((r = reste.match(new RegExp(`^\\[${NOMBRE}/${NOMBRE}\\](?:kg)?$`)))) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      return { rpe, charge: Math.max(a, b), consigne: `Charge ${formaterNombre(a)} à ${formaterNombre(b)} kg` };
    }
  }
  return { probleme: `intensité non comprise : « ${brut} »` };
}

/** « 4 » → { valeur: 4 } ; « 12/15 » → { valeur: 12, consigne: 'Rép. 12 à 15' }. */
function lireRepetitions(texte) {
  const brut = String(texte ?? '').trim();
  const m = brut.match(/^(\d+)(?:\s*[/\-à]\s*(\d+))?$/);
  if (!m) return { valeur: null, probleme: `répétitions non comprises : « ${brut} »` };
  return { valeur: Number(m[1]), consigne: m[2] ? `Rép. ${m[1]} à ${m[2]}` : '' };
}

/* ==========================================================================
   4. Comprendre tout l'onglet
   ========================================================================== */

/**
 * Transforme le tableau du CSV en programme :
 * { semaines: [{ numero, titre, jours: [{ creneau, nom, datePrevue, exercices }] }], problemes }
 */
export function lireProgrammeCoach(tableau) {
  const problemes = [];

  // Les lignes d'en-tête (« EXERCICE ») délimitent les jours ; leurs colonnes délimitent les semaines.
  const lignesEntete = [];
  const colonnesSemaines = new Set();
  tableau.forEach((ligne, numero) => {
    ligne.forEach((cellule, colonne) => {
      if (simplifier(cellule) === 'EXERCICE') {
        if (!lignesEntete.includes(numero)) lignesEntete.push(numero);
        colonnesSemaines.add(colonne);
      }
    });
  });
  const debuts = [...colonnesSemaines].sort((a, b) => a - b);

  const semaines = debuts.map((debut, position) => {
    const fin = debuts[position + 1] ?? Infinity;
    const lire = (l, c) => (c !== undefined && c >= debut && c < fin ? String(tableau[l]?.[c] ?? '').trim() : '');
    const premiereEntete = lignesEntete.find((l) => simplifier(tableau[l][debut]) === 'EXERCICE');

    // Titre de la semaine : première cellule utile au-dessus du premier en-tête
    let titre = '';
    for (let l = 0; l < premiereEntete && !titre; l += 1) {
      for (let c = debut; c < Math.min(fin, tableau[l].length) && !titre; c += 1) {
        const texte = String(tableau[l][c] ?? '').trim();
        const s = simplifier(texte);
        if (texte && !s.startsWith('NOTES') && !s.startsWith('JOUR')) titre = texte;
      }
    }
    const lundi = lundiDepuisTitre(titre);

    // Colonnes repérées par leur titre dans la ligne d'en-tête
    const colonnes = {};
    const entete = tableau[premiereEntete];
    for (let c = debut; c < Math.min(fin, entete.length); c += 1) {
      const nom = simplifier(entete[c]);
      if (nom && !(nom in colonnes)) colonnes[nom] = c;
    }

    // Jours
    const jours = [];
    let jour = null;
    let exerciceCourant = '';
    let variationCourante = '';
    let chargeDuDessus = null;

    for (let l = premiereEntete; l < tableau.length; l += 1) {
      const premiere = simplifier(tableau[l][debut]);
      if (premiere === 'EXERCICE') {
        const creneau = lignesEntete.indexOf(l) + 1;
        const decalage = JOURS_D_ENTRAINEMENT[creneau - 1];
        jour = {
          creneau,
          datePrevue: lundi && decalage !== undefined ? dateIso(ajouterJours(lundi, decalage)) : null,
          exercices: [],
        };
        jours.push(jour);
        exerciceCourant = '';
        variationCourante = '';
        chargeDuDessus = null;
        continue;
      }
      if (!jour || premiere.startsWith('ECHAUFFEMENT') || premiere.startsWith('NOTES')) continue;

      const series = lire(l, colonnes.SETS);
      const repetitions = lire(l, colonnes.REPS);
      if (!series && !repetitions) continue;   // ligne vide ou cellule isolée

      const nom = lire(l, colonnes.EXERCICE);
      const variation = lire(l, colonnes.VARIATIONS);
      if (nom) {
        exerciceCourant = nom;
        variationCourante = variation;
        chargeDuDessus = null;
      } else if (variation) {
        variationCourante = variation;
      }
      if (!exerciceCourant) continue;

      const etiquette = `S${position + 1} · J${jour.creneau} · ${joli(exerciceCourant)}`;
      const intensite = lireIntensite(lire(l, colonnes.INTENSITE), chargeDuDessus);
      if (intensite.probleme) problemes.push(`${etiquette} : ${intensite.probleme}`);
      const reps = lireRepetitions(repetitions);
      if (reps.probleme) problemes.push(`${etiquette} : ${reps.probleme}`);
      const nbSeries = /^\d+$/.test(series) ? Number(series) : null;
      if (nbSeries === null) problemes.push(`${etiquette} : séries non comprises : « ${series} »`);

      // « 3-6" » : dans le fichier du coach, " veut dire minutes → « 3-6 min »
      const repos = lire(l, colonnes.REPOS).replace(/^(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*["″”]$/, '$1 min');
      const indications = lire(l, colonnes.INDICATIONS);
      const consignes = [
        reps.consigne,
        intensite.consigne,
        repos ? `Repos ${repos}` : '',
        indications ? `Indications : ${joli(indications)}` : '',
      ].filter(Boolean).join(' · ');

      jour.exercices.push({
        id: nouvelId(),
        nom: variationCourante ? `${joli(exerciceCourant)} – ${joli(variationCourante)}` : joli(exerciceCourant),
        mouvement: devinerMouvement(exerciceCourant),
        consignes,
        prescription: {
          nbSeries,
          repetitions: reps.valeur,
          rpeCible: intensite.rpe ?? null,
          chargeMax: intensite.charge ?? null,
        },
        series: [],
      });
      if (intensite.charge !== null && intensite.charge !== undefined) chargeDuDessus = intensite.charge;
    }

    // Jours sans exercice (ex. jour absent du taper) : ignorés.
    const joursUtiles = jours.filter((j) => j.exercices.length > 0);
    for (const j of joursUtiles) {
      const principaux = [...new Set(j.exercices.map((e) => e.mouvement).filter((m) => m !== 'autre'))]
        .map((m) => ({ squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' })[m]);
      j.nom = principaux.length > 0 ? `J${j.creneau} – ${principaux.join('/')}` : `J${j.creneau}`;
    }

    return { numero: position + 1, titre: joli(titre) || `Semaine ${position + 1}`, lundi, jours: joursUtiles };
  }).filter((semaine) => semaine.jours.length > 0);

  // Deux semaines avec la même date : sans doute un titre recopié sans changer la date.
  const vues = new Map();
  for (const semaine of semaines) {
    if (!semaine.lundi) continue;
    const cle = dateIso(semaine.lundi);
    if (vues.has(cle)) {
      problemes.push(`S${vues.get(cle)} et S${semaine.numero} ont la même date dans le fichier (titres « ${semaines.find((s) => s.numero === vues.get(cle)).titre} » et « ${semaine.titre} ») : vérifiez avec le coach`);
    } else {
      vues.set(cle, semaine.numero);
    }
  }

  return { semaines, problemes };
}

/* ==========================================================================
   5. Fusion avec un bloc existant (ou création)
   ========================================================================== */

/** « J3 – Squat/Bench » → 3 (le numéro de jour du programme du coach), sinon null. */
function numeroDeJour(nom) {
  const trouve = String(nom ?? '').match(/^J(\d+)(?!\d)/);
  return trouve ? Number(trouve[1]) : null;
}

function jourCommence(jour) {
  return Boolean(jour.dateRealisee) || jour.exercices.some((exercice) =>
    exercice.series.some((serie) => serie.faite || serie.charge !== null || serie.rpe !== null || serie.vitesse !== null));
}

/** Vrai si deux jours ont le même programme (noms, dates, prescriptions, consignes), séries réalisées non comprises. */
function memeContenu(a, b) {
  const resume = (jour) => JSON.stringify([jour.nom, jour.datePrevue, jour.exercices.map((e) => [
    e.nom, e.mouvement, e.consignes ?? '',
    e.prescription.nbSeries, e.prescription.repetitions, e.prescription.rpeCible, e.prescription.chargeMax,
  ])]);
  return resume(a) === resume(b);
}

/** « 2026-11-19 » → « 2026-11-16 » (le lundi de cette semaine). */
function lundiDe(dateTexte) {
  const date = new Date(`${dateTexte}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return dateIso(date);
}

/**
 * Lundi d'une semaine de l'app : d'après la date prévue de ses jours, sinon d'après
 * ses notes si elles finissent par une date de titre du coach (« Semaine 2- 23/11 »).
 */
function lundiDeSemaine(semaine) {
  const dates = semaine.jours.map((jour) => jour.datePrevue).filter(Boolean).sort();
  if (dates.length > 0) return lundiDe(dates[0]);
  const notes = String(semaine.notes ?? '');
  if (/\d{1,2}\s*\/\s*\d{1,2}\s*$/.test(notes)) {
    const lundi = lundiDepuisTitre(notes);
    return lundi ? dateIso(lundi) : null;
  }
  return null;
}

/** Vrai si la date figure exactement une fois dans la liste (une date en double n'est pas fiable). */
function unique(date, dates) {
  return Boolean(date) && dates.filter((d) => d === date).length === 1;
}

/**
 * Applique le programme importé au bloc et renvoie ce qui a changé.
 *
 * Chaque semaine du fichier retrouve sa semaine dans l'app :
 * 1. par sa DATE (le lundi tiré du titre « SEMAINE 2- 23/11 ») : si le coach
 *    supprime ou insère une colonne, rien ne se décale ;
 * 2. sinon par sa PLACE (1re, 2e…), sauf si la semaine de l'app à cette place
 *    correspond clairement à une autre date du fichier. Cela couvre un titre
 *    corrigé par le coach, ou une date recopiée par erreur d'une semaine à l'autre ;
 * 3. sinon, c'est une nouvelle semaine.
 * Dans une semaine, chaque jour retrouve le sien par son numéro (J1, J2…).
 */
export function fusionner(bloc, programme) {
  const lignes = [];
  const datesFichier = programme.semaines.map((s) => (s.lundi ? dateIso(s.lundi) : null));
  const dejaPrises = new Set();

  programme.semaines.forEach((importee, index) => {
    const lundi = datesFichier[index];
    const libres = bloc.semaines.filter((s) => !dejaPrises.has(s));
    const datesApp = bloc.semaines.map(lundiDeSemaine);
    const dateApp = (s) => datesApp[bloc.semaines.indexOf(s)];
    const fiable = (date) => unique(date, datesFichier) && unique(date, datesApp);

    let semaine = fiable(lundi) ? libres.find((s) => dateApp(s) === lundi) : undefined;
    if (!semaine) {
      const memePlace = libres.find((s) => s.numero === importee.numero);
      const autreDate = memePlace ? dateApp(memePlace) : null;
      if (memePlace && !(autreDate && autreDate !== lundi && fiable(autreDate))) semaine = memePlace;
    }

    const ligne = { semaine, lundi, nouvelle: false, ajoutes: [], misAJour: [], conserves: [] };
    if (!semaine) {
      const numeros = bloc.semaines.map((s) => s.numero ?? 0);
      const numero = numeros.includes(importee.numero) ? Math.max(...numeros) + 1 : importee.numero;
      semaine = { id: nouvelId(), numero, notes: importee.titre, jours: [] };
      bloc.semaines.push(semaine);
      ligne.semaine = semaine;
      ligne.nouvelle = true;
    } else if (!semaine.notes) {
      semaine.notes = importee.titre;
    }
    dejaPrises.add(semaine);

    for (const jourImporte of importee.jours) {
      const nouveau = { id: nouvelId(), nom: jourImporte.nom, datePrevue: jourImporte.datePrevue, dateRealisee: null, exercices: jourImporte.exercices };
      const position = semaine.jours.findIndex((j) => numeroDeJour(j.nom) === jourImporte.creneau);
      const existant = semaine.jours[position];
      const court = `J${jourImporte.creneau}`;
      if (!existant) {
        semaine.jours.push(nouveau);
        ligne.ajoutes.push(court);
      } else if (memeContenu(existant, nouveau)) {
        // Rien à changer : le jour reste tel quel (avec ce que vous y avez déjà saisi).
      } else if (jourCommence(existant)) {
        ligne.conserves.push(court);   // modifié par le coach mais déjà commencé : jamais touché
      } else {
        semaine.jours[position] = { ...nouveau, id: existant.id };
        ligne.misAJour.push(court);
      }
    }
    // Jours rangés par numéro (J1, J2…) ; ceux sans numéro gardent leur place relative, à la fin.
    semaine.jours.sort((a, b) => (numeroDeJour(a.nom) ?? Infinity) - (numeroDeJour(b.nom) ?? Infinity));
    lignes.push(ligne);
  });

  // Les numéros des semaines existantes ne changent jamais ; une nouvelle semaine prend
  // sa place dans le fichier (1re, 2e…) si ce numéro est libre, sinon le suivant du bloc.
  bloc.semaines.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  if (!bloc.dateDebut && programme.semaines[0]?.lundi) bloc.dateDebut = dateIso(programme.semaines[0].lundi);

  const changements = lignes.reduce((total, l) => total + (l.nouvelle ? 1 : 0) + l.ajoutes.length + l.misAJour.length, 0);
  return {
    changements,
    lignes: lignes.map((l) => ({ ...l, numero: l.semaine.numero })),
  };
}

/**
 * « Djelyssa - PREPA FRANCE - B2.csv » → « PREPA FRANCE - B2 » (nom de l'onglet).
 * Les ajouts des navigateurs quand le fichier existe déjà, comme « (1) » ou « -2 »,
 * sont retirés pour retrouver le même bloc.
 */
function nomOngletDepuisFichier(nomFichier) {
  const sansExtension = nomFichier
    .replace(/\.(csv|txt)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/-\d+$/, '')
    .trim();
  const morceaux = sansExtension.split(' - ');
  return (morceaux.length > 1 ? morceaux.slice(1).join(' - ') : sansExtension).trim() || 'Programme du coach';
}

/** Une ligne par semaine concernée, ex. « • S2 (23/11) : mis à jour : J2 · déjà commencé, non modifié : J1 ». */
function lignesRapport(rapport) {
  const textes = [];
  for (const l of rapport.lignes) {
    const nom = `S${l.numero}${l.lundi ? ` (${l.lundi.slice(8, 10)}/${l.lundi.slice(5, 7)})` : ''}`;
    if (l.nouvelle) {
      textes.push(`• ${nom} — nouvelle semaine : ${pluriel(l.ajoutes.length, 'jour')}`);
      continue;
    }
    const morceaux = [];
    if (l.ajoutes.length > 0) morceaux.push(`${l.ajoutes.length > 1 ? 'ajoutés' : 'ajouté'} : ${l.ajoutes.join(', ')}`);
    if (l.misAJour.length > 0) morceaux.push(`mis à jour : ${l.misAJour.join(', ')}`);
    if (l.conserves.length > 0) morceaux.push(`${l.conserves.length > 1 ? 'déjà commencés, non modifiés' : 'déjà commencé, non modifié'} : ${l.conserves.join(', ')}`);
    if (morceaux.length > 0) textes.push(`• ${nom} : ${morceaux.join(' · ')}`);
  }
  return textes;
}

function lignesProblemes(problemes) {
  if (problemes.length === 0) return [];
  return [
    '', `⚠︎ ${pluriel(problemes.length, 'ligne à vérifier', 'lignes à vérifier')} :`,
    ...problemes.slice(0, 12).map((p) => `• ${p}`),
    ...(problemes.length > 12 ? [`• … et ${problemes.length - 12} autres`] : []),
  ];
}

/* ==========================================================================
   6. Les actions (branchées par programmation.js)
   ========================================================================== */

// Bloc à mettre à jour quand le bouton est celui de l'écran d'un bloc (sinon null).
let blocVise = null;

function choisirCsvCoach(bouton) {
  blocVise = bouton.dataset.bloc ?? null;
  document.getElementById('fichier-coach').click();
}

async function importerCsvCoach(champ) {
  const fichier = champ.files?.[0];
  champ.value = '';   // permet de choisir à nouveau le même fichier plus tard
  if (!fichier) return;

  const programme = lireProgrammeCoach(lireCsv(await fichier.text()));
  if (programme.semaines.length === 0) {
    throw new Error('Aucune semaine trouvée. Ce fichier est-il bien un onglet du programme du coach, exporté en CSV ?');
  }

  const nomOnglet = nomOngletDepuisFichier(fichier.name);
  const existant = blocVise
    ? await lireBloc(blocVise)
    : (await lireBlocs()).find((b) => b.source === nomOnglet || b.nom === nomOnglet);

  // 1. Essai à blanc sur une copie : on montre ce qui va changer AVANT de toucher aux données.
  const apercu = fusionner(existant ? structuredClone(existant) : { semaines: [] }, programme);
  const details = [...lignesRapport(apercu), ...lignesProblemes(programme.problemes)];

  if (existant && apercu.changements === 0) {
    window.alert([`Le bloc « ${existant.nom} » est déjà à jour : rien de nouveau dans ce fichier.`, ...(details.length > 0 ? ['', ...details] : [])].join('\n'));
    return;
  }
  const question = existant
    ? [`Mettre à jour le bloc « ${existant.nom} » ?`, '', ...details, '', 'Les séances déjà commencées ne sont jamais modifiées.']
    : [`Créer le bloc « ${nomOnglet} » ?`, '', ...details];
  if (!window.confirm(question.join('\n'))) return;

  // 2. Application pour de vrai.
  let bloc;
  if (existant) {
    await modifierBloc(existant.id, (b) => {
      if (!b.source) b.source = nomOnglet;
      return fusionner(b, programme);
    });
    bloc = existant;
  } else {
    bloc = nouveauBloc(nomOnglet);
    bloc.source = nomOnglet;
    bloc.objectif = /PEAK/i.test(nomOnglet) ? 'peaking' : 'autre';
    bloc.dateDebut = null;
    bloc.notes = 'Importé du Google Sheets du coach.';
    fusionner(bloc, programme);
    await enregistrerBloc(bloc);
  }

  afficherMessage(existant ? 'Bloc mis à jour' : 'Bloc créé');
  const adresse = `#/bloc/${bloc.id}`;
  if (location.hash === adresse) {
    window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible: null } }));
  } else {
    location.hash = adresse;
  }
}

export const boutonsImportCoach = {
  'choisir-csv-coach': choisirCsvCoach,
};

export const changementsImportCoach = {
  'importer-csv-coach': importerCsvCoach,
};