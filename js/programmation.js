// FA 4 IT — js/programmation.js
// Les écrans de saisie de la programmation : liste des blocs, bloc, semaine
// et jour. Chaque modification est enregistrée automatiquement dès que vous
// quittez un champ.
//
// Adresses utilisées :
//   #/programme                       liste des blocs
//   #/bloc/<bloc>                     un bloc et ses semaines
//   #/semaine/<bloc>/<semaine>        une semaine et ses jours
//   #/jour/<bloc>/<semaine>/<jour>    un jour et ses exercices
//
// L'import du programme du coach (CSV) est dans import-coach.js ; son bouton
// est sur l'écran Programme.
// v18 : les blocs viennent du CSV du coach. On ne crée plus de bloc, de semaine ou
// de jour à la main, et on ne duplique ni ne déplace plus rien ; restent les
// modifications de champs, l'ajout et le retrait d'un exercice, la suppression d'un bloc.

import { lireBlocs, lireBloc, modifierBloc, supprimerBloc } from './db.js';
import {
  MOUVEMENTS, OBJECTIFS, compter, lireNombre, devinerMouvement, estFormatCompetition, nouvelExercice,
} from './modele.js';
import { boutonsImportCoach, changementsImportCoach } from './import-coach.js';
import { allerA as allerVers } from './navigation.js';
import {
  echapper, carteVide, afficherMessage, pluriel, formaterDate,
  formaterNombre, arrondirAuDemi, majusculeInitiale,
} from './ui.js';

/* ==========================================================================
   1. Adresses et navigation
   ========================================================================== */

const adresse = {
  programme: () => '#/programme',
  bloc: (idBloc) => `#/bloc/${idBloc}`,
  semaine: (idBloc, idSemaine) => `#/semaine/${idBloc}/${idSemaine}`,
  jour: (idBloc, idSemaine, idJour) => `#/jour/${idBloc}/${idSemaine}/${idJour}`,
};

function allerA(nouvelleAdresse) {
  allerVers(nouvelleAdresse);   // v19 : en arrière si c'est l'écran d'où l'on vient
}

/**
 * Demande à app.js de réafficher l'écran actuel.
 * « cible » : identifiant HTML d'un élément à amener au milieu de l'écran.
 */
function signalerChangement(cible = null) {
  window.dispatchEvent(new CustomEvent('donnees-modifiees', { detail: { cible } }));
}

/* ==========================================================================
   2. Petits outils sur les données
   ========================================================================== */

/** Retrouve une semaine, un jour et un exercice dans un bloc (ou lance une erreur claire). */
function localiser(bloc, idSemaine, idJour, idExercice) {
  const semaine = idSemaine ? bloc.semaines.find((s) => s.id === idSemaine) : null;
  if (idSemaine && !semaine) throw new Error('Cette semaine n’existe plus.');
  const jour = idJour ? semaine.jours.find((j) => j.id === idJour) : null;
  if (idJour && !jour) throw new Error('Ce jour n’existe plus.');
  const exercice = idExercice ? jour.exercices.find((e) => e.id === idExercice) : null;
  if (idExercice && !exercice) throw new Error('Cet exercice n’existe plus.');
  return { semaine, jour, exercice };
}

async function chargerBloc(idBloc) {
  const bloc = await lireBloc(idBloc);
  if (!bloc) throw new Error('Ce bloc n’existe plus.');
  return bloc;
}

/* ==========================================================================
   3. Champs de saisie
   Chaque champ porte des attributs data-… qui disent quoi modifier :
   data-bloc, data-semaine, data-jour, data-exercice (où),
   data-nom (quelle propriété) et data-format (comment lire la valeur).
   ========================================================================== */

let compteurChamps = 0;

/** Transforme { bloc: 'a', jour: 'b' } en « data-bloc="a" data-jour="b" ». */
function attributsCible(ids) {
  return Object.entries(ids)
    .filter(([, valeur]) => valeur)
    .map(([cle, valeur]) => `data-${cle}="${echapper(valeur)}"`)
    .join(' ');
}

