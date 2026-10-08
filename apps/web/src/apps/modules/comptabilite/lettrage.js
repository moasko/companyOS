// Comptabilité — lettrage des comptes de tiers.
//
// Lettrer, c'est marquer d'une même lettre une facture et le règlement qui
// l'éteint. Ce qui reste sans lettre est exactement ce qui est dû — ou un
// règlement qu'on ne sait pas encore affecter.
//
// Deux sources de lettrage coexistent :
//
//   - **implicite** : la reprise de la Facturation pose le même numéro de
//     pièce sur une facture et sur ses règlements ; une pièce dont les
//     lignes s'annulent est soldée sans que personne n'ait rien fait ;
//   - **manuel** : un virement saisi à part, un acompte, un règlement
//     groupé de plusieurs factures. L'utilisateur coche les lignes et les
//     lettre. Le lettrage vit dans sa propre collection : il ne réécrit
//     jamais une écriture du journal.
//
// Un lettrage est **total** quand ses lignes s'annulent, **partiel**
// sinon : la facture reste alors ouverte pour le reste dû.

import { lignesDeTiers } from "./domaine.js";

/// Clé de ligne → lettre, pour les lettrages totaux d'un compte. C'est ce
/// que consomment `postesOuverts` et `balanceAgee`.
export const indexLettres = (lettrages = [], compte) => {
  const m = new Map();
  for (const l of lettrages) {
    const d = l.data || l;
    if (compte && d.compte !== compte) continue;
    if (d.partiel) continue;
    for (const cle of d.lignes || []) m.set(cle, d.lettre);
  }
  return m;
};

/// La lettre suivante d'un compte : A, B… Z, AA, AB…
export const prochaineLettre = (lettrages = [], compte) => {
  const prises = new Set(
    lettrages.map((l) => l.data || l).filter((d) => d.compte === compte).map((d) => d.lettre),
  );
  const lettre = (i) => {
    let s = "";
    let x = i + 1;
    while (x > 0) {
      x -= 1;
      s = String.fromCharCode(65 + (x % 26)) + s;
      x = Math.floor(x / 26);
    }
    return s;
  };
  for (let i = 0; ; i += 1) if (!prises.has(lettre(i))) return lettre(i);
};

/// Les lignes d'un compte de tiers, avec leur état de lettrage :
/// `lettre` (manuel), `partiel`, ou `auto` (pièce soldée par elle-même).
export const lignesLettrage = (ecritures, compte, lettrages = []) => {
  const manuel = new Map();
  for (const l of lettrages) {
    const d = l.data || l;
    if (d.compte !== compte) continue;
    for (const cle of d.lignes || []) manuel.set(cle, { lettre: d.lettre, partiel: !!d.partiel, id: l.id });
  }
  const lignes = lignesDeTiers(ecritures, compte);
  // Soldes par pièce, pour le lettrage implicite.
  const parPiece = new Map();
  const nbParPiece = new Map();
  for (const l of lignes) {
    if (!l.piece || manuel.has(l.cle)) continue;
    parPiece.set(l.piece, (parPiece.get(l.piece) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
    nbParPiece.set(l.piece, (nbParPiece.get(l.piece) || 0) + 1);
  }
  return lignes
    .map((l) => {
      const m = manuel.get(l.cle);
      if (m) return { ...l, lettre: m.lettre, partiel: m.partiel, lettrageId: m.id };
      const soldePiece = l.piece ? parPiece.get(l.piece) : null;
      // Une pièce d'une seule ligne n'est « soldée » que si elle vaut zéro —
      // ce qui n'arrive pas : il faut au moins deux mouvements.
      if (l.piece && nbParPiece.get(l.piece) > 1 && Math.abs(soldePiece) < 1) {
        return { ...l, lettre: "auto", partiel: false };
      }
      return { ...l, lettre: "", partiel: false };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

/// Totaux d'une sélection de lignes, et le type de lettrage possible.
export const totauxSelection = (lignes) => {
  const debit = lignes.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credit = lignes.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const ecart = Math.round(debit - credit);
  return {
    debit,
    credit,
    ecart,
    possible: lignes.length >= 2 && debit > 0 && credit > 0,
    total: lignes.length >= 2 && Math.abs(ecart) < 1,
  };
};

/// Propositions de lettrage : pour un même tiers, une facture et un
/// règlement non lettrés de même montant. On ne propose que les couples
/// sans ambiguïté — deux factures identiques pour un seul règlement, c'est
/// à l'utilisateur de choisir.
export const propositionsLettrage = (lignes) => {
  const libres = lignes.filter((l) => !l.lettre);
  const parTiers = new Map();
  for (const l of libres) {
    const t = l.tiers || "Sans tiers";
    if (!parTiers.has(t)) parTiers.set(t, []);
    parTiers.get(t).push(l);
  }
  const out = [];
  for (const [tiers, liste] of parTiers) {
    const debits = liste.filter((l) => Number(l.debit) > 0);
    const credits = liste.filter((l) => Number(l.credit) > 0);
    const pris = new Set();
    for (const d of debits) {
      const memes = credits.filter((c) => !pris.has(c.cle) && Math.abs(c.credit - d.debit) < 1);
      const rivaux = debits.filter((x) => x !== d && Math.abs(x.debit - d.debit) < 1);
      if (memes.length !== 1 || rivaux.length) continue;
      const c = memes[0];
      pris.add(c.cle);
      out.push({
        tiers,
        lignes: [d.cle, c.cle],
        montant: d.debit,
        detail: `${d.piece || d.libelle} et ${c.libelle} du ${c.date} : même montant`,
      });
    }
  }
  return out;
};

/// Résumé d'un tiers dans un compte : solde et nombre de pièces ouvertes.
export const resumeTiers = (lignes, tiers) => {
  const siennes = lignes.filter((l) => (l.tiers || "Sans tiers") === tiers);
  const solde = siennes.reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
  const ouvertes = siennes.filter((l) => !l.lettre || l.partiel);
  return { solde: Math.round(solde), lignes: siennes, nonLettrees: ouvertes.length };
};
