// FA 4 IT — js/labo-vbt.js
// Analyser une vidéo de série pour mesurer la vitesse de barre et tracer la trajectoire.
//   #/vbt/<bloc>/<semaine>/<jour>/<exercice>/<liste>/<numéro>
//           « Mesurer en vidéo », ouvert depuis une série (ou le last warm-up) de la
//           séance : après confirmation, la vitesse moyenne remplit la série et le
//           détail de la mesure (reps, trajectoire en chiffres) est gardé avec elle.
// La vidéo reste en mémoire le temps de l'analyse, puis elle est libérée : elle n'est
// jamais enregistrée ni envoyée sur internet.
// v18 : plus d'écran « Labo VBT » d'essai (doublon de la mesure depuis la séance), plus de
// bloc « Diagnostic » ; ce fichier et vbt-analyse.js ne sont chargés qu'à la première mesure.

import {
  estimerDisque, ajusterCadre, suivre, resultats, champAutour, toileDeTravail, tailleDeTraitement, allerA,
} from './vbt-analyse.js';
import { lireBloc, modifierBloc, lireReglage, ecrireReglage } from './db.js';
import { echapper, afficherMessage, pluriel, formaterNombre } from './ui.js';

const DISQUES = [
  { valeur: '0.45', libelle: '45 cm (20-25 kg ou bumper)' },
  { valeur: '0.40', libelle: '40 cm (15 kg calibré)' },
  { valeur: '0.325', libelle: '32,5 cm (10 kg calibré)' },
  { valeur: '0.228', libelle: '22,8 cm (5 kg calibré)' },
];

const MODES = [
  { valeur: 'image', libelle: 'Image par image (le plus sûr)' },
  { valeur: 'lecture', libelle: 'Lecture normale (rapide)' },
  { valeur: 'ralenti', libelle: 'Lecture au ralenti ×0,25' },
];

// Réglages retenus d'une fois sur l'autre (labo et mesure des séries)
const REGLAGES = {
  vbtDisque: { liste: DISQUES, defaut: '0.45' },
  vbtMode: { liste: MODES, defaut: 'image' },
};

// État de l'outil (une seule vidéo à la fois)
const etat = {
  adresse: null,      // adresse temporaire de la vidéo en mémoire (blob)
  taille: null,       // taille de traitement { l, h }
  cale: null,         // cadre du disque { x, y, a, b } : centre, demi-hauteur, demi-largeur (pixels de traitement)
  loupe: null,        // zone agrandie dans la loupe { x0, y0, cote } (pixels de traitement)
  glisse: null,       // côté (ou centre) du cadre en train d'être glissé dans la loupe
  analyse: null,      // résultat de suivre() + resultats()
  enCours: false,
  arreter: false,
  numero: 0,          // change à chaque nouvelle vidéo ou sortie de l'écran : une analyse en cours s'arrête
  cible: null,        // série à remplir (écran de mesure) : { bloc, semaine, jour, exercice, liste, index, repetitions }
};

/* ==========================================================================
   1. Les écrans
   ========================================================================== */

async function lireReglagesVbt() {
  const lus = {};
  for (const [cle, { liste, defaut }] of Object.entries(REGLAGES)) {
    const valeur = await lireReglage(cle, defaut);
    lus[cle] = liste.some((choix) => choix.valeur === valeur) ? valeur : defaut;
  }
  return lus;
}

/** Bouton pour choisir ou filmer la vidéo (avec le champ fichier caché). */
function boutonVideo() {
  return `
    <button class="bouton bouton-large" type="button" data-action="labo-choisir">Choisir ou filmer une vidéo</button>
    <input id="labo-fichier" type="file" accept="video/*" data-changement="labo-video" hidden>
  `;
}

