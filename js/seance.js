// FA 4 IT — js/seance.js
// Le mode séance : choisir la séance, puis saisir chaque série vite.
// Chaque saisie est enregistrée immédiatement.
//
// Adresses utilisées :
//   #/seance                            liste des séances (prochaine, à venir, faites)
//   #/seance/<bloc>/<semaine>/<jour>    saisie d'une séance

import { carteRappelSauvegarde } from './sauvegarde.js';
import { lireBlocs, lireBloc, modifierBloc, lireReglage, ecrireReglage } from './db.js';
import { MOUVEMENTS, lireNombre, nouvelleSerie, aujourdhui } from './modele.js';
import {
  echapper, carteVide, afficherMessage, pluriel, formaterDate,
  formaterNombre, arrondirAuDemi,
} from './ui.js';
import { calculerE1rm, seriesDuJour, htmlResultats } from './e1rm.js';

/* ==========================================================================
   1. Règles de saisie
   ========================================================================== */

// Comment lire chaque valeur tapée (texte → nombre propre).
const LECTURE = {
  charge: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.max(0, nombre);                            // aucun arrondi
  },
  repetitions: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.min(50, Math.max(0, Math.round(nombre)));  // nombre entier
  },
  rpe: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.min(10, Math.max(1, arrondirAuDemi(nombre))); // pas de 0,5
  },
  vitesse: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.min(5, Math.max(0, Math.round(nombre * 100) / 100)); // 2 décimales
  },
};

// Boutons − et + : de combien on avance, et dans quelles limites.
const PAS = {
  repetitions: { pas: 1, min: 0, max: 50 },
  rpe: { pas: 0.5, min: 1, max: 10 },
};

/* ==========================================================================
   2. Petits outils
   ========================================================================== */

function adresseSeance(idBloc, idSemaine, idJour) {
  return `#/seance/${idBloc}/${idSemaine}/${idJour}`;
}

function signalerChangement(cible = null) {
  window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible } }));
}

function aUneValeur(valeur) {
  return valeur !== null && valeur !== undefined;
}

/** Retrouve la semaine, le jour et l'exercice dans un bloc (ou lance une erreur claire). */
function trouver(bloc, idSemaine, idJour, idExercice) {
  const semaine = bloc.semaines.find((s) => s.id === idSemaine);
  if (!semaine) throw new Error('Cette semaine n’existe plus.');
  const jour = semaine.jours.find((j) => j.id === idJour);
  if (!jour) throw new Error('Cette séance n’existe plus.');
  const exercice = idExercice ? jour.exercices.find((e) => e.id === idExercice) : null;
  if (idExercice && !exercice) throw new Error('Cet exercice n’existe plus.');
  return { semaine, jour, exercice };
}

/** Ajoute les lignes de séries manquantes d'après la prescription. Renvoie true si quelque chose a changé. */
function completerSeries(exercice) {
  const voulues = exercice.prescription.nbSeries ?? 0;
  let ajout = false;
  while (exercice.series.length < voulues) {
    exercice.series.push(nouvelleSerie(exercice.prescription.repetitions));
    ajout = true;
  }
  return ajout;
}

/** Nombre de séries faites et prévues pour un jour. */
function avancement(jour) {
  let faites = 0;
  let total = 0;
  for (const exercice of jour.exercices) {
    faites += exercice.series.filter((serie) => serie.faite).length;
    total += Math.max(exercice.series.length, exercice.prescription.nbSeries ?? 0);
  }
  return { faites, total };
}

/** Les alertes d'une série : charge max dépassée, RPE au-dessus de la cible. */
function alertesSerie(serie, prescription) {
  const messages = [];
  if (aUneValeur(serie.charge) && aUneValeur(prescription.chargeMax) && serie.charge > prescription.chargeMax) {
    messages.push(`Charge max dépassée (${formaterNombre(serie.charge)} kg > ${formaterNombre(prescription.chargeMax)} kg)`);
  }
  if (aUneValeur(serie.rpe) && aUneValeur(prescription.rpeCible) && serie.rpe > prescription.rpeCible) {
    messages.push(`RPE au-dessus de la cible (${formaterNombre(serie.rpe)} > ${formaterNombre(prescription.rpeCible)})`);
  }
  return messages;
}

