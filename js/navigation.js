// FA 4 IT — js/navigation.js (v19)
// Les déplacements d'un écran à l'autre :
// 1. la « pile » des écrans visités, comme un paquet de cartes : chaque nouvel écran
//    se pose sur le dessus ; revenir en arrière retire la carte du dessus ;
// 2. les transitions (View Transitions de Safari) : glisser, fondu, tuile qui s'agrandit ;
// 3. le bouton ‹ du bas, qui ramène à l'écran d'où l'on vient et porte son nom ;
// 4. le geste de retour : glisser le doigt depuis le bord gauche de l'écran.
// Rien n'est animé si l'iPhone a le réglage « Réduire les animations ».

const racine = document.documentElement;
const CLE_PILE = 'fa4it-pile';   // la pile est gardée le temps que l'app reste ouverte
const DUREE_GLISSE = 300;         // en millisecondes : la même que --duree-glisse dans styles.css
const BORD = 24;                  // largeur (px) de la bande du bord gauche où le geste commence

/* ==========================================================================
   1. La pile des écrans
   Chaque étape de l'historique porte son numéro (history.state.n).
   pile[n] = { h: adresse, titre, defilement, ouverts, viaTuile }
   ========================================================================== */

let pile = [];
let courant = 0;   // numéro de l'écran affiché

