// Bloc-notes — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE LE BLOC-NOTES EST, FACE AU TRAITEMENT DE TEXTE
//
// L'ancien Bloc-notes était un `<textarea>` mort : on y tapait, et tout
// disparaissait à la fermeture. Rien n'était enregistré nulle part.
//
// Le refaire pose une question : à quoi sert un bloc-notes quand l'OS a
// déjà un traitement de texte ? À autre chose, précisément. Le Traitement
// de texte produit des documents `.docx` — des pièces qu'on met en forme,
// range, partage, imprime. Le Bloc-notes sert à ce qu'on jette sur un
// papier : un numéro de téléphone, une liste de courses, une idée avant
// qu'elle file. Beaucoup de petites notes, aucune mise en forme, tout de
// suite. Deux besoins, deux outils.
//
// Les notes sont partagées par l'espace de travail, comme le reste des
// données de CompanyOS, et signées : un pense-bête collé sur le frigo
// commun, où chacun voit qui a écrit quoi.
// ─────────────────────────────────────────────────────────────────────────

/// Couleurs des notes. La première est la neutre par défaut ; les autres
/// servent à trier d'un coup d'œil (« les jaunes, c'est les urgences »).
export const COULEURS = [
  { id: "papier", fond: "#fffef7", bord: "#efe9d0" },
  { id: "jaune", fond: "#fff8c4", bord: "#f2e79b" },
  { id: "vert", fond: "#d8f5d0", bord: "#b6e6a8" },
  { id: "bleu", fond: "#d6ecfb", bord: "#aed7f2" },
  { id: "rose", fond: "#fbdde8", bord: "#f2b8cd" },
  { id: "mauve", fond: "#e9ddfb", bord: "#cfb6f2" },
];

export const couleurDe = (id) =>
  COULEURS.find((c) => c.id === id) || COULEURS[0];

/// Une note vierge.
export const NOTE_VIDE = () => ({ titre: "", corps: "", couleur: "papier", epingle: false });

/// Le titre à afficher : celui saisi, sinon la première ligne du corps,
/// sinon « Note sans titre ». Une note sans titre ne doit pas être une
/// tuile vide dans la liste.
export const titreDe = (note) => {
  const t = (note?.titre || "").trim();
  if (t) return t;
  const premiere = (note?.corps || "").split("\n").find((l) => l.trim());
  return premiere ? premiere.trim().slice(0, 60) : "Note sans titre";
};

/// L'aperçu du corps sous le titre : les lignes suivantes, condensées.
export const apercuDe = (note) => {
  const lignes = (note?.corps || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // Si le titre a été pris sur la première ligne, on ne la répète pas dans
  // l'aperçu — sinon la tuile affiche deux fois la même chose.
  const debut = (note?.titre || "").trim() ? 0 : 1;
  return lignes.slice(debut).join(" · ").slice(0, 120);
};

/// L'ordre d'affichage : les épinglées d'abord, puis les plus récemment
/// modifiées. Une note qu'on vient de toucher remonte — c'est celle qu'on
/// cherche.
export const trier = (notes = []) =>
  [...notes].sort((a, b) => {
    if (!!b.data?.epingle !== !!a.data?.epingle) return a.data?.epingle ? -1 : 1;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

/// Recherche dans le titre et le corps.
export const filtrer = (notes, requete) => {
  const q = (requete || "").trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) =>
    `${n.data?.titre || ""} ${n.data?.corps || ""}`.toLowerCase().includes(q),
  );
};

/// Une note vide ne mérite pas d'être enregistrée : ni titre, ni corps.
/// C'est ce qui évite de semer des notes fantômes en ouvrant « Nouvelle »
/// sans rien écrire.
export const estVide = (note) =>
  !(note?.titre || "").trim() && !(note?.corps || "").trim();
