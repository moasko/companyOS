// Classement commun du Centre de commande.

export const normaliserRecherche = (texte = "") =>
  texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();

export const scoreRecherche = (requete, candidat) => {
  const q = normaliserRecherche(requete);
  const texte = normaliserRecherche(candidat);
  if (!q) return 1;
  if (texte === q) return 120;
  if (texte.startsWith(q)) return 90 - Math.min(texte.length - q.length, 20);
  const mot = texte.split(/\s+/).findIndex((partie) => partie.startsWith(q));
  if (mot >= 0) return 70 - mot;
  const position = texte.indexOf(q);
  if (position >= 0) return 50 - Math.min(position, 20);

  // Recherche tolérante dans l'ordre : « nvp » retrouve « nouvelle présentation ».
  let curseur = 0;
  for (const caractere of q) {
    curseur = texte.indexOf(caractere, curseur);
    if (curseur < 0) return 0;
    curseur += 1;
  }
  return 20;
};

export const classerResultats = (elements, requete, limite = 12) =>
  elements
    .map((element, ordre) => ({
      ...element,
      ordre,
      score: scoreRecherche(requete, `${element.titre} ${element.mots || ""}`),
    }))
    .filter((element) => element.score > 0)
    .sort((a, b) => b.score - a.score || a.ordre - b.ordre)
    .slice(0, limite);
