// FA 4 IT — js/ui.js
// Petites fonctions d'interface réutilisées par tous les écrans.
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