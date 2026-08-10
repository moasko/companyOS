// Classeur — lecture du format .xls (Excel 97-2003).
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER EXISTE
//
// `.xls` et `.xlsx` ne partagent que trois lettres. Le second est un zip
// de XML, qu'on lit en une page. Le premier est un **conteneur binaire
// OLE2** — un mini système de fichiers, avec sa table d'allocation et son
// répertoire — à l'intérieur duquel un flux « Workbook » enchaîne des
// enregistrements binaires BIFF8.
//
// On l'implémente parce que c'est le format des exports d'anciens
// logiciels de gestion, encore très présents ici. Dire « convertissez-le
// d'abord en .xlsx » revient à renvoyer l'utilisateur vers l'outil qu'il
// essaie précisément de quitter.
//
// CE QUI EST LU, ET CE QUI NE L'EST PAS
//
// Les **valeurs** : texte, nombres, dates, résultats de formules mis en
// cache, et les noms de feuilles. C'est ce qu'il faut pour rouvrir un
// fichier et continuer à travailler.
//
// Ne sont pas lus : la mise en forme (au-delà de la reconnaissance des
// dates), les formules elles-mêmes (leur *résultat* l'est, ce qui suffit à
// afficher juste), les graphiques, les macros. Un classeur sans ses
// couleurs vaut mieux qu'un classeur qu'on ne peut pas ouvrir.
//
// La lecture est en **lecture seule** : on ne réécrit jamais du .xls.
// Enregistrer produit du .xlsx, le format vivant.
// ─────────────────────────────────────────────────────────────────────────

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/// Reconnaît un conteneur OLE2 à ses huit premiers octets.
///
/// Le seuil est `>= 8`, pas `> 8` : l'appelant ne lit souvent que les huit
/// octets de la signature, et un `>` renvoyait alors toujours faux — le
/// fichier partait dans le lecteur `.xlsx`, qui échouait sur « ce n'est pas
/// un zip ».
export const estXls = (octets) =>
  octets.length >= SIGNATURE.length && SIGNATURE.every((b, i) => octets[i] === b);

// ---------------------------------------------------------------------------
// 1. Le conteneur OLE2 (Compound File Binary Format)
// ---------------------------------------------------------------------------
//
// Un fichier OLE2 est découpé en secteurs de taille fixe. Une table
// d'allocation (la FAT) dit, pour chaque secteur, quel est le suivant de sa
// chaîne — exactement comme une FAT de disquette. Un répertoire liste les
// flux qu'il contient ; c'est là qu'on trouve « Workbook ».
//
// Les petits flux (< 4096 octets) vivent dans un « mini-flux » avec sa
// propre table, pour ne pas gaspiller un secteur entier par flux.

const FIN_DE_CHAINE = 0xfffffffe;
const SECTEUR_LIBRE = 0xffffffff;

const lireChaine = (vue, fat, premier, taille, tailleSecteur, decalage = 512) => {
  const sortie = new Uint8Array(taille);
  let ecrit = 0;
  let secteur = premier;
  let garde = 0;

  while (secteur !== FIN_DE_CHAINE && secteur !== SECTEUR_LIBRE && ecrit < taille) {
    // Un fichier abîmé peut boucler : on borne le parcours au nombre de
    // secteurs existants plutôt que de figer l'onglet.
    if (garde++ > fat.length + 8) break;
    const debut = decalage + secteur * tailleSecteur;
    // Un fichier tronqué ou mal formé pointe vers des secteurs qui
    // n'existent pas : on s'arrête là plutôt que de laisser remonter une
    // erreur brute de DataView, illisible pour l'utilisateur.
    if (debut >= vue.byteLength) break;
    const n = Math.min(tailleSecteur, taille - ecrit, vue.byteLength - debut);
    for (let i = 0; i < n; i += 1) sortie[ecrit + i] = vue.getUint8(debut + i);
    ecrit += n;
    secteur = fat[secteur] ?? FIN_DE_CHAINE;
  }
  return sortie;
};

