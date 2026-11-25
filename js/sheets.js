// FA 4 IT — js/sheets.js
// Renvoi des résultats dans le Google Sheets du coach.
//
// L'app envoie, pour chaque ligne du coach réalisée :
//   - RPE RESSENTI : le RPE de la dernière série faite ;
//   - MVBT         : la moyenne des vitesses moyennes des séries faites ;
//   - POIDS        : la charge réalisée (celle de la dernière série faite).
// Elle ne connaît la case de chaque ligne que si le bloc a été importé (ou
// réimporté) depuis le CSV du coach avec la version 5 ou plus.
//
// L'écriture dans le classeur est faite par un petit script Google Apps Script
// (apps-script/fa4it-sheets.gs) publié avec votre compte. L'app lui parle avec
// l'adresse et le code secret réglés dans Sauvegarde › Google Sheets du coach.

import { lireBloc, modifierBloc, lireReglage, ecrireReglage } from './db.js';
import { echapper, afficherMessage, pluriel, formaterDateHeure } from './ui.js';

const CLE_ADRESSE = 'sheetsAdresse';
const CLE_CODE = 'sheetsCode';
const CLE_TEST = 'sheetsTest';

function aUneValeur(valeur) {
  return valeur !== null && valeur !== undefined;
}

function signalerChangement() {
  window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible: null } }));
}

/* ==========================================================================
   1. Réglages : adresse du script et code secret
   ========================================================================== */

