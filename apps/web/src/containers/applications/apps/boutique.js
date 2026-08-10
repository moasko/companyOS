// Boutique — la recherche du catalogue.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE FICHIER
//
// La recherche était un `includes()` sur le texte en minuscules. Deux
// échecs qu'on rencontre tous les jours :
//
//   « comptabilite »  ne trouvait pas « Comptabilité »
//   « cnps paie »     ne trouvait pas « Paie CNPS »
//
// Le premier compte plus qu'il n'y paraît : sur un clavier de téléphone, et
// pour la plupart des gens sur un clavier tout court, on ne met pas les
// accents en tapant une recherche. Une boutique qui répond « aucun
// résultat » à un mot correctement orthographié sans accent donne
// l'impression que l'application n'existe pas.
//
// Le second est l'ordre des mots : on tape ce qui vient à l'esprit, pas le
// libellé exact.
// ─────────────────────────────────────────────────────────────────────────

/// Réduit un texte à sa forme comparable : sans accent, sans casse, sans
/// ponctuation superflue.
///
/// `normalize("NFD")` sépare les lettres de leurs signes diacritiques, que
/// l'on retire ensuite : « é » devient « e ». C'est la façon la plus sûre
/// de le faire — une table de correspondance à la main oublie toujours un
/// caractère (ï, ç, œ, les langues voisines…).
export const normaliser = (texte) =>
  String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Apostrophes typographiques et tirets : « l'agenda » doit se trouver
    // en tapant « l agenda » comme « lagenda ».
    .replace(/['’‑-―-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/// Découpe une requête en mots, chacun devant être présent.
const mots = (requete) => normaliser(requete).split(" ").filter(Boolean);

/// Note une application pour une requête. `null` si elle ne correspond pas.
///
/// **Tous** les mots doivent être présents, dans n'importe quel ordre — un
/// mot en plus doit resserrer la recherche, jamais l'élargir. La note ne
/// sert qu'à classer ce qui reste.
///
/// Le nom pèse davantage que la description : qui tape « stock » cherche
/// l'application Stock, pas les six autres qui mentionnent le stock dans
/// leur texte de présentation.
export const noter = (app, requete, nomAffiche = "") => {
  const motsRequete = mots(requete);
  if (!motsRequete.length) return 0;

  const nom = normaliser(`${nomAffiche} ${app?.name || ""}`);
  const description = normaliser(app?.description || "");
  const categorie = normaliser(app?.category || "");
  const tout = `${nom} ${categorie} ${description}`;

  let note = 0;
  for (const mot of motsRequete) {
    if (!tout.includes(mot)) return null;

    // Le nom exact d'abord, puis un mot du nom, puis la catégorie, puis
    // le texte. C'est l'ordre dans lequel on s'attend à voir les résultats.
    if (nom === mot) note += 100;
    else if (nom.split(" ").includes(mot)) note += 40;
    else if (nom.startsWith(mot)) note += 30;
    else if (nom.includes(mot)) note += 20;
    else if (categorie.includes(mot)) note += 8;
    else note += 4;
  }
  return note;
};

/// Filtre et classe le catalogue.
///
/// `nomDe` permet de chercher aussi dans le nom **affiché**, qui dépend de
/// la langue : quelqu'un en anglais tape « Invoicing », quelqu'un en
/// français tape « Facturation », et les deux doivent trouver la même app.
///
/// Sans requête, l'ordre du catalogue est conservé : il est déjà classé par
/// catégorie puis par nom, et le bousculer sans raison désoriente.
export const chercher = (catalogue = [], requete = "", nomDe = () => "") => {
  if (!normaliser(requete)) return catalogue;

  const notes = [];
  for (const app of catalogue) {
    const note = noter(app, requete, nomDe(app));
    if (note !== null) notes.push({ app, note });
  }
  notes.sort((a, b) => b.note - a.note || a.app.name.localeCompare(b.app.name, "fr"));
  return notes.map((n) => n.app);
};