/** Comment lire chaque format de champ (la valeur tapée est toujours du texte). */
const FORMATS = {
  texte: (brut) => brut.trim(),
  notes: (brut) => brut.trim(),
  date: (brut) => brut || null,
  choix: (brut) => brut,
  booleen: (brut) => brut === 'oui',
  entier: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.max(1, Math.round(nombre));
  },
  rpe: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.min(10, Math.max(1, arrondirAuDemi(nombre)));
  },
  // Charges : aucun arrondi (0,25 kg et moins possibles), seulement positives.
  charge: (brut) => {
    const nombre = lireNombre(brut);
    return nombre === null ? null : Math.max(0, nombre);
  },
};

// Ces propriétés ne peuvent pas rester vides : on garde alors l'ancienne valeur.
const OBLIGATOIRES = new Set(['nom', 'numero']);

function champ({ ids, nom, etiquette, valeur, format = 'texte', titre = false, indice = '' }) {
  const idHtml = `champ-${++compteurChamps}`;
  const commun = `id="${idHtml}" class="champ" data-changement="modifier" data-nom="${nom}" data-format="${format}"${titre ? ' data-titre="oui"' : ''} ${attributsCible(ids)}`;
  const aide = indice ? ` placeholder="${echapper(indice)}"` : '';
  let saisie;
  if (format === 'notes') {
    saisie = `<textarea ${commun} rows="3"${aide}>${echapper(valeur ?? '')}</textarea>`;
  } else if (format === 'date') {
    saisie = `<input ${commun} type="date" value="${echapper(valeur ?? '')}">`;
  } else if (format === 'entier') {
    saisie = `<input ${commun} type="text" inputmode="numeric" autocomplete="off" value="${formaterNombre(valeur)}"${aide}>`;
  } else if (format === 'rpe' || format === 'charge') {
    saisie = `<input ${commun} type="text" inputmode="decimal" autocomplete="off" value="${formaterNombre(valeur)}"${aide}>`;
  } else {
    saisie = `<input ${commun} type="text" autocomplete="off" value="${echapper(valeur ?? '')}"${aide}>`;
  }
  return `
    <div class="groupe">
      <label class="etiquette" for="${idHtml}">${echapper(etiquette)}</label>
      ${saisie}
    </div>
  `;
}

function choix({ ids, nom, etiquette, valeur, options, format = 'choix' }) {
  const idHtml = `champ-${++compteurChamps}`;
  const liste = options
    .map((option) => `<option value="${echapper(option.valeur)}"${option.valeur === valeur ? ' selected' : ''}>${echapper(option.libelle)}</option>`)
    .join('');
  return `
    <div class="groupe">
      <label class="etiquette" for="${idHtml}">${echapper(etiquette)}</label>
      <div class="choix">
        <select id="${idHtml}" class="champ" data-changement="modifier" data-nom="${nom}" data-format="${format}" ${attributsCible(ids)}>${liste}</select>
      </div>
    </div>
  `;
}

/** Lit ou écrit une propriété, même imbriquée (« prescription.rpeCible »). */
function lireChemin(objet, chemin) {
  return chemin.split('.').reduce((courant, cle) => courant?.[cle], objet);
}

function ecrireChemin(objet, chemin, valeur) {
  const cles = chemin.split('.');
  const derniere = cles.pop();
  const parent = cles.reduce((courant, cle) => courant[cle], objet);
  parent[derniere] = valeur;
}

