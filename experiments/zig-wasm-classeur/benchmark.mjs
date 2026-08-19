import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const chemin = new URL("./moteur.wasm", import.meta.url);
const moduleWasm = await WebAssembly.instantiate(await readFile(chemin));
const wasm = moduleWasm.instance.exports;
const longueur = Math.min(1_000_000, Number(wasm.capaciteBuffer()));
const valeursWasm = new Float64Array(wasm.memory.buffer, Number(wasm.adresseBuffer()), longueur);
const valeursJs = new Float64Array(longueur);

for (let i = 0; i < longueur; i += 1) valeursJs[i] = (i % 997) / 7;
valeursWasm.set(valeursJs);

const iterations = 80;
const seuil = 70;
const mesure = (fonction) => {
  const debut = performance.now();
  let resultat = 0;
  for (let i = 0; i < iterations; i += 1) resultat = fonction();
  return { resultat, millisecondes: performance.now() - debut };
};

const sommeJs = () => {
  let total = 0;
  for (let i = 0; i < valeursJs.length; i += 1) total += valeursJs[i];
  return total;
};
const sommeSiJs = () => {
  let total = 0;
  for (let i = 0; i < valeursJs.length; i += 1) {
    if (valeursJs[i] > seuil) total += valeursJs[i];
  }
  return total;
};

// Échauffement des deux moteurs avant la mesure.
sommeJs();
wasm.somme(longueur);
sommeSiJs();
wasm.sommeSiSuperieur(longueur, seuil);

const tests = [
  ["SOMME", mesure(sommeJs), mesure(() => wasm.somme(longueur))],
  ["SOMME.SI", mesure(sommeSiJs), mesure(() => wasm.sommeSiSuperieur(longueur, seuil))],
];

for (const [nom, js, zig] of tests) {
  const ecart = Math.abs(js.resultat - zig.resultat);
  if (ecart > 1e-7) throw new Error(`${nom}: résultats différents (${ecart})`);
  console.log(`${nom}: JS ${js.millisecondes.toFixed(1)} ms | Zig/WASM ${zig.millisecondes.toFixed(1)} ms | x${(js.millisecondes / zig.millisecondes).toFixed(2)}`);
}

console.log(`Module WASM: ${(await stat(chemin)).size} octets`);
console.log(`Données: ${longueur.toLocaleString("fr-FR")} nombres × ${iterations} itérations`);

