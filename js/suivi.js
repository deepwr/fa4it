// FA 4 IT — js/suivi.js
// L'onglet « Suivi » : un graphique par mouvement (Squat, Bench, Deadlift en
// format compétition), avec UN POINT PAR BLOC :
//   - courbe bleue  : le lift le plus lourd réellement fait dans le bloc (« réel ») ;
//   - courbe saumon : l'e1RM projeté à partir de ce même lift (table RPE).
// Filtre de période : 6 mois, 1 an ou tout. Toucher un point affiche son détail.
// Le graphique est dessiné par l'app elle-même (SVG) : il marche hors ligne.
// En bas : la carte « Vitesse à charge égale » (voir vitesse.js).

import { lireBlocs, lireReglage, ecrireReglage } from './db.js';
import { compteDansE1rm, evaluerSerie, formaterE1rm } from './e1rm.js';
import { MOUVEMENTS, aujourdhui } from './modele.js';
import { echapper, carteVide, formaterNombre, formaterDate, pluriel } from './ui.js';
import { carteVitesseSuivi } from './vitesse.js';

const ORDRE_MOUVEMENTS = ['squat', 'bench', 'deadlift'];

const PERIODES = {
  '6m': { libelle: '6 mois', mois: 6 },
  '1a': { libelle: '1 an', mois: 12 },
  tout: { libelle: 'Tout', mois: null },
};
const PERIODE_PAR_DEFAUT = '1a';

const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Détail de chaque point, retrouvé quand on le touche (clé : « mouvement:numéro »).
const detailsDesPoints = new Map();

/* ==========================================================================
   1. Les points : le lift le plus lourd de chaque bloc, par mouvement
   ========================================================================== */

/** Vrai s'il reste dans le bloc un jour avec des exercices qui n'a pas encore été fait. */
function blocEnCours(bloc) {
  return bloc.semaines.some((semaine) =>
    semaine.jours.some((jour) => !jour.dateRealisee && jour.exercices.length > 0));
}

/**
 * Pour un bloc et un mouvement : la série faite la plus lourde, avec une date.
 * À charge égale, on garde celle qui donne le meilleur e1RM (puis la plus récente).
 * Renvoie null s'il n'y a aucune série faite de ce mouvement dans le bloc.
 */
function liftLePlusLourd(bloc, mouvement) {
  let meilleur = null;
  for (const semaine of bloc.semaines) {
    for (const jour of semaine.jours) {
      if (!jour.dateRealisee) continue;   // sans date, impossible de placer le point
      for (const exercice of jour.exercices) {
        if (exercice.mouvement !== mouvement || !compteDansE1rm(exercice)) continue;
        exercice.series.forEach((serie, index) => {
          if (!serie.faite || serie.charge === null || serie.charge === undefined) return;
          const evaluation = evaluerSerie(serie);
          const candidat = {
            charge: serie.charge,
            repetitions: serie.repetitions,
            rpe: serie.rpe,
            e1rm: evaluation.e1rm ?? null,
            raisonSansE1rm: evaluation.raison ?? null,
            date: jour.dateRealisee,
            bloc: bloc.nom,
            enCours: false,
            semaine: semaine.numero,
            jour: jour.nom,
            exercice: exercice.nom,
            numeroSerie: index + 1,
          };
          if (estMeilleur(candidat, meilleur)) meilleur = candidat;
        });
      }
    }
  }
  if (meilleur) meilleur.enCours = blocEnCours(bloc);
  return meilleur;
}

function estMeilleur(candidat, actuel) {
  if (!actuel) return true;
  if (candidat.charge !== actuel.charge) return candidat.charge > actuel.charge;
  const e1rmCandidat = candidat.e1rm ?? -1;
  const e1rmActuel = actuel.e1rm ?? -1;
  if (e1rmCandidat !== e1rmActuel) return e1rmCandidat > e1rmActuel;
  return candidat.date > actuel.date;
}