/** « 4 × 5 @ RPE 7 · max 112,5 kg » */
function resumePrescription(prescription) {
  const morceaux = [`${formaterNombre(prescription.nbSeries) || '?'} × ${formaterNombre(prescription.repetitions) || '?'}`];
  if (aUneValeur(prescription.rpeCible)) morceaux[0] += ` @ RPE ${formaterNombre(prescription.rpeCible)}`;
  if (aUneValeur(prescription.chargeMax)) morceaux.push(`max ${formaterNombre(prescription.chargeMax)} kg`);
  return morceaux.join(' · ');
}

/** Attributs data-… qui disent à quelle série appartient un champ ou un bouton. */
function attributsSerie(ids, index) {
  return `data-bloc="${echapper(ids.bloc)}" data-semaine="${echapper(ids.semaine)}" data-jour="${echapper(ids.jour)}" data-exercice="${echapper(ids.exercice)}" data-serie="${index}"`;
}

function idLigne(idExercice, index) {
  return `serie-${idExercice}-${index}`;
}

/* ==========================================================================
   3. Liste des séances (#/seance)
   ========================================================================== */

function carteSeance(bloc, { semaine, jour }, prochaine = false) {
  const { faites, total } = avancement(jour);
  const prevu = jour.datePrevue ? ` · prévu le ${formaterDate(jour.datePrevue)}` : '';
  const etat = jour.dateRealisee
    ? `Faite le ${formaterDate(jour.dateRealisee)} · ${faites}/${total} séries`
    : (faites > 0 ? `En cours · ${faites}/${total} séries` : pluriel(jour.exercices.length, 'exercice'));
  return `
    <a class="carte carte-lien${prochaine ? ' carte-prochaine' : ''}" href="${adresseSeance(bloc.id, semaine.id, jour.id)}">
      <span class="carte-lien-texte">
        <strong class="carte-titre">${echapper(jour.nom)}</strong>
        <span class="texte-secondaire">Semaine ${formaterNombre(semaine.numero)}${prevu}</span>
        <span class="texte-secondaire">${etat}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

async function ecranListe() {
  const blocs = await lireBlocs();
  if (blocs.length === 0) {
    return {
      titre: 'Séance',
      html: carteVide('Aucun programme', 'Créez un bloc dans l’onglet Programme, ou chargez l’exemple depuis l’onglet Sauvegarde.'),
    };
  }

  // Bloc choisi (par défaut : celui qui commence le plus récemment)
  const idChoisi = await lireReglage('blocSeance');
  const bloc = blocs.find((b) => b.id === idChoisi) ?? blocs[0];
  const choixBloc = blocs.length > 1
    ? `
      <section class="carte">
        <div class="groupe">
          <label class="etiquette" for="bloc-seance">Bloc</label>
          <div class="choix">
            <select id="bloc-seance" class="champ" data-changement="choisir-bloc-seance">
              ${blocs.map((b) => `<option value="${echapper(b.id)}"${b.id === bloc.id ? ' selected' : ''}>${echapper(b.nom)}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>
    `
    : '';

  // Tous les jours du bloc, dans l'ordre du programme
  const jours = bloc.semaines.flatMap((semaine) => semaine.jours.map((jour) => ({ semaine, jour })));
  const aFaire = jours.filter(({ jour }) => !jour.dateRealisee);
  const faits = jours
    .filter(({ jour }) => jour.dateRealisee)
    .sort((a, b) => b.jour.dateRealisee.localeCompare(a.jour.dateRealisee))
    .slice(0, 6);
  const [prochaine, ...suivantes] = aFaire;

  const html = `
    ${await carteRappelSauvegarde()}
    ${choixBloc}
    ${prochaine
      ? `<h2 class="titre-section">Prochaine séance</h2>${carteSeance(bloc, prochaine, true)}`
      : carteVide('Tout est fait', 'Toutes les séances de ce bloc sont réalisées.')}
    ${suivantes.length > 0
      ? `<h2 class="titre-section">Ensuite</h2>${suivantes.slice(0, 6).map((j) => carteSeance(bloc, j)).join('')}`
      : ''}
    ${faits.length > 0
      ? `<h2 class="titre-section">Déjà faites</h2>${faits.map((j) => carteSeance(bloc, j)).join('')}`
      : ''}
  `;

  return {
    titre: 'Séance',
    html,
    actions: prochaine
      ? `<a class="bouton" href="${adresseSeance(bloc.id, prochaine.semaine.id, prochaine.jour.id)}">Commencer la séance</a>`
      : '',
  };
}

/* ==========================================================================
   4. Saisie d'une séance (#/seance/<bloc>/<semaine>/<jour>)
   ========================================================================== */

let compteurChamps = 0;

/** Champ − valeur + (répétitions, RPE). */
function champPasAPas({ ids, index, champ, etiquette, valeur, depart, enAlerte }) {
  const idHtml = `saisie-${++compteurChamps}`;
  const attributs = attributsSerie(ids, index);
  const nom = etiquette.toLowerCase();
  return `
    <div class="groupe">
      <label class="etiquette" for="${idHtml}">${etiquette}</label>
      <div class="pas-a-pas">
        <button class="bouton bouton-secondaire pas-bouton" type="button" data-action="pas-serie" data-sens="-1" data-champ="${champ}" data-saisie="${idHtml}" data-depart="${formaterNombre(depart)}" aria-label="Diminuer ${nom}, série ${index + 1}">−</button>
        <input id="${idHtml}" class="champ${enAlerte ? ' en-alerte' : ''}" type="text" inputmode="decimal" autocomplete="off" value="${formaterNombre(valeur)}" data-changement="saisir-serie" data-champ="${champ}" ${attributs}>
        <button class="bouton bouton-secondaire pas-bouton" type="button" data-action="pas-serie" data-sens="1" data-champ="${champ}" data-saisie="${idHtml}" data-depart="${formaterNombre(depart)}" aria-label="Augmenter ${nom}, série ${index + 1}">+</button>
      </div>
    </div>
  `;
}

/** Champ simple (charge, vitesse). */
function champSimple({ ids, index, champ, etiquette, valeur, indice, enAlerte }) {
  const idHtml = `saisie-${++compteurChamps}`;
  return `
    <div class="groupe">
      <label class="etiquette" for="${idHtml}">${etiquette}</label>
      <input id="${idHtml}" class="champ${enAlerte ? ' en-alerte' : ''}" type="text" inputmode="decimal" autocomplete="off" placeholder="${indice}" value="${formaterNombre(valeur)}" data-changement="saisir-serie" data-champ="${champ}" ${attributsSerie(ids, index)}>
    </div>
  `;
}

function ligneSerie(ids, exercice, serie, index) {
  const prescription = exercice.prescription;
  const alertes = alertesSerie(serie, prescription);
  const chargeEnAlerte = alertes.some((m) => m.startsWith('Charge'));
  const rpeEnAlerte = alertes.some((m) => m.startsWith('RPE'));
  return `
    <div class="serie${serie.faite ? ' faite' : ''}" id="${echapper(idLigne(exercice.id, index))}">
      <div class="serie-entete">
        <span class="serie-numero">Série ${index + 1}</span>
        <button class="bascule-faite" type="button" data-action="basculer-faite" ${attributsSerie(ids, index)} aria-pressed="${serie.faite}">${serie.faite ? '✓ Faite' : 'À faire'}</button>
      </div>
      <div class="grille-2">
        ${champSimple({ ids, index, champ: 'charge', etiquette: 'Charge (kg)', valeur: serie.charge, indice: 'kg', enAlerte: chargeEnAlerte })}
        ${champPasAPas({ ids, index, champ: 'repetitions', etiquette: 'Répétitions', valeur: serie.repetitions, depart: prescription.repetitions ?? 5 })}
        ${champPasAPas({ ids, index, champ: 'rpe', etiquette: 'RPE', valeur: serie.rpe, depart: prescription.rpeCible ?? 8, enAlerte: rpeEnAlerte })}
        ${champSimple({ ids, index, champ: 'vitesse', etiquette: 'Vitesse (m/s)', valeur: serie.vitesse, indice: 'm/s' })}
      </div>
      <p class="alerte serie-alerte" role="status"${alertes.length > 0 ? '' : ' hidden'}>${alertes.length > 0 ? `⚠︎ ${alertes.join(' · ')}` : ''}</p>
    </div>
  `;
}

function carteExerciceSeance(idsJour, exercice) {
  const ids = { ...idsJour, exercice: exercice.id };
  const lignes = exercice.series.map((serie, index) => ligneSerie(ids, exercice, serie, index)).join('');
  return `
    <section class="carte" id="exercice-${echapper(exercice.id)}">
      <div class="entete-exercice">
        <h2>${echapper(exercice.nom)}</h2>
        <p class="texte-secondaire">${MOUVEMENTS[exercice.mouvement] ?? 'Autre'} · ${resumePrescription(exercice.prescription)}</p>
        ${exercice.consignes ? `<p class="consignes">${echapper(exercice.consignes)}</p>` : ''}
      </div>
      ${lignes || '<p class="texte-secondaire">Aucune série prévue.</p>'}
      <div class="rangee">
        <button class="bouton bouton-secondaire bouton-petit" type="button" data-action="ajouter-serie" ${attributsSerie(ids, exercice.series.length)}>+ Série</button>
        <button class="bouton bouton-alerte bouton-petit" type="button" data-action="retirer-serie" ${attributsSerie(ids, exercice.series.length - 1)}${exercice.series.length === 0 ? ' disabled' : ''}>Retirer la dernière</button>
      </div>
    </section>
  `;
}

async function ecranSaisie([idBloc, idSemaine, idJour]) {
  let bloc = await lireBloc(idBloc);
  if (!bloc) throw new Error('Ce bloc n’existe plus.');
  let { semaine, jour } = trouver(bloc, idSemaine, idJour);

  // Première ouverture : on crée les lignes de séries d'après la prescription
  // (répétitions déjà remplies).
  if (jour.exercices.some((exercice) => exercice.series.length < (exercice.prescription.nbSeries ?? 0))) {
    bloc = await modifierBloc(idBloc, (b) => {
      const trouve = trouver(b, idSemaine, idJour);
      trouve.jour.exercices.forEach(completerSeries);
      return b;
    });
    ({ semaine, jour } = trouver(bloc, idSemaine, idJour));
  }

  const ids = { bloc: bloc.id, semaine: semaine.id, jour: jour.id };
  const { faites, total } = avancement(jour);
  const prevu = jour.datePrevue ? ` · prévu le ${formaterDate(jour.datePrevue)}` : '';
  const exercices = jour.exercices.length > 0
    ? jour.exercices.map((exercice) => carteExerciceSeance(ids, exercice)).join('')
    : carteVide('Aucun exercice', 'Ajoutez des exercices à ce jour dans l’onglet Programme.');

  return {
    titre: jour.nom,
    html: `
      <section class="carte">
        <p class="texte-secondaire">${echapper(bloc.nom)} · Semaine ${formaterNombre(semaine.numero)}${prevu}</p>
        <p class="progression" id="progression-seance">${faites}/${total} séries faites</p>
        <a class="lien" href="#/jour/${echapper(bloc.id)}/${echapper(semaine.id)}/${echapper(jour.id)}">Modifier la prescription</a>
      </section>
      ${exercices}
      <section class="carte" id="e1rm-seance">${contenuE1rm(semaine, jour)}</section>
    `,
    actions: `
      <a class="bouton bouton-secondaire bouton-retour" href="#/seance">‹ Séances</a>
      <button class="bouton" type="button" data-action="terminer-seance" data-bloc="${echapper(bloc.id)}" data-semaine="${echapper(semaine.id)}" data-jour="${echapper(jour.id)}">Terminer</button>
    `,
  };
}

/** Point d'entrée de l'onglet : liste ou saisie selon l'adresse. */
async function afficherSeance(parametres) {
  return parametres.length >= 3 ? ecranSaisie(parametres) : ecranListe();
}

/* ==========================================================================
   5. Mise à jour de l'écran sans tout redessiner
   (pour ne pas fermer le clavier pendant la saisie)
   ========================================================================== */

function actualiserLigne(idExercice, index, serie, prescription, source = null) {
  const ligne = document.getElementById(idLigne(idExercice, index));
  if (!ligne) return;

  // Valeurs affichées (sauf dans un autre champ en cours de saisie)
  for (const champ of ['charge', 'repetitions', 'rpe', 'vitesse']) {
    const saisie = ligne.querySelector(`input[data-champ="${champ}"]`);
    if (saisie && (saisie === source || saisie !== document.activeElement)) {
      saisie.value = formaterNombre(serie[champ]);
    }
  }

  // Alertes
  const alertes = alertesSerie(serie, prescription);
  ligne.querySelector('input[data-champ="charge"]')?.classList.toggle('en-alerte', alertes.some((m) => m.startsWith('Charge')));
  ligne.querySelector('input[data-champ="rpe"]')?.classList.toggle('en-alerte', alertes.some((m) => m.startsWith('RPE')));
  const zone = ligne.querySelector('.serie-alerte');
  zone.hidden = alertes.length === 0;
  zone.textContent = alertes.length > 0 ? `⚠︎ ${alertes.join(' · ')}` : '';

  // Série faite ou non
  ligne.classList.toggle('faite', serie.faite);
  const bascule = ligne.querySelector('.bascule-faite');
  bascule.setAttribute('aria-pressed', String(serie.faite));
  bascule.textContent = serie.faite ? '✓ Faite' : 'À faire';
}

/** Contenu de la carte « e1RM de la séance ». */
function contenuE1rm(semaine, jour) {
  const resultat = calculerE1rm(seriesDuJour(semaine, jour), { nonFaitesEnAttente: true });
  return `
    <h2>e1RM de la séance</h2>
    ${htmlResultats(resultat, { avecJour: false })}
    <p class="texte-secondaire">Moyenne des séries valides, par mouvement de référence (variantes comprises).</p>
  `;
}

function actualiserE1rm(semaine, jour) {
  const carte = document.getElementById('e1rm-seance');
  if (carte) carte.innerHTML = contenuE1rm(semaine, jour);
}

function actualiserProgression(jour) {
  const zone = document.getElementById('progression-seance');
  if (!zone) return;
  const { faites, total } = avancement(jour);
  zone.textContent = `${faites}/${total} séries faites`;
}

/* ==========================================================================
   6. Enregistrement des saisies
   ========================================================================== */

/** Enregistre une valeur d'une série, puis met l'écran à jour. */
async function enregistrerValeur(element, champ, valeur) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice } = element.dataset;
  const index = Number(element.dataset.serie);

  const resultat = await modifierBloc(idBloc, (bloc) => {
    const { semaine, jour, exercice } = trouver(bloc, idSemaine, idJour, idExercice);
    const serie = exercice.series[index];
    if (!serie) throw new Error('Cette série n’existe plus.');
    const ancienne = serie[champ];
    serie[champ] = valeur;

    // Une charge saisie est proposée dans les séries suivantes pas encore faites,
    // si elles sont vides ou avaient la même charge (corriger la série 1 corrige
    // donc aussi les suivantes).
    const recopiees = [];
    if (champ === 'charge' && valeur !== null) {
      for (let i = index + 1; i < exercice.series.length; i += 1) {
        const suivante = exercice.series[i];
        if (!suivante.faite && (suivante.charge === null || suivante.charge === ancienne)) {
          suivante.charge = valeur;
          recopiees.push(i);
        }
      }
    }
    return { semaine, jour, exercice, recopiees };
  });

  const { semaine, jour, exercice, recopiees } = resultat;
  actualiserLigne(idExercice, index, exercice.series[index], exercice.prescription, element);
  for (const i of recopiees) {
    actualiserLigne(idExercice, i, exercice.series[i], exercice.prescription);
  }
  actualiserProgression(jour);
  actualiserE1rm(semaine, jour);
}

