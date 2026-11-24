// FA 4 IT — js/e1rm.js
// Calcul de l'e1RM (1RM estimé) à partir de la table RPE (js/rpe-table.js).
//
// Règle, pour chaque série faite :
//   e1RM = charge réalisée ÷ (% du 1RM pour le couple (répétitions réalisées, RPE ressenti))
// Exemple : 110 kg × 5 répétitions à RPE 7 → 78,6 % → 110 ÷ 0,786 = 139,95 kg.
//
// Sont exclues du calcul, et signalées : les séries non faites (dans une séance
// réalisée), sans charge, sans RPE, sans répétitions, ou hors de la table.
// L'e1RM affiché est la MOYENNE des e1RM des séries valides, calculée à part
// pour chaque mouvement de référence (variantes comprises). Les exercices
// « Autre » sont calculés chacun de leur côté, sous leur propre nom.

import { TABLE_RPE } from './rpe-table.js';
import { MOUVEMENTS } from './modele.js';
import { echapper, pluriel } from './ui.js';

const ORDRE_MOUVEMENTS = ['squat', 'bench', 'deadlift'];

/* ==========================================================================
   1. La table
   ========================================================================== */

/** % du 1RM pour (répétitions, RPE), ou null si le couple n'est pas dans la table. */
export function pourcentage1RM(repetitions, rpe) {
  const ligne = TABLE_RPE[String(rpe)];
  if (!Array.isArray(ligne)) return null;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > ligne.length) return null;
  const valeur = ligne[repetitions - 1];
  return typeof valeur === 'number' && valeur > 0 ? valeur : null;
}

/** Contrôle la table : nombres entre 0 et 100, qui diminuent quand les répétitions augmentent. */
export function verifierTable() {
  const problemes = [];
  for (const [rpe, ligne] of Object.entries(TABLE_RPE)) {
    if (!Array.isArray(ligne)) {
      problemes.push(`La ligne RPE ${rpe} n’est pas une liste de nombres.`);
      continue;
    }
    ligne.forEach((valeur, position) => {
      if (typeof valeur !== 'number' || valeur <= 0 || valeur > 100) {
        problemes.push(`RPE ${rpe}, ${position + 1} rép. : « ${valeur} » n’est pas un pourcentage valide.`);
      } else if (position > 0 && valeur > ligne[position - 1]) {
        problemes.push(`RPE ${rpe}, ${position + 1} rép. : ${valeur} est plus grand que la case précédente.`);
      }
    });
  }
  return problemes;
}

/* ==========================================================================
   2. Une série
   ========================================================================== */

function aUneValeur(valeur) {
  return valeur !== null && valeur !== undefined;
}

/** Renvoie { e1rm, pourcentage } pour une série valide, ou { raison } si elle est exclue. */
export function evaluerSerie(serie) {
  if (!serie.faite) return { raison: 'non faite' };
  if (!aUneValeur(serie.charge)) return { raison: 'sans charge' };
  if (!aUneValeur(serie.rpe)) return { raison: 'sans RPE' };
  if (!aUneValeur(serie.repetitions) || serie.repetitions < 1) return { raison: 'sans répétitions' };
  const pourcentage = pourcentage1RM(serie.repetitions, serie.rpe);
  if (pourcentage === null) {
    return { raison: `hors table (${serie.repetitions} rép. à RPE ${String(serie.rpe).replace('.', ',')})` };
  }
  return { e1rm: serie.charge / (pourcentage / 100), pourcentage };
}

/* ==========================================================================
   3. Rassembler les séries d'une séance, d'une semaine ou d'un bloc
   Chaque élément garde son contexte (semaine, jour, exercice, numéro) pour
   pouvoir signaler précisément une série exclue.
   ========================================================================== */

export function seriesDuJour(semaine, jour) {
  return jour.exercices.flatMap((exercice) =>
    exercice.series.map((serie, index) => ({ semaine, jour, exercice, serie, index })));
}

export function seriesDeLaSemaine(semaine) {
  return semaine.jours.flatMap((jour) => seriesDuJour(semaine, jour));
}

export function seriesDuBloc(bloc) {
  return bloc.semaines.flatMap(seriesDeLaSemaine);
}

/** Groupe de calcul : le mouvement de référence, ou le nom de l'exercice pour « Autre ». */
function groupeDe(exercice) {
  if (exercice.mouvement !== 'autre' && MOUVEMENTS[exercice.mouvement]) {
    return { cle: exercice.mouvement, libelle: MOUVEMENTS[exercice.mouvement] };
  }
  return { cle: `autre:${exercice.nom.trim().toLowerCase()}`, libelle: exercice.nom };
}

function rang(cle) {
  const position = ORDRE_MOUVEMENTS.indexOf(cle);
  return position === -1 ? ORDRE_MOUVEMENTS.length : position;
}

/* ==========================================================================
   4. Le calcul
   ========================================================================== */