/// Extrait le flux « Workbook » (ou « Book », nom utilisé par Excel 5).
const extraireWorkbook = (octets) => {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const tailleSecteur = 1 << vue.getUint16(0x1e, true);
  const tailleMini = 1 << vue.getUint16(0x20, true);
  const nbFat = vue.getUint32(0x2c, true);
  const premierRepertoire = vue.getUint32(0x30, true);
  const seuilMini = vue.getUint32(0x38, true);
  const premierMiniFat = vue.getUint32(0x3c, true);
  const nbMiniFat = vue.getUint32(0x40, true);
  const premierDifat = vue.getUint32(0x44, true);
  const nbDifat = vue.getUint32(0x48, true);

  // La DIFAT : la liste des secteurs qui contiennent la FAT. Les 109
  // premiers tiennent dans l'en-tête ; au-delà, ils se chaînent.
  const secteursFat = [];
  for (let i = 0; i < 109 && i < nbFat; i += 1) {
    secteursFat.push(vue.getUint32(0x4c + i * 4, true));
  }
  let s = premierDifat;
  for (let k = 0; k < nbDifat && s !== FIN_DE_CHAINE && s !== SECTEUR_LIBRE; k += 1) {
    const base = 512 + s * tailleSecteur;
    const parSecteur = tailleSecteur / 4 - 1;
    for (let i = 0; i < parSecteur; i += 1) {
      const v = vue.getUint32(base + i * 4, true);
      if (v !== SECTEUR_LIBRE) secteursFat.push(v);
    }
    s = vue.getUint32(base + parSecteur * 4, true);
  }

  // La FAT elle-même, concaténée depuis ses secteurs.
  const fat = [];
  for (const sec of secteursFat) {
    const base = 512 + sec * tailleSecteur;
    if (base + tailleSecteur > octets.byteLength) continue;
    for (let i = 0; i < tailleSecteur / 4; i += 1) fat.push(vue.getUint32(base + i * 4, true));
  }

  // Le répertoire : des entrées de 128 octets.
  const repertoire = lireChaine(vue, fat, premierRepertoire, fat.length * tailleSecteur, tailleSecteur);
  const vueRep = new DataView(repertoire.buffer);
  const entrees = [];
  for (let i = 0; i + 128 <= repertoire.length; i += 128) {
    const longueurNom = vueRep.getUint16(i + 0x40, true);
    if (longueurNom < 2) continue;
    let nom = "";
    for (let j = 0; j < longueurNom - 2; j += 2) nom += String.fromCharCode(vueRep.getUint16(i + j, true));
    entrees.push({
      nom,
      type: vueRep.getUint8(i + 0x42),
      secteur: vueRep.getUint32(i + 0x74, true),
      taille: vueRep.getUint32(i + 0x78, true),
    });
  }

  const workbook = entrees.find((e) => e.nom === "Workbook" || e.nom === "Book");
  if (!workbook) throw new Error("Ce fichier .xls ne contient pas de classeur lisible.");

  // Un flux volumineux vit dans les secteurs normaux ; un petit vit dans
  // le mini-flux, lui-même stocké dans le flux de l'entrée racine.
  if (workbook.taille >= seuilMini) {
    return lireChaine(vue, fat, workbook.secteur, workbook.taille, tailleSecteur);
  }

  const racine = entrees[0];
  const miniFatBrut = lireChaine(vue, fat, premierMiniFat, nbMiniFat * tailleSecteur, tailleSecteur);
  const vueMini = new DataView(miniFatBrut.buffer);
  const miniFat = [];
  for (let i = 0; i + 4 <= miniFatBrut.length; i += 4) miniFat.push(vueMini.getUint32(i, true));

  const miniFlux = lireChaine(vue, fat, racine.secteur, racine.taille, tailleSecteur);
  const vueFlux = new DataView(miniFlux.buffer);
  return lireChaine(vueFlux, miniFat, workbook.secteur, workbook.taille, tailleMini, 0);
};

// ---------------------------------------------------------------------------
// 2. Les enregistrements BIFF8
// ---------------------------------------------------------------------------

