// FA 4 IT — js/vbt-analyse.js
// Le « moteur » de la VBT vidéo : il suit le disque au bout de la barre, image
// après image, puis calcule la vitesse moyenne de chaque montée (phase concentrique).
// Tout se passe sur le téléphone : la vidéo n'est ni enregistrée ni envoyée.
//
// Méthode (mise au point sur vos vidéos au banc d'essai, ≈ 0,02 m/s d'écart avec Qwik VBT) :
//   1. On cale une ellipse sur le BORD du disque, à partir du cercle placé par vous.
//   2. Image après image, on cherche où se trouve ce bord : c'est l'endroit où la
//      « marche » de luminosité (le gradient) le long de l'ellipse est la plus forte.
//   3. Échelle : diamètre réel du disque ÷ diamètre en pixels.
//   4. La hauteur est lissée (filtre de Butterworth, 4 Hz), puis on repère chaque montée.

/* ==========================================================================
   1. Réglages
   ========================================================================== */

export const REGLAGES_VBT = {
  cotePetitTraitement: 480,   // l'image est réduite : son petit côté fait 480 pixels
  pointsContour: 160,         // nombre de points sur l'ellipse
  partGardee: 0.7,            // on garde les 70 % de points au bord le plus net (mains, reflets…)
  visibiliteMin: 0.5,         // au moins la moitié du contour doit être dans l'image
  recherche: 14,              // on cherche le disque à ± 14 pixels de la position prévue
  frequenceCoupure: 4,        // lissage : on garde les mouvements plus lents que 4 Hz
  hysteresis: 0.06,           // 6 cm : écart minimal entre un creux et un sommet
  amplitudeMin: 0.15,         // une rep monte d'au moins 15 cm
  amplitudeMax: 1.0,          // … et d'au plus 1 m
  vitesseMax: 2.5,            // vitesse moyenne de montée au plus 2,5 m/s
  seuilVitesse: 0.03,         // en dessous de 0,03 m/s, la barre est considérée immobile
  dureeMin: 0.3,              // une montée dure au moins 0,3 s
  tenueFin: 0.2,              // fin de montée : la barre ne remonte plus pendant au moins 0,2 s…
  remonteeMax: 0.003,         // …c'est-à-dire pas de plus de 3 mm (tolère les petits sauts du suivi)
  scoreDouteux: 0.35,         // score de suivi < 35 % de l'habituel pendant la montée : rep à vérifier
};

/* ==========================================================================
   2. Traitement d'une zone d'image : gris, flou, gradients
   ========================================================================== */

// Flou gaussien 5 × 5 de σ = 1,5 (coefficients normalisés)
const NOYAU = (() => {
  const brut = [-2, -1, 0, 1, 2].map((x) => Math.exp(-(x * x) / (2 * 1.5 * 1.5)));
  const somme = brut.reduce((a, b) => a + b, 0);
  return brut.map((v) => v / somme);
})();

/**
 * Transforme une zone d'image (ImageData) en « champ de gradients » :
 * { x0, y0, l, h, gx, gy } où (x0, y0) est le coin de la zone dans l'image entière.
 */
export function champDeGradients(imageData, x0, y0) {
  const { width: l, height: h, data } = imageData;
  const n = l * h;
  const gris = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    gris[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  // Flou horizontal puis vertical (les bords de la zone sont prolongés)
  const tampon = new Float32Array(n);
  const flou = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < l; x += 1) {
      let s = 0;
      for (let k = -2; k <= 2; k += 1) {
        const xx = Math.min(l - 1, Math.max(0, x + k));
        s += NOYAU[k + 2] * gris[y * l + xx];
      }
      tampon[y * l + x] = s;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < l; x += 1) {
      let s = 0;
      for (let k = -2; k <= 2; k += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += NOYAU[k + 2] * tampon[yy * l + x];
      }
      flou[y * l + x] = s;
    }
  }
  // Gradients de Sobel 3 × 3
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const p = (x, y) => flou[Math.min(h - 1, Math.max(0, y)) * l + Math.min(l - 1, Math.max(0, x))];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < l; x += 1) {
      gx[y * l + x] = (p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1)) - (p(x - 1, y - 1) + 2 * p(x - 1, y) + p(x - 1, y + 1));
      gy[y * l + x] = (p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1)) - (p(x - 1, y - 1) + 2 * p(x, y - 1) + p(x + 1, y - 1));
    }
  }
  return { x0, y0, l, h, gx, gy };
}