/** Vidéo, réglages, Analyser, puis résultats : commun au labo et à la mesure d'une série. */
function htmlOutil(reglages) {
  const options = (liste, choisie) => liste
    .map((choix) => `<option value="${choix.valeur}"${choix.valeur === choisie ? ' selected' : ''}>${echapper(choix.libelle)}</option>`)
    .join('');
  return `
    <section class="carte" id="labo-zone" hidden>
      <div class="labo-cadre">
        <video id="labo-lecteur" playsinline muted preload="auto"></video>
        <canvas id="labo-dessin" class="labo-dessin"></canvas>
      </div>
      <p id="labo-infos" class="texte-secondaire"></p>

      <div class="groupe">
        <label class="etiquette" for="labo-temps">1. Placez la vidéo juste avant la première rep</label>
        <input id="labo-temps" class="labo-curseur" type="range" min="0" max="1" step="0.01" value="0">
        <span id="labo-temps-texte" class="texte-secondaire">0,00 s</span>
      </div>

      <p class="etiquette">2. Touchez le disque sur l’image</p>

      <div id="labo-reglage" class="groupe" hidden>
        <p class="etiquette">3. Ajustez le cadre au bord du plus grand disque</p>
        <canvas id="labo-loupe" class="labo-loupe"></canvas>
        <p class="texte-secondaire">Faites glisser chaque côté bleu sur le bord de la face du disque (sans son épaisseur, visible si le téléphone est plus bas ou plus haut que la barre) ; glissez au milieu pour déplacer le cadre. Filmé de biais, le disque est un ovale : le cadre est alors plus étroit que haut, c’est normal.</p>
        <div class="rangee">
          <button class="bouton bouton-secondaire bouton-petit" type="button" data-action="labo-ajuster">Ajuster au bord</button>
          <button class="bouton bouton-petit" type="button" data-action="labo-valider">C’est bon</button>
        </div>
      </div>
      <p id="labo-cale" class="texte-secondaire">Touchez d’abord le disque.</p>

      <div class="groupe">
        <label class="etiquette" for="labo-diametre">4. Diamètre de ce disque</label>
        <div class="choix">
          <select id="labo-diametre" class="champ" data-changement="vbt-reglage" data-reglage="vbtDisque">
            ${options(DISQUES, reglages.vbtDisque)}
          </select>
        </div>
      </div>

      <div class="groupe">
        <label class="etiquette" for="labo-mode">Lecture pendant l’analyse</label>
        <div class="choix">
          <select id="labo-mode" class="champ" data-changement="vbt-reglage" data-reglage="vbtMode">
            ${options(MODES, reglages.vbtMode)}
          </select>
        </div>
      </div>

      <button class="bouton bouton-large" type="button" data-action="labo-analyser" id="labo-analyser">Analyser</button>
      <button class="bouton bouton-secondaire bouton-large" type="button" data-action="labo-arreter" id="labo-arreter" hidden>Arrêter</button>
      <p id="labo-etat" class="texte-secondaire" aria-live="polite"></p>
    </section>

    <section class="carte" id="labo-resultats" hidden></section>
  `;
}

/** Retrouve la série visée par l'adresse (ou lance une erreur claire). */
function trouverSerie(bloc, idSemaine, idJour, idExercice, liste, index) {
  const semaine = bloc.semaines.find((s) => s.id === idSemaine);
  const jour = semaine?.jours.find((j) => j.id === idJour);
  const exercice = jour?.exercices.find((e) => e.id === idExercice);
  const lignes = liste === 'echauffement' ? exercice?.echauffement : exercice?.series;
  const serie = lignes?.[index];
  if (!serie) throw new Error('Cette série n’existe plus.');
  return { jour, exercice, lignes, serie };
}

/** « Série 2 », « Last warm-up » ou « Palier 3 ». */
function nomDeLaLigne(liste, index, lignes) {
  if (liste === 'series') return `Série ${index + 1}`;
  return index === lignes.length - 1 ? 'Last warm-up' : `Palier ${index + 1}`;
}

/** Écran « Mesurer en vidéo » d'une série : #/vbt/<bloc>/<semaine>/<jour>/<exercice>/<liste>/<numéro> */
async function ecranMesure([idBloc, idSemaine, idJour, idExercice, liste = 'series', numero = '0']) {
  liberer();
  const bloc = await lireBloc(idBloc);
  if (!bloc) throw new Error('Ce bloc n’existe plus.');
  const index = Number(numero);
  const { jour, exercice, lignes, serie } = trouverSerie(bloc, idSemaine, idJour, idExercice, liste, index);
  const reglages = await lireReglagesVbt();
  etat.cible = { bloc: idBloc, semaine: idSemaine, jour: idJour, exercice: idExercice, liste, index, repetitions: serie.repetitions };

  const nom = nomDeLaLigne(liste, index, lignes);
  const ancienne = serie.vbt
    ? `<p class="texte-secondaire">Déjà mesurée : ${serie.vbt.vitesse !== null ? `${format(serie.vbt.vitesse)} m/s` : '?'} sur ${pluriel(serie.vbt.reps.length, 'rep')}. Une nouvelle mesure remplacera l’ancienne.</p>`
    : '';
  return {
    titre: exercice.nom,
    html: `
      <section class="carte">
        <h2>Mesurer en vidéo · ${echapper(nom)}</h2>
        <p class="texte-secondaire">${echapper(jour.nom)} · ${formaterNombre(serie.charge) || '?'} kg × ${formaterNombre(serie.repetitions) || '?'}</p>
        ${ancienne}
        <p class="texte-secondaire">Téléphone fixe, à 2,5–3 m, face au bout de la barre et à sa hauteur à mi-mouvement (vers les hanches pour le squat), disque entier visible (1080p à 60 i/s conseillé). La vidéo n’est ni gardée ni envoyée : seuls les chiffres le sont, et seulement si vous remplissez la série.</p>
        ${boutonVideo()}
      </section>
      ${htmlOutil(reglages)}
    `,
    actions: actionsMesure(),
  };
}

/** Boutons du bas de l'écran de mesure : retour, et « Remplir » une fois la vitesse connue. */
function actionsMesure(vitesse = null) {
  const retour = '<button class="bouton bouton-secondaire bouton-retour" type="button" data-action="vbt-retour">‹ Séance</button>';
  return vitesse === null ? retour : `${retour}<button class="bouton" type="button" data-action="vbt-remplir">Remplir : ${format(vitesse)} m/s</button>`;
}

