import test from "node:test";
import assert from "node:assert/strict";

test("campagnes : français et anglais complets, aucune clé utilisée ne manque", async () => {
  const { TEXTES } = await import("../src/apps/modules/campagnes/textes.js");
  const fs = await import("node:fs");
  const fr = Object.keys(TEXTES.fr);
  const en = Object.keys(TEXTES.en);
  assert.deepEqual(fr.filter((k) => !TEXTES.en[k]), []);
  assert.deepEqual(en.filter((k) => !TEXTES.fr[k]), []);
  const racine = new URL("../src/apps/modules/campagnes/", import.meta.url);
  const fichiers = ["index.jsx", "commun.jsx", ...fs.readdirSync(new URL("vues/", racine)).map((f) => `vues/${f}`)];
  const utilisees = new Set();
  for (const f of fichiers) {
    const src = fs.readFileSync(new URL(f, racine), "utf8");
    for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) utilisees.add(m[1]);
    // Les libellés du menu, écrits en données.
    for (const m of src.matchAll(/(?:label|groupe): "((?:nav|grp)[A-Za-z]+)"/g)) utilisees.add(m[1]);
  }
  const { RECETTES, TYPES_BLOCS, CHAMPS_IMPORT } = await import("@companyos/shared/campagnes");
  const composees = {
    statut_: ["brouillon", "programmee", "envoi", "pause", "terminee"],
    crm_: ["tous", "actif", "prospect", "inactif"],
    origine_: ["formulaire", "import", "crm"],
    source_: [...new Set(RECETTES.map((r) => r.source))],
    onglet_: ["toutes", "brouillon", "programmee", "envoi", "terminee"],
    etape_: ["audience", "contenu", "envoi"],
    mois_: ["1", "3", "6", "12"],
    lancer_: ["nom", "audience", "sujet", "texte", "cta", "ab", "test"],
    bloc_: TYPES_BLOCS,
    blocAide_: TYPES_BLOCS,
    vide_: TYPES_BLOCS,
    var_: ["client", "contact", "prenom", "ville", "entreprise", "numero", "annees"],
    verif_: ["contenu", "contenu_ko", "boutons", "boutons_ko", "images", "images_ko", "poids", "poids_ko"],
    reseau_: ["site", "whatsapp", "facebook", "instagram", "linkedin"],
    creneau_: ["demain8", "lundi9", "mardi830"],
    filtre_: ["tous", "ouverts", "cliques", "nonOuverts", "echecs", "desinscrits"],
    recette_: RECETTES.map((r) => r.id),
    recetteD_: RECETTES.map((r) => r.id),
    decl_: RECETTES.map((r) => r.id),
    cond_: RECETTES.filter((r) => r.sortie).map((r) => r.id),
    regleSortie_: RECETTES.filter((r) => r.sortie).map((r) => r.id),
    etapeScenario_: ["declencheur", "attendre", "condition", "email"],
    contacts_: ["tous", "engages", "inactifs", "rebonds", "desinscrits", "aConfirmer", "sansEmail"],
    import_: ["1", "2", "3"],
    champ_: CHAMPS_IMPORT,
  };
  for (const [p, vs] of Object.entries(composees)) for (const v of vs) utilisees.add(p + v);
  assert.deepEqual([...utilisees].filter((k) => !TEXTES.fr[k]), []);
});
