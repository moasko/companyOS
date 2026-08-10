// Règles et manipulations d'un tableau de projet.
//
// Tout ce qui n'est pas du rendu vit ici : ordonnancement des cartes,
// déplacements, filtres, statistiques, échéances. `index.jsx` ne s'occupe
// que de la mise en page et de l'état d'écran.

/// Étiquettes, à la Trello : une couleur et un nom qu'on peut lire.
export const ETIQUETTES = [
  { id: "urgent", nom: "Urgent", couleur: "#eb5a46" },
  { id: "client", nom: "Client", couleur: "#0079bf" },
  { id: "interne", nom: "Interne", couleur: "#61bd4f" },
  { id: "attente", nom: "En attente", couleur: "#f2d600" },
  { id: "bloque", nom: "Bloqué", couleur: "#c377e0" },
  { id: "facture", nom: "À facturer", couleur: "#ff9f1a" },
];

export const etiquetteDe = (id) => ETIQUETTES.find((e) => e.id === id);

/// Colonnes d'un tableau neuf. Trois états suffisent pour démarrer ;
/// l'utilisateur en ajoute ensuite autant qu'il veut.
export const COLONNES_PAR_DEFAUT = () => [
  { id: idCourt(), titre: "À faire" },
  { id: idCourt(), titre: "En cours" },
  { id: idCourt(), titre: "Terminé" },
];

/// Identifiant court, suffisant pour distinguer des colonnes ou des
/// éléments de liste à l'intérieur d'un même enregistrement.
export function idCourt() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Ordonnancement
// ---------------------------------------------------------------------------

/// Les cartes d'une colonne, dans l'ordre d'affichage.
export const cartesDe = (cartes, colonneId) =>
  cartes
    .filter((c) => c.data.colonneId === colonneId)
    .sort((a, b) => (a.data.ordre ?? 0) - (b.data.ordre ?? 0));

/// Rang à donner à une carte déposée à l'index `position` d'une colonne.
///
/// On intercale entre les voisins plutôt que de renuméroter toute la
/// colonne : un déplacement n'écrit ainsi qu'un seul enregistrement.
/// Quand il n'y a plus de place entre deux rangs, `renumeroter` remet
/// la série à plat.
export const rangPour = (cartes, colonneId, position, carteDeplacee) => {
  const liste = cartesDe(cartes, colonneId).filter(
    (c) => c.id !== carteDeplacee?.id,
  );
  const avant = liste[position - 1]?.data.ordre;
  const apres = liste[position]?.data.ordre;

  if (avant == null && apres == null) return 1000;
  if (avant == null) return apres - 100;
  if (apres == null) return avant + 100;
  return (avant + apres) / 2;
};

/// Vrai quand deux rangs sont devenus trop proches pour qu'on puisse
/// encore intercaler quoi que ce soit entre eux.
export const besoinDeRenumeroter = (cartes, colonneId) => {
  const liste = cartesDe(cartes, colonneId);
  for (let i = 1; i < liste.length; i++) {
    if (Math.abs(liste[i].data.ordre - liste[i - 1].data.ordre) < 0.001) {
      return true;
    }
  }
  return false;
};

export const renumeroter = (cartes, colonneId) =>
  cartesDe(cartes, colonneId).map((c, i) => ({ carte: c, ordre: (i + 1) * 1000 }));

/// Déplace un élément d'une liste ordonnée — les tâches d'une check-list
/// se réordonnent ainsi par glisser-déposer, sans rang à calculer :
/// l'ordre est celui du tableau, qui tient dans un seul enregistrement.
export const deplacerDansListe = (liste, deId, versIndex) => {
  const depart = liste.findIndex((x) => x.id === deId);
  if (depart < 0) return liste;

  const copie = [...liste];
  const [element] = copie.splice(depart, 1);
  // L'index visé se décale d'un cran quand on retire un élément situé avant.
  const cible = depart < versIndex ? versIndex - 1 : versIndex;
  copie.splice(Math.max(0, Math.min(copie.length, cible)), 0, element);
  return copie;
};

// ---------------------------------------------------------------------------
// Échéances
// ---------------------------------------------------------------------------

const jour = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/// Statut d'une échéance : en retard, aujourd'hui, bientôt, ou lointaine.
export const statutEcheance = (echeance, terminee) => {
  if (!echeance) return null;
  if (terminee) return "faite";

  const cible = jour(echeance);
  const aujourdHui = jour(new Date());
  const jours = Math.round((cible - aujourdHui) / 86400000);

  if (jours < 0) return "retard";
  if (jours === 0) return "aujourdhui";
  if (jours <= 3) return "bientot";
  return "lointain";
};

