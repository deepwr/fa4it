// FA 4 IT — js/rpe-table.js
// Table RPE de Reactive Training Systems (Mike Tuchscherer).
//
// Chaque ligne correspond à un RPE ressenti (de 10 à 5).
// Chaque colonne correspond au nombre de répétitions réalisées (de 1 à 12).
// La valeur est le pourcentage du 1RM : par exemple, 5 répétitions à RPE 8
// correspondent à 81,1 % du 1RM.
//
// Les lignes RPE 10 à 6,5 sont la table RTS publiée.
// Les lignes RPE 6, 5,5 et 5 sont un prolongement : dans la table RTS, un
// demi-point de RPE en moins vaut une demi-répétition de plus (chaque ligne
// est la précédente décalée d'une case). Ces trois lignes reprennent donc les
// mêmes valeurs, décalées ; elles s'arrêtent là où la table RTS s'arrête.
// À RPE 6 et moins, l'estimation est moins fiable : la vitesse de barre est
// un meilleur repère à ces intensités.
//
// Vous pouvez vérifier et modifier ces valeurs (avec un point décimal, pas
// une virgule). L'app les relit au démarrage et les affiche, avec un contrôle,
// en bas de l'onglet Historique.
//
// Une série dont le couple (répétitions, RPE) n'est pas dans la table
// (ex. 14 répétitions, ou RPE 4,5) est exclue de l'e1RM et signalée.

export const TABLE_RPE = {
  //       1      2      3      4      5      6      7      8      9     10     11     12   ← répétitions
  10:  [100.0,  95.5,  92.2,  89.2,  86.3,  83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0],
  9.5: [ 97.8,  93.9,  90.7,  87.8,  85.0,  82.4,  79.9,  77.4,  75.1,  72.3,  69.4,  66.7],
  9:   [ 95.5,  92.2,  89.2,  86.3,  83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0,  65.3],
  8.5: [ 93.9,  90.7,  87.8,  85.0,  82.4,  79.9,  77.4,  75.1,  72.3,  69.4,  66.7,  64.0],
  8:   [ 92.2,  89.2,  86.3,  83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0,  65.3,  62.6],
  7.5: [ 90.7,  87.8,  85.0,  82.4,  79.9,  77.4,  75.1,  72.3,  69.4,  66.7,  64.0,  61.3],
  7:   [ 89.2,  86.3,  83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0,  65.3,  62.6,  59.9],
  6.5: [ 87.8,  85.0,  82.4,  79.9,  77.4,  75.1,  72.3,  69.4,  66.7,  64.0,  61.3,  58.6],
  // Prolongement (voir plus haut) :
  6:   [ 86.3,  83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0,  65.3,  62.6,  59.9],
  5.5: [ 85.0,  82.4,  79.9,  77.4,  75.1,  72.3,  69.4,  66.7,  64.0,  61.3,  58.6],
  5:   [ 83.7,  81.1,  78.6,  76.2,  73.9,  70.7,  68.0,  65.3,  62.6,  59.9],
};