/** Tous les points d'un mouvement (un par bloc), du plus ancien au plus récent. */
export function pointsDuMouvement(blocs, mouvement) {
  return blocs
    .map((bloc) => liftLePlusLourd(bloc, mouvement))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ==========================================================================
   2. Dates
   Les dates sont des textes « AAAA-MM-JJ ». On les convertit en nombre de
   jours pour les placer sur l'axe du temps.
   ========================================================================== */

function enJours(dateIso) {
  const [annee, mois, jour] = dateIso.slice(0, 10).split('-').map(Number);
  return Date.UTC(annee, mois - 1, jour) / 86400000;
}

/** Date de début de la période (« AAAA-MM-JJ »), ou null pour « Tout ». */
export function debutDePeriode(cle, finIso = aujourdhui()) {
  const mois = PERIODES[cle]?.mois;
  if (!mois) return null;
  const [annee, m, jour] = finIso.split('-').map(Number);
  const debut = new Date(Date.UTC(annee, m - 1 - mois, jour));
  return debut.toISOString().slice(0, 10);
}

/** Premiers jours de mois entre deux dates (en jours), pour les repères de l'axe. */
function reperesDeMois(debut, fin) {
  const reperes = [];
  const date = new Date(debut * 86400000);
  let annee = date.getUTCFullYear();
  let mois = date.getUTCMonth() + 1;   // on commence au mois suivant
  for (;;) {
    if (mois > 11) { mois = 0; annee += 1; }
    const jours = Date.UTC(annee, mois, 1) / 86400000;
    if (jours > fin) break;
    reperes.push({ jours, mois, annee });
    mois += 1;
  }
  return reperes;
}

/* ==========================================================================
   3. Le graphique (SVG)
   ========================================================================== */

const L = 320;          // largeur du dessin
const H = 190;          // hauteur du dessin
const MARGE = { gauche: 34, droite: 12, haut: 12, bas: 24 };
const RAYON = 5;          // rayon d'un point
const RAYON_CHOISI = 7;   // rayon du point choisi

function arrondi(valeur) {
  return Math.round(valeur * 10) / 10;
}

/** Pas « rond » de l'axe des charges : 2,5 / 5 / 10 / 20 kg, pour 3 à 6 repères. */
function pasDeCharge(etendue) {
  for (const pas of [2.5, 5, 10, 20, 25, 50]) {
    if (etendue / pas <= 5) return pas;
  }
  return 100;
}

function htmlGraphique(mouvement, points, periode) {
  const charges = points.flatMap((p) => [p.charge, p.e1rm].filter((v) => v !== null));
  let bas = Math.min(...charges);
  let haut = Math.max(...charges);
  if (haut - bas < 10) { bas -= 5; haut += 5; }
  const pas = pasDeCharge(haut - bas);
  bas = Math.floor((bas - pas * 0.3) / pas) * pas;
  haut = Math.ceil((haut + pas * 0.3) / pas) * pas;

  const fin = enJours(aujourdhui());
  const debutPeriode = debutDePeriode(periode);
  // « Tout » : du premier point à aujourd'hui, avec un peu de marge à gauche
  let debut = debutPeriode ? enJours(debutPeriode) : enJours(points[0].date) - 14;
  if (fin - debut < 30) debut = fin - 30;   // au moins un mois visible

  const x = (dateIso) => arrondi(MARGE.gauche + ((enJours(dateIso) - debut) / (fin - debut)) * (L - MARGE.gauche - MARGE.droite));
  const y = (charge) => arrondi(MARGE.haut + ((haut - charge) / (haut - bas)) * (H - MARGE.haut - MARGE.bas));

  // Lignes horizontales et charges
  const lignes = [];
  for (let charge = bas; charge <= haut + 0.001; charge += pas) {
    lignes.push(`<line class="grille" x1="${MARGE.gauche}" x2="${L - MARGE.droite}" y1="${y(charge)}" y2="${y(charge)}"/>`);
    lignes.push(`<text class="axe" x="${MARGE.gauche - 5}" y="${y(charge) + 4}" text-anchor="end">${formaterNombre(charge)}</text>`);
  }

  // Repères de mois (un sur deux, ou un sur trois, si la période est longue)
  const reperes = reperesDeMois(debut, fin);
  const saut = reperes.length > 8 ? 3 : reperes.length > 5 ? 2 : 1;
  const mois = reperes
    .filter((_, i) => i % saut === 0)
    .map((r) => {
      const xr = arrondi(MARGE.gauche + ((r.jours - debut) / (fin - debut)) * (L - MARGE.gauche - MARGE.droite));
      const libelle = r.mois === 0 ? String(r.annee) : NOMS_MOIS[r.mois];
      return `<line class="grille grille-mois" x1="${xr}" x2="${xr}" y1="${MARGE.haut}" y2="${H - MARGE.bas}"/>`
        + `<text class="axe" x="${xr}" y="${H - 6}" text-anchor="middle">${libelle}</text>`;
    })
    .join('');

  // Les deux courbes
  const courbe = (classe, cle) => {
    const valeurs = points.filter((p) => p[cle] !== null);
    if (valeurs.length < 2) return '';
    return `<polyline class="${classe}" points="${valeurs.map((p) => `${x(p.date)},${y(p[cle])}`).join(' ')}"/>`;
  };

  // Les points, avec une grande zone invisible pour les toucher facilement.
  // La zone s'arrête à mi-chemin du point voisin : deux blocs proches ne se gênent pas.
  const abscisses = points.map((p) => x(p.date));
  const ronds = points.map((p, i) => {
    const cle = `${mouvement}:${i}`;
    const xp = abscisses[i];
    const gauche = Math.max(xp - 16, i > 0 ? (abscisses[i - 1] + xp) / 2 : -Infinity);
    const droite = Math.min(xp + 16, i < points.length - 1 ? (xp + abscisses[i + 1]) / 2 : Infinity);
    const ordonnees = [p.charge, p.e1rm].filter((v) => v !== null).map(y);
    const milieu = arrondi((Math.min(...ordonnees) + Math.max(...ordonnees)) / 2);
    const hauteurZone = Math.max(44, Math.max(...ordonnees) - Math.min(...ordonnees) + 30);
    const rayon = i === points.length - 1 ? RAYON_CHOISI : RAYON;
    return `
      <g class="point-suivi${i === points.length - 1 ? ' choisi' : ''}" data-action="suivi-point" data-point="${cle}">
        <rect class="zone-point" x="${arrondi(gauche)}" y="${arrondi(milieu - hauteurZone / 2)}" width="${arrondi(droite - gauche)}" height="${arrondi(hauteurZone)}"/>
        ${p.e1rm !== null ? `<circle class="rond-e1rm" cx="${xp}" cy="${y(p.e1rm)}" r="${rayon}"/>` : ''}
        <circle class="rond-reel" cx="${xp}" cy="${y(p.charge)}" r="${rayon}"/>
      </g>`;
  }).join('');

  const derniers = points.at(-1);
  const description = `${MOUVEMENTS[mouvement]} : ${pluriel(points.length, 'bloc')}. Dernier lift le plus lourd ${formaterNombre(derniers.charge)} kg`
    + (derniers.e1rm !== null ? `, e1RM projeté ${formaterE1rm(derniers.e1rm)}.` : '.');

  return `
    <svg class="graphique-suivi" viewBox="0 0 ${L} ${H}" role="img" aria-label="${echapper(description)}">
      ${lignes.join('')}
      ${mois}
      ${courbe('courbe-e1rm', 'e1rm')}
      ${courbe('courbe-reel', 'charge')}
      ${ronds}
    </svg>
  `;
}

/* ==========================================================================
   4. Une carte par mouvement
   ========================================================================== */

function texteEcart(ecart) {
  if (ecart === null) return '—';
  return `${ecart >= 0 ? '+' : '−'}${Math.abs(ecart).toFixed(1).replace('.', ',')} kg`;
}

function htmlDetail(p) {
  const serie = [`${formaterNombre(p.charge)} kg`];
  if (p.repetitions) serie.push(`× ${formaterNombre(p.repetitions)}`);
  if (p.rpe !== null && p.rpe !== undefined) serie.push(`@ RPE ${formaterNombre(p.rpe)}`);
  const e1rm = p.e1rm !== null
    ? `e1RM projeté <strong>${formaterE1rm(p.e1rm)}</strong>`
    : `e1RM non calculable (${echapper(p.raisonSansE1rm ?? 'série incomplète')})`;
  return `
    <strong>${echapper(p.bloc)}${p.enCours ? ' (en cours)' : ''}</strong>
    <span class="texte-secondaire">S${formaterNombre(p.semaine) || '?'} · ${echapper(p.jour)} · ${formaterDate(p.date)} · ${echapper(p.exercice)}, série ${p.numeroSerie}</span>
    <span>${serie.join(' ')} → ${e1rm}</span>
  `;
}

function htmlCarte(mouvement, tousLesPoints, periode) {
  const debut = debutDePeriode(periode);
  const points = tousLesPoints.filter((p) => !debut || p.date >= debut);
  const nom = MOUVEMENTS[mouvement];

  if (points.length === 0) {
    return `
      <section class="carte carte-suivi">
        <h2>${nom}</h2>
        <p class="texte-secondaire">${tousLesPoints.length === 0
          ? 'Aucune série faite en format compétition pour l’instant.'
          : 'Aucun bloc sur cette période.'}</p>
      </section>
    `;
  }

  const dernier = points.at(-1);
  const precedent = points.at(-2) ?? null;
  const ecart = precedent
    ? (dernier.e1rm !== null && precedent.e1rm !== null ? dernier.e1rm - precedent.e1rm : dernier.charge - precedent.charge)
    : null;
  const meilleurReel = Math.max(...points.map((p) => p.charge));
  const e1rms = points.map((p) => p.e1rm).filter((v) => v !== null);

  points.forEach((p, i) => detailsDesPoints.set(`${mouvement}:${i}`, p));
  const derniereCle = `${mouvement}:${points.length - 1}`;

  return `
    <section class="carte carte-suivi">
      <h2>${nom}</h2>
      <div class="chiffres-suivi">
        <div><span class="etiquette-chiffre">Réel</span><strong>${formaterNombre(dernier.charge)} kg</strong></div>
        <div><span class="etiquette-chiffre">e1RM</span><strong>${dernier.e1rm !== null ? formaterE1rm(dernier.e1rm) : '—'}</strong></div>
        <div><span class="etiquette-chiffre">vs précédent</span><strong>${texteEcart(ecart)}</strong></div>
      </div>
      <p class="texte-secondaire">Meilleur réel ${formaterNombre(meilleurReel)} kg · meilleur e1RM ${e1rms.length ? formaterE1rm(Math.max(...e1rms)) : '—'} · ${pluriel(points.length, 'bloc')}</p>
      ${htmlGraphique(mouvement, points, periode)}
      <div class="detail-point" id="detail-${mouvement}" data-point-choisi="${derniereCle}">${htmlDetail(dernier)}</div>
    </section>
  `;
}

/* ==========================================================================
   5. L'écran
   ========================================================================== */

async function ecranSuivi() {
  const blocs = await lireBlocs();
  if (blocs.length === 0) {
    return {
      titre: 'Suivi',
      html: carteVide('Pas encore de données', 'Créez un bloc dans l’onglet Programme, ou chargez l’exemple depuis l’onglet Sauvegarde.'),
    };
  }

  const lu = await lireReglage('suiviPeriode', PERIODE_PAR_DEFAUT);
  const periode = Object.hasOwn(PERIODES, lu) ? lu : PERIODE_PAR_DEFAUT;
  detailsDesPoints.clear();

  const boutonsPeriode = Object.entries(PERIODES).map(([cle, { libelle }]) => `
    <button type="button" class="puce-periode${cle === periode ? ' active' : ''}" data-action="suivi-periode" data-periode="${cle}"
      aria-pressed="${cle === periode}">${libelle}</button>`).join('');

  const cartes = ORDRE_MOUVEMENTS.map((mouvement) => htmlCarte(mouvement, pointsDuMouvement(blocs, mouvement), periode)).join('');

  return {
    titre: 'Suivi',
    html: `
      <div class="periodes" role="group" aria-label="Période">${boutonsPeriode}</div>
      <p class="legende-suivi">
        <span><span class="pastille pastille-reel"></span>Réel : lift le plus lourd du bloc</span>
        <span><span class="pastille pastille-e1rm"></span>e1RM projeté de ce lift</span>
      </p>
      ${cartes}
      <p class="texte-secondaire">Un point par bloc. Seuls comptent le Squat, le Bench et le Deadlift en format compétition, comme pour l’e1RM. Touchez un point pour voir son détail.</p>
      ${carteVitesseSuivi(blocs)}
    `,
  };
}

/* ==========================================================================
   6. Les boutons
   ========================================================================== */

async function choisirPeriode(bouton) {
  await ecrireReglage('suiviPeriode', bouton.dataset.periode);
  window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible: null } }));
}

/** Affiche le détail du point touché sous son graphique (sans redessiner l'écran). */
function choisirPoint(groupe) {
  const cle = groupe.dataset.point;
  const point = detailsDesPoints.get(cle);
  if (!point) return;
  const mouvement = cle.split(':')[0];
  const zone = document.getElementById(`detail-${mouvement}`);
  if (!zone) return;
  zone.innerHTML = htmlDetail(point);
  zone.dataset.pointChoisi = cle;
  const graphique = groupe.closest('svg');
  for (const autre of graphique.querySelectorAll('.point-suivi')) {
    const choisi = autre === groupe;
    autre.classList.toggle('choisi', choisi);
    for (const rond of autre.querySelectorAll('circle')) rond.setAttribute('r', choisi ? RAYON_CHOISI : RAYON);
  }
}

/* ==========================================================================
   7. Ce que app.js utilise
   ========================================================================== */

export const ecransSuivi = {
  suivi: { onglet: 'suivi', afficher: ecranSuivi },
};

export const boutonsSuivi = {
  'suivi-periode': choisirPeriode,
  'suivi-point': choisirPoint,
};