const REC = {
  FORMULA: 0x0006, EOF: 0x000a, CONTINUE: 0x003c, BOUNDSHEET: 0x0085,
  SST: 0x00fc, MULRK: 0x00bd, MULBLANK: 0x00be, FORMAT: 0x041e, XF: 0x00e0,
  LABEL: 0x0204, BOOLERR: 0x0205, STRING: 0x0207, NUMBER: 0x0203,
  RK: 0x027e, LABELSST: 0x00fd, BOF: 0x0809, BLANK: 0x0201, RSTRING: 0x00d6,
};

/// Découpe le flux en enregistrements { type, données }.
const decouperEnregistrements = (flux) => {
  const vue = new DataView(flux.buffer, flux.byteOffset, flux.byteLength);
  const liste = [];
  let i = 0;
  while (i + 4 <= flux.length) {
    const type = vue.getUint16(i, true);
    const longueur = vue.getUint16(i + 2, true);
    if (i + 4 + longueur > flux.length) break;
    liste.push({ type, debut: i + 4, longueur, vue });
    i += 4 + longueur;
  }
  return liste;
};

/// Le nombre codé « RK » : Excel range ainsi les valeurs courantes sur
/// quatre octets au lieu de huit.
///
/// Les deux bits de poids faible sont des drapeaux : l'un dit que la
/// valeur est un entier plutôt que les 30 bits de poids fort d'un flottant,
/// l'autre qu'il faut diviser par cent (les montants à deux décimales).
const decoderRK = (brut) => {
  const entier = (brut & 0x02) !== 0;
  const centieme = (brut & 0x01) !== 0;
  let valeur;
  if (entier) {
    valeur = brut >> 2; // décalage arithmétique : conserve le signe
  } else {
    const tampon = new ArrayBuffer(8);
    const v = new DataView(tampon);
    v.setUint32(4, brut & 0xfffffffc, true); // les 30 bits de poids fort
    v.setUint32(0, 0, true);
    valeur = v.getFloat64(0, true);
  }
  return centieme ? valeur / 100 : valeur;
};

/// Chaîne BIFF8. Le drapeau dit si les caractères tiennent sur un ou deux
/// octets ; des extras (mise en forme riche, annotations extrême-orientales)
/// peuvent suivre et doivent être sautés.
const lireTexte = (vue, position, nbCaracteres) => {
  const drapeau = vue.getUint8(position);
  let p = position + 1;
  const large = (drapeau & 0x01) !== 0;
  const richTexte = (drapeau & 0x08) !== 0;
  const extremeOrient = (drapeau & 0x04) !== 0;

  let nbRuns = 0;
  let tailleExtra = 0;
  if (richTexte) { nbRuns = vue.getUint16(p, true); p += 2; }
  if (extremeOrient) { tailleExtra = vue.getUint32(p, true); p += 4; }

  let texte = "";
  for (let i = 0; i < nbCaracteres; i += 1) {
    if (large) { texte += String.fromCharCode(vue.getUint16(p, true)); p += 2; }
    else { texte += String.fromCharCode(vue.getUint8(p)); p += 1; }
  }
  return { texte, fin: p + nbRuns * 4 + tailleExtra };
};

