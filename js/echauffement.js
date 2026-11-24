// FA 4 IT — js/echauffement.js
// Proposition de ramp-up (montée en charge avant les séries de travail).
//
// La proposition part de la charge de la première série de travail (la
// « charge cible ») et monte par paliers : de moins en moins de répétitions à
// mesure que la charge approche de la cible. Le dernier palier est le
// « last warm-up », sur lequel vous notez le RPE et la vitesse moyenne.
// Tout est modifiable ensuite dans la séance : ce n'est qu'une proposition.
//
// Vous pouvez ajuster les réglages ci-dessous (avec un point décimal).

export const REGLAGES_RAMP_UP = {
  barre: 20,       // kg : barre seule (squat et bench)
  arrondi: 2.5,    // kg : les charges proposées sont arrondies au 2,5 kg le plus proche
  minimumDeadlift: 60,   // kg : premier palier du deadlift (barre + deux disques de 20)
  // Paliers en % de la charge cible. « barre: true » = barre seule (pas en deadlift).
  paliers: [
    { barre: true, repetitions: 8 },
    { pourcentage: 40, repetitions: 5 },
    { pourcentage: 55, repetitions: 3 },
    { pourcentage: 70, repetitions: 2 },
    { pourcentage: 80, repetitions: 1 },
    { pourcentage: 90, repetitions: 1 },   // last warm-up
  ],
};

function arrondir(charge, pas) {
  return Math.round(charge / pas) * pas;
}

/**
 * Paliers proposés pour une charge cible et un mouvement :
 * [{ charge, repetitions }, …], du plus léger au plus lourd (le dernier = last warm-up).
 * Les paliers trop proches (même charge après arrondi) ou pas plus légers que la cible
 * sont retirés.
 */
export function proposerRampUp(chargeCible, mouvement, reglages = REGLAGES_RAMP_UP) {
  if (!(chargeCible > 0)) return [];
  const minimum = mouvement === 'deadlift' ? reglages.minimumDeadlift : reglages.barre;
  const paliers = [];

  for (const palier of reglages.paliers) {
    if (palier.barre && mouvement === 'deadlift') continue;
    const brute = palier.barre ? reglages.barre : arrondir(chargeCible * palier.pourcentage / 100, reglages.arrondi);
    const charge = Math.max(minimum, brute);
    if (charge >= chargeCible) continue;                                // jamais au niveau de la cible
    if (paliers.length > 0 && charge <= paliers.at(-1).charge) continue; // toujours en montant
    paliers.push({ charge, repetitions: palier.repetitions });
  }
  return paliers;
}