/** Met à jour les boutons du bas (écran de mesure seulement). */
function majActions(vitesse = null) {
  const zone = document.getElementById('actions');
  if (etat.cible && zone) zone.innerHTML = actionsMesure(vitesse);
}

// En quittant ces écrans, on libère la vidéo de la mémoire (une analyse en cours s'arrête)
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/vbt/')) liberer();
});

/** Oublie la vidéo en cours (mémoire) et arrête une analyse en cours ; garde la série visée. */
function oublierVideo() {
  etat.numero += 1;
  etat.arreter = true;
  if (etat.adresse) URL.revokeObjectURL(etat.adresse);
  Object.assign(etat, { adresse: null, taille: null, cale: null, loupe: null, glisse: null, analyse: null, enCours: false });
  const reglage = document.getElementById('labo-reglage');
  if (reglage) reglage.hidden = true;
}

/** Comme oublierVideo, et oublie aussi la série visée (sortie de l'écran). */
function liberer() {
  oublierVideo();
  etat.cible = null;
}

/** Réglage (disque, mode) changé : retenu pour la prochaine fois. */
async function enregistrerReglageVbt(champ) {
  const cle = champ.dataset.reglage;
  if (Object.hasOwn(REGLAGES, cle)) await ecrireReglage(cle, champ.value);
}

const $ = (id) => document.getElementById(id);

function format(nombre, decimales = 2) {
  return nombre.toFixed(decimales).replace('.', ',');
}

/* ==========================================================================
   2. Charger la vidéo
   ========================================================================== */

function choisirVideo() {
  $('labo-fichier')?.click();
}

async function chargerVideo(champ) {
  const fichier = champ.files?.[0];
  champ.value = '';   // pour pouvoir rechoisir la même vidéo
  if (!fichier) return;
  oublierVideo();   // arrête aussi une analyse en cours sur la vidéo précédente
  $('labo-analyser').hidden = false;
  $('labo-arreter').hidden = true;
  majActions();
  const video = $('labo-lecteur');
  etat.adresse = URL.createObjectURL(fichier);
  video.src = etat.adresse;
  $('labo-zone').hidden = false;
  $('labo-resultats').hidden = true;
  $('labo-etat').textContent = 'Chargement de la vidéo…';

  await new Promise((resoudre, rejeter) => {
    video.addEventListener('loadedmetadata', resoudre, { once: true });
    video.addEventListener('error', () => rejeter(new Error('Cette vidéo ne peut pas être lue sur cet appareil.')), { once: true });
    video.load();
  });
  // Sur iPhone, une vidéo n'affiche ses images qu'après avoir été lancée une fois
  try {
    await video.play();
    video.pause();
  } catch {
    // sans conséquence : on essaie quand même d'afficher la première image
  }
  etat.taille = tailleDeTraitement(video);
  // La vidéo est réduite pour tenir à l'écran avec les réglages (voir labo.css)
  video.closest('.labo-cadre')?.style.setProperty('--ratio', String(video.videoWidth / video.videoHeight));
  const dessin = $('labo-dessin');
  dessin.width = etat.taille.l;
  dessin.height = etat.taille.h;

  const curseur = $('labo-temps');
  curseur.max = String(Math.max(0, video.duration - 0.1).toFixed(2));
  curseur.value = '0';
  await allerA(video, 0.05);
  $('labo-temps-texte').textContent = `${format(video.currentTime)} s`;

  $('labo-infos').textContent = `${video.videoWidth} × ${video.videoHeight} px · ${format(video.duration, 1)} s · ${Math.round(fichier.size / 1048576)} Mo`;
  $('labo-cale').textContent = 'Touchez d’abord le disque.';
  $('labo-etat').textContent = 'Placez la vidéo, puis touchez le disque.';
  brancher();
  dessiner();
}

/* ==========================================================================
   3. Caler le disque : toucher, puis cadre à 4 côtés dans la loupe
   Ces réglages réagissent en continu : on les écoute directement.
   ========================================================================== */

