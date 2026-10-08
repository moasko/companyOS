// Les images de la facture (logo, cachet, signature), prêtes pour le PDF.
//
// Quelle que soit leur forme d'origine — JPEG de la fiche de l'entreprise,
// PNG d'un ancien profil, SVG de l'application Signature —, elles sont
// redessinées sur fond blanc et réencodées en JPEG : le seul format qu'un
// PDF intègre tel quel, sans bibliothèque de compression.

import { octetsDe, reduireImage } from "../../image";

const preparer = async (source, max, agrandir = false) => {
  if (!source) return null;
  try {
    const { url, largeur, hauteur } = await reduireImage(source, { max, qualite: 0.9, agrandir });
    return { octets: octetsDe(url), largeur, hauteur };
  } catch {
    // Une image illisible ne bloque pas la facture : on retombe sur les
    // initiales ou le nom du signataire.
    return null;
  }
};

/// `e` : l'émetteur tel que l'aperçu le reçoit ; `f` : la facture.
export const imagesPdf = async (f, e = {}) => {
  const avecSignature = f.afficherSignature !== false;
  const [Logo, Cachet, Signature] = await Promise.all([
    f.afficherLogo !== false ? preparer(e.logo, 480) : null,
    avecSignature ? preparer(e.cachet, 360) : null,
    avecSignature ? preparer(e.signatureImage, 520, String(e.signatureImage).startsWith("data:image/svg")) : null,
  ]);
  return Object.fromEntries(Object.entries({ Logo, Cachet, Signature }).filter(([, v]) => v));
};