/**
 * Calcule l'e1RM par groupe pour une liste de séries.
 * Option « nonFaitesEnAttente » : pendant une séance, les séries pas encore
 * faites sont seulement comptées, pas signalées une par une.
 * Renvoie { groupes: [{ cle, libelle, nombre, moyenne, min, max }], exclues, aVenir }.
 */
export function calculerE1rm(elements, { nonFaitesEnAttente = false } = {}) {
  const groupes = new Map();
  const exclues = [];
  let aVenir = 0;

  for (const element of elements) {
    const resultat = evaluerSerie(element.serie);
    if (resultat.raison === 'non faite' && (nonFaitesEnAttente || !element.jour.dateRealisee)) {
      aVenir += 1;   // séance à venir ou en cours : rien d'anormal
      continue;
    }
    if (resultat.raison) {
      exclues.push({ ...element, raison: resultat.raison });
      continue;
    }
    const { cle, libelle } = groupeDe(element.exercice);
    if (!groupes.has(cle)) groupes.set(cle, { cle, libelle, valeurs: [] });
    groupes.get(cle).valeurs.push(resultat.e1rm);
  }

  const liste = [...groupes.values()].map((groupe) => ({
    cle: groupe.cle,
    libelle: groupe.libelle,
    nombre: groupe.valeurs.length,
    moyenne: groupe.valeurs.reduce((somme, valeur) => somme + valeur, 0) / groupe.valeurs.length,
    min: Math.min(...groupe.valeurs),
    max: Math.max(...groupe.valeurs),
  }));
  liste.sort((a, b) => rang(a.cle) - rang(b.cle) || a.libelle.localeCompare(b.libelle, 'fr'));

  return { groupes: liste, exclues, aVenir };
}

/* ==========================================================================
   5. Affichage des résultats (utilisé par la séance et l'historique)
   ========================================================================== */

/** 139.949… → « 139,9 kg » (l'arrondi ne sert qu'à l'affichage). */
export function formaterE1rm(valeur) {
  return `${valeur.toFixed(1).replace('.', ',')} kg`;
}

function libelleSerie(element, { avecSemaine, avecJour }) {
  const morceaux = [];
  if (avecSemaine) morceaux.push(`S${String(element.semaine.numero ?? '?')}`);
  if (avecJour) morceaux.push(element.jour.nom);
  morceaux.push(element.exercice.nom, `série ${element.index + 1}`);
  return morceaux.join(' · ');
}

/**
 * HTML des résultats.
 * Options :
 * - precedent : résultat de la semaine précédente, pour afficher l'écart ;
 * - avecSemaine, avecJour : précisions dans les libellés des séries exclues ;
 * - exclusions : 'liste' (détail de chaque série) ou 'resume' (un simple total).
 */
export function htmlResultats(resultat, { precedent = null, avecSemaine = false, avecJour = true, exclusions = 'liste' } = {}) {
  const lignes = resultat.groupes.map((groupe) => {
    const avant = precedent?.groupes.find((g) => g.cle === groupe.cle);
    const ecart = avant ? groupe.moyenne - avant.moyenne : null;
    const texteEcart = ecart === null
      ? ''
      : ` · ${ecart >= 0 ? '+' : '−'}${Math.abs(ecart).toFixed(1).replace('.', ',')} kg vs semaine précédente`;
    return `
      <div class="ligne-e1rm">
        <span class="e1rm-nom">${echapper(groupe.libelle)}</span>
        <strong class="e1rm-valeur">${formaterE1rm(groupe.moyenne)}</strong>
        <span class="e1rm-detail">${pluriel(groupe.nombre, 'série')} · min ${formaterE1rm(groupe.min)} · max ${formaterE1rm(groupe.max)}${texteEcart}</span>
      </div>
    `;
  }).join('');

  const nombreExclues = resultat.exclues.length;
  let htmlExclues = '';
  if (nombreExclues > 0 && exclusions === 'liste') {
    const elements = resultat.exclues
      .map((exclue) => `<li>${echapper(libelleSerie(exclue, { avecSemaine, avecJour }))} : ${echapper(exclue.raison)}</li>`)
      .join('');
    htmlExclues = `
      <div class="alerte">
        <strong>⚠︎ ${pluriel(nombreExclues, 'série exclue', 'séries exclues')} de l’e1RM</strong>
        <ul class="liste-exclues">${elements}</ul>
      </div>
    `;
  } else if (nombreExclues > 0) {
    htmlExclues = `<p class="alerte">⚠︎ ${pluriel(nombreExclues, 'série exclue', 'séries exclues')} de l’e1RM (détail dans chaque semaine).</p>`;
  }

  const htmlAVenir = resultat.aVenir > 0
    ? `<p class="texte-secondaire">${pluriel(resultat.aVenir, 'série pas encore faite', 'séries pas encore faites')} : pas comptées.</p>`
    : '';

  return `
    ${lignes || '<p class="texte-secondaire">Aucune série valide pour l’instant.</p>'}
    ${htmlExclues}
    ${htmlAVenir}
  `;
}