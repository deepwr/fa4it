// FA 4 IT — js/labo-vbt.js
// L'écran « Labo VBT » (essai) : analyser une vidéo de série pour mesurer la
// vitesse de barre et tracer la trajectoire. Ouvert depuis Sauvegarde › Application.
// Il ne lit ni n'écrit AUCUNE donnée de l'app : la vidéo reste en mémoire le temps
// de l'analyse, puis elle est libérée. Rien n'est envoyé sur internet.

import { caler, suivre, resultats, champAutour, toileDeTravail, tailleDeTraitement, allerA } from './vbt-analyse.js';
import { echapper, afficherMessage } from './ui.js';

const DISQUES = [
  { valeur: '0.45', libelle: '45 cm (20-25 kg ou bumper)' },
  { valeur: '0.40', libelle: '40 cm (15 kg calibré)' },
  { valeur: '0.325', libelle: '32,5 cm (10 kg calibré)' },
  { valeur: '0.228', libelle: '22,8 cm (5 kg calibré)' },
];

const MODES = [
  { valeur: 'image', libelle: 'Image par image (le plus sûr)' },
  { valeur: 'lecture', libelle: 'Lecture normale (rapide)' },
  { valeur: 'ralenti', libelle: 'Lecture au ralenti ×0,25' },
];

// État du labo (une seule vidéo à la fois)
const etat = {
  adresse: null,      // adresse temporaire de la vidéo en mémoire (blob)
  taille: null,       // taille de traitement { l, h }
  cercle: null,       // { x, y, D } placé par l'utilisatrice (pixels de traitement)
  cale: null,         // ellipse calée sur le bord du disque
  analyse: null,      // résultat de suivre() + resultats()
  enCours: false,
  arreter: false,
};

/* ==========================================================================
   1. L'écran
   ========================================================================== */

