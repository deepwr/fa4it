// FA 4 IT — js/accueil.js
// L'écran d'accueil (#/accueil) : le verset du jour et les tuiles des pages.
//
// Le verset du jour :
//   - il est tiré au hasard à l'ouverture de l'app, puis gardé EN MÉMOIRE (variable ci-dessous) :
//     tant que l'app reste ouverte, même en arrière-plan, c'est le même ;
//   - quand l'app est fermée (balayée vers le haut) puis rouverte, la page est rechargée :
//     la mémoire repart de zéro, donc un nouveau verset ;
//   - aucun ne revient avant que tous aient été vus : la liste des versets « à venir »
//     est gardée dans le stockage local de l'iPhone (localStorage).
// Versets : Louis Segond 1910 (LSG), texte exact ; « … » = verset cité en partie.

import { lireBlocs, lireReglage } from './db.js';
import { echapper, formaterNombre, pluriel } from './ui.js';
import { compter } from './modele.js';

/* ==========================================================================
   1. Les versets
   ========================================================================== */

export const VERSETS = [
  { texte: "Je puis tout par celui qui me fortifie.", reference: "Philippiens 4, 13" },
  { texte: "…oubliant ce qui est en arrière et me portant vers ce qui est en avant, je cours vers le but…", reference: "Philippiens 3, 13-14" },
  { texte: "Ne savez-vous pas que ceux qui courent dans le stade courent tous, mais qu’un seul remporte le prix ? Courez de manière à le remporter.", reference: "1 Corinthiens 9, 24" },
  { texte: "Tous ceux qui combattent s’imposent toute espèce d’abstinences, et ils le font pour obtenir une couronne corruptible ; mais nous, faisons-le pour une couronne incorruptible.", reference: "1 Corinthiens 9, 25" },
  { texte: "Moi donc, je cours, non pas comme à l’aventure ; je frappe, non pas comme battant l’air.", reference: "1 Corinthiens 9, 26" },
  { texte: "J’ai combattu le bon combat, j’ai achevé la course, j’ai gardé la foi.", reference: "2 Timothée 4, 7" },
  { texte: "Car ce n’est pas un esprit de timidité que Dieu nous a donné, mais un esprit de force, d’amour et de sagesse.", reference: "2 Timothée 1, 7" },
  { texte: "…courons avec persévérance dans la carrière qui nous est ouverte…", reference: "Hébreux 12, 1" },
  { texte: "Il est vrai que tout châtiment semble d’abord un sujet de tristesse, et non de joie ; mais il produit plus tard pour ceux qui ont été ainsi exercés un fruit paisible de justice.", reference: "Hébreux 12, 11" },
  { texte: "Fortifiez donc vos mains languissantes Et vos genoux affaiblis…", reference: "Hébreux 12, 12" },
  { texte: "Il donne de la force à celui qui est fatigué, Et il augmente la vigueur de celui qui tombe en défaillance.", reference: "Ésaïe 40, 29" },
  { texte: "Mais ceux qui se confient en l’Éternel renouvellent leur force. Ils prennent le vol comme les aigles ; Ils courent, et ne se lassent point, Ils marchent, et ne se fatiguent point.", reference: "Ésaïe 40, 31" },
  { texte: "Ne t’ai-je pas donné cet ordre : Fortifie-toi et prends courage ? Ne t’effraie point et ne t’épouvante point, car l’Éternel, ton Dieu, est avec toi dans tout ce que tu entreprendras.", reference: "Josué 1, 9" },
  { texte: "…nous nous glorifions même des afflictions, sachant que l’affliction produit la persévérance, la persévérance la victoire dans l’épreuve, et cette victoire l’espérance.", reference: "Romains 5, 3-4" },
  { texte: "Mes frères, regardez comme un sujet de joie complète les diverses épreuves auxquelles vous pouvez être exposés, sachant que l’épreuve de votre foi produit la patience.", reference: "Jacques 1, 2-3" },
  { texte: "Ne nous lassons pas de faire le bien ; car nous moissonnerons au temps convenable, si nous ne nous relâchons pas.", reference: "Galates 6, 9" },
  { texte: "Car sept fois le juste tombe, et il se relève…", reference: "Proverbes 24, 16" },
  { texte: "Celui qui est lent à la colère vaut mieux qu’un héros, Et celui qui est maître de lui-même, que celui qui prend des villes.", reference: "Proverbes 16, 32" },
  { texte: "Tout ce que vous faites, faites-le de bon cœur, comme pour le Seigneur et non pour des hommes…", reference: "Colossiens 3, 23" },
  { texte: "…Ma grâce te suffit, car ma puissance s’accomplit dans la faiblesse.", reference: "2 Corinthiens 12, 9" },
  { texte: "Nous sommes pressés de toute manière, mais non réduits à l’extrémité ; dans la détresse, mais non dans le désespoir ; persécutés, mais non abandonnés ; abattus, mais non perdus…", reference: "2 Corinthiens 4, 8-9" },
  { texte: "C’est Dieu qui me ceint de force, Et qui me conduit dans la voie droite.", reference: "Psaume 18, 33" },
  { texte: "Il exerce mes mains au combat, Et mes bras tendent l’arc d’airain.", reference: "Psaume 18, 35" },
  { texte: "…si je suis tombée, je me relèverai ; Si je suis assise dans les ténèbres, L’Éternel sera ma lumière.", reference: "Michée 7, 8" },
  { texte: "Et tu me donnes la force du buffle ; Je suis arrosé avec une huile fraîche.", reference: "Psaume 92, 11" }
];

const CLE_A_VENIR = 'fa4it-versets-a-venir';   // références pas encore vues dans ce tour
const CLE_DERNIER = 'fa4it-dernier-verset';    // dernier verset montré (pour ne pas le revoir aussitôt)

