// FA 4 IT — js/historique.js
// L'onglet « Historique » : e1RM par mouvement sur tout le bloc et pour
// chaque semaine, séries exclues, last warm-ups (repère de forme du jour),
// vitesses enregistrées et table RPE utilisée.

import { lireBlocs, lireReglage, ecrireReglage } from './db.js';
import { TABLE_RPE } from './rpe-table.js';
import { calculerE1rm, seriesDuBloc, seriesDeLaSemaine, htmlResultats, verifierTable } from './e1rm.js';
import { echapper, carteVide, formaterNombre, pluriel } from './ui.js';

function signalerChangement() {
  window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible: null } }));
}

/** 0.5 → « 0,50 » */
function formaterVitesse(valeur) {
  return valeur.toFixed(2).replace('.', ',');
}

/* ==========================================================================
   1. Vitesses enregistrées d'une semaine
   Les séries consécutives à la même charge et au même nombre de répétitions
   sont regroupées : « 110 kg × 5 : 0,50 · 0,49 · 0,48 m/s ».
   ========================================================================== */

function htmlVitesses(semaine) {
  const elements = [];
  let total = 0;

  for (const jour of semaine.jours) {
    for (const exercice of jour.exercices) {
      const mesurees = exercice.series.filter((serie) => serie.faite && serie.vitesse !== null && serie.vitesse !== undefined);
      if (mesurees.length === 0) continue;
      total += mesurees.length;

      const paquets = [];
      for (const serie of mesurees) {
        const dernier = paquets.at(-1);
        if (dernier && dernier.charge === serie.charge && dernier.repetitions === serie.repetitions) {
          dernier.vitesses.push(serie.vitesse);
        } else {
          paquets.push({ charge: serie.charge, repetitions: serie.repetitions, vitesses: [serie.vitesse] });
        }
      }

      const lignes = paquets
        .map((p) => `<span class="texte-secondaire">${formaterNombre(p.charge) || '?'} kg × ${formaterNombre(p.repetitions) || '?'} : ${p.vitesses.map(formaterVitesse).join(' · ')} m/s</span>`)
        .join('');
      elements.push(`<li><strong>${echapper(jour.nom)} · ${echapper(exercice.nom)}</strong>${lignes}</li>`);
    }
  }

  if (total === 0) return '<p class="texte-secondaire">Aucune vitesse enregistrée.</p>';
  return `
    <details class="details">
      <summary>${pluriel(total, 'vitesse enregistrée', 'vitesses enregistrées')}</summary>
      <ul class="liste-vitesses">${elements.join('')}</ul>
    </details>
  `;
}

/* ==========================================================================
   1 bis. Last warm-ups d'une semaine
   Le dernier palier d'échauffement de chaque exercice, avec RPE et vitesse
   moyenne : à charge égale d'une semaine à l'autre, une vitesse plus basse
   ou un RPE plus haut signale un jour moins en forme.
   ========================================================================== */

function htmlLastWarmups(semaine) {
  const elements = [];
  for (const jour of semaine.jours) {
    for (const exercice of jour.exercices) {
      const dernier = (exercice.echauffement ?? []).at(-1);
      if (!dernier || (dernier.charge === null && !dernier.faite)) continue;
      const morceaux = [`${formaterNombre(dernier.charge) || '?'} kg × ${formaterNombre(dernier.repetitions) || '?'}`];
      if (dernier.rpe !== null && dernier.rpe !== undefined) morceaux.push(`RPE ${formaterNombre(dernier.rpe)}`);
      if (dernier.vitesse !== null && dernier.vitesse !== undefined) morceaux.push(`${formaterVitesse(dernier.vitesse)} m/s`);
      elements.push(`<li><strong>${echapper(jour.nom)} · ${echapper(exercice.nom)}</strong><span class="texte-secondaire">${morceaux.join(' · ')}</span></li>`);
    }
  }
  if (elements.length === 0) return '';
  return `
    <details class="details">
      <summary>${pluriel(elements.length, 'last warm-up')}</summary>
      <ul class="liste-vitesses">${elements.join('')}</ul>
    </details>
  `;
}

/* ==========================================================================
   2. Table RPE utilisée, avec son contrôle
   ========================================================================== */