/** Quand on quitte un champ modifié (charge, répétitions, RPE, vitesse). */
async function saisirSerie(saisie) {
  const champ = saisie.dataset.champ;
  const valeur = LECTURE[champ](saisie.value);
  await enregistrerValeur(saisie, champ, valeur);
}

/** Boutons − et + : la première pression donne la valeur prévue (ex. RPE cible). */
async function pasSerie(bouton) {
  const champ = bouton.dataset.champ;
  const regle = PAS[champ];
  const saisie = document.getElementById(bouton.dataset.saisie);
  const actuelle = LECTURE[champ](saisie.value);
  const depart = lireNombre(bouton.dataset.depart) ?? regle.min;
  const brute = actuelle === null ? depart : actuelle + Number(bouton.dataset.sens) * regle.pas;
  const valeur = Math.min(regle.max, Math.max(regle.min, brute));
  saisie.value = formaterNombre(valeur);
  await enregistrerValeur(saisie, champ, valeur);
}

/** Case « Faite » : coche ou décoche la série. */
async function basculerFaite(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice } = bouton.dataset;
  const index = Number(bouton.dataset.serie);

  const { semaine, jour, exercice } = await modifierBloc(idBloc, (bloc) => {
    const trouve = trouver(bloc, idSemaine, idJour, idExercice);
    const serie = trouve.exercice.series[index];
    if (!serie) throw new Error('Cette série n’existe plus.');
    serie.faite = !serie.faite;
    // Première série cochée : la séance est datée d'aujourd'hui.
    if (serie.faite && !trouve.jour.dateRealisee) trouve.jour.dateRealisee = aujourdhui();
    return trouve;
  });

  const serie = exercice.series[index];
  actualiserLigne(idExercice, index, serie, exercice.prescription);
  actualiserProgression(jour);
  actualiserE1rm(semaine, jour);
  if (serie.faite && serie.charge === null) afficherMessage('Série faite — pensez à noter la charge');
}