/** Vrai pour une adresse de script publié (…/exec), ou une adresse locale de test. */
function adresseValide(adresse) {
  try {
    const url = new URL(adresse);
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    return url.protocol === 'https:' && url.hostname === 'script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Adresse complète à appeler (avec le code secret), ou null si le réglage n'est pas fait. */
async function adresseComplete() {
  const adresse = (await lireReglage(CLE_ADRESSE)) ?? '';
  const code = (await lireReglage(CLE_CODE)) ?? '';
  if (!adresseValide(adresse) || code.length < 12) return null;
  const url = new URL(adresse);
  url.searchParams.set('cle', code);
  return url.toString();
}

export async function sheetsRegle() {
  return (await adresseComplete()) !== null;
}

/* ==========================================================================
   2. Ce qu'on envoie : une ligne du coach = un exercice de l'app
   ========================================================================== */

/**
 * Valeurs à écrire pour un exercice, d'après ses séries faites :
 * { rpe, vitesse, charge } (null si inconnue), ou null si aucune série n'est faite.
 */
export function resultatsExercice(exercice) {
  const faites = exercice.series.filter((serie) => serie.faite);
  if (faites.length === 0) return null;
  const derniere = (champ) => [...faites].reverse().find((serie) => aUneValeur(serie[champ]))?.[champ] ?? null;
  const vitesses = faites.map((serie) => serie.vitesse).filter(aUneValeur);
  const moyenne = vitesses.length > 0
    ? Math.round((vitesses.reduce((somme, v) => somme + v, 0) / vitesses.length) * 100) / 100
    : null;
  return { rpe: derniere('rpe'), vitesse: moyenne, charge: derniere('charge') };
}

/**
 * Lignes à envoyer pour un jour (numéros de ligne et de colonne à partir de 1, comme
 * dans Google Sheets), et noms des exercices faits mais sans case connue.
 */
export function lignesDuJour(jour) {
  const lignes = [];
  const sansCase = [];
  for (const exercice of jour.exercices) {
    const resultats = resultatsExercice(exercice);
    if (!resultats) continue;
    const origine = exercice.origine;
    if (!origine) {
      sansCase.push(exercice.nom);
      continue;
    }
    const valeurs = ['rpe', 'vitesse', 'charge']
      .filter((champ) => aUneValeur(resultats[champ]) && aUneValeur(origine.colonnes?.[champ]))
      .map((champ) => ({ colonne: origine.colonnes[champ] + 1, valeur: resultats[champ] }));
    if (valeurs.length === 0) continue;
    lignes.push({
      ligne: origine.ligne + 1,
      controle: (origine.controle ?? []).map((c) => ({ colonne: c.colonne + 1, texte: c.texte })),
      valeurs,
      jour: jour.id,
      exercice: exercice.nom,
    });
  }
  return { lignes, sansCase };
}

/* ==========================================================================
   3. Appels au script Google
   ========================================================================== */

async function appeler(options = {}) {
  const adresse = await adresseComplete();
  if (!adresse) {
    throw new Error('Le lien avec le Google Sheets n’est pas encore réglé : onglet Sauvegarde › Google Sheets du coach.');
  }
  if (navigator.onLine === false) {
    throw new Error('Pas de réseau : réessayez une fois connectée.');
  }
  let reponse;
  try {
    reponse = await fetch(adresse, { redirect: 'follow', cache: 'no-store', ...options });
  } catch {
    throw new Error('Impossible de joindre le script Google. Vérifiez le réseau, l’adresse, et que le déploiement est ouvert à « Tout le monde ».');
  }
  let donnees;
  try {
    donnees = await reponse.json();
  } catch {
    throw new Error('Le script n’a pas répondu comme prévu. Vérifiez l’adresse (elle se termine par /exec) et que le déploiement est ouvert à « Tout le monde ».');
  }
  if (!donnees?.ok) throw new Error(donnees?.erreur || 'Le script a refusé la demande.');
  return donnees;
}

/**
 * Envoie les résultats des jours demandés. Les jours entièrement acceptés sont
 * marqués « envoyés ». Renvoie le texte du compte rendu.
 */
async function envoyerJours(idBloc, idsJours) {
  const bloc = await lireBloc(idBloc);
  if (!bloc) throw new Error('Ce bloc n’existe plus.');
  if (!bloc.source) throw new Error('Ce bloc n’a pas été importé du Google Sheets du coach : il n’a pas de cases où écrire.');

  const lignes = [];
  const sansCase = [];
  for (const semaine of bloc.semaines) {
    for (const jour of semaine.jours) {
      if (!idsJours.includes(jour.id)) continue;
      const resultat = lignesDuJour(jour);
      lignes.push(...resultat.lignes);
      sansCase.push(...resultat.sansCase.map((nom) => `S${semaine.numero} · ${jour.nom} · ${nom}`));
    }
  }

  if (lignes.length === 0) {
    const texte = ['Rien à envoyer : aucune série faite sur une ligne du coach.'];
    if (sansCase.length > 0) texte.push('', `Exercices sans case dans le Sheets : ${sansCase.join(' ; ')}. Réimportez le CSV du coach pour les relier.`);
    return texte.join('\n');
  }

  const reponse = await appeler({
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // évite la vérification « CORS » que Google refuse
    body: JSON.stringify({
      onglet: bloc.source,
      lignes: lignes.map(({ ligne, controle, valeurs }) => ({ ligne, controle, valeurs })),
    }),
  });

  // Jours marqués « envoyés » : ceux dont aucune ligne n'a été refusée
  const refusees = reponse.refusees ?? [];
  const lignesRefusees = new Set(refusees.map((r) => r.ligne));
  const joursRefuses = new Set(lignes.filter((l) => lignesRefusees.has(l.ligne)).map((l) => l.jour));
  const joursAcceptes = [...new Set(lignes.map((l) => l.jour))].filter((id) => !joursRefuses.has(id));
  const maintenant = new Date().toISOString();
  if (joursAcceptes.length > 0) {
    await modifierBloc(idBloc, (b) => {
      for (const semaine of b.semaines) {
        for (const jour of semaine.jours) {
          if (joursAcceptes.includes(jour.id)) jour.envoiSheets = maintenant;
        }
      }
    });
  }

  const texte = [`Envoyé dans l’onglet « ${bloc.source} » : ${pluriel(reponse.ecrites ?? 0, 'case remplie', 'cases remplies')}.`];
  if (refusees.length > 0) {
    texte.push('', `⚠︎ ${pluriel(refusees.length, 'case refusée', 'cases refusées')} :`);
    for (const r of refusees.slice(0, 10)) {
      const nom = lignes.find((l) => l.ligne === r.ligne)?.exercice;
      texte.push(`• ligne ${r.ligne}${nom ? ` (${nom})` : ''} : ${r.raison}`);
    }
    if (refusees.length > 10) texte.push(`• … et ${refusees.length - 10} autres`);
  }
  if (sansCase.length > 0) {
    texte.push('', `Exercices sans case dans le Sheets (réimportez le CSV du coach pour les relier) : ${sansCase.join(' ; ')}.`);
  }
  return texte.join('\n');
}

/* ==========================================================================
   4. Carte de réglage (écran Sauvegarde)
   ========================================================================== */

export async function carteReglageSheets() {
  const adresse = (await lireReglage(CLE_ADRESSE)) ?? '';
  const code = (await lireReglage(CLE_CODE)) ?? '';
  const test = await lireReglage(CLE_TEST);
  let etat;
  if (!adresse && !code) etat = 'Pas encore réglé.';
  else if (adresse && !adresseValide(adresse)) etat = '⚠︎ Adresse non reconnue : elle commence par https://script.google.com/macros/s/ et se termine par /exec.';
  else if (code.length < 12) etat = '⚠︎ Le code secret doit faire au moins 12 caractères (le même que dans le script).';
  else if (test) etat = `Connecté au classeur « ${echapper(test.classeur)} » (test du ${formaterDateHeure(test.date)}).`;
  else etat = 'Réglé, pas encore testé.';
  const alerte = etat.startsWith('⚠︎');

  return `
    <section class="carte">
      <h2>Google Sheets du coach</h2>
      <p class="texte-secondaire">Pour renvoyer vos résultats dans le classeur du coach : RPE de la dernière série, vitesse moyenne et charge réalisée. Réglage à faire une seule fois.</p>
      <div class="groupe">
        <label class="etiquette" for="sheets-adresse">Adresse du script (se termine par /exec)</label>
        <input id="sheets-adresse" class="champ" type="url" inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" value="${echapper(adresse)}" data-changement="regler-sheets" data-reglage="${CLE_ADRESSE}">
      </div>
      <div class="groupe">
        <label class="etiquette" for="sheets-code">Code secret (le même que dans le script)</label>
        <input id="sheets-code" class="champ" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${echapper(code)}" data-changement="regler-sheets" data-reglage="${CLE_CODE}">
      </div>
      <p class="${alerte ? 'alerte' : 'texte-secondaire'}">${etat}</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="tester-sheets">Tester la connexion</button>
    </section>
  `;
}

/* ==========================================================================
   5. Les actions
   ========================================================================== */

async function reglerSheets(champ) {
  await ecrireReglage(champ.dataset.reglage, champ.value.trim());
  await ecrireReglage(CLE_TEST, null);   // réglage changé : à retester
  afficherMessage('Enregistré ✓');
  signalerChangement();
}

async function testerSheets() {
  const reponse = await appeler({ method: 'GET' });
  await ecrireReglage(CLE_TEST, { date: new Date().toISOString(), classeur: reponse.classeur });
  afficherMessage(`Connecté à « ${reponse.classeur} » ✓`);
  signalerChangement();
}

async function envoyerSeance(bouton) {
  const texte = await envoyerJours(bouton.dataset.bloc, [bouton.dataset.jour]);
  window.alert(texte);
  signalerChangement();
}

async function envoyerBloc(bouton) {
  const bloc = await lireBloc(bouton.dataset.bloc);
  const jours = bloc.semaines.flatMap((semaine) => semaine.jours)
    .filter((jour) => jour.exercices.some((exercice) => exercice.series.some((serie) => serie.faite)));
  if (jours.length === 0) {
    afficherMessage('Aucune séance faite dans ce bloc');
    return;
  }
  if (!window.confirm(`Envoyer les résultats de ${pluriel(jours.length, 'séance')} dans l’onglet « ${bloc.source} » du Google Sheets ?\n\nLes cases déjà remplies dans les colonnes de l’athlète seront mises à jour.`)) return;
  const texte = await envoyerJours(bloc.id, jours.map((jour) => jour.id));
  window.alert(texte);
  signalerChangement();
}

/**
 * Après « Terminer » : propose d'envoyer la séance, si le lien est réglé et que la
 * séance a des résultats sur des lignes du coach. N'interrompt jamais la fin de séance.
 */
export async function proposerEnvoiApresSeance(idBloc, idJour) {
  if (!(await sheetsRegle())) return;
  const bloc = await lireBloc(idBloc);
  const jour = bloc?.source ? bloc.semaines.flatMap((s) => s.jours).find((j) => j.id === idJour) : null;
  if (!jour || lignesDuJour(jour).lignes.length === 0) return;
  if (!window.confirm('Envoyer les résultats de cette séance dans le Google Sheets du coach ?')) return;
  try {
    window.alert(await envoyerJours(idBloc, [idJour]));
  } catch (erreur) {
    window.alert(`Pas envoyé : ${erreur.message}\n\nVous pourrez réessayer depuis la séance (« Envoyer au Sheets »).`);
  }
}

export const boutonsSheets = {
  'tester-sheets': testerSheets,
  'envoyer-seance-sheets': envoyerSeance,
  'envoyer-bloc-sheets': envoyerBloc,
};

export const changementsSheets = {
  'regler-sheets': reglerSheets,
};