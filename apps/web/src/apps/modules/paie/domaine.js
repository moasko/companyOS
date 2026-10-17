// Le calcul de la paie vit dans packages/shared (src/paie.js) : le shell et
// l'API (script de démonstration, contrôles) appliquent exactement les mêmes
// barèmes CNPS, ITS et FDFP.
export * from "@companyos/shared/paie";
export { montant as fcfa } from "../../../utils/monnaie.js";
