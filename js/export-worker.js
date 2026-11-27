// FA 4 IT — js/export-worker.js
// Prépare le fichier d'export EN ARRIÈRE-PLAN (un « worker » : un second fil d'exécution).
// Lire toutes les données, trajectoires comprises, puis les écrire en texte prend jusqu'à
// une demi-seconde avec un an de mesures vidéo : ici, l'écran ne se fige pas pendant ce temps.
// Lancé par sauvegarde.js ; renvoie { blob } (le fichier) ou { erreur }.

import { completerBlocs } from './db.js';
import { construireSauvegarde } from './modele.js';

function lireTout(magasin) {
  return new Promise((resoudre, rejeter) => {
    const demande = magasin.getAll();
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error);
  });
}

function ouvrir() {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open('fa4it');   // sans numéro : la version actuelle, sans rien modifier
    demande.onupgradeneeded = () => demande.transaction.abort();   // pas de base : on ne la crée pas ici
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error ?? new Error('Base introuvable.'));
  });
}

(async () => {
  try {
    const base = await ouvrir();
    const transaction = base.transaction(['blocs', 'traces']);
    const [blocs, traces] = await Promise.all([
      lireTout(transaction.objectStore('blocs')),
      lireTout(transaction.objectStore('traces')),
    ]);
    base.close();
    const texte = JSON.stringify(construireSauvegarde(completerBlocs(blocs, traces)));
    self.postMessage({ blob: new Blob([texte], { type: 'application/json' }) });
  } catch (erreur) {
    self.postMessage({ erreur: String(erreur?.message ?? erreur) });
  }
})();
