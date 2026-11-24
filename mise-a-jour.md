# FA 4 IT — sauvegardes et mises à jour

Ce fichier n'est pas utilisé par l'app : c'est le mode d'emploi pour ne jamais perdre de données.

## 1. Routine de sauvegarde

- **Quand :** chaque samedi après la séance J4, ou dès que l'onglet Séance affiche le rappel (plus de 7 jours sans export). Aussi avant chaque mise à jour de l'app et avant de changer d'iPhone.
- **Comment (iPhone) :** Sauvegarde › Exporter mes données › Enregistrer dans Fichiers › iCloud Drive › dossier « FA 4 IT » › Enregistrer.
- **Combien en garder :** les 4 dernières (un mois). Supprimer les plus anciennes dans Fichiers.
- **Une fois par mois, vérifier qu'une sauvegarde se relit :** sur le Mac, dans l'app ouverte avec Live Server, Sauvegarde › Importer un fichier… › la dernière sauvegarde. Les nombres de blocs, semaines et séries faites doivent correspondre à ceux de l'iPhone. (Cela remplace seulement les données de test du Mac.)

## 2. Ce qui peut effacer les données de l'iPhone

- Supprimer l'icône FA 4 IT de l'écran d'accueil : à considérer comme une suppression des données.
- Réglages › Apps › Safari › Effacer historique et données de sites (par prudence, exporter avant).
- Réinitialiser l'iPhone ou en changer sans réimporter une sauvegarde.
- iOS lui-même si l'iPhone manque d'espace, sauf si la protection (écran Sauvegarde) est « activée ».
- Changer l'adresse du site (nom du compte GitHub ou du dépôt) : une nouvelle adresse donne une app vide.

## 3. Restaurer

- **Fausse manœuvre** (mauvais import, effacement) : Sauvegarde › Copie de secours › Revenir à cette copie. L'app garde une copie juste avant chaque import ou effacement ; elle est stockée sur l'iPhone, elle ne remplace donc pas l'export.
- **Nouvel iPhone ou app supprimée :** Safari › https://deepwr.github.io/fa4it/ › Partager › Sur l'écran d'accueil › ouvrir FA 4 IT › Sauvegarde › Importer un fichier… › iCloud Drive › FA 4 IT › la sauvegarde la plus récente.

## 4. Mettre l'app à jour (à chaque nouvelle version)

1. Sur l'iPhone : exporter une sauvegarde.
2. Sur le Mac : remplacer les fichiers dans VS Code et enregistrer (⌘S).
3. Dans `sw.js` : augmenter `VERSION` (par exemple `'v3'` → `'v4'`) et ajouter chaque nouveau fichier à la liste `FICHIERS`.
4. Tester sur le Mac avec Live Server : Programme, Séance, Historique, Sauvegarde. Console de Safari sans erreur rouge.
5. GitHub Desktop : commit, puis Push origin.
6. Attendre une à deux minutes, puis ouvrir https://deepwr.github.io/fa4it/sw.js : la nouvelle `VERSION` doit apparaître.
7. Sur l'iPhone, avec du réseau : ouvrir l'app (message « Nouvelle version installée »), la fermer, la rouvrir. Vérifier la version dans Sauvegarde › Application.

## 5. En cas de problème après une mise à jour

- GitHub Desktop › History › clic droit sur le dernier commit › Revert Changes in Commit › Push origin.
- Le site revient à la version précédente et l'iPhone la réinstalle à l'ouverture suivante (le navigateur voit que `sw.js` a changé). Les données ne bougent pas.
- Si des données semblent abîmées : Sauvegarde › Revenir à la copie de secours, ou importer la sauvegarde exportée à l'étape 1.

## 6. Règles d'or pour le code

- Ne jamais renommer le compte GitHub ni le dépôt `fa4it` (l'adresse du site changerait).
- Ne jamais changer `NOM_BASE` dans `js/db.js`.
- Ne jamais renommer ni supprimer un champ des données (bloc, semaine, jour, exercice, série). Ajouter un champ est possible, avec une valeur par défaut dans `js/modele.js`.
- Si la structure des données doit vraiment changer : augmenter `VERSION_BASE` avec une migration dans `onupgradeneeded` (`js/db.js`), et `VERSION_FORMAT` avec une conversion dans `lireSauvegarde` (`js/modele.js`).
- Toujours augmenter `VERSION` dans `sw.js` à chaque mise en ligne.