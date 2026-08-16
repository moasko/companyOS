import { prisma } from "./db.js";

const conditionValide = (condition, valeurs) => {
  const valeur = valeurs?.[condition.champ];
  const attendu = condition.valeur ?? "";
  if (condition.operateur === "non-vide") return valeur !== "" && valeur != null;
  if (condition.operateur === "vide") return valeur === "" || valeur == null;
  if (condition.operateur === "different")
    return String(valeur ?? "") !== String(attendu);
  if (condition.operateur === "contient") {
    return String(valeur ?? "")
      .toLowerCase()
      .includes(String(attendu).toLowerCase());
  }
  if (condition.operateur === "superieur") return Number(valeur) > Number(attendu);
  return String(valeur ?? "") === String(attendu);
};

/// Exécute la logique déclarative d'une application CUSTOM avant l'écriture.
/// Le serveur reste l'autorité : import, UI et future API déclenchent donc
/// exactement les mêmes règles.
export const executerAutomatisations = async ({
  tenantId,
  userId,
  module,
  collection,
  declencheur,
  valeurs,
}) => {
  const app = await prisma.app.findFirst({
    where: { tenantId, slug: module, kind: "CUSTOM" },
    select: { definition: true, name: true },
  });
  const resultat = { ...valeurs };
  const declenchees = [];
  const notifications = [];

  for (const regle of app?.definition?.automatisations || []) {
    if (
      regle.active === false ||
      regle.collection !== collection ||
      ![declencheur, "toujours"].includes(regle.declencheur) ||
      !(regle.conditions || []).every((condition) => conditionValide(condition, resultat))
    ) {
      continue;
    }
    for (const action of regle.actions || []) {
      if (action.type === "definir" && action.champ)
        resultat[action.champ] = action.valeur;
      if (action.type === "notifier" && action.titre) {
        notifications.push({ titre: action.titre, message: action.message || null });
      }
    }
    declenchees.push(regle.nom || "Règle sans nom");
  }

  if (notifications.length) {
    await prisma.notification.createMany({
      data: notifications.map((notification) => ({
        tenantId,
        userId,
        source: module,
        titre: notification.titre,
        message: notification.message,
        lien: { app: module },
      })),
    });
  }

  return { valeurs: resultat, declenchees, app: app?.name || module };
};