/* ==========================================================================
   3. L'ellipse du bord du disque et son « score »
   ========================================================================== */

/** Points et normales d'une ellipse à axe vertical : a = demi-axe vertical, b = horizontal. */
export function contour(a, b, nombre = REGLAGES_VBT.pointsContour) {
  const dx = new Float32Array(nombre);
  const dy = new Float32Array(nombre);
  const nx = new Float32Array(nombre);
  const ny = new Float32Array(nombre);
  for (let i = 0; i < nombre; i += 1) {
    const t = (2 * Math.PI * i) / nombre;
    dx[i] = b * Math.sin(t);
    dy[i] = -a * Math.cos(t);
    const ux = Math.sin(t) / b;
    const uy = -Math.cos(t) / a;
    const norme = Math.hypot(ux, uy);
    nx[i] = ux / norme;
    ny[i] = uy / norme;
  }
  return { a, b, dx, dy, nx, ny, nombre };
}

/** Valeur interpolée d'un tableau du champ au point (x, y) de l'image entière, ou NaN hors zone. */
function lire(champ, tableau, x, y) {
  const lx = x - champ.x0;
  const ly = y - champ.y0;
  if (lx <= 1 || ly <= 1 || lx >= champ.l - 2 || ly >= champ.h - 2) return NaN;
  const ix = Math.floor(lx);
  const iy = Math.floor(ly);
  const fx = lx - ix;
  const fy = ly - iy;
  const i = iy * champ.l + ix;
  return (tableau[i] * (1 - fx) + tableau[i + 1] * fx) * (1 - fy)
    + (tableau[i + champ.l] * (1 - fx) + tableau[i + champ.l + 1] * fx) * fy;
}

const valeursTemporaires = new Float32Array(1024);

/** Range le tableau pour que la valeur de rang k (en partant du plus grand) soit à sa place (« sélection rapide »). */
function selectionner(t, n, k) {
  let gauche = 0;
  let droite = n - 1;
  while (gauche < droite) {
    const pivot = t[(gauche + droite) >> 1];
    let i = gauche;
    let j = droite;
    while (i <= j) {
      while (t[i] > pivot) i += 1;
      while (t[j] < pivot) j -= 1;
      if (i <= j) { const x = t[i]; t[i] = t[j]; t[j] = x; i += 1; j -= 1; }
    }
    if (k <= j) droite = j;
    else if (k >= i) gauche = i;
    else return;
  }
}

/** Score de bord de l'ellipse centrée en (cx, cy) : moyenne des 70 % de points au bord le plus net. */
export function score(champ, ellipse, cx, cy) {
  let valides = 0;
  for (let i = 0; i < ellipse.nombre; i += 1) {
    const x = cx + ellipse.dx[i];
    const y = cy + ellipse.dy[i];
    const vx = lire(champ, champ.gx, x, y);
    if (Number.isNaN(vx)) continue;
    const vy = lire(champ, champ.gy, x, y);
    valeursTemporaires[valides] = Math.abs(vx * ellipse.nx[i] + vy * ellipse.ny[i]);
    valides += 1;
  }
  const visibilite = valides / ellipse.nombre;
  if (valides === 0 || visibilite < REGLAGES_VBT.visibiliteMin) return { valeur: 0, visibilite };
  const garde = Math.max(1, Math.floor(valides * REGLAGES_VBT.partGardee));
  selectionner(valeursTemporaires, valides, garde - 1);   // les « garde » plus grandes valeurs sont devant
  let somme = 0;
  for (let i = 0; i < garde; i += 1) somme += valeursTemporaires[i];
  return { valeur: somme / garde, visibilite };
}

