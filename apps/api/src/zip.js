import zlib from "node:zlib";

/// Archive ZIP produite au fil de l'eau, sans dépendance et sans tout
/// charger en mémoire : chaque fichier est lu en flux et recopié tel quel
/// (méthode « stockée », sans compression — la plupart des fichiers d'un
/// cloud d'entreprise, PDF, images, Office, sont déjà compressés).
///
/// Les tailles et le CRC ne sont connus qu'après lecture : chaque entrée
/// est donc suivie d'un « descripteur de données » (bit 3 des drapeaux),
/// ce que tous les décompresseurs savent lire. Noms en UTF-8 (bit 11).
///
/// Limites du format sans ZIP64 : 4 Go et 65 535 entrées — l'appelant
/// plafonne bien en dessous.

const DRAPEAUX = 0x0808; // descripteur de données + noms UTF-8

const dateDos = (d = new Date()) => {
  const heure = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { heure, jour };
};

/// Un nom d'entrée sûr : barres obliques, pas de « .. », pas de chemin absolu.
export const nomEntree = (chemin) =>
  String(chemin)
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");

/// `entrees` : itérable (ou itérable asynchrone) de
///   { nom, dossier?: true, date?: Date, ouvrir?: async () => Readable }
/// Rend un générateur asynchrone de Buffer — à passer à Readable.from.
export async function* zipEnFlux(entrees) {
  const centrale = [];
  let decalage = 0;

  for await (const e of entrees) {
    const dossier = !!e.dossier;
    const nom = Buffer.from(nomEntree(e.nom) + (dossier ? "/" : ""), "utf8");
    const { heure, jour } = dateDos(e.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(DRAPEAUX, 6);
    local.writeUInt16LE(0, 8); // stockée
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(jour, 12);
    // CRC et tailles à zéro : ils suivent dans le descripteur.
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);
    const debut = decalage;
    yield local;
    yield nom;
    decalage += local.length + nom.length;

    let crc = 0;
    let taille = 0;
    if (!dossier && e.ouvrir) {
      const flux = await e.ouvrir();
      for await (const morceau of flux) {
        const b = Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau);
        crc = zlib.crc32(b, crc);
        taille += b.length;
        yield b;
      }
      decalage += taille;
    }

    const descripteur = Buffer.alloc(16);
    descripteur.writeUInt32LE(0x08074b50, 0);
    descripteur.writeUInt32LE(crc >>> 0, 4);
    descripteur.writeUInt32LE(taille, 8);
    descripteur.writeUInt32LE(taille, 12);
    yield descripteur;
    decalage += 16;

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(DRAPEAUX, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(heure, 12);
    c.writeUInt16LE(jour, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(taille, 20);
    c.writeUInt32LE(taille, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(dossier ? 0x10 : 0, 38); // attribut « répertoire » (MS-DOS)
    c.writeUInt32LE(debut, 42);
    centrale.push(c, nom);
  }

  const tailleCentrale = centrale.reduce((s, b) => s + b.length, 0);
  for (const b of centrale) yield b;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  const n = centrale.length / 2;
  fin.writeUInt16LE(n, 8);
  fin.writeUInt16LE(n, 10);
  fin.writeUInt32LE(tailleCentrale, 12);
  fin.writeUInt32LE(decalage, 16);
  yield fin;
}
