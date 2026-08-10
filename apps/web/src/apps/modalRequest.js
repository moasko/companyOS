// Magasin hors Redux pour les boîtes de dialogue générales : confirmation,
// alerte, saisie, et tout contenu sur mesure. Même principe que
// `saveRequest` — une promesse ne se range pas proprement dans un store
// Redux, la pile est donc tenue ici et le rendu est fait par `ModalHost`,
// monté une seule fois au niveau de App.
//
// C'est une pile et non une boîte unique : une confirmation ouverte
// depuis une boîte déjà à l'écran doit se poser par-dessus, pas la
// remplacer.

let listener = null;
let stack = [];
let seq = 0;

const publish = () => listener?.([...stack]);

export const subscribeModals = (fn) => {
  listener = fn;
  publish();
  return () => {
    listener = null;
  };
};

/// Empile une boîte et attend la décision de l'utilisateur.
/// La promesse est résolue par `closeModal` — voir les raccourcis
/// `modal.confirm` / `modal.alert` / `modal.prompt` plus bas.
export const openModal = (spec) =>
  new Promise((resolve) => {
    stack = [...stack, { ...spec, id: ++seq, resolve }];
    publish();
  });

/// Dépile une boîte et résout sa promesse. Sans effet si la boîte a déjà
/// été fermée : une double fermeture (clic + Échap) ne doit pas résoudre
/// la promesse deux fois.
export const closeModal = (id, result) => {
  const entry = stack.find((m) => m.id === id);
  if (!entry) return;
  stack = stack.filter((m) => m.id !== id);
  publish();
  entry.resolve(result);
};

/// Ferme tout ce qui reste ouvert — au changement de session par exemple,
/// pour ne pas laisser une boîte de l'ancien espace de travail à l'écran.
export const closeAllModals = () => {
  const pending = stack;
  stack = [];
  publish();
  pending.forEach((m) => m.resolve(m.kind === "confirm" ? false : null));
};

// Un appel s'écrit indifféremment avec un simple message ou avec un objet
// complet : `modal.confirm("Supprimer ?")` comme
// `modal.confirm({ title: "…", message: "…", danger: true })`.
const spec = (kind, input, extra) => ({
  kind,
  ...(typeof input === "string" ? { message: input } : input || {}),
  ...(extra || {}),
});

/// Remplaçants de `window.confirm` / `alert` / `prompt`, en promesse.
///
///   if (!(await modal.confirm(`Supprimer « ${nom} » ?`))) return;
///   const nom = await modal.prompt("Nom du nouveau dossier :");
///   await modal.alert({ title: "Envoyé", message: "…", tone: "success" });
///
/// Options communes : `title`, `message`, `confirmLabel`, `cancelLabel`,
/// `danger` (bouton de validation rouge), `tone` ("info" | "success" |
/// "warning" | "error"), `icon` (nom FontAwesome solid).
/// Propres à `prompt` : `value` (valeur initiale), `placeholder`, `label`,
/// `multiline`, `required` (défaut vrai : valider une saisie vide est
/// impossible).
export const modal = {
  /// Résout `true` si l'utilisateur valide, `false` sinon.
  confirm: (input, extra) => openModal(spec("confirm", input, extra)),

  /// Résout `true` à la fermeture — il n'y a rien à refuser.
  alert: (input, extra) => openModal(spec("alert", input, extra)),

  /// Résout la chaîne saisie, ou `null` si annulé.
  prompt: (input, extra) => openModal(spec("prompt", input, extra)),

  /// Boîte sur mesure : `render` reçoit `{ close }` et rend le corps.
  /// La promesse est résolue par la valeur passée à `close`.
  open: (input, extra) => openModal(spec("custom", input, extra)),
};
