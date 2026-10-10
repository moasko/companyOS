// L'archive ZIP en flux, relue par un décompresseur indépendant (Python).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nomEntree, zipEnFlux } from "../src/zip.js";

const lire = async (gen) => {
  const morceaux = [];
  for await (const b of gen) morceaux.push(b);
  return Buffer.concat(morceaux);
};

test("noms d'entrée : pas d'échappement hors de l'archive", () => {
  assert.equal(nomEntree("../../etc/passwd"), "etc/passwd");
  assert.equal(nomEntree("/abs\\\\chemin/./x.txt"), "abs/chemin/x.txt");
});

test("une archive valide, dossiers et noms accentués compris", async () => {
  const gros = Buffer.alloc(200_000, 7);
  const zip = await lire(
    zipEnFlux([
      { nom: "Contrats", dossier: true },
      { nom: "Contrats/Accord signé.txt", ouvrir: async () => Readable.from([Buffer.from("bonjour "), Buffer.from("le monde")]) },
      { nom: "Contrats/vide.txt", ouvrir: async () => Readable.from([]) },
      { nom: "gros.bin", ouvrir: async () => Readable.from([gros.subarray(0, 70_000), gros.subarray(70_000)]) },
    ]),
  );
  const dossier = mkdtempSync(join(tmpdir(), "zip-"));
  const fichier = join(dossier, "t.zip");
  writeFileSync(fichier, zip);
  const sortie = execFileSync("python3", [
    "-c",
    "import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({i.filename:len(z.read(i)) for i in z.infolist()}))",
    fichier,
  ]).toString();
  assert.deepEqual(JSON.parse(sortie), {
    "Contrats/": 0,
    "Contrats/Accord signé.txt": 16,
    "Contrats/vide.txt": 0,
    "gros.bin": 200_000,
  });
});
