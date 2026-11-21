// FA 4 IT — js/ui.js
// Petites fonctions réutilisées par tous les écrans : affichage, nombres, dates.
// « export » rend une fonction utilisable depuis un autre fichier.

/**
 * Rend un texte inoffensif avant de l'insérer dans du HTML.
 * Exemple : un exercice nommé « Squat <pause> » s'afficherait mal sans
 * cette précaution, car < et > ont un sens spécial en HTML.
 */
export function echapper(texte) {
  return String(texte ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

let minuteurMessage = null;

/**
 * Affiche un court message en haut de l'écran (ex. « Enregistré »),
 * qui disparaît tout seul au bout de 2,5 secondes.
 */
export function afficherMessage(texte) {
  const zone = document.getElementById('message');
  zone.textContent = texte;
  zone.classList.add('visible');
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => zone.classList.remove('visible'), 2500);
}

/**
 * Construit une carte « vide » (un titre et une explication),
 * utilisée quand un écran n'a encore rien à montrer.
 */
export function carteVide(titre, explication) {
  return `
    <section class="carte vide">
      <h2>${echapper(titre)}</h2>
      <p class="texte-secondaire">${echapper(explication)}</p>
    </section>
  `;
}

/**
 * Carte rose affichée à la place d'un écran quand quelque chose a échoué.
 */
export function carteErreur(erreur) {
  return `
    <section class="alerte" role="alert">
      <strong>Un problème est survenu.</strong><br>
      ${echapper(erreur?.message ?? erreur)}
    </section>
  `;
}

/**
 * Accorde un mot avec un nombre.
 * pluriel(1, 'bloc') → « 1 bloc » ; pluriel(3, 'série faite', 'séries faites') → « 3 séries faites ».
 */
export function pluriel(nombre, mot, motAuPluriel = `${mot}s`) {
  return `${nombre} ${Math.abs(nombre) >= 2 ? motAuPluriel : mot}`;
}

/** Met une majuscule à la première lettre : « accumulation » → « Accumulation ». */
export function majusculeInitiale(texte) {
  const propre = String(texte ?? '');
  return propre.charAt(0).toUpperCase() + propre.slice(1);
}

/* --------------------------------------------------------------------------
   Nombres
   -------------------------------------------------------------------------- */

/** 102.5 → « 102,5 » ; une valeur vide donne un texte vide. */
export function formaterNombre(nombre) {
  if (nombre === null || nombre === undefined || Number.isNaN(nombre)) return '';
  return String(nombre).replace('.', ',');
}

/** Arrondit au 0,5 le plus proche : 7,3 → 7,5 ; 102,2 → 102. */
export function arrondirAuDemi(nombre) {
  return Math.round(nombre * 2) / 2;
}

/* --------------------------------------------------------------------------
   Dates et tailles
   -------------------------------------------------------------------------- */

/** « 2026-10-26 » → « 26/10/2026 ». */
export function formaterDate(dateIso) {
  if (!dateIso) return '—';
  const [annee, mois, jour] = dateIso.slice(0, 10).split('-');
  return `${jour}/${mois}/${annee}`;
}

/** Instant enregistré par l'app → « 21/11/2026 à 00:45 » (heure de l'appareil). */
export function formaterDateHeure(instantIso) {
  if (!instantIso) return '—';
  const instant = new Date(instantIso);
  const date = instant.toLocaleDateString('fr-FR');
  const heure = instant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${heure}`;
}

/** 52 345 octets → « 51 Ko ». */
export function formaterTaille(octets) {
  if (octets === null || octets === undefined) return 'inconnu';
  if (octets < 1024) return `${octets} octets`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}