function htmlTable() {
  const rpes = Object.keys(TABLE_RPE).sort((a, b) => Number(b) - Number(a));
  const colonnes = Math.max(...rpes.map((rpe) => (Array.isArray(TABLE_RPE[rpe]) ? TABLE_RPE[rpe].length : 0)));
  const entete = Array.from({ length: colonnes }, (_, i) => `<th scope="col">${i + 1}</th>`).join('');
  const lignes = rpes.map((rpe) => {
    const valeurs = Array.isArray(TABLE_RPE[rpe]) ? TABLE_RPE[rpe] : [];
    const cases = Array.from({ length: colonnes }, (_, i) => `<td>${valeurs[i] === undefined ? '—' : echapper(formaterNombre(valeurs[i]))}</td>`).join('');
    return `<tr><th scope="row">${formaterNombre(Number(rpe))}</th>${cases}</tr>`;
  }).join('');

  const problemes = verifierTable();
  const controle = problemes.length > 0
    ? `<div class="alerte"><strong>⚠︎ Problème dans js/rpe-table.js</strong><ul class="liste-exclues">${problemes.map((p) => `<li>${echapper(p)}</li>`).join('')}</ul></div>`
    : '<p class="texte-secondaire">Table contrôlée : toutes les valeurs sont des pourcentages valides, qui diminuent avec les répétitions.</p>';

  return `
    <section class="carte">
      <details class="details">
        <summary>Table RPE (RTS) : % du 1RM</summary>
        <p class="texte-secondaire">Lignes : RPE ressenti. Colonnes : répétitions réalisées. Modifiable dans js/rpe-table.js.</p>
        <div class="tableau-defilant">
          <table class="table-rpe">
            <thead><tr><th scope="col">RPE</th>${entete}</tr></thead>
            <tbody>${lignes}</tbody>
          </table>
        </div>
      </details>
      ${controle}
    </section>
  `;
}

/* ==========================================================================
   3. L'écran
   ========================================================================== */

async function ecranHistorique() {
  const blocs = await lireBlocs();
  if (blocs.length === 0) {
    return {
      titre: 'Historique',
      html: carteVide('Pas encore de données', 'Créez un bloc dans la page Programme, ou chargez l’exemple depuis la page Sauvegarde.'),
    };
  }

  // Même bloc que dans l'onglet Séance (choix partagé)
  const idChoisi = await lireReglage('blocSeance');
  const bloc = blocs.find((b) => b.id === idChoisi) ?? blocs[0];
  const choixBloc = blocs.length > 1
    ? `
      <section class="carte">
        <div class="groupe">
          <label class="etiquette" for="bloc-historique">Bloc</label>
          <div class="choix">
            <select id="bloc-historique" class="champ" data-changement="choisir-bloc-historique">
              ${blocs.map((b) => `<option value="${echapper(b.id)}"${b.id === bloc.id ? ' selected' : ''}>${echapper(b.nom)}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>
    `
    : '';

  // Bloc entier
  const resultatBloc = calculerE1rm(seriesDuBloc(bloc));

  // Semaine par semaine (avec l'écart par rapport à la dernière semaine qui a des résultats)
  let precedent = null;
  const cartesSemaines = bloc.semaines.map((semaine) => {
    const resultat = calculerE1rm(seriesDeLaSemaine(semaine));
    const carte = `
      <section class="carte">
        <h2>Semaine ${formaterNombre(semaine.numero)}</h2>
        ${htmlResultats(resultat, { precedent, avecJour: true })}
        ${htmlLastWarmups(semaine)}
        ${htmlVitesses(semaine)}
      </section>
    `;
    if (resultat.groupes.length > 0) precedent = resultat;
    return carte;
  }).join('');

  return {
    titre: 'Historique',
    html: `
      ${choixBloc}
      <section class="carte">
        <h2>${echapper(bloc.nom)}</h2>
        <p class="texte-secondaire">e1RM moyen sur tout le bloc : Squat, Bench et Deadlift en format compétition (variantes, accessoires et échauffements non comptés).</p>
        ${htmlResultats(resultatBloc, { exclusions: 'resume' })}
      </section>

      <h2 class="titre-section">Par semaine</h2>
      ${cartesSemaines || carteVide('Aucune semaine', 'Ce bloc ne contient pas encore de semaine.')}

      <h2 class="titre-section">Table RPE</h2>
      ${htmlTable()}
    `,
  };
}

async function choisirBloc(liste) {
  await ecrireReglage('blocSeance', liste.value);
  signalerChangement();
}

/* ==========================================================================
   4. Ce que app.js utilise
   ========================================================================== */

export const ecransHistorique = {
  historique: { onglet: 'historique', afficher: ecranHistorique },
};

export const changementsHistorique = {
  'choisir-bloc-historique': choisirBloc,
};