// Les liens `mailto:` mènent au Courrier.
//
// Un OS sans client mail installé laisse ces liens morts ; CompanyOS en a
// un. Où qu'un lien `mailto:` soit cliqué — une fiche client, une page
// d'aide, la barre d'adresse du Navigateur — le composeur s'ouvre,
// prérempli avec l'adresse, le sujet et le corps que le lien transporte.

import { composerCourriel } from "./courrielRequest";

/// Décompose `mailto:adresse?subject=…&body=…&cc=…` en brouillon.
/// Tolérant : un mailto sans adresse ouvre un composeur vide, un
/// paramètre illisible est simplement ignoré.
export const analyserMailto = (href) => {
  const sans = String(href || "").replace(/^mailto:/i, "");
  const [adresse, requete = ""] = sans.split("?");
  const brouillon = { a: decodeURIComponent(adresse || "") };

  const params = new URLSearchParams(requete);
  const sujet = params.get("subject");
  const corps = params.get("body");
  const cc = params.get("cc");
  if (sujet) brouillon.sujet = sujet;
  if (corps) brouillon.texte = corps;
  if (cc) brouillon.cc = cc;
  return brouillon;
};

export const estMailto = (href) => /^mailto:/i.test(String(href || ""));

/// Installe l'intercepteur global : tout clic sur un lien `mailto:` de
/// l'interface ouvre le Courrier au lieu de chercher un client mail
/// inexistant. En capture, pour passer avant les gestionnaires locaux.
export const intercepterMailto = () => {
  const surClic = (e) => {
    const lien = e.target.closest?.("a[href^='mailto:' i]");
    if (!lien) return;
    e.preventDefault();
    e.stopPropagation();
    composerCourriel(analyserMailto(lien.getAttribute("href")));
  };
  document.addEventListener("click", surClic, true);
  return () => document.removeEventListener("click", surClic, true);
};
