// Petit magasin hors Redux pour le sélecteur d'emplacement.
// Une promesse ne se range pas proprement dans un store Redux ; ici
// `requestSave` en renvoie une que le composant résout au clic.

let listener = null;
let current = null;

export const subscribeSavePicker = (fn) => {
  listener = fn;
  return () => {
    listener = null;
  };
};

export const getSaveRequest = () => current;

/// Ouvre le sélecteur et attend la décision de l'utilisateur.
/// Résout avec { parentId, name } ou null si annulé.
export const requestSave = (defaultName, suggestedFolder) =>
  new Promise((resolve) => {
    current = { defaultName, suggestedFolder, resolve };
    listener?.(current);
  });

export const closeSavePicker = (result) => {
  const req = current;
  current = null;
  listener?.(null);
  req?.resolve(result);
};
