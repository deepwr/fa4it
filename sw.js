// FA 4 IT — sw.js (le « service worker »)
// Rôle : garder une copie de l'app sur l'appareil pour qu'elle s'ouvre et
// fonctionne sans réseau (salle en sous-sol, mode avion…).
// Ce fichier ne touche JAMAIS à vos données : elles sont dans IndexedDB.
//
// ⚠︎ À chaque mise en ligne d'une nouvelle version de l'app :
//   1. augmentez VERSION (ex. 'v1' → 'v2') ;
//   2. si vous avez ajouté un fichier, ajoutez-le aussi dans FICHIERS.
// C'est le changement de VERSION qui déclenche la mise à jour sur l'iPhone.

const VERSION = 'v6';
const CACHE = `fa4it-${VERSION}`;

// Tous les fichiers de l'app (chemins relatifs à ce fichier sw.js).
// Si un seul manque, l'installation échoue : vérifiez l'orthographe.
const FICHIERS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles.css',
  'seance.css',
  'historique.css',
  'data/exemple.json',
  'icons/apple-touch-icon.png',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/favicon.png',
  'js/app.js',
  'js/pwa.js',
  'js/ui.js',
  'js/modele.js',
  'js/db.js',
  'js/sauvegarde.js',
  'js/programmation.js',
  'js/seance.js',
  'js/e1rm.js',
  'js/rpe-table.js',
  'js/historique.js',
  'js/import-coach.js',
  'js/echauffement.js',
  'js/sheets.js',
];

// Sur le Mac (Live Server), on va d'abord chercher les fichiers sur le réseau
// pour voir tout de suite vos modifications. En ligne (GitHub Pages), on sert
// d'abord la copie enregistrée : l'app s'ouvre instantanément, même sans réseau.
const EN_DEVELOPPEMENT = ['localhost', '127.0.0.1'].includes(self.location.hostname);

/* --------------------------------------------------------------------------
   1. Installation : on télécharge et on range tous les fichiers
   -------------------------------------------------------------------------- */

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE)
      // { cache: 'reload' } : on contourne le cache du navigateur pour avoir la vraie dernière version
      .then((cache) => cache.addAll(FICHIERS.map((fichier) => new Request(fichier, { cache: 'reload' }))))
      .then(() => self.skipWaiting())   // la nouvelle version prend le relais sans attendre
  );
});

/* --------------------------------------------------------------------------
   2. Activation : on supprime les copies des anciennes versions
   -------------------------------------------------------------------------- */

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms
          .filter((nom) => nom.startsWith('fa4it-') && nom !== CACHE)
          .map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim())
  );
});

/* --------------------------------------------------------------------------
   3. Chaque demande de fichier passe par ici
   -------------------------------------------------------------------------- */

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;                              // seules les lectures nous concernent
  if (new URL(requete.url).origin !== self.location.origin) return;  // les autres sites ne sont pas concernés

  evenement.respondWith(EN_DEVELOPPEMENT ? reseauDAbord(requete) : copieDAbord(requete));
});

/** En ligne : la copie enregistrée d'abord, le réseau seulement si elle manque. */
async function copieDAbord(requete) {
  const cache = await caches.open(CACHE);
  const copie = await cache.match(requete, { ignoreSearch: true });
  if (copie) return copie;
  if (requete.mode === 'navigate') {
    const accueil = await cache.match('index.html');
    if (accueil) return accueil;
  }
  return fetch(requete);
}

/** Sur le Mac : le réseau d'abord (et on met à jour la copie), la copie si le réseau échoue. */
async function reseauDAbord(requete) {
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(requete, reponse.clone());
    }
    return reponse;
  } catch (erreur) {
    const copie = await caches.match(requete, { ignoreSearch: true });
    if (copie) return copie;
    if (requete.mode === 'navigate') {
      const accueil = await caches.match('index.html');
      if (accueil) return accueil;
    }
    throw erreur;
  }
}