function brancher() {
  const video = $('labo-lecteur');
  const dessin = $('labo-dessin');
  const curseur = $('labo-temps');
  const loupe = $('labo-loupe');

  curseur.oninput = async () => {
    if (etat.enCours) return;
    etat.analyse = null;
    await allerA(video, Number(curseur.value));
    $('labo-temps-texte').textContent = `${format(video.currentTime)} s`;
    dessiner();
    dessinerLoupe();
  };
  // Nouvelle image de départ : le cadre déjà réglé est recalé sur le disque à cet instant
  curseur.onchange = () => {
    if (!etat.cale || etat.enCours) return;
    const c = etat.cale;
    etat.cale = cadreDe(ajusterCadre(champAutourDuCadre(c, Math.max(8, 0.3 * c.a)), c, Math.max(8, 0.3 * c.a)));
    decrireCalage('Disque recalé sur cette image');
    recadrerLoupe(false);
    dessiner();
  };

  // « click » et non « pointerdown » : faire défiler la page en touchant l'image ne place rien
  dessin.onclick = (evenement) => {
    if (etat.enCours) return;
    const zone = dessin.getBoundingClientRect();
    const x = ((evenement.clientX - zone.left) / zone.width) * dessin.width;
    const y = ((evenement.clientY - zone.top) / zone.height) * dessin.height;
    toucherDisque(x, y).catch((erreur) => afficherMessage(erreur.message));
  };

  // Loupe : on attrape le côté le plus proche (ou le centre) et on le fait glisser
  loupe.onpointerdown = (evenement) => {
    if (etat.enCours || !etat.cale || !etat.loupe) return;
    const p = pointDansLaLoupe(evenement);
    const tolerance = (26 * etat.loupe.cote) / loupe.clientWidth;   // 26 points d'écran autour du côté
    const { x, y, a, b } = etat.cale;
    const cotes = [
      ['haut', Math.abs(p.y - (y - a))],
      ['bas', Math.abs(p.y - (y + a))],
      ['gauche', Math.abs(p.x - (x - b))],
      ['droite', Math.abs(p.x - (x + b))],
    ].sort((u, v) => u[1] - v[1]);
    let prise = cotes[0][1] <= tolerance ? cotes[0][0] : null;
    if (!prise && Math.abs(p.x - x) <= b && Math.abs(p.y - y) <= a) prise = 'centre';
    if (!prise) return;
    etat.glisse = { prise, depart: p, cadre: { ...etat.cale } };
    loupe.setPointerCapture?.(evenement.pointerId);
    evenement.preventDefault();
  };
  loupe.onpointermove = (evenement) => {
    const g = etat.glisse;
    if (!g) return;
    evenement.preventDefault();
    etat.cale = glisser(g, pointDansLaLoupe(evenement));
    etat.analyse = null;
    dessinerLoupe();
    dessiner();
    decrireCalage('Cadre réglé à la main');
  };
  loupe.onpointerup = () => {
    if (!etat.glisse) return;
    etat.glisse = null;
    recadrerLoupe(false);
  };
  loupe.onpointercancel = loupe.onpointerup;
}

/** Nouveau cadre pendant qu'on fait glisser un côté (le côté opposé ne bouge pas) ou le centre. */
function glisser(g, p) {
  const c = { ...g.cadre };
  const mini = 4;   // demi-taille minimale (pixels de traitement)
  if (g.prise === 'centre') {
    c.x += p.x - g.depart.x;
    c.y += p.y - g.depart.y;
  } else if (g.prise === 'haut' || g.prise === 'bas') {
    const haut = g.prise === 'haut' ? Math.min(p.y, c.y + c.a - 2 * mini) : c.y - c.a;
    const bas = g.prise === 'bas' ? Math.max(p.y, c.y - c.a + 2 * mini) : c.y + c.a;
    c.a = (bas - haut) / 2;
    c.y = (bas + haut) / 2;
  } else {
    const gauche = g.prise === 'gauche' ? Math.min(p.x, c.x + c.b - 2 * mini) : c.x - c.b;
    const droite = g.prise === 'droite' ? Math.max(p.x, c.x - c.b + 2 * mini) : c.x + c.b;
    c.b = (droite - gauche) / 2;
    c.x = (droite + gauche) / 2;
  }
  return c;
}

/** Position du doigt dans la loupe, en pixels de traitement. */
function pointDansLaLoupe(evenement) {
  const zone = $('labo-loupe').getBoundingClientRect();
  const { x0, y0, cote } = etat.loupe;
  return {
    x: x0 + ((evenement.clientX - zone.left) / zone.width) * cote,
    y: y0 + ((evenement.clientY - zone.top) / zone.height) * cote,
  };
}

/** Garde seulement le cadre (centre, demi-hauteur, demi-largeur). */
function cadreDe(ellipse) {
  return { x: ellipse.x, y: ellipse.y, a: ellipse.a, b: ellipse.b };
}

/** Champ de gradients de l'image affichée, autour du cadre (avec une marge de « rayon »). */
function champAutourDuCadre(c, rayon) {
  const video = $('labo-lecteur');
  const demi = Math.max(c.a, c.b) * 1.12 + rayon + 8;
  return champAutour(toileDeTravail(video), video, c.x, c.y, demi, demi);
}

