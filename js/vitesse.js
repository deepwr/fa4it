// FA 4 IT — js/vitesse.js
// Ce que l'on tire des vitesses mesurées (étape 4 du VBT) :
//   - la PERTE DE VITESSE d'une série : de la 1re rep à la dernière ;
//   - la VITESSE À CHARGE ÉGALE : la moyenne d'une série comparée à celle
//     de la même série, au même exercice et à la même charge, à la séance précédente.
//
// « Même série » = même rang parmi les séries faites à cette charge ce jour-là
// (la 2e série à 125 kg est comparée à la 2e série à 125 kg) : la fatigue est comparable.
// Le last warm-up est comparé aux last warm-up (rang 0).
// « Même exercice » = même nom (majuscules, espaces et tirets ignorés).
// Moyenne d'une série = la vitesse moyenne notée (« Remplir » ou saisie à la main,
// par exemple une valeur Qwik), sinon la moyenne des reps de la vidéo.
//
// Adresses :
//   #/serie/<bloc>/<semaine>/<jour>/<exercice>/<series|echauffement>/<n°>   détail d'une série
//   #/vitesse/<nom de l'exercice>/<charge>/<rang>                           évolution à charge égale

import { lireBlocs, lireBloc } from './db.js';
import { echapper, carteVide, pluriel, formaterNombre } from './ui.js';
import { allerA, remplacerAdresse } from './navigation.js';

/* ==========================================================================
   1. Petits outils
   ========================================================================== */

/** Vitesse en m/s, toujours avec 2 décimales : 0,5 → « 0,50 ». */
export function formaterVitesse(valeur) {
  return valeur.toFixed(2).replace('.', ',');
}

/** Écart de vitesse : +0,04 / −0,02 / 0,00 (valeurs déjà arrondies au centième). */
function formaterEcart(ecart) {
  if (ecart === 0) return '0,00';
  return `${ecart > 0 ? '+' : '−'}${formaterVitesse(Math.abs(ecart))}`;
}

/** Arrondi au centième, sans les petites erreurs de calcul (0,47 − 0,43 = 0,04 tout rond). */
function auCentieme(valeur) {
  return Math.round(valeur * 100) / 100;
}

/** « 2026-11-20 » → « 20/11 ». */
export function dateCourte(dateIso) {
  if (!dateIso) return '—';
  const [, mois, jour] = dateIso.slice(0, 10).split('-');
  return `${jour}/${mois}`;
}

/** Instant enregistré (« 2026-11-27T09:12:00Z ») → date locale « 2026-11-27 ». */
function dateLocale(instantIso) {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) return null;
  const deux = (n) => String(n).padStart(2, '0');
  return `${instant.getFullYear()}-${deux(instant.getMonth() + 1)}-${deux(instant.getDate())}`;
}