/** Meilleure position sur une grille de centres autour de (px, py). */
function chercher(champ, ellipse, px, py, rayon, pas) {
  let meilleur = { x: px, y: py, valeur: -1, visibilite: 0 };
  for (let y = py - rayon; y <= py + rayon + 1e-9; y += pas) {
    for (let x = px - rayon; x <= px + rayon + 1e-9; x += pas) {
      const s = score(champ, ellipse, x, y);
      if (s.valeur > meilleur.valeur) meilleur = { x, y, valeur: s.valeur, visibilite: s.visibilite };
    }
  }
  return meilleur;
}

/** Recherche grossière puis affinage au 1/8 de pixel. */
export function localiser(champ, ellipse, px, py, rayon = REGLAGES_VBT.recherche) {
  let r = chercher(champ, ellipse, px, py, rayon, 2);
  r = chercher(champ, ellipse, r.x, r.y, 2, 0.5);
  r = chercher(champ, ellipse, r.x, r.y, 0.5, 0.125);
  return r;
}

/** Calage dans une fenêtre de ± 6 % autour du diamètre D (méthode du banc d'essai). */
function calerAutour(champ, cx, cy, D) {
  const bas = 0.94 * D / 2;
  const haut = 1.06 * D / 2;
  let meilleur = null;
  for (let k = 0; k <= 12; k += 1) {
    const a = bas + (k * (haut - bas)) / 12;
    for (let rb = 0.5; rb <= 1.0501; rb += 0.03) {
      const e = contour(a, a * rb);
      const r = chercher(champ, e, cx, cy, 8, 1);
      if (!meilleur || r.valeur > meilleur.valeur) meilleur = { ...r, a, b: a * rb };
    }
  }
  // Affinage des deux demi-axes
  const depart = meilleur;
  for (let a = depart.a - 1.5; a <= depart.a + 1.5001; a += 0.25) {
    if (a < bas - 1e-9 || a > haut + 1e-9) continue;
    for (let b = depart.b - 1.5; b <= depart.b + 1.5001; b += 0.5) {
      const e = contour(a, b);
      const r = chercher(champ, e, depart.x, depart.y, 1, 0.5);
      if (r.valeur > meilleur.valeur) meilleur = { ...r, a, b };
    }
  }
  const marge = (haut - bas) / 24;
  return { ...meilleur, auBord: meilleur.a <= bas + marge || meilleur.a >= haut - marge };
}

/**
 * Calage : à partir du cercle placé par l'utilisatrice (centre cx, cy ; diamètre D en pixels),
 * cherche l'ellipse qui épouse le mieux le bord du disque (diamètre vertical à ± 6 %).
 * Si le meilleur bord est à la limite de cette fenêtre, on la déplace vers lui
 * (deux fois au plus) : un cercle un peu trop grand ou trop petit est corrigé tout seul.
 * Renvoie { x, y, a, b, valeur, auBord, recale } ; auBord = encore à la limite à la fin.
 */
export function caler(champ, cx, cy, D) {
  let resultat = calerAutour(champ, cx, cy, D);
  let recale = false;
  for (let essai = 0; essai < 2 && resultat.auBord; essai += 1) {
    resultat = calerAutour(champ, resultat.x, resultat.y, 2 * resultat.a);
    recale = true;
  }
  return { ...resultat, recale };
}

/* ==========================================================================
   4. Lire les images de la vidéo
   ========================================================================== */

/** Taille de traitement : le petit côté de l'image est ramené à 480 pixels. */
export function tailleDeTraitement(video) {
  const petit = Math.min(video.videoWidth, video.videoHeight);
  const facteur = REGLAGES_VBT.cotePetitTraitement / petit;
  return { l: Math.round(video.videoWidth * facteur), h: Math.round(video.videoHeight * facteur) };
}

