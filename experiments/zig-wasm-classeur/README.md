# Prototype Zig/WebAssembly du Classeur

Expérience isolée, non chargée par CompanyOS. Elle compare deux agrégations
de cellules en JavaScript et dans un noyau Zig compilé en WebAssembly.

Compilation (Zig 0.16) :

```powershell
zig build-exe moteur.zig -target wasm32-freestanding -O ReleaseFast -fno-entry --export-memory -rdynamic -femit-bin=moteur.wasm
node benchmark.mjs
```

Une intégration réelle devra vivre dans un Web Worker et conserver le moteur
JavaScript comme solution de secours.