async function ajouterSerie(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice } = bouton.dataset;
  const index = await modifierBloc(idBloc, (bloc) => {
    const { exercice } = trouver(bloc, idSemaine, idJour, idExercice);
    const nouvelle = nouvelleSerie(exercice.prescription.repetitions);
    nouvelle.charge = exercice.series.at(-1)?.charge ?? null;   // reprend la dernière charge
    exercice.series.push(nouvelle);
    return exercice.series.length - 1;
  });
  signalerChangement(idLigne(idExercice, index));
}

async function retirerSerie(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice } = bouton.dataset;
  const bloc = await lireBloc(idBloc);
  const { exercice } = trouver(bloc, idSemaine, idJour, idExercice);
  const derniere = exercice.series.at(-1);
  if (!derniere) return;
  const remplie = derniere.faite || derniere.charge !== null || derniere.rpe !== null || derniere.vitesse !== null;
  if (remplie && !window.confirm(`Retirer la série ${exercice.series.length} de « ${exercice.nom} » et ses valeurs ?`)) return;

  await modifierBloc(idBloc, (b) => {
    trouver(b, idSemaine, idJour, idExercice).exercice.series.pop();
  });
  signalerChangement(`exercice-${idExercice}`);
}

async function terminerSeance(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour } = bouton.dataset;
  const bloc = await lireBloc(idBloc);
  const { faites, total } = avancement(trouver(bloc, idSemaine, idJour).jour);
  if (faites < total && !window.confirm(`${total - faites} série(s) ne sont pas cochées « Faite ». Terminer quand même ?`)) return;

  await modifierBloc(idBloc, (b) => {
    const { jour } = trouver(b, idSemaine, idJour);
    if (!jour.dateRealisee) jour.dateRealisee = aujourdhui();
  });
  afficherMessage(`Séance terminée : ${faites}/${total} séries faites`);
  location.hash = '#/seance';
}

async function choisirBloc(liste) {
  await ecrireReglage('blocSeance', liste.value);
  signalerChangement();
}

/* ==========================================================================
   7. Ce que app.js utilise
   ========================================================================== */

export const ecransSeance = {
  seance: { onglet: 'seance', afficher: afficherSeance },
};

export const boutonsSeance = {
  'pas-serie': pasSerie,
  'basculer-faite': basculerFaite,
  'ajouter-serie': ajouterSerie,
  'retirer-serie': retirerSerie,
  'terminer-seance': terminerSeance,
};

export const changementsSeance = {
  'saisir-serie': saisirSerie,
  'choisir-bloc-seance': choisirBloc,
};