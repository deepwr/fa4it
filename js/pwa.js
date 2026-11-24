// FA 4 IT — js/pwa.js
// Installe le service worker (sw.js), qui garde une copie de l'app sur
// l'appareil pour qu'elle fonctionne hors ligne, et vérifie s'il existe
// une nouvelle version de l'app.

import { afficherMessage } from './ui.js';

if ('serviceWorker' in navigator) {
  // L'app était-elle déjà gérée par un service worker au démarrage ?
  const dejaInstallee = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.register('sw.js')
    .then((inscription) => {
      console.info('Mode hors ligne prêt pour', inscription.scope);

      // Sur iPhone, l'app est souvent reprise sans être rechargée :
      // on vérifie donc les mises à jour au démarrage et à chaque retour dans l'app.
      const verifier = () => inscription.update().catch(() => {});   // sans réseau : on réessaiera plus tard
      verifier();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') verifier();
      });
    })
    .catch((erreur) => console.warn('Mode hors ligne indisponible :', erreur));

  // Une nouvelle version vient de s'installer (après un changement de VERSION dans sw.js).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (dejaInstallee) {
      afficherMessage('Nouvelle version installée : elle s’appliquera à la prochaine ouverture');
    }
  });
} else {
  console.warn('Ce navigateur ne gère pas les service workers : pas de mode hors ligne.');
}