/** Une toile (canvas) de travail, invisible, à la taille de traitement. */
export function toileDeTravail(video) {
  const { l, h } = tailleDeTraitement(video);
  const toile = document.createElement('canvas');
  toile.width = l;
  toile.height = h;
  const ctx = toile.getContext('2d', { willReadFrequently: true });
  return { toile, ctx, l, h };
}

/** Champ de gradients d'une zone de l'image actuellement affichée par la vidéo. */
export function champAutour(travail, video, cx, cy, demiL, demiH) {
  travail.ctx.drawImage(video, 0, 0, travail.l, travail.h);
  const x0 = Math.max(0, Math.floor(cx - demiL));
  const y0 = Math.max(0, Math.floor(cy - demiH));
  const x1 = Math.min(travail.l, Math.ceil(cx + demiL));
  const y1 = Math.min(travail.h, Math.ceil(cy + demiH));
  const image = travail.ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  return champDeGradients(image, x0, y0);
}

function attendre(element, evenement) {
  return new Promise((resoudre) => element.addEventListener(evenement, resoudre, { once: true }));
}

/** Place la vidéo à un instant précis et attend que l'image soit prête. */
export async function allerA(video, temps) {
  if (Math.abs(video.currentTime - temps) < 1e-4) return;
  const pret = attendre(video, 'seeked');
  video.currentTime = temps;
  await pret;
}

/** Estime le nombre d'images par seconde en faisant défiler la vidéo un court instant. */
async function estimerCadence(video, debut) {
  if (!('requestVideoFrameCallback' in video)) return 30;
  await allerA(video, debut);
  const temps = [];
  await new Promise((resoudre) => {
    const fin = setTimeout(resoudre, 1500);
    const surCadre = (maintenant, meta) => {
      temps.push(meta.mediaTime);
      if (temps.length >= 12 || video.ended) { clearTimeout(fin); resoudre(); return; }
      video.requestVideoFrameCallback(surCadre);
    };
    video.requestVideoFrameCallback(surCadre);
    video.playbackRate = 0.25;   // lentement, pour voir passer chaque image
    video.play().catch(() => { clearTimeout(fin); resoudre(); });
  });
  video.pause();
  const ecarts = temps.slice(1).map((x, i) => x - temps[i]).filter((d) => d > 1e-4);
  if (ecarts.length < 3) return 30;
  return Math.min(240, Math.max(15, Math.round(1 / mediane(ecarts))));
}

/**
 * Suit le disque depuis l'instant « debut » jusqu'à la fin de la vidéo.
 * Modes :
 *   'lecture' : la vidéo défile à vitesse normale, chaque image affichée est analysée (rapide,
 *               mais si le calcul est trop lent, des images sont sautées) ;
 *   'ralenti' : même chose au quart de la vitesse (moins d'images sautées) ;
 *   'image'   : on avance image par image (le plus sûr, le plus lent).
 * Renvoie { t, X, Y, S, V, diagnostic }.
 */