function lirePile() {
  try {
    const p = JSON.parse(sessionStorage.getItem(CLE_PILE) ?? '[]');
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function ecrirePile() {
  try {
    sessionStorage.setItem(CLE_PILE, JSON.stringify(pile));
  } catch {
    /* stockage indisponible : la pile reste en mémoire, c'est suffisant */
  }
}

/** Au lancement : on numérote l'étape en cours (0 pour une app qui démarre). */
export function demarrerPile() {
  try { history.scrollRestoration = 'manual'; } catch { /* sans importance */ }
  const n = history.state?.n;
  if (Number.isInteger(n)) {
    courant = n;
    pile = lirePile();
  } else {
    courant = 0;
    pile = [];
    history.replaceState({ n: 0 }, '');
  }
  pile[courant] = { ...(pile[courant] ?? {}), h: location.hash };
  ecrirePile();
}

/** Garde la position de l'écran que l'on quitte (défilement et parties ouvertes). */
function sauverPosition(n) {
  if (!pile[n]) return;
  pile[n].defilement = window.scrollY;
  pile[n].ouverts = [...document.querySelectorAll('#ecran details')].map((d) => d.open);
}

/** Remet l'écran comme on l'avait laissé. */
function restaurerPosition(entree) {
  const details = [...document.querySelectorAll('#ecran details')];
  if (entree?.ouverts?.length === details.length) {
    details.forEach((d, i) => { d.open = entree.ouverts[i]; });
  }
  window.scrollTo(0, entree?.defilement ?? 0);
}

/** Le titre de l'écran affiché (pour le bouton ‹ de l'écran suivant). */
export function noterTitre(titre) {
  if (!pile[courant]) return;
  pile[courant].titre = titre;
  ecrirePile();
}

/* --------------------------------------------------------------------------
   Ce que l'on vient de toucher (menu, tuile, ⌂) : noté au moment du toucher,
   lu quand l'adresse change, pour choisir la bonne transition.
   -------------------------------------------------------------------------- */

let indice = null;
let animeParSafari = false;      // Safari a déjà animé le retour (geste du navigateur)
let etapeDejaAffichee = null;     // le geste de retour a déjà affiché cet écran

function noterIndice(nouvelIndice) {
  indice = { ...nouvelIndice, moment: performance.now() };
}

function lireIndice() {
  const i = indice;
  indice = null;
  return i && performance.now() - i.moment < 1500 ? i : null;
}

const estAccueil = (h) => ['', '#', '#/', '#/accueil'].includes(h);

/**
 * Appelée à chaque changement d'adresse : met la pile à jour et dit comment animer.
 * Renvoie null quand l'écran est déjà affiché (fin d'un geste de retour).
 */
export function noterChangementAdresse() {
  const n = history.state?.n;
  if (etapeDejaAffichee !== null && n === etapeDejaAffichee) {
    courant = n;
    etapeDejaAffichee = null;
    ecrirePile();
    return null;
  }
  const quitte = courant;
  const ecranQuitte = pile[quitte];
  sauverPosition(quitte);
  const touche = lireIndice();
  let type;
  let restaurer = false;

  if (!Number.isInteger(n)) {
    // Nouvelle étape (lien, bouton) : elle se pose sur le dessus de la pile
    courant = quitte + 1;
    history.replaceState({ n: courant }, '');
    pile.length = courant;
    pile[courant] = { h: location.hash, viaTuile: touche?.type === 'tuile' ? touche.href : null };
    type = { fondu: 'fondu', tuile: 'tuile', accueil: 'arriere', retour: 'arriere' }[touche?.type] ?? 'avant';
  } else {
    // Retour (ou avance) dans l'historique : on retrouve l'écran tel qu'on l'avait laissé
    courant = n;
    pile[courant] = { ...(pile[courant] ?? {}), h: location.hash };
    restaurer = true;
    if (n < quitte) {
      type = n === quitte - 1 && ecranQuitte?.viaTuile && estAccueil(location.hash) ? 'tuile-retour' : 'arriere';
    } else {
      type = 'avant';
    }
  }
  ecrirePile();
  const sansAnimationIci = animeParSafari;
  animeParSafari = false;
  return {
    type: sansAnimationIci ? null : type,
    tuile: touche?.type === 'tuile' ? touche.element : null,
    viaTuile: ecranQuitte?.viaTuile ?? null,
    restaurer,
  };
}

let ligneAMontrer = null;   // une série à remettre à l'écran après le retour (‹ Séance)

/** Remet l'écran affiché dans la position gardée (après un retour). */
export function restaurerPositionCourante() {
  restaurerPosition(pile[courant]);
  const ligne = ligneAMontrer && document.getElementById(ligneAMontrer);
  ligneAMontrer = null;
  if (ligne) {
    const repli = ligne.closest('details');
    if (repli && !repli.open) repli.open = true;   // ex. échauffement replié
    ligne.scrollIntoView({ block: 'center' });
  }
}

/**
 * Pour le code des écrans : aller à une adresse. Si c'est l'écran d'où l'on vient,
 * on y revient (comme ‹), sinon on pose un nouvel écran.
 */
export function allerA(adresse) {
  if (pile[courant - 1]?.h === adresse) {
    window.history.back();
  } else {
    location.hash = adresse;
  }
}

/** Change l'adresse de l'écran affiché sans créer d'étape (ex. autre charge dans « Évolution »). */
export function remplacerAdresse(adresse) {
  history.replaceState({ n: courant }, '', adresse);
  if (pile[courant]) pile[courant].h = adresse;
  ecrirePile();
  window.dispatchEvent(new Event('adresse-remplacee'));
}

/* ==========================================================================
   2. Les transitions
   ========================================================================== */

/** Vrai si l'on ne doit rien animer (iPhone réglé sur « Réduire les animations »). */
export function sansAnimation() {
  return typeof document.startViewTransition !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const page = () => document.getElementById('page');

// Pendant l'agrandissement d'une tuile, la page est coupée au bas de l'écran :
// on n'agrandit que ce qui se voit.
function bornerPage(oui) {
  const element = page();
  if (!element) return;
  if (oui) {
    const haut = element.getBoundingClientRect().top;
    element.style.maxHeight = `${Math.max(0, window.innerHeight - haut)}px`;
    element.style.overflow = 'hidden';
    element.style.viewTransitionName = 'tuile';
  } else {
    element.style.maxHeight = '';
    element.style.overflow = '';
    element.style.viewTransitionName = '';
  }
}

/** La couleur de départ (ou d'arrivée) de la tuile : bleue pour Séance, blanche pour les autres. */
function couleurTuile(tuile) {
  racine.style.setProperty('--tuile-couleur', getComputedStyle(tuile).backgroundColor);
}

const trouverTuile = (href) => [...document.querySelectorAll('#ecran .tuile')].find((t) => t.getAttribute('href') === href) ?? null;

let jeton = 0;   // numéro de la transition en cours (une nouvelle remplace l'ancienne)

/**
 * Change d'écran : « appliquer » remplace le contenu. Avec une transition, Safari
 * photographie l'écran d'avant, appelle « appliquer », puis anime de l'un à l'autre.
 * Types : avant, arriere, fondu, tuile, tuile-retour (null = sans animation).
 */
export async function jouerTransition(type, appliquer, { tuile = null, viaTuile = null } = {}) {
  if (!type || sansAnimation()) {
    appliquer();
    return;
  }
  if (type === 'tuile' && !tuile) type = 'avant';
  const mon = ++jeton;
  racine.dataset.transition = type;
  if (tuile) {
    tuile.style.viewTransitionName = 'tuile';
    couleurTuile(tuile);
  }
  if (type === 'tuile-retour') bornerPage(true);
  let tuileArrivee = null;

  const transition = document.startViewTransition(() => {
    if (tuile) tuile.style.viewTransitionName = '';
    if (type === 'tuile-retour') bornerPage(false);
    appliquer();
    if (type === 'tuile') bornerPage(true);
    if (type === 'tuile-retour') {
      tuileArrivee = trouverTuile(viaTuile);
      if (tuileArrivee) {
        tuileArrivee.style.viewTransitionName = 'tuile';
        couleurTuile(tuileArrivee);
      }
    }
  });
  try {
    await transition.finished;
  } catch {
    /* transition interrompue par une autre : rien à faire */
  } finally {
    if (tuileArrivee) tuileArrivee.style.viewTransitionName = '';
    if (mon === jeton) {
      bornerPage(false);
      delete racine.dataset.transition;
    }
  }
}

/* ==========================================================================
   3. Le bouton ‹ du bas
   ========================================================================== */

const nomCourt = (titre) => (titre && titre.length <= 12 ? titre : 'Retour');

/**
 * S'il y a un écran d'avant, le bouton ‹ y ramène. S'il va déjà là où le bouton menait
 * (ex. « ‹ Séances » vers la liste), il garde son nom ; sinon il prend le nom de cet écran.
 */
export function preparerBoutonRetour(n = courant) {
  const bouton = document.querySelector('#actions .bouton-retour');
  const precedent = pile[n - 1];
  if (!bouton || !precedent) return;
  const destinationHabituelle = bouton.getAttribute('href') ?? bouton.dataset.adresse ?? null;
  if (precedent.h !== destinationHabituelle) bouton.textContent = `‹ ${nomCourt(precedent.titre)}`;
  bouton.dataset.retourPile = '';
}

/** Le dernier accueil de la pile (pour que ⌂ y revienne au lieu d'empiler). */
function etapeAccueil() {
  for (let i = courant - 1; i >= 0; i -= 1) {
    if (estAccueil(pile[i]?.h)) return i;
  }
  return null;
}

// Écouté « en premier » (phase de capture), avant les actions des boutons de app.js
document.addEventListener('click', (evenement) => {
  const element = evenement.target.closest('a, button');
  if (!element) return;

  if (element.matches('#actions .bouton-retour[data-retour-pile]')) {
    evenement.preventDefault();
    evenement.stopPropagation();
    ligneAMontrer = element.dataset.ligne ?? null;
    window.history.back();
    return;
  }
  if (element.classList.contains('bouton-retour')) noterIndice({ type: 'retour' });
  if (element.id === 'bouton-accueil') {
    noterIndice({ type: 'accueil' });
    const i = etapeAccueil();
    if (i !== null) {
      evenement.preventDefault();
      window.history.go(i - courant);
    }
    return;
  }
  if (element.matches('a[data-remplacer]')) {
    // Un simple choix dans le même écran (ex. série 1 · 2 · 3) : pas de nouvelle étape, pas d'animation
    evenement.preventDefault();
    remplacerAdresse(element.getAttribute('href'));
    return;
  }
  if (element.classList.contains('menu-lien')) {
    if (element.getAttribute('href') !== location.hash) noterIndice({ type: 'fondu' });
    return;
  }
  if (element.classList.contains('tuile')) {
    noterIndice({ type: 'tuile', element, href: element.getAttribute('href') });
  }
}, true);

// Retour fait par Safari lui-même (dans le navigateur, pas dans l'app installée) : déjà animé
window.addEventListener('popstate', (evenement) => {
  animeParSafari = Boolean(evenement.hasUAVisualTransition);
});

/* ==========================================================================
   4. Le geste de retour : glisser depuis le bord gauche
   La page suit le doigt : on lance la transition « arriere » puis on la pilote
   à la main. En lâchant après un tiers de l'écran (ou d'un geste vif), on revient ;
   sinon la page se remet en place.
   ========================================================================== */

let outils = null;      // fourni par app.js : { preparerVue, appliquerVue, gesteAutorise }
let geste = null;       // le geste en cours
let finGeste = Promise.resolve();

/** app.js donne ici de quoi préparer et afficher un écran. */
export function configurerNavigation(outilsApp) {
  outils = outilsApp;
}

/** Pour app.js : attendre la fin d'un geste avant de redessiner l'écran. */
export const attendreFinGeste = () => finGeste;

// L'app installée sur l'écran d'accueil n'a pas de geste « retour » : on le fournit.
// Dans Safari (navigateur), Safari a déjà le sien.
const appInstallee = () => window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches
  || racine.dataset.gesteRetour === 'partout';

function gestePossible() {
  return appInstallee()
    && outils
    && !geste
    && courant > 0
    && pile[courant - 1]
    && document.getElementById('menu')?.hidden !== false
    && !racine.dataset.transition
    && outils.gesteAutorise();
}

document.addEventListener('touchstart', (evenement) => {
  if (evenement.touches.length !== 1) return;
  const doigt = evenement.touches[0];
  if (doigt.clientX > BORD || !gestePossible()) return;
  geste = {
    x0: doigt.clientX, y0: doigt.clientY, dx: 0, actif: false, lache: false,
    points: [{ x: doigt.clientX, t: evenement.timeStamp }],
  };
}, { passive: true });

document.addEventListener('touchmove', (evenement) => {
  if (!geste || geste.lache) return;
  const doigt = evenement.touches[0];
  const dx = doigt.clientX - geste.x0;
  const dy = doigt.clientY - geste.y0;
  if (!geste.actif) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {   // c'est un défilement vertical
      geste = null;
      return;
    }
    if (dx < 10) return;
    geste.actif = true;
    finGeste = demarrerGeste();
  }
  evenement.preventDefault();   // la page ne défile pas pendant le geste
  geste.dx = Math.max(0, dx);
  geste.points.push({ x: doigt.clientX, t: evenement.timeStamp });
  if (geste.points.length > 5) geste.points.shift();
  geste.suivre?.();
}, { passive: false });

function lacher() {
  if (!geste) return;
  if (!geste.actif) {
    geste = null;
    return;
  }
  geste.lache = true;
  geste.relacher?.();
}
document.addEventListener('touchend', lacher);
document.addEventListener('touchcancel', () => {
  if (geste) geste.annule = true;
  lacher();
});

/** Vitesse du doigt à la fin du geste, en pixels par milliseconde. */
function vitesseDoigt() {
  const p = geste.points;
  if (p.length < 2) return 0;
  const premier = p[0];
  const dernier = p[p.length - 1];
  return (dernier.x - premier.x) / Math.max(1, dernier.t - premier.t);
}

const decider = () => !geste.annule && (geste.dx / window.innerWidth > 0.33 || (vitesseDoigt() > 0.35 && geste.dx > 20));

/** Fait avancer des animations jusqu'à « vers » (0 = départ, 1 = arrivée), en douceur. */
function amener(animations, depuis, vers) {
  const duree = Math.max(120, Math.abs(vers - depuis) * DUREE_GLISSE);
  const debut = performance.now();
  return new Promise((fini) => {
    const image = (maintenant) => {
      const t = Math.min(1, (maintenant - debut) / duree);
      const doux = 1 - (1 - t) ** 3;
      placer(animations, depuis + (vers - depuis) * doux);
      if (t < 1) requestAnimationFrame(image);
      else fini();
    };
    requestAnimationFrame(image);
  });
}

function placer(animations, progression) {
  for (const animation of animations) {
    animation.currentTime = progression * animation.effect.getComputedTiming().endTime;
  }
}

async function demarrerGeste() {
  const etape = courant - 1;
  const cible = pile[etape];
  sauverPosition(courant);
  const ecranQuitte = pile[courant];

  // Sans animation : on revient simplement en arrière si le geste est assez long
  if (sansAnimation()) {
    await new Promise((fini) => { geste.relacher = fini; });
    const ok = decider();
    geste = null;
    if (ok) window.history.back();
    return;
  }

  let vue;
  try {
    vue = await outils.preparerVue(cible.h);
  } catch {
    geste = null;
    return;
  }

  // Ce qui est à l'écran est mis de côté (pas redessiné) : si le geste est annulé, on le remet tel quel.
  const mise = {};
  racine.dataset.transition = 'geste';   // comme « arriere », mais sans courbe (styles.css)
  const mon = ++jeton;
  const transition = document.startViewTransition(() => {
    const ecran = document.getElementById('ecran');
    mise.contenu = document.createDocumentFragment();
    mise.contenu.append(...ecran.childNodes);
    mise.titre = document.getElementById('titre').textContent;
    mise.actions = document.getElementById('actions').innerHTML;
    mise.classes = document.body.className;
    mise.titreDocument = document.title;
    mise.hash = location.hash;
    outils.appliquerVue(vue, cible.h);
    preparerBoutonRetour(etape);
    restaurerPosition(cible);
  });

  let animations = [];
  try {
    await transition.ready;
    animations = document.getAnimations().filter((a) => a.effect?.pseudoElement?.startsWith('::view-transition'));
    animations.forEach((animation) => animation.pause());   // c'est le doigt qui les fait avancer
  } catch {
    geste = null;
    if (mon === jeton) delete racine.dataset.transition;
    return;
  }

  const progression = () => Math.min(1, geste.dx / window.innerWidth);
  placer(animations, progression());
  geste.suivre = () => placer(animations, progression());
  if (!geste.lache) await new Promise((fini) => { geste.relacher = fini; });
  geste.suivre = null;

  if (decider()) {
    await amener(animations, progression(), 1);
    animations.forEach((a) => a.finish());
    await transition.finished.catch(() => {});
    geste = null;
    if (mon === jeton) delete racine.dataset.transition;
    // L'écran d'avant est affiché : on recule l'historique sans le redessiner
    etapeDejaAffichee = etape;
    window.history.back();
  } else {
    await amener(animations, progression(), 0);
    // On remet l'écran d'origine, puis on retire la transition (invisible : c'est la même image)
    document.getElementById('ecran').replaceChildren(mise.contenu);
    document.getElementById('titre').textContent = mise.titre;
    document.getElementById('actions').innerHTML = mise.actions;
    document.body.className = mise.classes;
    document.title = mise.titreDocument;
    outils.allumerAdresse(mise.hash);
    preparerBoutonRetour(courant);
    restaurerPosition(ecranQuitte);
    transition.skipTransition();
    await transition.finished.catch(() => {});
    geste = null;
    if (mon === jeton) delete racine.dataset.transition;
  }
}