/** Appelée quand vous quittez un champ modifié : enregistre la nouvelle valeur. */
async function modifierChamp(saisie) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice, nom, format } = saisie.dataset;
  const convertir = FORMATS[format] ?? FORMATS.texte;
  let valeur = convertir(saisie.value);

  await modifierBloc(idBloc, (bloc) => {
    const { semaine, jour, exercice } = localiser(bloc, idSemaine, idJour, idExercice);
    const cible = exercice ?? jour ?? semaine ?? bloc;
    if (OBLIGATOIRES.has(nom) && (valeur === null || valeur === '')) {
      valeur = lireChemin(cible, nom);   // champ vidé : on garde l'ancienne valeur
    }
    ecrireChemin(cible, nom, valeur);
    if (nom === 'numero') {
      bloc.semaines.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
    }
  });

  // On réaffiche la valeur nettoyée (ex. « 7,3 » devient « 7,5 »).
  if (['entier', 'rpe', 'charge'].includes(format)) saisie.value = formaterNombre(valeur);
  if (format === 'texte') saisie.value = valeur;

  // Le grand titre suit le nom (ou le numéro de semaine).
  if (saisie.dataset.titre) {
    document.getElementById('titre').textContent = nom === 'numero' ? `Semaine ${formaterNombre(valeur)}` : valeur;
  }
  afficherMessage('Enregistré ✓');
  // Changer le mouvement fait apparaître (ou disparaître) le choix « Compte dans l'e1RM ».
  if (nom === 'mouvement' && idExercice) signalerChangement(`exercice-${idExercice}`);
}

/* ==========================================================================
   4. Morceaux d'écran
   ========================================================================== */

function filAriane(etapes) {
  const liens = etapes.map((etape) => `<a href="${etape.adresse}">${echapper(etape.libelle)}</a>`);
  return `<nav class="fil" aria-label="Chemin">${liens.join('<span aria-hidden="true">›</span>')}</nav>`;
}

/** Les gros boutons du bas : « Retour » à gauche, l'action principale à droite. */
function boutonsBas(adresseRetour, boutonPrincipal = '') {
  return `
    <a class="bouton bouton-secondaire bouton-retour" href="${adresseRetour}">‹ Retour</a>
    ${boutonPrincipal}
  `;
}

function resumeTotal(total) {
  return `${pluriel(total.jours, 'jour')} · ${pluriel(total.exercices, 'exercice')} · ${pluriel(total.seriesFaites, 'série faite', 'séries faites')}`;
}