export async function suivre(video, depart, { mode = 'lecture', debut = 0, surImage = null, arret = null } = {}) {
  const travail = toileDeTravail(video);
  const ellipse = contour(depart.a, depart.b);
  const t = [];
  const X = [];
  const Y = [];
  const S = [];
  const V = [];
  const ecarts = [];
  let px = depart.x;
  let py = depart.y;
  let vx = 0;
  let vy = 0;
  let dernierTemps = null;
  let calcul = 0;
  let imagesSautees = 0;
  let dernierePresentee = null;
  let cadence = null;

  const traiter = (temps) => {
    const debutCalcul = performance.now();
    const dt = dernierTemps === null ? 0 : temps - dernierTemps;
    if (dt > 0) ecarts.push(dt);
    const pasHabituel = ecarts.length ? mediane(ecarts.slice(-30)) : dt;
    const facteur = dt > 0 && pasHabituel > 0 ? Math.min(2, Math.max(1, dt / pasHabituel)) : 1;
    const rayon = Math.round(REGLAGES_VBT.recherche * facteur);
    const prevuX = px + vx * dt;
    const prevuY = py + vy * dt;
    const champ = champAutour(travail, video, prevuX, prevuY, depart.b + rayon + 6, depart.a + rayon + 6);
    const r = dernierTemps === null
      ? localiser(champ, ellipse, px, py, 2)
      : localiser(champ, ellipse, prevuX, prevuY, rayon);
    if (dt > 0) {
      vx = (0.7 * (r.x - px)) / dt;
      vy = (0.7 * (r.y - py)) / dt;
    }
    px = r.x;
    py = r.y;
    dernierTemps = temps;
    t.push(temps); X.push(r.x); Y.push(r.y); S.push(r.valeur); V.push(r.visibilite);
    calcul += performance.now() - debutCalcul;
    surImage?.({ temps, x: r.x, y: r.y, valeur: r.valeur, nombre: t.length });
  };

  const debutReel = performance.now();
  const avecCadres = 'requestVideoFrameCallback' in video;
  const modeReel = mode !== 'image' && avecCadres ? mode : 'image';

  if (modeReel === 'image') {
    cadence = await estimerCadence(video, debut);
    const pas = 1 / Math.min(cadence, 120);
    // On vise le milieu de chaque image pour ne jamais tomber entre deux
    for (let k = 0; ; k += 1) {
      const temps = debut + k * pas;
      if (temps >= video.duration - pas / 2 || arret?.()) break;
      await allerA(video, temps + pas / 4);
      traiter(temps);
    }
  } else {
    await allerA(video, debut);
    await new Promise((resoudre, rejeter) => {
      const surCadre = (maintenant, meta) => {
        try {
          if (arret?.()) { video.pause(); resoudre(); return; }
          if (dernierePresentee !== null && meta.presentedFrames > dernierePresentee + 1) {
            imagesSautees += meta.presentedFrames - dernierePresentee - 1;
          }
          dernierePresentee = meta.presentedFrames;
          if (meta.mediaTime >= debut - 1e-3 && (dernierTemps === null || meta.mediaTime > dernierTemps)) traiter(meta.mediaTime);
          if (!video.ended) video.requestVideoFrameCallback(surCadre);
        } catch (erreur) {
          video.pause();
          rejeter(erreur);
        }
      };
      video.addEventListener('ended', () => resoudre(), { once: true });
      video.requestVideoFrameCallback(surCadre);
      video.playbackRate = modeReel === 'ralenti' ? 0.25 : 1;
      video.play().catch(rejeter);
    });
    video.playbackRate = 1;
  }

  const duree = (performance.now() - debutReel) / 1000;
  return {
    t, X, Y, S, V,
    diagnostic: {
      mode: modeReel,
      cadence,
      images: t.length,
      imagesSautees,
      dureeVideo: t.length > 1 ? t.at(-1) - t[0] : 0,
      dureeAnalyse: duree,
      calculParImage: t.length ? calcul / t.length : 0,
      imagesParSeconde: t.length > 1 ? (t.length - 1) / (t.at(-1) - t[0]) : 0,
      largeur: travail.l,
      hauteur: travail.h,
    },
  };
}

/* ==========================================================================
   5. Lissage (filtre de Butterworth d'ordre 4, aller-retour)
   ========================================================================== */

/** Ré-échantillonne (t, v) sur des instants réguliers, au pas médian. */
export function regulariser(t, v) {
  const pas = mediane(t.slice(1).map((x, i) => x - t[i]).filter((d) => d > 0));
  const n = Math.floor((t.at(-1) - t[0]) / pas) + 1;
  const tu = new Float64Array(n);
  const vu = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const ti = t[0] + i * pas;
    while (j < t.length - 2 && t[j + 1] < ti) j += 1;
    const f = t[j + 1] === t[j] ? 0 : (ti - t[j]) / (t[j + 1] - t[j]);
    tu[i] = ti;
    vu[i] = v[j] + Math.min(1, Math.max(0, f)) * (v[j + 1] - v[j]);
  }
  return { t: tu, v: vu, pas };
}