/// La table des chaînes partagées, qui peut déborder sur des
/// enregistrements CONTINUE — et une chaîne peut être coupée en plein
/// milieu, le drapeau d'encodage étant alors répété au début du morceau
/// suivant. C'est le point le plus délicat du format.
const lireSST = (enregistrements, indexSST) => {
  const morceaux = [enregistrements[indexSST]];
  for (let i = indexSST + 1; i < enregistrements.length; i += 1) {
    if (enregistrements[i].type !== REC.CONTINUE) break;
    morceaux.push(enregistrements[i]);
  }

  // On recolle les morceaux, en retenant où commence chacun : le drapeau
  // d'encodage se relit à chaque frontière.
  let total = 0;
  for (const m of morceaux) total += m.longueur;
  const donnees = new Uint8Array(total);
  const frontieres = [];
  let ecrit = 0;
  for (const m of morceaux) {
    frontieres.push(ecrit);
    for (let i = 0; i < m.longueur; i += 1) donnees[ecrit + i] = m.vue.getUint8(m.debut + i);
    ecrit += m.longueur;
  }
  const vue = new DataView(donnees.buffer);
  const estFrontiere = new Set(frontieres);

  const nbUniques = vue.getUint32(4, true);
  const chaines = [];
  let p = 8;

  for (let n = 0; n < nbUniques && p + 3 <= donnees.length; n += 1) {
    const nbCar = vue.getUint16(p, true);
    p += 2;
    let drapeau = vue.getUint8(p);
    p += 1;
    let large = (drapeau & 0x01) !== 0;
    const riche = (drapeau & 0x08) !== 0;
    const orient = (drapeau & 0x04) !== 0;
    let runs = 0;
    let extra = 0;
    if (riche) { runs = vue.getUint16(p, true); p += 2; }
    if (orient) { extra = vue.getUint32(p, true); p += 4; }

    let texte = "";
    for (let i = 0; i < nbCar; i += 1) {
      // Frontière de CONTINUE atteinte au milieu de la chaîne : un octet
      // de drapeau s'intercale, et l'encodage peut changer.
      if (estFrontiere.has(p)) {
        drapeau = vue.getUint8(p);
        large = (drapeau & 0x01) !== 0;
        p += 1;
      }
      if (large) { texte += String.fromCharCode(vue.getUint16(p, true)); p += 2; }
      else { texte += String.fromCharCode(vue.getUint8(p)); p += 1; }
    }
    p += runs * 4 + extra;
    chaines.push(texte);
  }
  return chaines;
};

const EST_FORMAT_DATE = /[dmy]{2}|jj|aa/i;