function carteBloc(bloc) {
  const total = compter([bloc]);
  return `
    <a class="carte carte-lien" href="${adresse.bloc(bloc.id)}">
      <span class="carte-lien-texte">
        <strong class="carte-titre">${echapper(bloc.nom)}</strong>
        <span class="texte-secondaire">${echapper(majusculeInitiale(bloc.objectif))} · début le ${formaterDate(bloc.dateDebut)}</span>
        <span class="texte-secondaire">${pluriel(total.semaines, 'semaine')} · ${resumeTotal(total)}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

function carteSemaine(bloc, semaine) {
  const total = compter([{ semaines: [semaine] }]);
  const notes = semaine.notes ? `<span class="texte-secondaire">${echapper(semaine.notes)}</span>` : '';
  return `
    <a class="carte carte-lien" href="${adresse.semaine(bloc.id, semaine.id)}">
      <span class="carte-lien-texte">
        <strong class="carte-titre">Semaine ${formaterNombre(semaine.numero)}</strong>
        <span class="texte-secondaire">${resumeTotal(total)}</span>
        ${notes}
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

function carteJour(bloc, semaine, jour) {
  const prevu = jour.datePrevue ? `Prévu le ${formaterDate(jour.datePrevue)}` : 'Pas de date prévue';
  const fait = jour.dateRealisee ? ` · fait le ${formaterDate(jour.dateRealisee)}` : '';
  const noms = jour.exercices.map((exercice) => exercice.nom).join(', ') || 'Aucun exercice';
  return `
    <a class="carte carte-lien" href="${adresse.jour(bloc.id, semaine.id, jour.id)}">
      <span class="carte-lien-texte">
        <strong class="carte-titre">${echapper(jour.nom)}</strong>
        <span class="texte-secondaire">${prevu}${fait}</span>
        <span class="texte-secondaire">${echapper(noms)}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

function carteExercice(idsJour, exercice, position, nombre) {
  const ids = { ...idsJour, exercice: exercice.id };
  const prescription = exercice.prescription;
  const faites = exercice.series.filter((serie) => serie.faite).length;
  const optionsMouvement = Object.entries(MOUVEMENTS).map(([valeur, libelle]) => ({ valeur, libelle }));
  return `
    <section class="carte" id="exercice-${echapper(exercice.id)}">
      <p class="etiquette">Exercice ${position + 1} sur ${nombre}</p>
      ${champ({ ids, nom: 'nom', etiquette: 'Nom', valeur: exercice.nom })}
      ${choix({ ids, nom: 'mouvement', etiquette: 'Mouvement de référence', valeur: exercice.mouvement, options: optionsMouvement })}
      ${exercice.mouvement === 'autre' ? '' : choix({
        ids,
        nom: 'formatCompetition',
        etiquette: 'Compte dans l’e1RM',
        valeur: (exercice.formatCompetition ?? estFormatCompetition(exercice.nom, exercice.mouvement)) ? 'oui' : 'non',
        options: [
          { valeur: 'oui', libelle: 'Oui : format compétition' },
          { valeur: 'non', libelle: 'Non : variante' },
        ],
        format: 'booleen',
      })}
      <div class="grille-2">
        ${champ({ ids, nom: 'prescription.nbSeries', etiquette: 'Séries', valeur: prescription.nbSeries, format: 'entier', indice: 'Ex. 4' })}
        ${champ({ ids, nom: 'prescription.repetitions', etiquette: 'Répétitions', valeur: prescription.repetitions, format: 'entier', indice: 'Ex. 5' })}
        ${champ({ ids, nom: 'prescription.rpeCible', etiquette: 'RPE cible', valeur: prescription.rpeCible, format: 'rpe', indice: 'Ex. 7,5' })}
        ${champ({ ids, nom: 'prescription.chargeMax', etiquette: 'Charge max (kg)', valeur: prescription.chargeMax, format: 'charge', indice: 'Ex. 112,25' })}
      </div>
      ${champ({ ids, nom: 'consignes', etiquette: 'Consignes', valeur: exercice.consignes, format: 'notes', indice: 'Repos, tempo, indications du coach…' })}
      ${faites > 0 ? `<p class="texte-secondaire">${pluriel(faites, 'série réalisée', 'séries réalisées')}</p>` : ''}
      <div class="rangee">
        <button class="bouton bouton-alerte bouton-petit" type="button" data-action="supprimer-exercice" ${attributsCible(ids)}>Supprimer</button>
      </div>
    </section>
  `;
}

/* ==========================================================================
   5. Les écrans
   Chaque écran renvoie { titre, html, actions }.
   ========================================================================== */

/**
 * Carte « Programme du coach » : import d'un onglet du Google Sheets exporté en CSV.
 * Sur l'écran Programme : le bloc est retrouvé (ou créé) d'après le nom du fichier.
 * Sur l'écran d'un bloc importé (bloc fourni) : c'est ce bloc qui est mis à jour.
 */
function carteImportCoach(bloc = null) {
  const texte = bloc
    ? `Le coach a ajouté ou modifié des semaines dans l’onglet « ${echapper(bloc.source)} » ? Importez à nouveau son CSV : ce bloc est mis à jour, les séances déjà commencées ne sont jamais modifiées.`
    : 'Exportez l’onglet du bloc depuis le Google Sheets du coach au format CSV, puis importez le fichier ici. Réimportez-le chaque fois que le coach ajoute une semaine : les séances déjà commencées ne sont jamais modifiées.';
  return `
    <section class="carte">
      <h2>Programme du coach</h2>
      <p class="texte-secondaire">${texte}</p>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="choisir-csv-coach"${bloc ? ` data-bloc="${echapper(bloc.id)}"` : ''}>${bloc ? 'Mettre à jour avec un CSV…' : 'Importer un CSV…'}</button>
      ${bloc ? `<button class="bouton bouton-secondaire bouton-large" type="button" data-action="envoyer-bloc-sheets" data-bloc="${echapper(bloc.id)}">Envoyer les séances faites au Sheets</button>` : ''}
      <input id="fichier-coach" type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" data-changement="importer-csv-coach" hidden>
    </section>
  `;
}

async function ecranProgramme() {
  const blocs = await lireBlocs();
  const liste = blocs.length > 0
    ? blocs.map(carteBloc).join('')
    : carteVide('Aucun bloc pour l’instant', 'Importez le programme du coach avec le bouton ci-dessous.');
  return {
    titre: 'Programme',
    html: liste + carteImportCoach(),
  };
}

async function ecranBloc([idBloc]) {
  const bloc = await chargerBloc(idBloc);
  const ids = { bloc: bloc.id };
  const objectifs = [...new Set([...OBJECTIFS, bloc.objectif])]
    .map((objectif) => ({ valeur: objectif, libelle: majusculeInitiale(objectif) }));
  const semaines = bloc.semaines.length > 0
    ? bloc.semaines.map((semaine) => carteSemaine(bloc, semaine)).join('')
    : carteVide('Aucune semaine', 'Mettez le bloc à jour avec le CSV du coach.');

  return {
    titre: bloc.nom,
    html: `
      ${filAriane([{ libelle: 'Programme', adresse: adresse.programme() }])}
      <section class="carte">
        ${champ({ ids, nom: 'nom', etiquette: 'Nom du bloc', valeur: bloc.nom, titre: true })}
        ${choix({ ids, nom: 'objectif', etiquette: 'Objectif', valeur: bloc.objectif, options: objectifs })}
        ${champ({ ids, nom: 'dateDebut', etiquette: 'Date de début', valeur: bloc.dateDebut, format: 'date' })}
        ${champ({ ids, nom: 'notes', etiquette: 'Notes', valeur: bloc.notes, format: 'notes', indice: 'Objectif de total, contraintes…' })}
      </section>

      <h2 class="titre-section">Semaines</h2>
      ${semaines}

      ${bloc.source ? carteImportCoach(bloc) : ''}

      <div class="zone-danger">
        <button class="bouton bouton-alerte bouton-large" type="button" data-action="supprimer-bloc" ${attributsCible(ids)}>Supprimer ce bloc</button>
      </div>
    `,
    actions: boutonsBas(adresse.programme()),
  };
}

async function ecranSemaine([idBloc, idSemaine]) {
  const bloc = await chargerBloc(idBloc);
  const { semaine } = localiser(bloc, idSemaine);
  const ids = { bloc: bloc.id, semaine: semaine.id };
  const jours = semaine.jours.length > 0
    ? semaine.jours.map((jour) => carteJour(bloc, semaine, jour)).join('')
    : carteVide('Aucun jour', 'Mettez le bloc à jour avec le CSV du coach.');

  return {
    titre: `Semaine ${formaterNombre(semaine.numero)}`,
    html: `
      ${filAriane([
        { libelle: 'Programme', adresse: adresse.programme() },
        { libelle: bloc.nom, adresse: adresse.bloc(bloc.id) },
      ])}
      <section class="carte">
        ${champ({ ids, nom: 'numero', etiquette: 'Numéro de la semaine', valeur: semaine.numero, format: 'entier', titre: true })}
        ${champ({ ids, nom: 'notes', etiquette: 'Notes', valeur: semaine.notes, format: 'notes', indice: 'Ex. semaine de décharge' })}
      </section>

      <h2 class="titre-section">Jours</h2>
      ${jours}
    `,
    actions: boutonsBas(adresse.bloc(bloc.id)),
  };
}

async function ecranJour([idBloc, idSemaine, idJour]) {
  const bloc = await chargerBloc(idBloc);
  const { semaine, jour } = localiser(bloc, idSemaine, idJour);
  const ids = { bloc: bloc.id, semaine: semaine.id, jour: jour.id };
  const nombre = jour.exercices.length;
  const exercices = nombre > 0
    ? jour.exercices.map((exercice, position) => carteExercice(ids, exercice, position, nombre)).join('')
    : carteVide('Aucun exercice', 'Ajoutez un exercice avec le bouton « + Exercice ».');

  return {
    titre: jour.nom,
    html: `
      ${filAriane([
        { libelle: 'Programme', adresse: adresse.programme() },
        { libelle: bloc.nom, adresse: adresse.bloc(bloc.id) },
        { libelle: `Semaine ${formaterNombre(semaine.numero)}`, adresse: adresse.semaine(bloc.id, semaine.id) },
      ])}
      <section class="carte">
        ${champ({ ids, nom: 'nom', etiquette: 'Nom du jour', valeur: jour.nom, titre: true })}
        <div class="grille-2">
          ${champ({ ids, nom: 'datePrevue', etiquette: 'Date prévue', valeur: jour.datePrevue, format: 'date' })}
          ${champ({ ids, nom: 'dateRealisee', etiquette: 'Date réalisée', valeur: jour.dateRealisee, format: 'date' })}
        </div>
      </section>

      <h2 class="titre-section">Exercices</h2>
      ${exercices}
    `,
    actions: boutonsBas(adresse.semaine(bloc.id, semaine.id), `<button class="bouton" type="button" data-action="ajouter-exercice" ${attributsCible(ids)}>+ Exercice</button>`),
  };
}

/* ==========================================================================
   6. Les actions des boutons
   Chaque action reçoit le bouton touché ; ses attributs data-… disent sur quoi agir.
   ========================================================================== */

async function supprimerLeBloc(bouton) {
  const bloc = await chargerBloc(bouton.dataset.bloc);
  const total = compter([bloc]);
  const accord = window.confirm(
    `Supprimer le bloc « ${bloc.nom} » (${pluriel(total.semaines, 'semaine')}, ${pluriel(total.seriesFaites, 'série faite', 'séries faites')}) ?\n\nC’est définitif.`
  );
  if (!accord) return;
  await supprimerBloc(bloc.id);
  afficherMessage('Bloc supprimé');
  allerA(adresse.programme());
}

async function ajouterExercice(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour } = bouton.dataset;
  const nom = window.prompt('Nom de l’exercice (ex. « Squat pause 2 s ») :', '');
  if (nom === null) return;
  const propre = nom.trim() || 'Nouvel exercice';

  const exercice = await modifierBloc(idBloc, (bloc) => {
    const { jour } = localiser(bloc, idSemaine, idJour);
    const nouveau = nouvelExercice(propre, devinerMouvement(propre));
    jour.exercices.push(nouveau);
    return nouveau;
  });
  afficherMessage(`Ajouté (mouvement : ${MOUVEMENTS[exercice.mouvement]})`);
  signalerChangement(`exercice-${exercice.id}`);
}

async function supprimerLExercice(bouton) {
  const { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice } = bouton.dataset;
  const bloc = await chargerBloc(idBloc);
  const { exercice } = localiser(bloc, idSemaine, idJour, idExercice);
  const faites = exercice.series.filter((serie) => serie.faite).length;
  const detail = faites > 0 ? ` et ses ${pluriel(faites, 'série réalisée', 'séries réalisées')}` : '';
  if (!window.confirm(`Supprimer « ${exercice.nom} »${detail} ?`)) return;
  await modifierBloc(idBloc, (b) => {
    const { jour } = localiser(b, idSemaine, idJour);
    jour.exercices = jour.exercices.filter((e) => e.id !== idExercice);
  });
  afficherMessage('Exercice supprimé');
  signalerChangement();
}

/* ==========================================================================
   7. Ce que app.js utilise
   ========================================================================== */

export const ecransProgrammation = {
  programme: { onglet: 'programme', afficher: ecranProgramme },
  bloc: { onglet: 'programme', afficher: ecranBloc },
  semaine: { onglet: 'programme', afficher: ecranSemaine },
  jour: { onglet: 'programme', afficher: ecranJour },
};

export const boutonsProgrammation = {
  'supprimer-bloc': supprimerLeBloc,
  'ajouter-exercice': ajouterExercice,
  'supprimer-exercice': supprimerLExercice,
  ...boutonsImportCoach,   // « Importer un CSV… »
};

export const changementsProgrammation = {
  'modifier': modifierChamp,
  ...changementsImportCoach,   // fichier CSV choisi
};