function mediane(valeurs) {
  const tries = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tries.length / 2);
  return tries.length % 2 ? tries[m] : (tries[m - 1] + tries[m]) / 2;
}

/** Deux filtres du second ordre en série = Butterworth d'ordre 4 (transformation bilinéaire). */
function sectionsButterworth(fc, fe) {
  const k = Math.tan((Math.PI * fc) / fe);
  return [0.5411961, 1.3065630].map((q) => {
    const norme = 1 / (1 + k / q + k * k);
    const b0 = k * k * norme;
    return { b0, b1: 2 * b0, b2: b0, a1: 2 * (k * k - 1) * norme, a2: (1 - k / q + k * k) * norme };
  });
}

function filtrer(sections, x) {
  let y = Float64Array.from(x);
  for (const s of sections) {
    const sortie = new Float64Array(y.length);
    // État initial : comme si le signal avait toujours valu sa première valeur
    let z2 = (s.b2 - s.a2) * y[0];
    let z1 = (s.b1 - s.a1) * y[0] + z2;
    for (let i = 0; i < y.length; i += 1) {
      const entree = y[i];
      const out = s.b0 * entree + z1;
      z1 = s.b1 * entree - s.a1 * out + z2;
      z2 = s.b2 * entree - s.a2 * out;
      sortie[i] = out;
    }
    y = sortie;
  }
  return y;
}

/** Lissage aller-retour (sans décalage dans le temps), avec prolongement des bords. */
export function lisser(valeurs, pas, fc = REGLAGES_VBT.frequenceCoupure) {
  const fe = 1 / pas;
  if (fc >= fe / 2) return Float64Array.from(valeurs);
  const sections = sectionsButterworth(fc, fe);
  const n = valeurs.length;
  const bord = Math.min(n - 1, 15);
  const etendu = new Float64Array(n + 2 * bord);
  for (let i = 0; i < bord; i += 1) {
    etendu[i] = 2 * valeurs[0] - valeurs[bord - i];
    etendu[n + bord + i] = 2 * valeurs[n - 1] - valeurs[n - 2 - i];
  }
  for (let i = 0; i < n; i += 1) etendu[bord + i] = valeurs[i];
  const aller = filtrer(sections, etendu);
  const retour = filtrer(sections, aller.reverse()).reverse();
  return retour.slice(bord, bord + n);
}

/** Dérivée (différences centrées), comme numpy.gradient. */
export function deriver(y, pas) {
  const n = y.length;
  const d = new Float64Array(n);
  if (n < 2) return d;
  d[0] = (y[1] - y[0]) / pas;
  d[n - 1] = (y[n - 1] - y[n - 2]) / pas;
  for (let i = 1; i < n - 1; i += 1) d[i] = (y[i + 1] - y[i - 1]) / (2 * pas);
  return d;
}

/* ==========================================================================
   6. Les reps (phases de montée)
   ========================================================================== */

/**
 * Repère les montées d'au moins 15 cm. Début : dernier instant avant le pic de vitesse où la
 * barre est quasi immobile près du bas ; fin : premier instant après le pic où elle l'est près du haut.
 */