/** Nom d'exercice comparable : « Squat – Comp », « squat - comp » et « Squat—Comp » se valent. */
export function cleExercice(nom) {
  return String(nom ?? '')
    .toLowerCase()
    .replace(/[‐-―−-]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nom court d'un jour pour les tableaux : « J1 – Squat/Bench » → « J1 ». */
function jourCourt(nom) {
  return String(nom ?? '').split(/\s[–—-]\s/)[0].trim() || String(nom ?? '');
}

/** « S3 · J1 » */
function seanceCourte(point) {
  return `S${formaterNombre(point.semaine) || '?'} · ${jourCourt(point.jour)}`;
}

/** « 2e série à 125 kg », « 1re série à 125 kg », « last warm-up à 110 kg ». */
function libelleRang(rang) {
  if (rang === 0) return 'last warm-up';
  return `${rang}${rang === 1 ? 're' : 'e'} série`;
}

/* ==========================================================================
   2. Les calculs d'une série
   ========================================================================== */

/** Vitesses des reps trouvées dans la vidéo (vide si la série n'a pas été filmée). */
export function vitessesDesReps(serie) {
  return (serie?.vbt?.reps ?? []).map((rep) => rep.vitesse).filter((v) => typeof v === 'number');
}

/** Moyenne de la série (notée, sinon celle de la vidéo), ou null. */
export function moyenneSerie(serie) {
  if (typeof serie?.vitesse === 'number') return serie.vitesse;
  if (typeof serie?.vbt?.vitesse === 'number') return serie.vbt.vitesse;
  const reps = vitessesDesReps(serie);
  return reps.length > 0 ? reps.reduce((a, b) => a + b, 0) / reps.length : null;
}

/**
 * Perte de vitesse de la 1re rep à la dernière, en fraction (0,08 = 8 %).
 * Négative si la dernière rep est plus rapide (« aucune perte »).
 * null s'il y a moins de 2 reps mesurées.
 */
export function perteDeVitesse(serie) {
  const reps = vitessesDesReps(serie);
  if (reps.length < 2 || !(reps[0] > 0)) return null;
  const premiere = reps[0];
  const derniere = reps.at(-1);
  return { premiere, derniere, perte: (premiere - derniere) / premiere };
}

/** « 8 % », ou « aucune » quand la dernière rep n'est pas plus lente que la 1re. */
export function textePerte(perte) {
  const pourcent = Math.round(perte.perte * 100);
  return pourcent <= 0 ? 'aucune' : `${pourcent}\u00a0%`;
}

/**
 * Rang d'une série parmi celles faites à la même charge dans l'exercice ce jour-là
 * (1 pour la première). Les séries pas encore mesurées comptent aussi : seule
 * leur place dans la séance importe.
 */
export function rangALaCharge(lignes, index) {
  const charge = lignes[index]?.charge;
  if (charge === null || charge === undefined) return null;
  let rang = 0;
  for (let i = 0; i <= index; i += 1) {
    if (lignes[i].charge === charge) rang += 1;
  }
  return rang;
}

/* ==========================================================================
   3. Toutes les séries avec une vitesse, et les comparaisons
   ========================================================================== */

function cleLigne(idBloc, idJour, idExercice, liste, index) {
  return `${idBloc}/${idJour}/${idExercice}/${liste}/${index}`;
}

function cleGroupe(cle, charge, rang) {
  return `${cle}|${charge}|${rang}`;
}

/**
 * Parcourt tous les blocs et garde chaque série qui a une vitesse moyenne et une charge.
 * Renvoie { points, parLigne, groupes } :
 *   - parLigne : retrouver le point d'une ligne de séance ;
 *   - groupes  : les points d'un même exercice, d'une même charge et d'un même rang,
 *                du plus ancien au plus récent.
 */
export function indexDesVitesses(blocs) {
  const points = [];
  const parLigne = new Map();
  const groupes = new Map();

  for (const bloc of blocs) {
    for (const semaine of bloc.semaines ?? []) {
      for (const jour of semaine.jours ?? []) {
        for (const exercice of jour.exercices ?? []) {
          const cle = cleExercice(exercice.nom);
          const listes = [['series', exercice.series ?? []], ['echauffement', exercice.echauffement ?? []]];
          for (const [liste, lignes] of listes) {
            lignes.forEach((serie, index) => {
              const moyenne = moyenneSerie(serie);
              if (moyenne === null || serie.charge === null || serie.charge === undefined) return;
              const date = jour.dateRealisee || (serie.vbt?.date ? dateLocale(serie.vbt.date) : null);
              const point = {
                nom: exercice.nom,
                cle,
                charge: serie.charge,
                rang: liste === 'series' ? rangALaCharge(lignes, index) : 0,
                liste,
                index,
                moyenne: auCentieme(moyenne),
                perte: perteDeVitesse(serie),
                reps: vitessesDesReps(serie),
                repetitions: serie.repetitions,
                rpe: serie.rpe,
                date,
                idBloc: bloc.id,
                idSemaine: semaine.id,
                idJour: jour.id,
                idExercice: exercice.id,
                semaine: semaine.numero,
                jour: jour.nom,
              };
              points.push(point);
              parLigne.set(cleLigne(bloc.id, jour.id, exercice.id, liste, index), point);
              if (!date) return;   // sans date, impossible de la placer dans le temps
              const cleG = cleGroupe(cle, point.charge, point.rang);
              if (!groupes.has(cleG)) groupes.set(cleG, []);
              groupes.get(cleG).push(point);
            });
          }
        }
      }
    }
  }

  for (const groupe of groupes.values()) {
    groupe.sort((a, b) => a.date.localeCompare(b.date));
    // Deux last warm-up mesurés le même jour à la même charge : on garde le dernier.
    for (let i = groupe.length - 2; i >= 0; i -= 1) {
      if (groupe[i].idJour === groupe[i + 1].idJour) groupe.splice(i, 1);
    }
  }
  return { points, parLigne, groupes };
}

/** Le point d'une ligne de séance, ou null. */
export function pointDeLigne(index, idBloc, idJour, idExercice, liste, numero) {
  return index.parLigne.get(cleLigne(idBloc, idJour, idExercice, liste, numero)) ?? null;
}

/** Les points du même exercice, à la même charge et au même rang, du plus ancien au plus récent. */
function groupeDe(index, point) {
  return index.groupes.get(cleGroupe(point.cle, point.charge, point.rang)) ?? [];
}

/**
 * La série d'une séance précédente à comparer (même exercice, même charge, même rang),
 * la plus récente avant ce jour. Renvoie { avant, ecart } ou null.
 */
export function comparaison(index, point) {
  if (!point?.date) return null;
  const precedents = groupeDe(index, point).filter((p) => p.date < point.date);
  const avant = precedents.at(-1);
  if (!avant) return null;
  return { avant, ecart: auCentieme(point.moyenne - avant.moyenne) };
}

/** « +0,04 m/s vs 20/11 » */
export function texteComparaison(comp) {
  return `${formaterEcart(comp.ecart)}\u00a0m/s vs\u00a0${dateCourte(comp.avant.date)}`;
}

function adresseEvolution(point) {
  return `#/vitesse/${encodeURIComponent(point.nom)}/${point.charge}/${point.rang}`;
}

function adresseDetail(point) {
  return `#/serie/${point.idBloc}/${point.idSemaine}/${point.idJour}/${point.idExercice}/${point.liste}/${point.index}`;
}

/* ==========================================================================
   4. Dans la séance : une seule ligne qui ouvre le détail
   ========================================================================== */

/**
 * Ligne « Vidéo · 5 reps · perte 8 % / À charge égale : +0,04 m/s vs 20/11 › Détail ».
 * Renvoie '' si la série n'a rien à montrer (ni vidéo, ni comparaison).
 */
export function ligneVitesseSeance(index, ids, liste, numero, serie) {
  const point = pointDeLigne(index, ids.bloc, ids.jour, ids.exercice, liste, numero);
  const comp = point ? comparaison(index, point) : null;
  const reps = vitessesDesReps(serie);
  if (reps.length === 0 && !comp) return '';

  const morceaux = reps.length > 0 ? [`Vidéo · ${pluriel(reps.length, 'rep')}`] : [`Vitesse notée ${formaterVitesse(point.moyenne)}\u00a0m/s`];
  const perte = perteDeVitesse(serie);
  if (perte) morceaux.push(textePerte(perte) === 'aucune' ? 'aucune perte' : `perte ${textePerte(perte)}`);
  let seconde = 'Pas encore de comparaison à cette charge';
  if (comp) seconde = `À charge égale : ${texteComparaison(comp)}`;
  else if (serie.charge === null || serie.charge === undefined) seconde = 'Notez la charge pour comparer';
  const adresse = `#/serie/${ids.bloc}/${ids.semaine}/${ids.jour}/${ids.exercice}/${liste}/${numero}`;
  return `
    <a class="lien-vitesse" href="${echapper(adresse)}">
      <span class="lien-vitesse-texte">
        <strong>${morceaux.join(' · ')}</strong>
        <span class="texte-secondaire">${seconde}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

/** Vrai si la ligne a une mesure vidéo (le bouton « Remesurer » passe alors dans le détail). */
export function aUneVideo(serie) {
  return vitessesDesReps(serie).length > 0;
}

/* ==========================================================================
   5. Détail d'une série (#/serie/…)
   ========================================================================== */

/** Barres : une par rep, la 1re (référence) plus foncée, trait pointillé à sa hauteur. */
function htmlBarres(reps) {
  const L = 320;
  const H = 150;
  const bas = 110;                     // ligne de base des barres
  const hautMax = 90;                  // hauteur de la barre la plus rapide
  const maxi = Math.max(...reps);
  const largeurCase = (L - 12) / reps.length;
  const largeur = Math.min(40, largeurCase * 0.62);
  const h = (v) => Math.round((v / maxi) * hautMax * 10) / 10;
  const xCentre = (i) => Math.round((6 + largeurCase * (i + 0.5)) * 10) / 10;
  const petit = reps.length > 7;       // beaucoup de reps : textes plus petits

  const barres = reps.map((v, i) => {
    const x = Math.round((xCentre(i) - largeur / 2) * 10) / 10;
    return `<rect class="barre-rep${i === 0 ? ' barre-reference' : ''}" x="${x}" y="${bas - h(v)}" width="${Math.round(largeur * 10) / 10}" height="${h(v)}" rx="6"/>`
      + `<text class="valeur-rep" x="${xCentre(i)}" y="128" text-anchor="middle"${petit ? ' font-size="11"' : ''}>${formaterVitesse(v)}</text>`
      + `<text class="axe" x="${xCentre(i)}" y="145" text-anchor="middle">${i === 0 ? (petit ? '1' : '1 · réf.') : i + 1}</text>`;
  }).join('');
  const yRef = bas - h(reps[0]);
  const description = `Vitesse de chaque rep : ${reps.map((v, i) => `rep ${i + 1} ${formaterVitesse(v)}`).join(', ')} m/s. Référence : rep 1.`;
  return `
    <svg class="graphique-reps" viewBox="0 0 ${L} ${H}" role="img" aria-label="${echapper(description)}">
      <line class="grille" x1="0" x2="${L}" y1="${bas}" y2="${bas}"/>
      ${barres}
      <line class="trait-reference" x1="2" x2="${L - 2}" y1="${yRef}" y2="${yRef}"/>
    </svg>
  `;
}

function trouverLigne(bloc, idSemaine, idJour, idExercice, liste, index) {
  const semaine = bloc.semaines.find((s) => s.id === idSemaine);
  const jour = semaine?.jours.find((j) => j.id === idJour);
  const exercice = jour?.exercices.find((e) => e.id === idExercice);
  const lignes = liste === 'echauffement' ? (exercice?.echauffement ?? []) : (exercice?.series ?? []);
  const serie = lignes[index];
  if (!serie) throw new Error('Cette série n’existe plus.');
  return { semaine, jour, exercice, serie };
}

async function ecranDetail([idBloc, idSemaine, idJour, idExercice, liste = 'series', numero = '0']) {
  const index = Number(numero);
  const bloc = await lireBloc(idBloc);
  if (!bloc) throw new Error('Ce bloc n’existe plus.');
  const { semaine, jour, exercice, serie } = trouverLigne(bloc, idSemaine, idJour, idExercice, liste, index);
  const vitesses = indexDesVitesses(await lireBlocs());
  const point = pointDeLigne(vitesses, idBloc, idJour, idExercice, liste, index);

  const titre = liste === 'echauffement' ? 'Last warm-up' : `Série ${index + 1}`;
  const charge = serie.charge !== null && serie.charge !== undefined ? `${formaterNombre(serie.charge)} kg` : 'charge non notée';
  const detailsSerie = [charge + (serie.repetitions ? ` × ${formaterNombre(serie.repetitions)}` : '')];
  if (serie.rpe !== null && serie.rpe !== undefined) detailsSerie.push(`RPE ${formaterNombre(serie.rpe)}`);
  const quand = [`S${formaterNombre(semaine.numero) || '?'} · ${echapper(jour.nom)}`];
  if (jour.dateRealisee) quand.push(dateCourte(jour.dateRealisee));

  // Carte 1 : les reps
  const reps = vitessesDesReps(serie);
  const moyenne = moyenneSerie(serie);
  const perte = perteDeVitesse(serie);
  let carteReps;
  if (reps.length > 0) {
    const textePerteTuile = perte
      ? `<strong class="tuile-valeur">${Math.round(perte.perte * 100) <= 0 ? 'Aucune' : `${Math.round(perte.perte * 100)} %`}</strong>
         <span class="texte-secondaire">de ${formaterVitesse(perte.premiere)} à ${formaterVitesse(perte.derniere)}</span>`
      : '<strong class="tuile-valeur">—</strong><span class="texte-secondaire">une seule rep</span>';
    carteReps = `
      <section class="carte">
        <h2>Vitesse de chaque rep</h2>
        ${htmlBarres(reps)}
        <div class="tuiles-vitesse">
          <div class="tuile-vitesse">
            <span class="etiquette-tuile">Perte de vitesse</span>
            ${textePerteTuile}
          </div>
          <div class="tuile-vitesse">
            <span class="etiquette-tuile">Moyenne</span>
            <strong class="tuile-valeur">${moyenne !== null ? `${formaterVitesse(moyenne)} m/s` : '—'}</strong>
            <span class="texte-secondaire">sur ${pluriel(reps.length, 'rep')}</span>
          </div>
        </div>
        <p class="texte-secondaire">Perte : de la 1re rep (la référence) à la dernière.</p>
      </section>
    `;
  } else {
    carteReps = `
      <section class="carte">
        <h2>Vitesse</h2>
        <p>${moyenne !== null
          ? `Vitesse moyenne notée : <strong>${formaterVitesse(moyenne)} m/s</strong>.`
          : 'Pas encore de vitesse pour cette série.'}</p>
        <p class="texte-secondaire">La perte de vitesse demande une mesure vidéo (le détail des reps).</p>
      </section>
    `;
  }

  // Carte 2 : à charge égale
  let carteCharge = '';
  if (point) {
    const comp = comparaison(vitesses, point);
    const sousTitre = `${echapper(exercice.nom)} · ${libelleRang(point.rang)} à ${formaterNombre(point.charge)} kg`;
    if (comp) {
      const sens = comp.ecart > 0 ? 'plus rapide' : comp.ecart < 0 ? 'plus lente' : 'même vitesse';
      carteCharge = `
        <section class="carte">
          <div class="entete-carte-vitesse">
            <h2>À charge égale</h2>
            <p class="texte-secondaire">${sousTitre} · moyenne de la série</p>
          </div>
          <div class="lignes-comparaison">
            <p><span>${point.date ? dateCourte(point.date) : 'Aujourd’hui'} · ${echapper(seanceCourte(point))}</span><strong>${formaterVitesse(point.moyenne)}</strong></p>
            <p class="texte-secondaire"><span>${dateCourte(comp.avant.date)} · ${echapper(seanceCourte(comp.avant))}</span><span>${formaterVitesse(comp.avant.moyenne)}</span></p>
          </div>
          <p class="ecart-vitesse"><strong>${formaterEcart(comp.ecart)}\u00a0m/s</strong> <span class="texte-secondaire">${sens} que le ${dateCourte(comp.avant.date)}</span></p>
          <a class="bouton bouton-secondaire bouton-large" href="${echapper(adresseEvolution(point))}">Voir l’évolution ›</a>
        </section>
      `;
    } else {
      carteCharge = `
        <section class="carte">
          <div class="entete-carte-vitesse">
            <h2>À charge égale</h2>
            <p class="texte-secondaire">${sousTitre}</p>
          </div>
          <p class="texte-secondaire">Pas encore de séance précédente avec cette série à cette charge : la comparaison apparaîtra la prochaine fois.</p>
          ${groupeDe(vitesses, point).length > 0 ? `<a class="bouton bouton-secondaire bouton-large" href="${echapper(adresseEvolution(point))}">Voir l’évolution ›</a>` : ''}
        </section>
      `;
    }
  } else if (moyenne !== null) {
    carteCharge = `
      <section class="carte">
        <h2>À charge égale</h2>
        <p class="texte-secondaire">Notez la charge de la série pour la comparer aux séances précédentes.</p>
      </section>
    `;
  }

  const adresseMesure = `#/vbt/${idBloc}/${idSemaine}/${idJour}/${idExercice}/${liste}/${index}`;
  return {
    titre,
    html: `
      <section class="carte">
        <div class="entete-carte-vitesse">
          <h2>${echapper(exercice.nom)}</h2>
          <p class="texte-secondaire">${detailsSerie.join(' · ')}</p>
          <p class="texte-secondaire">${quand.join(' · ')}</p>
        </div>
      </section>
      ${carteReps}
      ${carteCharge}
    `,
    actions: `
      <button class="bouton bouton-secondaire bouton-retour" type="button" data-action="vitesse-retour-seance"
        data-bloc="${echapper(idBloc)}" data-semaine="${echapper(idSemaine)}" data-jour="${echapper(idJour)}"
        data-exercice="${echapper(idExercice)}" data-liste="${echapper(liste)}" data-serie="${index}"
        data-adresse="${echapper(`#/seance/${idBloc}/${idSemaine}/${idJour}`)}"
        data-ligne="${echapper(`${liste === 'series' ? 'serie' : 'echauffement'}-${idExercice}-${index}`)}">‹ Séance</button>
      ${exercice.mouvement === 'autre' ? '' : `<a class="bouton" href="${echapper(adresseMesure)}">${reps.length > 0 ? 'Remesurer en vidéo' : 'Mesurer en vidéo'}</a>`}
    `,
  };
}

/** « ‹ Séance » : retour à la séance, sur la ligne de la série. */
async function retourSeance(bouton) {
  const { bloc, semaine, jour, exercice, liste, serie } = bouton.dataset;
  const idCible = `${liste === 'series' ? 'serie' : 'echauffement'}-${exercice}-${serie}`;   // comme dans seance.js
  allerA(`#/seance/${bloc}/${semaine}/${jour}`);   // v19 : en arrière si l'on en vient
  // L'écran de séance se dessine juste après : on attend la ligne, puis on l'amène au centre.
  for (let essai = 0; essai < 60; essai += 1) {
    await new Promise((resoudre) => setTimeout(resoudre, 50));
    const ligne = document.getElementById(idCible);
    if (ligne) {
      ligne.closest('details')?.setAttribute('open', '');
      ligne.scrollIntoView({ block: 'center' });
      return;
    }
  }
}

/* ==========================================================================
   6. Onglet Suivi : la carte « Vitesse à charge égale »
   ========================================================================== */

/** Pour chaque exercice : la comparaison la plus récente (ou rien s'il n'y en a pas encore). */
function dernieresComparaisons(index) {
  const parExercice = new Map();
  for (const point of index.points) {
    if (!point.date) continue;
    if (!parExercice.has(point.cle)) parExercice.set(point.cle, []);
    parExercice.get(point.cle).push(point);
  }
  const lignes = [];
  for (const points of parExercice.values()) {
    // Du plus récent au plus ancien ; le même jour, les séries de travail avant le last warm-up, puis par rang
    points.sort((a, b) => b.date.localeCompare(a.date)
      || (a.rang === 0) - (b.rang === 0)
      || a.rang - b.rang);
    let trouve = null;
    for (const point of points) {
      const comp = comparaison(index, point);
      if (comp) { trouve = { point, comp }; break; }
    }
    lignes.push({ dernier: points[0], ...(trouve ?? {}) });
  }
  return lignes.sort((a, b) => b.dernier.date.localeCompare(a.dernier.date));
}

export function carteVitesseSuivi(blocs) {
  const index = indexDesVitesses(blocs);
  const lignes = dernieresComparaisons(index).slice(0, 12);
  if (lignes.length === 0) {
    return `
      <section class="carte">
        <h2>Vitesse à charge égale</h2>
        <p class="texte-secondaire">Mesurez vos séries en vidéo (ou notez leur vitesse moyenne) : dès qu’une série revient à la même charge, la comparaison apparaît ici.</p>
      </section>
    `;
  }
  const html = lignes.map(({ dernier, point, comp }) => {
    if (comp) {
      return `
        <a class="ligne-vitesse" href="${echapper(adresseEvolution(point))}">
          <span class="ligne-vitesse-texte">
            <strong>${echapper(point.nom)}</strong>
            <span class="texte-secondaire">${libelleRang(point.rang)} à ${formaterNombre(point.charge)}\u00a0kg · <span class="insecable">${dateCourte(point.date)} vs ${dateCourte(comp.avant.date)}</span></span>
          </span>
          <strong class="ligne-vitesse-ecart">${formaterEcart(comp.ecart)}\u00a0m/s</strong>
          <span class="chevron" aria-hidden="true">›</span>
        </a>
      `;
    }
    return `
      <a class="ligne-vitesse" href="${echapper(adresseEvolution(dernier))}">
        <span class="ligne-vitesse-texte">
          <strong>${echapper(dernier.nom)}</strong>
          <span class="texte-secondaire">Pas encore deux séances à la même charge</span>
        </span>
        <span class="chevron" aria-hidden="true">›</span>
      </a>
    `;
  }).join('');
  return `
    <section class="carte carte-vitesse">
      <div class="entete-carte-vitesse">
        <h2>Vitesse à charge égale</h2>
        <p class="texte-secondaire">Dernière comparaison, même exercice et même charge</p>
      </div>
      <div class="liste-vitesse">${html}</div>
    </section>
  `;
}

/* ==========================================================================
   7. Évolution à charge égale (#/vitesse/<nom>/<charge>/<rang>)
   ========================================================================== */

/** Pas « rond » de l'axe des vitesses : 0,02 / 0,05 / 0,1 m/s. */
function pasDeVitesse(etendue) {
  for (const pas of [0.02, 0.05, 0.1, 0.2]) {
    if (etendue / pas <= 4) return pas;
  }
  return 0.5;
}

function htmlCourbe(points) {
  const L = 320;
  const H = 170;
  const marge = { gauche: 36, droite: 14, haut: 12, bas: 26 };
  const valeurs = points.map((p) => p.moyenne);
  let bas = Math.min(...valeurs);
  let haut = Math.max(...valeurs);
  if (haut - bas < 0.04) { bas -= 0.02; haut += 0.02; }
  const pas = pasDeVitesse(haut - bas);
  bas = Math.max(0, Math.floor((bas - pas * 0.3) / pas) * pas);
  haut = Math.ceil((haut + pas * 0.3) / pas) * pas;

  const largeur = L - marge.gauche - marge.droite;
  const x = (i) => Math.round((marge.gauche + (points.length === 1 ? largeur / 2 : (i / (points.length - 1)) * largeur)) * 10) / 10;
  const y = (v) => Math.round((marge.haut + ((haut - v) / (haut - bas)) * (H - marge.haut - marge.bas)) * 10) / 10;

  const lignes = [];
  for (let v = bas; v <= haut + 1e-9; v += pas) {
    lignes.push(`<line class="grille" x1="${marge.gauche}" x2="${L - marge.droite}" y1="${y(v)}" y2="${y(v)}"/>`);
    lignes.push(`<text class="axe" x="${marge.gauche - 5}" y="${y(v) + 4}" text-anchor="end">${formaterVitesse(v)}</text>`);
  }
  // Dates sous l'axe : toutes, ou une sur deux / trois s'il y en a beaucoup (la dernière toujours)
  const saut = points.length > 10 ? 3 : points.length > 5 ? 2 : 1;
  const dates = points.map((p, i) => ((i % saut === 0 || i === points.length - 1)
    ? `<text class="axe" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dateCourte(p.date)}</text>` : '')).join('');
  const trace = points.length > 1
    ? `<polyline class="courbe-vitesse" points="${points.map((p, i) => `${x(i)},${y(p.moyenne)}`).join(' ')}"/>` : '';
  const ronds = points.map((p, i) => `<circle class="rond-vitesse${i === points.length - 1 ? ' choisi' : ''}" cx="${x(i)}" cy="${y(p.moyenne)}" r="${i === points.length - 1 ? 7 : 5}"/>`).join('');
  const description = `Moyenne de la série : ${points.map((p) => `${formaterVitesse(p.moyenne)} le ${dateCourte(p.date)}`).join(', ')}.`;
  return `
    <svg class="graphique-suivi" viewBox="0 0 ${L} ${H}" role="img" aria-label="${echapper(description)}">
      ${lignes.join('')}
      ${dates}
      ${trace}
      ${ronds}
    </svg>
  `;
}

async function ecranEvolution([nomEncode = '', chargeTexte = '', rangTexte = '']) {
  let nom;
  try {
    nom = decodeURIComponent(nomEncode);
  } catch {
    nom = nomEncode;
  }
  const cle = cleExercice(nom);
  const index = indexDesVitesses(await lireBlocs());
  const tous = index.points.filter((p) => p.cle === cle && p.date);
  const retour = '<button class="bouton bouton-secondaire bouton-retour" type="button" data-action="vitesse-retour">‹ Retour</button>';
  if (tous.length === 0) {
    return { titre: 'Vitesse', html: carteVide('Pas de vitesse', `Aucune série de « ${echapper(nom)} » avec une vitesse et une charge.`), actions: retour };
  }
  const nomAffiche = tous.at(-1).nom;

  // Charges disponibles (de la plus lourde à la plus légère), avec leur nombre de séances
  const charges = [...new Set(tous.map((p) => p.charge))].sort((a, b) => b - a);
  const plusRecent = [...tous].sort((a, b) => b.date.localeCompare(a.date))[0];
  let charge = Number(chargeTexte);
  if (!charges.includes(charge)) charge = plusRecent.charge;

  // Rangs disponibles à cette charge (last warm-up en dernier)
  const aLaCharge = tous.filter((p) => p.charge === charge);
  const rangs = [...new Set(aLaCharge.map((p) => p.rang))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  let rang = Number(rangTexte);
  if (rangTexte === '' || !rangs.includes(rang)) {
    rang = [...aLaCharge].sort((a, b) => b.date.localeCompare(a.date) || a.rang - b.rang)[0].rang;
  }
  const points = index.groupes.get(cleGroupe(cle, charge, rang)) ?? [];

  const optionsCharge = charges.map((c) => {
    const n = new Set(tous.filter((p) => p.charge === c).map((p) => p.idJour)).size;
    return `<option value="${c}"${c === charge ? ' selected' : ''}>${formaterNombre(c)} kg (${pluriel(n, 'séance')})</option>`;
  }).join('');
  const adresse = (r) => `#/vitesse/${encodeURIComponent(nomAffiche)}/${charge}/${r}`;
  const pilules = rangs.map((r) => `
    <a class="puce-periode puce-rang${r === rang ? ' active' : ''}" href="${echapper(adresse(r))}" data-remplacer${r === rang ? ' aria-current="true"' : ''}>${r === 0 ? 'Last warm-up' : r}</a>`).join('');

  let resume = '';
  if (points.length > 1) {
    const premier = points[0];
    const dernier = points.at(-1);
    resume = `<p class="ecart-vitesse"><strong>${formaterEcart(auCentieme(dernier.moyenne - premier.moyenne))}\u00a0m/s</strong> <span class="texte-secondaire">depuis le ${dateCourte(premier.date)} (${formaterVitesse(premier.moyenne)} → ${formaterVitesse(dernier.moyenne)})</span></p>`;
  } else {
    resume = '<p class="texte-secondaire">Une seule séance pour l’instant : la courbe apparaîtra à la prochaine séance à cette charge.</p>';
  }

  const lignesTableau = [...points].reverse().map((p, i) => `
    <tr>
      <td><a class="lien" href="${echapper(adresseDetail(p))}">${dateCourte(p.date)}</a></td>
      <td>${echapper(seanceCourte(p))}</td>
      <td class="nombre${i === 0 ? ' fort' : ''}">${formaterVitesse(p.moyenne)}</td>
      <td class="nombre">${p.perte ? textePerte(p.perte) : '—'}</td>
    </tr>`).join('');

  return {
    titre: nomAffiche,
    html: `
      <section class="carte">
        <p class="texte-secondaire">Vitesse moyenne de la série, à charge égale</p>
        <div class="groupe">
          <label class="etiquette" for="vitesse-charge">Charge</label>
          <div class="choix">
            <select id="vitesse-charge" class="champ" data-changement="vitesse-charge" data-nom="${echapper(nomAffiche)}">${optionsCharge}</select>
          </div>
        </div>
        <div class="groupe">
          <span class="etiquette">Série à cette charge</span>
          <div class="rangs" role="group" aria-label="Série à cette charge">${pilules}</div>
        </div>
      </section>
      <section class="carte">
        <h2>${rang === 0 ? 'Last warm-up' : `${libelleRang(rang).replace(/^./, (c) => c.toUpperCase())}`} à ${formaterNombre(charge)} kg</h2>
        ${resume}
        ${points.length > 1 ? htmlCourbe(points) : ''}
        <table class="tableau-vitesse">
          <thead><tr><th>Date</th><th>Séance</th><th class="nombre">Moyenne</th><th class="nombre">Perte</th></tr></thead>
          <tbody>${lignesTableau}</tbody>
        </table>
        <p class="texte-secondaire">Même exercice, même charge, même rang de série. Perte : de la 1re à la dernière rep (mesure vidéo seulement). Touchez une date pour voir la série.</p>
      </section>
    `,
    actions: retour,
  };
}

/** Choix d'une autre charge : on garde l'exercice, le rang est choisi par l'écran. */
function choisirCharge(liste) {
  remplacerAdresse(`#/vitesse/${encodeURIComponent(liste.dataset.nom)}/${liste.value}`);   // v19 : même écran, sans nouvelle étape
}

/** « ‹ Retour » : écran précédent (détail d'une série ou onglet Suivi). */
function retour() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    location.hash = '#/suivi';
  }
}

/* ==========================================================================
   8. Ce que app.js utilise
   ========================================================================== */

export const ecransVitesse = {
  serie: { onglet: 'seance', afficher: ecranDetail },
  vitesse: { onglet: 'suivi', afficher: ecranEvolution },
};

export const boutonsVitesse = {
  'vitesse-retour-seance': retourSeance,
  'vitesse-retour': retour,
};

export const changementsVitesse = {
  'vitesse-charge': choisirCharge,
};