/** Toucher du disque sur la vidéo : premier calage automatique, puis la loupe s'ouvre. */
async function toucherDisque(x, y) {
  const video = $('labo-lecteur');
  $('labo-cale').textContent = 'Recherche du disque…';
  await new Promise((resoudre) => requestAnimationFrame(() => setTimeout(resoudre, 0)));   // le message s'affiche d'abord
  const travail = toileDeTravail(video);
  const petit = Math.min(travail.l, travail.h);
  const champ = champAutour(travail, video, x, y, 0.9 * petit, 0.9 * petit);
  etat.cale = cadreDe(estimerDisque(champ, x, y, petit));
  etat.analyse = null;
  $('labo-resultats').hidden = true;
  majActions();
  decrireCalage('Cadre proposé');
  dessiner();
  $('labo-reglage').hidden = false;
  recadrerLoupe(true);
  $('labo-reglage').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Cadre la loupe sur le disque (zone de 2,6 fois sa taille). Sans « forcer », on ne
 * recadre que si le cadre sort presque de la loupe ou y devient trop petit.
 */
function recadrerLoupe(forcer) {
  if (!etat.cale || $('labo-reglage')?.hidden) return;
  const { x, y, a, b } = etat.cale;
  const taille = Math.max(a, b);
  const z = etat.loupe;
  const sort = z && (x - b < z.x0 + 0.03 * z.cote || x + b > z.x0 + 0.97 * z.cote
    || y - a < z.y0 + 0.03 * z.cote || y + a > z.y0 + 0.97 * z.cote);
  if (forcer || !z || sort || 2 * taille < 0.3 * z.cote) {
    // Au moins 45 % du petit côté de l'image : si la proposition est un anneau intérieur,
    // le vrai bord du disque reste visible dans la loupe pour y amener les côtés.
    const cote = Math.max(0.45 * Math.min(etat.taille.l, etat.taille.h), 2.6 * taille);
    etat.loupe = { x0: x - cote / 2, y0: y - cote / 2, cote };
  }
  dessinerLoupe();
}

/** « Ajuster au bord » : le cadre réglé est calé sur le bord le plus net tout près. */
function ajusterAuBord() {
  if (!etat.cale || etat.enCours) return;
  const c = etat.cale;
  etat.cale = cadreDe(ajusterCadre(champAutourDuCadre(c, 6), c, 6));
  etat.analyse = null;
  decrireCalage('Ajusté au bord le plus net (vérifiez sur la loupe)');
  recadrerLoupe(false);
  dessiner();
}

/** « C'est bon » : la loupe se referme, le disque reste calé. */
function validerCadre() {
  if (!etat.cale) return;
  $('labo-reglage').hidden = true;
  decrireCalage('Disque calé');
  $('labo-analyser')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Angle de prise de vue estimé d'après le cadre : 0° = face au bout de la barre. */
function angleDeVue(cadre) {
  const rapport = cadre.b / cadre.a;
  return rapport >= 0.95 ? 0 : Math.round((Math.acos(Math.min(1, rapport)) * 180) / Math.PI);
}

function decrireCalage(debut) {
  const { a, b } = etat.cale;
  const angle = angleDeVue(etat.cale);
  let vue;
  if (b / a > 1.08) vue = '⚠︎ cadre plus large que haut : vérifiez le bord du disque';
  else if (angle === 0) vue = 'disque vu de face';
  else vue = `disque vu de biais (environ ${angle}°)${angle > 50 ? ' ⚠︎ très de biais : rapprochez-vous de l’axe de la barre' : ''}`;
  $('labo-cale').textContent = `${debut} : ${Math.round(2 * a)} px de haut, ${vue}.`;
}

/** La loupe : la zone du disque agrandie (image de la vidéo en pleine définition), cadre par-dessus. */
function dessinerLoupe() {
  const toile = $('labo-loupe');
  const video = $('labo-lecteur');
  if (!toile || !video || !etat.loupe || !etat.cale || toile.clientWidth === 0) return;
  const L = Math.round(toile.clientWidth * (window.devicePixelRatio || 1));
  if (toile.width !== L) { toile.width = L; toile.height = L; }
  const ctx = toile.getContext('2d');
  ctx.fillStyle = couleur('--texte');
  ctx.fillRect(0, 0, L, L);

  // Image : la zone demandée, limitée aux bords de la vidéo
  const { x0, y0, cote } = etat.loupe;
  const k = video.videoWidth / etat.taille.l;   // pixels de traitement → pixels de la vidéo
  const sx = x0 * k;
  const sy = y0 * k;
  const sc = cote * k;
  const gx = Math.max(0, sx);
  const gy = Math.max(0, sy);
  const dx = Math.min(video.videoWidth, sx + sc);
  const dy = Math.min(video.videoHeight, sy + sc);
  const e = L / sc;
  if (dx > gx && dy > gy) ctx.drawImage(video, gx, gy, dx - gx, dy - gy, (gx - sx) * e, (gy - sy) * e, (dx - gx) * e, (dy - gy) * e);

  // Pour le diagnostic (et les tests) : zone et cadre en pixels de traitement
  toile.dataset.zone = JSON.stringify(etat.loupe);
  toile.dataset.cadre = JSON.stringify(etat.cale);

  // Cadre : ellipse saumon, côtés bleus sur toute la loupe, poignées au milieu des côtés
  const X = (x) => ((x - x0) / cote) * L;
  const Y = (y) => ((y - y0) / cote) * L;
  const { x, y, a, b } = etat.cale;
  const ep = Math.max(2, L / 200);
  ctx.lineWidth = ep;
  ctx.strokeStyle = couleur('--saumon');
  ctx.beginPath();
  ctx.ellipse(X(x), Y(y), (b / cote) * L, (a / cote) * L, 0, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = couleur('--bleu');
  ctx.lineWidth = ep * 0.8;
  ctx.setLineDash([ep * 4, ep * 3]);
  ctx.beginPath();
  for (const u of [X(x - b), X(x + b)]) { ctx.moveTo(u, 0); ctx.lineTo(u, L); }
  for (const v of [Y(y - a), Y(y + a)]) { ctx.moveTo(0, v); ctx.lineTo(L, v); }
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [u, v] of [[X(x), Y(y - a)], [X(x), Y(y + a)], [X(x - b), Y(y)], [X(x + b), Y(y)]]) {
    ctx.beginPath();
    ctx.arc(u, v, ep * 4, 0, 2 * Math.PI);
    ctx.fillStyle = couleur('--bleu');
    ctx.fill();
    ctx.lineWidth = ep;
    ctx.strokeStyle = couleur('--carte');
    ctx.stroke();
  }
  // Centre
  ctx.strokeStyle = couleur('--saumon');
  ctx.lineWidth = ep;
  ctx.beginPath();
  ctx.moveTo(X(x) - ep * 4, Y(y)); ctx.lineTo(X(x) + ep * 4, Y(y));
  ctx.moveTo(X(x), Y(y) - ep * 4); ctx.lineTo(X(x), Y(y) + ep * 4);
  ctx.stroke();
}

/* ==========================================================================
   4. Dessin par-dessus la vidéo
   ========================================================================== */

function couleur(nom) {
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
}

function dessiner(jusquA = null) {
  const dessin = $('labo-dessin');
  if (!dessin) return;
  const ctx = dessin.getContext('2d');
  ctx.clearRect(0, 0, dessin.width, dessin.height);
  const epaisseur = Math.max(2, dessin.width / 120);

  if (etat.cale && !etat.analyse) {
    ctx.lineWidth = epaisseur;
    ctx.strokeStyle = couleur('--saumon');
    ctx.beginPath();
    ctx.ellipse(etat.cale.x, etat.cale.y, etat.cale.b, etat.cale.a, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = couleur('--saumon');
    ctx.beginPath();
    ctx.arc(etat.cale.x, etat.cale.y, epaisseur * 1.5, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Trajectoire : bleu = descente, saumon = montée
  const tr = etat.analyse?.resultat?.trajectoire;
  if (tr) {
    ctx.lineWidth = epaisseur * 1.3;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.t.length; i += 1) {
      if (jusquA !== null && tr.t[i] > jusquA) break;
      ctx.strokeStyle = tr.montee[i] ? couleur('--saumon') : couleur('--bleu');
      ctx.beginPath();
      ctx.moveTo(tr.x[i - 1], tr.y[i - 1]);
      ctx.lineTo(tr.x[i], tr.y[i]);
      ctx.stroke();
    }
  }
}

/* ==========================================================================
   5. Analyser
   ========================================================================== */

async function analyser() {
  if (etat.enCours) return;
  const video = $('labo-lecteur');
  if (!etat.adresse) { afficherMessage('Choisissez d’abord une vidéo'); return; }
  if (!etat.cale) { afficherMessage('Touchez d’abord le disque'); return; }

  const diametre = Number($('labo-diametre').value);
  const mode = $('labo-mode').value;
  const debut = video.currentTime;   // l'image sur laquelle le disque a été calé
  const numero = etat.numero;        // si la vidéo change ou si l'on quitte l'écran, on abandonne
  const abandonnee = () => etat.numero !== numero;
  etat.enCours = true;
  etat.arreter = false;
  etat.analyse = null;
  $('labo-analyser').hidden = true;
  $('labo-arreter').hidden = false;
  $('labo-resultats').hidden = true;
  $('labo-reglage').hidden = true;
  $('labo-etat').textContent = 'Analyse en cours…';
  majActions();

  const depart = { ...etat.cale };
  const dessin = $('labo-dessin');
  const ctx = dessin.getContext('2d');
  try {
    const suivi = await suivre(video, depart, {
      mode,
      debut,
      arret: () => etat.arreter || abandonnee(),
      surImage: ({ x, y, nombre, temps }) => {
        // Suivi en direct : le contour calé suit le disque
        ctx.clearRect(0, 0, dessin.width, dessin.height);
        ctx.lineWidth = Math.max(2, dessin.width / 160);
        ctx.strokeStyle = couleur('--saumon');
        ctx.beginPath();
        ctx.ellipse(x, y, depart.b, depart.a, 0, 0, 2 * Math.PI);
        ctx.stroke();
        if (nombre % 10 === 0) $('labo-etat').textContent = `Analyse en cours… ${format(temps, 1)} s / ${format(video.duration, 1)} s`;
      },
    });
    if (abandonnee()) return;
    video.pause();
    const resultat = resultats(suivi, depart, diametre);
    etat.analyse = { suivi, resultat, diametre, mode, depart };
    $('labo-etat').textContent = etat.arreter ? 'Analyse arrêtée.' : 'Analyse terminée.';
    afficherResultats();
    await allerA(video, debut);
    if (!abandonnee()) dessiner();
  } finally {
    if (!abandonnee()) {
      etat.enCours = false;
      $('labo-analyser').hidden = false;
      $('labo-arreter').hidden = true;
    }
  }
}

function arreter() {
  etat.arreter = true;
}

/* ==========================================================================
   6. Résultats et diagnostic
   ========================================================================== */

/** Moyenne des vitesses moyennes des reps sûres (sans ⚠︎), arrondie au centième, ou null. */
function vitesseDeLaSerie(reps) {
  const fiables = reps.filter((r) => !r.douteuse);
  if (fiables.length === 0) return null;
  return Math.round((fiables.reduce((somme, r) => somme + r.vitesseMoyenne, 0) / fiables.length) * 100) / 100;
}

/** Écran de mesure : avertissement sur le nombre de reps et rappel du bouton « Remplir » (en bas). */
function htmlRemplir(reps, moyenne) {
  const cible = etat.cible;
  if (!cible || reps.length === 0) return '';
  const notees = cible.repetitions;
  const avertissement = notees !== null && notees !== undefined && reps.length !== notees
    ? `<p class="alerte">⚠︎ ${pluriel(reps.length, 'rep trouvée', 'reps trouvées')} pour ${pluriel(notees, 'notée', 'notées')} dans la série. Revoyez la vidéo avant de remplir : les répétitions ne seront pas modifiées.</p>`
    : '';
  const quoi = cible.liste === 'series' ? 'la série' : 'le last warm-up';
  const suite = moyenne !== null
    ? `<p class="texte-secondaire">Pour mettre ${format(moyenne)} m/s dans ${quoi}, touchez « Remplir » en bas de l’écran. Le détail des reps et la trajectoire sont gardés avec, pas la vidéo.</p>`
    : '<p class="alerte">Toutes les reps sont à vérifier (⚠︎) : rien à remplir. Recommencez avec le disque bien visible.</p>';
  return `${avertissement}${suite}`;
}

function afficherResultats() {
  const { resultat } = etat.analyse;
  const reps = resultat.reps;
  const zone = $('labo-resultats');
  const moyenne = vitesseDeLaSerie(reps);
  const avecDouteuses = reps.some((r) => r.douteuse);

  const lignes = reps.map((r, i) => `
    <tr>
      <th scope="row">${i + 1}</th>
      <td><strong>${format(r.vitesseMoyenne)}</strong></td>
      <td>${format(r.vitesseMax)}</td>
      <td>${Math.round(r.amplitude * 100)} cm</td>
      <td>${format(r.duree)} s</td>
      <td>${r.douteuse ? '⚠︎ ' : ''}${Math.round(r.qualite * 100)} %</td>
    </tr>`).join('');

  zone.innerHTML = `
    <h2>Résultats</h2>
    ${reps.length === 0
      ? '<p class="alerte">Aucune rep trouvée. Vérifiez que le disque est bien suivi en revoyant la vidéo, ou placez le départ plus tôt.</p>'
      : `
        <p>Vitesse moyenne de la série : <strong>${moyenne !== null ? `${format(moyenne)} m/s` : '—'}</strong>
          <span class="texte-secondaire">(moyenne des reps${avecDouteuses ? ' sans ⚠︎' : ''} ; c’est la valeur qui ${etat.cible ? 'ira' : 'irait'} dans la série)</span></p>
        <div class="tableau-defilant">
          <table class="table-labo">
            <thead><tr><th scope="col">Rep</th><th scope="col">Moy.</th><th scope="col">Max</th><th scope="col">Ampl.</th><th scope="col">Durée</th><th scope="col">Suivi</th></tr></thead>
            <tbody>${lignes}</tbody>
          </table>
        </div>
        <p class="texte-secondaire">Vitesses en m/s. « Suivi » : netteté du bord du disque pendant la montée, comparée au reste de la vidéo (⚠︎ = à vérifier en revoyant la vidéo).</p>`}
    ${angleDeVue(etat.analyse.depart) > 0 ? `<p class="texte-secondaire">Filmé de biais (environ ${angleDeVue(etat.analyse.depart)}°) : les vitesses restent justes, car c’est la hauteur du disque qui sert d’échelle${etat.cible ? ' ; le mouvement avant-arrière gardé avec la série est redressé' : ''}.</p>` : ''}
    ${resultat.interrompu !== null ? `<p class="texte-secondaire">Suivi arrêté à ${format(resultat.interrompu, 1)} s : le disque a quitté sa zone (barre reposée, sortie de l’image ou disque caché). Ce qui suit n’est pas compté.</p>` : ''}
    <button class="bouton bouton-secondaire bouton-large" type="button" data-action="labo-revoir">Revoir avec la trajectoire</button>
    ${htmlRemplir(reps, moyenne)}
  `;
  zone.hidden = false;
  majActions(reps.length > 0 ? moyenne : null);
}

/**
 * Rejoue la série au ralenti (×0,5) en dessinant la trajectoire au fur et à mesure,
 * puis s'arrête sur la fin de la dernière rep.
 */
async function revoir() {
  if (!etat.analyse || etat.enCours) return;
  const video = $('labo-lecteur');
  const tr = etat.analyse.resultat.trajectoire;
  if (!tr) return;
  const fin = tr.t.at(-1);
  let termine = false;
  const terminer = () => {
    if (termine) return;
    termine = true;
    video.pause();
    video.playbackRate = 1;
    video.removeEventListener('timeupdate', surveiller);
    dessiner();
  };
  // Filet de sécurité si l'iPhone n'appelle pas requestVideoFrameCallback
  const surveiller = () => { if (video.currentTime >= fin) terminer(); };
  const etape = (maintenant, meta) => {
    if (termine) return;
    if (meta.mediaTime >= fin || video.paused || video.ended) { terminer(); return; }
    dessiner(meta.mediaTime);
    video.requestVideoFrameCallback(etape);
  };
  await allerA(video, tr.t[0]);
  video.playbackRate = 0.5;
  video.addEventListener('timeupdate', surveiller);
  video.addEventListener('ended', terminer, { once: true });
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(etape);
  await video.play();
}

/* ==========================================================================
   7. Remplir la série (écran de mesure seulement)
   ========================================================================== */

/**
 * Ce qui est gardé avec la série : les reps et la trajectoire en chiffres
 * (environ 30 points par seconde, en mm depuis le premier point, y vers le haut).
 */
function construireMesure(resultat, diametre, vitesse, depart) {
  const arrondi = (valeur, decimales) => Math.round(valeur * 10 ** decimales) / 10 ** decimales;
  const tr = resultat.trajectoire;
  // Filmé de biais : le mouvement avant-arrière apparaît écrasé comme la largeur du disque
  // (rapport largeur/hauteur) ; on le redresse. La hauteur, elle, n'est pas touchée.
  const angle = angleDeVue(depart);
  const redressement = angle > 0 ? Math.min(2, depart.a / depart.b) : 1;
  const t0 = tr ? tr.t[0] : 0;
  let trajectoire = null;
  if (tr && tr.t.length > 1) {
    const pas = (tr.t.at(-1) - t0) / (tr.t.length - 1);
    const saut = Math.max(1, Math.round(1 / 30 / pas));
    const mm = (pixels) => Math.round(pixels * resultat.metresParPixel * 1000);
    const x = [];
    const y = [];
    for (let i = 0; i < tr.t.length; i += saut) {
      x.push(Math.round(mm(tr.x[i] - tr.x[0]) * redressement));
      y.push(mm(tr.y[0] - tr.y[i]));   // sur l'image, y descend : on le remet vers le haut
    }
    trajectoire = { pas: arrondi(saut * pas, 4), x, y };
  }
  return {
    date: new Date().toISOString(),
    disque: diametre,
    angle,
    vitesse,
    reps: resultat.reps.map((r) => ({
      vitesse: arrondi(r.vitesseMoyenne, 3),
      max: arrondi(r.vitesseMax, 3),
      amplitude: arrondi(r.amplitude, 3),
      duree: arrondi(r.duree, 2),
      debut: arrondi(r.debut - t0, 2),
      fin: arrondi(r.fin - t0, 2),
      douteuse: r.douteuse,
    })),
    trajectoire,
  };
}

/** « Remplir la série » : vitesse moyenne dans le champ, détail gardé avec la série, retour à la séance. */
async function remplir() {
  const cible = etat.cible;
  if (!cible || !etat.analyse || etat.enCours) return;
  const { resultat, diametre, depart } = etat.analyse;
  const vitesse = vitesseDeLaSerie(resultat.reps);
  if (vitesse === null) return;
  const mesure = construireMesure(resultat, diametre, vitesse, depart);
  await modifierBloc(cible.bloc, (bloc) => {
    const { serie } = trouverSerie(bloc, cible.semaine, cible.jour, cible.exercice, cible.liste, cible.index);
    serie.vitesse = vitesse;
    serie.vbt = mesure;
  });
  afficherMessage(`Vitesse enregistrée : ${format(vitesse)} m/s`);
  await retourSeance();
}

/** Retour à la séance, sur la ligne mesurée. */
async function retourSeance() {
  const cible = etat.cible;
  if (!cible) {
    location.hash = '#/seance';
    return;
  }
  // Même identifiant que la ligne dans seance.js
  const idCible = `${cible.liste === 'series' ? 'serie' : 'echauffement'}-${cible.exercice}-${cible.index}`;
  location.hash = `#/seance/${cible.bloc}/${cible.semaine}/${cible.jour}`;
  // L'écran de séance se dessine juste après : on attend la ligne, puis on l'amène au centre.
  for (let essai = 0; essai < 60; essai += 1) {
    await new Promise((resoudre) => setTimeout(resoudre, 50));
    const ligne = document.getElementById(idCible);
    if (ligne) {
      ligne.closest('details')?.setAttribute('open', '');   // échauffement replié
      ligne.scrollIntoView({ block: 'center' });
      return;
    }
  }
}

/* ==========================================================================
   8. Ce que app.js utilise
   ========================================================================== */

export const ecransLabo = {
  vbt: { onglet: 'seance', afficher: ecranMesure },
};

export const boutonsLabo = {
  'labo-choisir': choisirVideo,
  'labo-analyser': analyser,
  'labo-arreter': arreter,
  'labo-revoir': revoir,
  'labo-ajuster': ajusterAuBord,
  'labo-valider': validerCadre,
  'vbt-remplir': remplir,
  'vbt-retour': retourSeance,
};

export const changementsLabo = {
  'labo-video': chargerVideo,
  'vbt-reglage': enregistrerReglageVbt,
};
