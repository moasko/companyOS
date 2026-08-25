// Retour utilisateur non bloquant : une seule notification à la fois.

export default function Toast({ toast }) {
  if (!toast) return null;
  return <output key={toast.id} className="imgToast" data-erreur={toast.erreur}>{toast.texte}</output>;
}