/// Le nombre de série d'Excel en date ISO. Même origine décalée que dans
/// le .xlsx : 1900 y passe pour bissextile.
const serieVersDate = (n) => {
  const d = new Date((Number(n) - 25569) * 86400000);
  return Number.isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// 3. Lecture d'un classeur
// ---------------------------------------------------------------------------

export const depuisXls = async (blob, titre = "Classeur") => {
  const octets = new Uint8Array(await blob.arrayBuffer());
  if (!estXls(octets)) throw new Error("Ce fichier n'est pas un classeur Excel 97-2003.");

  const flux = extraireWorkbook(octets);
  const enregistrements = decouperEnregistrements(flux);

  // Premier passage : chaînes partagées, formats, styles, feuilles.
  const formats = new Map(); // ifmt → code
  const xfDate = new Set(); // index XF portant un format de date
  const xfIfmt = [];
  const feuillesDeclarees = [];
  let sst = [];

  for (let i = 0; i < enregistrements.length; i += 1) {
    const r = enregistrements[i];
    if (r.type === REC.SST) { sst = lireSST(enregistrements, i); continue; }
    if (r.type === REC.FORMAT) {
      const ifmt = r.vue.getUint16(r.debut, true);
      const nb = r.vue.getUint16(r.debut + 2, true);
      formats.set(ifmt, lireTexte(r.vue, r.debut + 4, nb).texte);
      continue;
    }
    if (r.type === REC.XF) {
      xfIfmt.push(r.vue.getUint16(r.debut + 2, true));
      continue;
    }
    if (r.type === REC.BOUNDSHEET) {
      const position = r.vue.getUint32(r.debut, true);
      const nb = r.vue.getUint8(r.debut + 6);
      feuillesDeclarees.push({
        position,
        nom: lireTexte(r.vue, r.debut + 7, nb).texte || `Feuille ${feuillesDeclarees.length + 1}`,
      });
    }
  }

  // Les formats intégrés 14 à 22 et 45 à 47 sont des dates et des heures ;
  // au-delà de 163 ce sont des formats personnalisés, qu'on juge sur leur
  // code.
  xfIfmt.forEach((ifmt, index) => {
    const integre = (ifmt >= 14 && ifmt <= 22) || (ifmt >= 45 && ifmt <= 47);
    const perso = formats.get(ifmt);
    if (integre || (perso && EST_FORMAT_DATE.test(perso))) xfDate.add(index);
  });

  // Second passage : les cellules, feuille par feuille. Chaque BOUNDSHEET
  // donne la position de son BOF dans le flux ; on avance ensuite jusqu'au
  // EOF correspondant.
  const parPosition = new Map();
  let position = 0;
  for (const r of enregistrements) {
    parPosition.set(position, r);
    position += 4 + r.longueur;
  }
  const indexParPosition = new Map();
  enregistrements.forEach((r, i) => indexParPosition.set(r.debut - 4, i));

  const feuilles = [];
  for (const decl of feuillesDeclarees) {
    const depart = indexParPosition.get(decl.position);
    if (depart === undefined) continue;

    const cellules = [];
    let maxL = 0;
    let maxC = 0;
    const poser = (l, c, valeur, xf) => {
      if (valeur === "" || valeur === null || valeur === undefined) return;
      const estDate = xfDate.has(xf) && typeof valeur === "number";
      (cellules[l] ??= [])[c] = estDate
        ? { v: serieVersDate(valeur), s: { format: "date" } }
        : { v: String(valeur) };
      maxL = Math.max(maxL, l);
      maxC = Math.max(maxC, c);
    };

    for (let i = depart + 1; i < enregistrements.length; i += 1) {
      const r = enregistrements[i];
      if (r.type === REC.EOF) break;
      const v = r.vue;
      const d = r.debut;

      switch (r.type) {
        case REC.LABELSST: {
          const isst = v.getUint32(d + 6, true);
          poser(v.getUint16(d, true), v.getUint16(d + 2, true), sst[isst] ?? "", v.getUint16(d + 4, true));
          break;
        }
        case REC.LABEL:
        case REC.RSTRING: {
          const nb = v.getUint16(d + 6, true);
          poser(v.getUint16(d, true), v.getUint16(d + 2, true),
                lireTexte(v, d + 8, nb).texte, v.getUint16(d + 4, true));
          break;
        }
        case REC.NUMBER:
          poser(v.getUint16(d, true), v.getUint16(d + 2, true),
                v.getFloat64(d + 6, true), v.getUint16(d + 4, true));
          break;
        case REC.RK:
          poser(v.getUint16(d, true), v.getUint16(d + 2, true),
                decoderRK(v.getInt32(d + 6, true)), v.getUint16(d + 4, true));
          break;
        case REC.MULRK: {
          const ligne = v.getUint16(d, true);
          const premiere = v.getUint16(d + 2, true);
          const nb = (r.longueur - 6) / 6;
          for (let k = 0; k < nb; k += 1) {
            const base = d + 4 + k * 6;
            poser(ligne, premiere + k, decoderRK(v.getInt32(base + 2, true)), v.getUint16(base, true));
          }
          break;
        }
        case REC.FORMULA: {
          // Le résultat est mis en cache sur huit octets. Si les deux
          // derniers valent 0xFFFF, ce n'est pas un nombre : le type est
          // dans le premier octet, et une chaîne arrive dans le STRING
          // qui suit.
          const ligne = v.getUint16(d, true);
          const colonne = v.getUint16(d + 2, true);
          const xf = v.getUint16(d + 4, true);
          if (v.getUint16(d + 12, true) === 0xffff) {
            const genre = v.getUint8(d + 6);
            if (genre === 1) poser(ligne, colonne, v.getUint8(d + 8) ? "VRAI" : "FAUX", xf);
            else if (genre === 2) poser(ligne, colonne, "#ERREUR", xf);
            else if (genre === 0) {
              const suivant = enregistrements[i + 1];
              if (suivant?.type === REC.STRING) {
                const nb = suivant.vue.getUint16(suivant.debut, true);
                poser(ligne, colonne, lireTexte(suivant.vue, suivant.debut + 2, nb).texte, xf);
              }
            }
          } else {
            poser(ligne, colonne, v.getFloat64(d + 6, true), xf);
          }
          break;
        }
        default:
          break;
      }
    }

    const L = Math.max(maxL + 1, 20);
    const C = Math.max(maxC + 1, 8);
    const grille = Array.from({ length: L }, (_, l) =>
      Array.from({ length: C }, (_, c) => cellules[l]?.[c] || { v: "" }),
    );
    feuilles.push({ nom: decl.nom, cellules: grille, largeurs: {}, figees: { lignes: 0, colonnes: 0 } });
  }

  if (!feuilles.length) throw new Error("Ce classeur ne contient aucune feuille lisible.");
  return { titre, feuilles, version: 1 };
};