export function trouverReps(t, y, pas, R = REGLAGES_VBT, vitesses = null) {
  const v = vitesses ?? deriver(y, pas);
  const extremes = [];
  let mode = null;
  let imin = 0;
  let imax = 0;
  for (let i = 1; i < y.length; i += 1) {
    if (y[i] > y[imax]) imax = i;
    if (y[i] < y[imin]) imin = i;
    if (mode !== 'haut' && imax > imin && y[imax] - y[imin] > R.hysteresis) {
      extremes.push(['creux', imin]); mode = 'haut'; imin = imax;
    } else if (mode !== 'bas' && imin > imax && y[imax] - y[imin] > R.hysteresis) {
      extremes.push(['sommet', imax]); mode = 'bas'; imax = imin;
    }
  }
  if (mode === 'haut') extremes.push(['sommet', imax]);

  const reps = [];
  for (let k = 0; k + 1 < extremes.length; k += 1) {
    const [type1, i1] = extremes[k];
    const [type2, i2] = extremes[k + 1];
    if (type1 !== 'creux' || type2 !== 'sommet') continue;
    const bas = y[i1];
    const haut = y[i2];
    if (haut - bas < R.amplitudeMin) continue;
    let ip = i1;
    for (let i = i1; i <= i2; i += 1) if (v[i] > v[ip]) ip = i;
    let a = ip;
    while (a > i1 && !(v[a] < R.seuilVitesse && y[a] < bas + 0.15 * (haut - bas))) a -= 1;
    // Fin : la barre est près du haut, quasi immobile, ET ne remonte pas de plus de 3 mm
    // dans les 0,2 s qui suivent. Un simple ralentissement avant le verrouillage ne coupe
    // donc pas la rep, et les petits sauts du suivi après le verrouillage ne l'allongent pas.
    const tenue = Math.max(1, Math.round(R.tenueFin / pas));
    const arretee = (i) => {
      if (v[i] >= R.seuilVitesse) return false;
      for (let j = i; j <= Math.min(y.length - 1, i + tenue); j += 1) if (y[j] - y[i] > R.remonteeMax) return false;
      return true;
    };
    let b = ip;
    while (b < i2 && !(y[b] > bas + 0.85 * (haut - bas) && arretee(b))) b += 1;
    const duree = t[b] - t[a];
    if (duree < R.dureeMin) continue;
    // Valeurs impossibles en force athlétique : suivi perdu, pas une rep
    if (y[b] - y[a] > R.amplitudeMax || (y[b] - y[a]) / duree > R.vitesseMax) continue;
    reps.push({ a, b, debut: t[a], fin: t[b], amplitude: y[b] - y[a], duree, vitesseMoyenne: (y[b] - y[a]) / duree, vitesseMax: v[ip] });
  }
  return reps;
}

/* ==========================================================================
   7. Du suivi aux résultats
   ========================================================================== */

/** Interpolation linéaire de (t, y, v) sur une grille 8 fois plus fine. */
function affiner8(t, y, v) {
  const n = (t.length - 1) * 8 + 1;
  const tf = new Float64Array(n);
  const yf = new Float64Array(n);
  const vf = new Float64Array(n);
  for (let i = 0; i < t.length - 1; i += 1) {
    for (let k = 0; k < 8; k += 1) {
      const f = k / 8;
      const j = i * 8 + k;
      tf[j] = t[i] + f * (t[i + 1] - t[i]);
      yf[j] = y[i] + f * (y[i + 1] - y[i]);
      vf[j] = v[i] + f * (v[i + 1] - v[i]);
    }
  }
  tf[n - 1] = t.at(-1);
  yf[n - 1] = y.at(-1);
  vf[n - 1] = v.at(-1);
  return { t: tf, y: yf, v: vf };
}

/**
 * suivi : résultat de suivre() ; depart : { a } (demi-axe vertical en pixels) ;
 * diametre : diamètre réel du disque en mètres.
 */
/**
 * Jusqu'où le suivi est fiable : on s'arrête quand le disque s'éloigne de plus de
 * deux rayons sur le côté (barre reposée au rack, on marche avec), ou quand son bord
 * n'est plus net pendant 3 images (disque caché, ou sorti de l'image pour plus de moitié).
 * Un disque un peu coupé par le bord de l'image reste suivi normalement.
 */
function finDuSuivi(suivi, depart) {
  const { X, S } = suivi;
  const habituel = mediane(S);
  let faibles = 0;
  for (let i = 1; i < X.length; i += 1) {
    if (Math.abs(X[i] - X[0]) > 2 * depart.b) return i;
    faibles = S[i] < 0.35 * habituel ? faibles + 1 : 0;
    if (faibles >= 3) return i - 2;
  }
  return X.length;
}