let versetChoisi = null;   // le verset de cette ouverture de l'app

function lireStockage(cle) {
  try {
    return window.localStorage.getItem(cle);
  } catch {
    return null;   // stockage indisponible : on tire simplement au hasard
  }
}

function ecrireStockage(cle, valeur) {
  try {
    window.localStorage.setItem(cle, valeur);
  } catch {
    // tant pis : le verset change quand même à chaque ouverture
  }
}

/** Mélange de Fisher-Yates : chaque ordre a la même chance. */
function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/** Le verset de cette ouverture de l'app (tiré une seule fois). */
export function versetDuJour() {
  if (versetChoisi) return versetChoisi;
  const references = VERSETS.map((v) => v.reference);
  let aVenir = [];
  try {
    aVenir = JSON.parse(lireStockage(CLE_A_VENIR) ?? '[]').filter((r) => references.includes(r));
  } catch {
    aVenir = [];
  }
  if (aVenir.length === 0) {
    // Nouveau tour : tous les versets, dans un ordre au hasard, sans recommencer par le dernier vu
    const dernier = lireStockage(CLE_DERNIER);
    aVenir = melanger(references);
    if (aVenir.length > 1 && aVenir[0] === dernier) aVenir.push(aVenir.shift());
  }
  const reference = aVenir.shift();
  ecrireStockage(CLE_A_VENIR, JSON.stringify(aVenir));
  ecrireStockage(CLE_DERNIER, reference);
  versetChoisi = VERSETS.find((v) => v.reference === reference);
  return versetChoisi;
}

/* ==========================================================================
   2. Les petites lignes sous les titres des tuiles
   ========================================================================== */

async function informations() {
  const blocs = await lireBlocs();
  if (blocs.length === 0) {
    return { seance: 'Aucun programme', programme: 'Aucun bloc', sauvegarde: await texteSauvegarde(blocs) };
  }
  // Même bloc et même « prochaine séance » que l'écran Séance
  const idChoisi = await lireReglage('blocSeance');
  const bloc = blocs.find((b) => b.id === idChoisi) ?? blocs[0];
  let prochaine = null;
  for (const semaine of bloc.semaines) {
    const jour = semaine.jours.find((j) => !j.dateRealisee);
    if (jour) { prochaine = { semaine, jour }; break; }
  }
  return {
    seance: prochaine ? `S${formaterNombre(prochaine.semaine.numero) || '?'} · ${prochaine.jour.nom}` : 'Tout est fait',
    programme: bloc.nom,
    sauvegarde: await texteSauvegarde(blocs),
  };
}

/** « Aujourd’hui », « Hier », « Il y a 3 jours », « Jamais » (⚠︎ après 7 jours s'il y a des séries faites). */
async function texteSauvegarde(blocs) {
  const derniere = await lireReglage('derniereSauvegarde');
  if (!derniere) return compter(blocs).seriesFaites > 0 ? '⚠︎ Jamais' : 'Jamais';
  const jours = Math.floor((Date.now() - new Date(derniere).getTime()) / 86400000);
  if (jours <= 0) return 'Aujourd’hui';
  if (jours === 1) return 'Hier';
  return `${jours > 7 ? '⚠︎ ' : ''}Il y a ${pluriel(jours, 'jour')}`;
}

/* ==========================================================================
   3. L'écran
   ========================================================================== */

// Icônes (traits, couleur donnée par le CSS)
const ICONES = {
  seance: '<path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  programme: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  suivi: '<path d="M3 20h18"/><path d="M4 16l5-6 4 3 7-8"/>',
  historique: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sauvegarde: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  accueil: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
};

export function icone(nom, taille = 28) {
  return `<svg class="icone" width="${taille}" height="${taille}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONES[nom]}</svg>`;
}

function tuile(page, titre, detail) {
  return `
    <a class="tuile" href="#/${page}">
      ${icone(page)}
      <span class="tuile-texte">
        <span class="tuile-titre">${titre}</span>
        <span class="tuile-detail">${echapper(detail)}</span>
      </span>
    </a>
  `;
}

async function ecranAccueil() {
  const verset = versetDuJour();
  const infos = await informations();
  return {
    titre: 'Accueil',
    html: `
      <figure class="carte verset">
        <svg class="verset-guillemets" width="34" height="26" viewBox="0 0 34 26" aria-hidden="true"><path d="M2 24V14C2 7 6 3 13 2v4c-4 1-6 3-6 7h6v11H2zm19 0V14c0-7 4-11 11-12v4c-4 1-6 3-6 7h6v11H21z"/></svg>
        <blockquote class="verset-texte">${echapper(verset.texte)}</blockquote>
        <figcaption class="texte-secondaire">— ${echapper(verset.reference)}</figcaption>
      </figure>
      <nav class="tuiles" aria-label="Pages de l’app">
        <a class="tuile tuile-seance" href="#/seance">
          <span class="tuile-texte">
            <span class="tuile-titre">Séance</span>
            <span class="tuile-detail">${echapper(infos.seance)}</span>
          </span>
          <span class="tuile-pastille">${icone('seance', 30)}</span>
        </a>
        <div class="tuiles-grille">
          ${tuile('programme', 'Programme', infos.programme)}
          ${tuile('suivi', 'Suivi', 'e1RM et vitesse')}
          ${tuile('historique', 'Historique', 'Séances passées')}
          ${tuile('sauvegarde', 'Sauvegarde', infos.sauvegarde)}
        </div>
      </nav>
    `,
  };
}

export const ecransAccueil = {
  accueil: { onglet: 'accueil', afficher: ecranAccueil },
};