function ecranLabo() {
  liberer();
  return {
    titre: 'Labo VBT',
    html: `
      <section class="carte">
        <h2>Essai de la VBT vidéo</h2>
        <p class="texte-secondaire">Filmez une série ou choisissez une vidéo : l’app suit le disque au bout de la barre et calcule la vitesse de chaque rep. La vidéo n’est ni enregistrée ni envoyée, et vos données ne sont pas touchées.</p>
        <p class="texte-secondaire">Pour un bon résultat : téléphone fixe (trépied), face au bout de la barre, disque entier visible du début à la fin.</p>
        <button class="bouton bouton-large" type="button" data-action="labo-choisir">Choisir ou filmer une vidéo</button>
        <input id="labo-fichier" type="file" accept="video/*" data-changement="labo-video" hidden>
      </section>

      <section class="carte" id="labo-zone" hidden>
        <div class="labo-cadre">
          <video id="labo-lecteur" playsinline muted preload="auto"></video>
          <canvas id="labo-dessin" class="labo-dessin"></canvas>
        </div>
        <p id="labo-infos" class="texte-secondaire"></p>

        <div class="groupe">
          <label class="etiquette" for="labo-temps">1. Placez la vidéo juste avant la première rep</label>
          <input id="labo-temps" class="labo-curseur" type="range" min="0" max="1" step="0.01" value="0">
          <span id="labo-temps-texte" class="texte-secondaire">0,00 s</span>
        </div>

        <p class="etiquette">2. Touchez le centre du disque sur l’image</p>

        <div class="groupe">
          <label class="etiquette" for="labo-taille">3. Ajustez le cercle au bord du disque</label>
          <input id="labo-taille" class="labo-curseur" type="range" min="30" max="400" step="1" value="150">
          <span id="labo-cale" class="texte-secondaire">Touchez d’abord le disque.</span>
        </div>

        <div class="groupe">
          <label class="etiquette" for="labo-diametre">4. Disque visible</label>
          <div class="choix">
            <select id="labo-diametre" class="champ">
              ${DISQUES.map((d) => `<option value="${d.valeur}">${echapper(d.libelle)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="groupe">
          <label class="etiquette" for="labo-mode">Lecture pendant l’analyse</label>
          <div class="choix">
            <select id="labo-mode" class="champ">
              ${MODES.map((m) => `<option value="${m.valeur}">${echapper(m.libelle)}</option>`).join('')}
            </select>
          </div>
        </div>

        <button class="bouton bouton-large" type="button" data-action="labo-analyser" id="labo-analyser">Analyser</button>
        <button class="bouton bouton-secondaire bouton-large" type="button" data-action="labo-arreter" id="labo-arreter" hidden>Arrêter</button>
        <p id="labo-etat" class="texte-secondaire" aria-live="polite"></p>
      </section>

      <section class="carte" id="labo-resultats" hidden></section>
    `,
    actions: '<a class="bouton bouton-secondaire bouton-retour" href="#/sauvegarde">Retour</a>',
  };
}

// En quittant le labo, on libère la vidéo de la mémoire
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/labo')) liberer();
});

/** Libère la vidéo précédente (mémoire). */
function liberer() {
  if (etat.adresse) URL.revokeObjectURL(etat.adresse);
  Object.assign(etat, { adresse: null, taille: null, cercle: null, cale: null, analyse: null, enCours: false, arreter: false });
}

const $ = (id) => document.getElementById(id);

function format(nombre, decimales = 2) {
  return nombre.toFixed(decimales).replace('.', ',');
}

/* ==========================================================================
   2. Charger la vidéo
   ========================================================================== */

function choisirVideo() {
  $('labo-fichier')?.click();
}

async function chargerVideo(champ) {
  const fichier = champ.files?.[0];
  champ.value = '';   // pour pouvoir rechoisir la même vidéo
  if (!fichier) return;
  liberer();
  const video = $('labo-lecteur');
  etat.adresse = URL.createObjectURL(fichier);
  video.src = etat.adresse;
  $('labo-zone').hidden = false;
  $('labo-resultats').hidden = true;
  $('labo-etat').textContent = 'Chargement de la vidéo…';

  await new Promise((resoudre, rejeter) => {
    video.addEventListener('loadedmetadata', resoudre, { once: true });
    video.addEventListener('error', () => rejeter(new Error('Cette vidéo ne peut pas être lue sur cet appareil.')), { once: true });
    video.load();
  });
  // Sur iPhone, une vidéo n'affiche ses images qu'après avoir été lancée une fois
  try {
    await video.play();
    video.pause();
  } catch {
    // sans conséquence : on essaie quand même d'afficher la première image
  }
  etat.taille = tailleDeTraitement(video);
  const dessin = $('labo-dessin');
  dessin.width = etat.taille.l;
  dessin.height = etat.taille.h;

  const curseur = $('labo-temps');
  curseur.max = String(Math.max(0, video.duration - 0.1).toFixed(2));
  curseur.value = '0';
  await allerA(video, 0.05);
  $('labo-temps-texte').textContent = `${format(video.currentTime)} s`;

  const taille = $('labo-taille');
  taille.max = String(Math.min(etat.taille.l, etat.taille.h));
  $('labo-infos').textContent = `${video.videoWidth} × ${video.videoHeight} px · ${format(video.duration, 1)} s · ${Math.round(fichier.size / 1048576)} Mo`;
  $('labo-etat').textContent = 'Placez la vidéo, puis touchez le centre du disque.';
  brancher();
  dessiner();
}

/* ==========================================================================
   3. Placer le cercle
   Ces réglages réagissent en continu : on les écoute directement.
   ========================================================================== */

function brancher() {
  const video = $('labo-lecteur');
  const dessin = $('labo-dessin');
  const curseur = $('labo-temps');
  const taille = $('labo-taille');

  curseur.oninput = async () => {
    if (etat.enCours) return;
    etat.analyse = null;
    etat.cale = null;
    await allerA(video, Number(curseur.value));
    $('labo-temps-texte').textContent = `${format(video.currentTime)} s`;
    dessiner();
  };
  curseur.onchange = () => { if (etat.cercle) recaler(); };

  // « click » et non « pointerdown » : faire défiler la page en touchant l'image ne place pas de cercle
  dessin.onclick = (evenement) => {
    if (etat.enCours) return;
    const zone = dessin.getBoundingClientRect();
    const x = ((evenement.clientX - zone.left) / zone.width) * dessin.width;
    const y = ((evenement.clientY - zone.top) / zone.height) * dessin.height;
    etat.cercle = { x, y, D: Number(taille.value) };
    etat.analyse = null;
    recaler();
  };

  taille.oninput = () => {
    if (!etat.cercle) return;
    etat.cercle.D = Number(taille.value);
    etat.cale = null;
    dessiner();
  };
  taille.onchange = () => { if (etat.cercle) recaler(); };
}

/** Cale l'ellipse sur le bord du disque autour du cercle placé. */
function recaler() {
  const video = $('labo-lecteur');
  const { x, y, D } = etat.cercle;
  const travail = toileDeTravail(video);
  const champ = champAutour(travail, video, x, y, D * 0.6 + 12, D * 0.6 + 12);
  etat.cale = caler(champ, x, y, D);
  const hauteur = Math.round(2 * etat.cale.a);
  if (etat.cale.recale) $('labo-taille').value = String(hauteur);   // le curseur suit le recalage
  const texte = `${etat.cale.recale ? 'Cercle recalé automatiquement' : 'Cercle calé'} : ${hauteur} px de haut`;
  $('labo-cale').textContent = etat.cale.auBord
    ? `${texte}. ⚠︎ Bord du disque mal trouvé : rapprochez votre cercle du bord du disque.`
    : `${texte}. Vérifiez que l’ellipse saumon suit bien le bord extérieur du disque choisi.`;
  dessiner();
}

/* ==========================================================================
   4. Dessin par-dessus la vidéo
   ========================================================================== */

function couleur(nom) {
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
}

function dessiner(jusquA = null) {
  const dessin = $('labo-dessin');
  if (!dessin) return;
  const ctx = dessin.getContext('2d');
  ctx.clearRect(0, 0, dessin.width, dessin.height);
  const epaisseur = Math.max(2, dessin.width / 160);

  if (etat.cercle && !etat.analyse) {
    ctx.lineWidth = epaisseur;
    ctx.strokeStyle = couleur('--bleu');
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(etat.cercle.x, etat.cercle.y, etat.cercle.D / 2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    if (etat.cale) {
      ctx.strokeStyle = couleur('--saumon');
      ctx.beginPath();
      ctx.ellipse(etat.cale.x, etat.cale.y, etat.cale.b, etat.cale.a, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = couleur('--saumon');
      ctx.beginPath();
      ctx.arc(etat.cale.x, etat.cale.y, epaisseur * 1.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Trajectoire : bleu = descente, saumon = montée
  const tr = etat.analyse?.resultat?.trajectoire;
  if (tr) {
    ctx.lineWidth = epaisseur * 1.3;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.t.length; i += 1) {
      if (jusquA !== null && tr.t[i] > jusquA) break;
      ctx.strokeStyle = tr.montee[i] ? couleur('--saumon') : couleur('--bleu');
      ctx.beginPath();
      ctx.moveTo(tr.x[i - 1], tr.y[i - 1]);
      ctx.lineTo(tr.x[i], tr.y[i]);
      ctx.stroke();
    }
  }
}

/* ==========================================================================
   5. Analyser
   ========================================================================== */

async function analyser() {
  if (etat.enCours) return;
  const video = $('labo-lecteur');
  if (!etat.adresse) { afficherMessage('Choisissez d’abord une vidéo'); return; }
  if (!etat.cercle) { afficherMessage('Touchez d’abord le centre du disque'); return; }
  if (!etat.cale) recaler();

  const diametre = Number($('labo-diametre').value);
  const mode = $('labo-mode').value;
  const debut = video.currentTime;   // l'image sur laquelle le cercle a été calé
  etat.enCours = true;
  etat.arreter = false;
  etat.analyse = null;
  $('labo-analyser').hidden = true;
  $('labo-arreter').hidden = false;
  $('labo-resultats').hidden = true;
  $('labo-etat').textContent = 'Analyse en cours…';

  const depart = etat.cale;
  const dessin = $('labo-dessin');
  const ctx = dessin.getContext('2d');
  try {
    const suivi = await suivre(video, depart, {
      mode,
      debut,
      arret: () => etat.arreter,
      surImage: ({ x, y, nombre, temps }) => {
        // Suivi en direct : le contour calé suit le disque
        ctx.clearRect(0, 0, dessin.width, dessin.height);
        ctx.lineWidth = Math.max(2, dessin.width / 160);
        ctx.strokeStyle = couleur('--saumon');
        ctx.beginPath();
        ctx.ellipse(x, y, depart.b, depart.a, 0, 0, 2 * Math.PI);
        ctx.stroke();
        if (nombre % 10 === 0) $('labo-etat').textContent = `Analyse en cours… ${format(temps, 1)} s / ${format(video.duration, 1)} s`;
      },
    });
    video.pause();
    const resultat = resultats(suivi, depart, diametre);
    etat.analyse = { suivi, resultat, diametre };
    $('labo-etat').textContent = etat.arreter ? 'Analyse arrêtée.' : 'Analyse terminée.';
    afficherResultats();
    await allerA(video, debut);
    dessiner();
  } finally {
    etat.enCours = false;
    $('labo-analyser').hidden = false;
    $('labo-arreter').hidden = true;
  }
}

function arreter() {
  etat.arreter = true;
}

/* ==========================================================================
   6. Résultats et diagnostic
   ========================================================================== */

function afficherResultats() {
  const { suivi, resultat, diametre } = etat.analyse;
  const reps = resultat.reps;
  const zone = $('labo-resultats');
  const d = suivi.diagnostic;
  const fiables = reps.filter((r) => !r.douteuse);
  const moyenne = fiables.length ? fiables.reduce((s, r) => s + r.vitesseMoyenne, 0) / fiables.length : null;

  const lignes = reps.map((r, i) => `
    <tr>
      <th scope="row">${i + 1}</th>
      <td><strong>${format(r.vitesseMoyenne)}</strong></td>
      <td>${format(r.vitesseMax)}</td>
      <td>${Math.round(r.amplitude * 100)} cm</td>
      <td>${format(r.duree)} s</td>
      <td>${r.douteuse ? '⚠︎ ' : ''}${Math.round(r.qualite * 100)} %</td>
    </tr>`).join('');

  const modes = { lecture: 'lecture normale', ralenti: 'lecture au ralenti', image: 'image par image' };
  zone.innerHTML = `
    <h2>Résultats</h2>
    ${reps.length === 0
      ? '<p class="alerte">Aucune rep trouvée. Vérifiez que le disque est bien suivi en revoyant la vidéo, ou placez le départ plus tôt.</p>'
      : `
        <p>Vitesse moyenne de la série : <strong>${moyenne !== null ? `${format(moyenne)} m/s` : '—'}</strong>
          <span class="texte-secondaire">(moyenne des reps ; c’est la valeur qui irait dans la série)</span></p>
        <div class="tableau-defilant">
          <table class="table-labo">
            <thead><tr><th scope="col">Rep</th><th scope="col">Moy.</th><th scope="col">Max</th><th scope="col">Ampl.</th><th scope="col">Durée</th><th scope="col">Suivi</th></tr></thead>
            <tbody>${lignes}</tbody>
          </table>
        </div>
        <p class="texte-secondaire">Vitesses en m/s. « Suivi » : netteté du bord du disque pendant la montée, comparée au reste de la vidéo (⚠︎ = à vérifier en revoyant la vidéo).</p>`}
    <button class="bouton bouton-secondaire bouton-large" type="button" data-action="labo-revoir">Revoir avec la trajectoire</button>
    <details class="details">
      <summary>Diagnostic (pour Claude)</summary>
      <ul class="liste-vitesses">
        <li>Mode : ${modes[d.mode]}${d.cadence ? ` · cadence estimée ${d.cadence} i/s` : ''}</li>
        <li>Images analysées : ${d.images} (${Math.round(d.imagesParSeconde)} par seconde de vidéo) · images sautées : ${d.imagesSautees}</li>
        <li>Calcul : ${format(d.calculParImage, 1)} ms par image · analyse ${format(d.dureeAnalyse, 1)} s pour ${format(d.dureeVideo, 1)} s de vidéo</li>
        <li>Image de travail : ${d.largeur} × ${d.hauteur} px · disque ${Math.round(2 * etat.cale.a)} px de haut pour ${format(diametre * 100, 1)} cm · ${format(resultat.metresParPixel * 1000, 2)} mm par pixel</li>
        <li>Navigateur : ${'requestVideoFrameCallback' in HTMLVideoElement.prototype ? 'lecture image par image disponible' : 'requestVideoFrameCallback absent'} · ${window.matchMedia('(display-mode: standalone)').matches ? 'app de l’écran d’accueil' : 'Safari'}</li>
      </ul>
    </details>
  `;
  zone.hidden = false;
}

/** Rejoue la vidéo en dessinant la trajectoire au fur et à mesure. */
async function revoir() {
  if (!etat.analyse || etat.enCours) return;
  const video = $('labo-lecteur');
  const tr = etat.analyse.resultat.trajectoire;
  if (!tr) return;
  await allerA(video, tr.t[0]);
  video.playbackRate = 0.5;
  const etape = (maintenant, meta) => {
    dessiner(meta.mediaTime);
    if (!video.paused && !video.ended) video.requestVideoFrameCallback(etape);
    else dessiner();
  };
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(etape);
  video.addEventListener('ended', () => { video.playbackRate = 1; dessiner(); }, { once: true });
  await video.play();
}

/* ==========================================================================
   7. Ce que app.js utilise
   ========================================================================== */

export const ecransLabo = {
  labo: { onglet: 'sauvegarde', afficher: ecranLabo },
};

export const boutonsLabo = {
  'labo-choisir': choisirVideo,
  'labo-analyser': analyser,
  'labo-arreter': arreter,
  'labo-revoir': revoir,
};

export const changementsLabo = {
  'labo-video': chargerVideo,
};