export const formatEcheance = (echeance) => {
  if (!echeance) return "";
  const cible = jour(echeance);
  const jours = Math.round((cible - jour(new Date())) / 86400000);

  if (jours === 0) return "Aujourd'hui";
  if (jours === 1) return "Demain";
  if (jours === -1) return "Hier";
  if (jours > 1 && jours <= 7) return `Dans ${jours} jours`;
  if (jours < -1 && jours >= -7) return `Il y a ${-jours} jours`;

  return cible.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

// ---------------------------------------------------------------------------
// Filtres et recherche
// ---------------------------------------------------------------------------

export const FILTRE_VIDE = {
  texte: "",
  etiquette: null,
  membre: null,
  retardSeulement: false,
};

export const filtrer = (cartes, filtre, colonneTerminee) => {
  const q = filtre.texte.trim().toLowerCase();

  return cartes.filter((c) => {
    const d = c.data;

    if (q) {
      const champs = [d.titre, d.description, ...(d.checklist || []).map((x) => x.texte)];
      if (!champs.filter(Boolean).some((t) => t.toLowerCase().includes(q))) {
        return false;
      }
    }
    if (filtre.etiquette && !(d.etiquettes || []).includes(filtre.etiquette)) {
      return false;
    }
    if (filtre.membre && d.assigneId !== filtre.membre) return false;
    if (filtre.retardSeulement) {
      const terminee = d.colonneId === colonneTerminee;
      if (statutEcheance(d.echeance, terminee) !== "retard") return false;
    }
    return true;
  });
};

export const filtreActif = (filtre) =>
  !!(filtre.texte || filtre.etiquette || filtre.membre || filtre.retardSeulement);

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

/// Indicateurs d'un tableau. La dernière colonne fait office de « terminé » :
/// c'est la convention d'un kanban, et elle évite de demander à
/// l'utilisateur de désigner une colonne d'arrivée.
export const statistiques = (tableau, cartes) => {
  const colonnes = tableau?.data.colonnes || [];
  const derniere = colonnes[colonnes.length - 1]?.id;

  const total = cartes.length;
  const terminees = cartes.filter((c) => c.data.colonneId === derniere).length;
  const enRetard = cartes.filter(
    (c) =>
      statutEcheance(c.data.echeance, c.data.colonneId === derniere) === "retard",
  ).length;
  const sansAssigne = cartes.filter((c) => !c.data.assigneId).length;

  return {
    total,
    terminees,
    enRetard,
    sansAssigne,
    avancement: total ? Math.round((terminees / total) * 100) : 0,
    colonneTerminee: derniere,
  };
};

/// Avancement d'une check-list, pour la pastille sur la carte.
export const avancementChecklist = (checklist = []) => {
  if (!checklist.length) return null;
  const faits = checklist.filter((x) => x.fait).length;
  return { faits, total: checklist.length, complet: faits === checklist.length };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const csvEchappe = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/// Le tableau au format CSV — colonne, titre, échéance, assigné, étiquettes.
export const versCsv = (tableau, cartes, membres, clients) => {
  const colonnes = tableau.data.colonnes || [];
  const nomColonne = (id) => colonnes.find((c) => c.id === id)?.titre || "";
  const nomMembre = (id) => membres.find((m) => m.id === id)?.name || "";
  const nomClient = (id) => {
    const c = clients.find((x) => x.id === id);
    return c ? c.data.entreprise || c.data.nom : "";
  };

  const lignes = [
    ["Colonne", "Titre", "Échéance", "Assigné", "Client", "Étiquettes", "Check-list"],
    ...cartes.map((c) => {
      const av = avancementChecklist(c.data.checklist);
      return [
        nomColonne(c.data.colonneId),
        c.data.titre,
        c.data.echeance
          ? new Date(c.data.echeance).toLocaleDateString("fr-FR")
          : "",
        nomMembre(c.data.assigneId),
        nomClient(c.data.liens?.clientId),
        (c.data.etiquettes || []).map((e) => etiquetteDe(e)?.nom || e).join(", "),
        av ? `${av.faits}/${av.total}` : "",
      ];
    }),
  ];

  // Point-virgule : c'est ce qu'attend Excel en configuration française.
  return lignes.map((l) => l.map(csvEchappe).join(";")).join("\n");
};