export function resultats(suiviComplet, depart, diametre) {
  const coupe = finDuSuivi(suiviComplet, depart);
  const suivi = {
    t: suiviComplet.t.slice(0, coupe),
    X: suiviComplet.X.slice(0, coupe),
    Y: suiviComplet.Y.slice(0, coupe),
    S: suiviComplet.S.slice(0, coupe),
  };
  const interrompu = coupe < suiviComplet.t.length ? suiviComplet.t[coupe] : null;
  const { t, X, Y, S } = suivi;
  if (t.length < 10) return { reps: [], trajectoire: null, metresParPixel: diametre / 2 / depart.a, interrompu };
  const metresParPixel = diametre / 2 / depart.a;
  const hauteur = Y.map((y) => -(y - Y[0]) * metresParPixel);
  const ry = regulariser(t, hauteur);
  const rx = regulariser(t, X);
  const rpy = regulariser(t, Y);
  const y = lisser(ry.v, ry.pas);
  // Repérage des reps sur une grille 8 fois plus fine (interpolation de la courbe lissée) :
  // le début et la fin d'une montée ne tombent plus forcément sur une image.
  const v = deriver(y, ry.pas);
  const fin = affiner8(ry.t, y, v);
  const reps = trouverReps(fin.t, fin.y, ry.pas / 8, REGLAGES_VBT, fin.v);

  // Qualité du suivi pendant chaque montée
  const habituel = mediane(S);
  for (const rep of reps) {
    let pire = Infinity;
    for (let i = 0; i < t.length; i += 1) {
      if (t[i] >= rep.debut && t[i] <= rep.fin) pire = Math.min(pire, S[i] / habituel);
    }
    rep.qualite = Number.isFinite(pire) ? pire : 0;
    rep.douteuse = rep.qualite < REGLAGES_VBT.scoreDouteux;
  }

  // Trajectoire limitée à la série : de la descente de la 1re rep à la fin de la dernière
  // (la sortie du rack et le retour au rack ne sont pas dessinés).
  const [i0, i1] = fenetreDeLaSerie(ry.t, y, reps);
  const tx = lisser(rx.v, rx.pas);
  const ty = lisser(rpy.v, rpy.pas);
  const tt = ry.t.slice(i0, i1);
  return {
    reps,
    metresParPixel,
    interrompu,
    trajectoire: {
      t: tt,
      x: tx.slice(i0, i1),
      y: ty.slice(i0, i1),
      montee: tt.map((ti) => reps.some((r) => ti >= r.debut && ti <= r.fin)),
    },
  };
}

/**
 * Début et fin (indices, fin exclue) de la partie utile de la trajectoire.
 * Début : dernier instant, avant la 1re montée, où la barre était encore à sa hauteur
 * du haut (à 5 cm près) — c'est le début de la descente (squat, bench). Si la barre
 * n'y a jamais été (deadlift qui part du sol), 0,3 s avant la 1re montée.
 * Fin : 0,3 s après la fin de la dernière montée. Sans rep, toute la trajectoire.
 */
function fenetreDeLaSerie(t, y, reps) {
  if (reps.length === 0) return [0, t.length];
  const indice = (temps) => {
    let i = 0;
    while (i < t.length - 1 && t[i] < temps) i += 1;
    return i;
  };
  const premiere = reps[0];
  const iDebut = indice(premiere.debut);
  const hautVise = y[indice(premiere.fin)] - 0.05;
  let i0 = iDebut;
  while (i0 > 0 && y[i0] < hautVise) i0 -= 1;
  if (y[i0] < hautVise) i0 = indice(premiere.debut - 0.3);
  const i1 = Math.min(t.length, indice(reps.at(-1).fin + 0.3) + 1);
  return [i0, i1];
}
