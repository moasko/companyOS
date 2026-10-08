import React from "react";
import { montantDans } from "../../../utils/monnaie";
import {
  CONDITIONS,
  FREQUENCES,
  chiffres,
  dateLongue,
  initiales,
  libelleTaxe,
  lignesPaiement,
  montantEnLettres,
  montantsEcheancier,
} from "./domaine";
import { couleurDe, eclaircir, modeleDe } from "./modeles";
import { ligneLegale } from "../../entreprise/domaine";

// La page de la facture, telle que le client la recevra.
//
// Une page A4 à 96 ppp (794 × 1123 px), toujours blanche, quel que soit le
// thème de l'OS : c'est un document, pas de l'interface. Le modèle choisi
// est posé en `data-modele` sur la page, et toute la mise en page vient de
// la feuille de style — le même balisage sert aux six modèles, ce qui
// garantit qu'aucun n'oublie une information (échéancier, montant en
// lettres, moyen de paiement…).

export const Apercu = React.forwardRef(function Apercu({ facture: f, emetteur: e = {} }, ref) {
  const c = chiffres(f);
  const modele = modeleDe(f.modele);
  const couleur = couleurDe(f);
  const argent = (n) => montantDans(n, f.devise);
  const articles = f.lignes.filter((l) => String(l.designation || "").trim() || Number(l.pu));
  const echeances = f.mode === "fractionne" ? montantsEcheancier(f.echeancier, c.total) : [];
  const paiement = lignesPaiement(f.moyenPaiement, e);
  const condition = CONDITIONS.find((x) => x.id === f.conditions)?.label;
  const nomEmetteur = e.nom || "Votre entreprise";

  const logo = f.afficherLogo !== false ? (
    e.logo ? (
      <img className="efLogo" src={e.logo} alt="" />
    ) : (
      <span className="efLogo efLogoInitiales" aria-hidden="true">{initiales(nomEmetteur)}</span>
    )
  ) : null;

  const adresse = [e.adresse, [e.ville, e.pays].filter(Boolean).join(", ")].filter(Boolean);
  const contacts = [e.email, e.telephone, e.siteWeb].filter(Boolean);
  const fiscal = [e.ncc && `NCC : ${e.ncc}`, e.rccm && `RCCM : ${e.rccm}`].filter(Boolean);
  const legale = ligneLegale(e);
  const fiscalPied = modele.id === "officiel" || modele.id === "classique" ? [] : fiscal;

  return (
    <div
      ref={ref}
      className="efPage"
      data-modele={modele.id}
      style={{
        "--ef-accent": couleur,
        "--ef-accent-doux": eclaircir(couleur, 0.9),
        "--ef-accent-pale": eclaircir(couleur, 0.95),
      }}
    >
      {modele.id === "bandeau" ? (
        <div className="efBandeau">
          <div className="efBandeauNom">
            {logo}
            <span>{nomEmetteur}</span>
          </div>
          <div className="efBandeauTitre">
            <b>FACTURE</b>
            <span>N° {f.numero || "—"}</span>
          </div>
        </div>
      ) : null}

      {modele.id === "classique" ? (
        <div className="efTitreCentre">
          <h2>FACTURE</h2>
          <span>N° {f.numero || "—"}</span>
        </div>
      ) : null}

      <header className="efTete">
        <div className="efEmetteur">
          {modele.id !== "bandeau" ? logo : null}
          <div>
            {modele.id !== "bandeau" ? <h1>{nomEmetteur}</h1> : null}
            {adresse.map((l) => <p key={l}>{l}</p>)}
            {contacts.length ? <p className="efEspace">{contacts.join(" · ")}</p> : null}
            {(modele.id === "officiel" || modele.id === "classique") && fiscal.length ? (
              <p className="efFiscal">{fiscal.join(" · ")}</p>
            ) : null}
          </div>
        </div>
        {modele.id !== "bandeau" && modele.id !== "classique" ? (
          <div className="efTitre">
            <h2>FACTURE</h2>
            <b className="efNumero">#{f.numero || "—"}</b>
          </div>
        ) : null}
      </header>

      <section className="efInfos">
        <div className="efFactureA">
          <span className="efEtiquette">Facturé à</span>
          <b>{f.clientEntreprise || f.clientNom || "Client à choisir"}</b>
          {f.clientEntreprise && f.clientNom ? <p>{f.clientNom}</p> : null}
          {f.clientVille ? <p>{f.clientVille}</p> : null}
          {f.clientEmail ? <p>{f.clientEmail}</p> : null}
          {f.clientTelephone ? <p>{f.clientTelephone}</p> : null}
        </div>
        <dl className="efDates">
          <div><dt>Date de facture</dt><dd>{dateLongue(f.date)}</dd></div>
          <div><dt>Échéance</dt><dd>{dateLongue(f.echeance)}</dd></div>
          {condition ? <div><dt>Conditions</dt><dd>{condition}</dd></div> : null}
        </dl>
      </section>

      <table className="efTable">
        <thead>
          <tr>
            <th>Article</th>
            <th>Quantité</th>
            <th>Prix unitaire</th>
            <th>Taxe</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {articles.length ? articles.map((l) => (
            <tr key={l.id}>
              <td>
                <b>{l.designation || "Article sans nom"}</b>
                {l.description ? <span>{l.description}</span> : null}
              </td>
              <td>{Number(l.qte) || 0}</td>
              <td>{argent(l.pu)}</td>
              <td>{Number(l.tva) || 0} %</td>
              <td>{argent((Number(l.qte) || 0) * (Number(l.pu) || 0))}</td>
            </tr>
          )) : (
            <tr className="efVide"><td colSpan={5}>Ajoutez des articles : ils apparaîtront ici.</td></tr>
          )}
        </tbody>
      </table>

      <div className="efRecap">
        <div className="efRecapGauche">
          {echeances.length ? (
            <div className="efEcheancier">
              <span className="efEtiquette">Échéancier de paiement</span>
              {echeances.map((x) => (
                <div key={x.id} className="efEcheance">
                  <span>{x.libelle || "Échéance"} · {Number(x.pourcentage) || 0} %</span>
                  <span>{dateLongue(x.date)}</span>
                  <b>{argent(x.montant)}</b>
                </div>
              ))}
            </div>
          ) : null}
          {f.mode === "recurrente" ? (
            <p className="efRecurrence">
              Facture récurrente · {FREQUENCES.find((x) => x.id === f.recurrence?.frequence)?.label.toLowerCase() || "chaque mois"}
              {f.recurrence?.fin ? `, jusqu'au ${dateLongue(f.recurrence.fin)}` : ""}
            </p>
          ) : null}
        </div>
        <dl className="efTotaux">
          <div><dt>Sous-total</dt><dd>{argent(c.sousTotal)}</dd></div>
          <div><dt>{libelleTaxe(c.parTaux)}</dt><dd>{argent(c.tva)}</dd></div>
          <div className="efRemise"><dt>Remise{Number(f.remise) ? ` (${f.remise} %)` : ""}</dt><dd>−{argent(c.remise)}</dd></div>
          <div><dt>Livraison</dt><dd>{argent(c.livraison)}</dd></div>
        </dl>
      </div>

      <div className="efTotal">
        <span>Montant total</span>
        <b>{argent(c.total)}</b>
      </div>

      {f.montantEnLettres !== false ? (
        <p className="efLettres">
          Arrêtée la présente facture à la somme de : <b>{montantEnLettres(c.total, f.devise)}</b>.
        </p>
      ) : null}

      <footer className="efPied">
        <div className="efPaiement">
          <h4>Moyen de paiement</h4>
          {paiement.map((l) => <p key={l}>{l}</p>)}
        </div>
        <div className="efNotes">
          {f.notes ? (
            <>
              <h4>Notes</h4>
              <p>{f.notes}</p>
            </>
          ) : null}
          {f.afficherSignature !== false ? (
            <div className="efSignature">
              <span className="efSignatureZone">
                {e.cachet ? <img className="efCachet" src={e.cachet} alt="" /> : null}
                {e.signatureImage ? (
                  <img src={e.signatureImage} alt="" />
                ) : (
                  <span className="efSignatureNom">{e.signataire || e.titulaire || nomEmetteur}</span>
                )}
              </span>
              <b>Signature autorisée</b>
              {e.signataire || e.fonctionSignataire ? (
                <small>{[e.signataire, e.fonctionSignataire].filter(Boolean).join(", ")}</small>
              ) : null}
            </div>
          ) : null}
        </div>
      </footer>

      {/* Les identifiants fiscaux vont en pied de page, sauf dans les
          modèles qui les montrent déjà dans l'en-tête. */}
      {legale || e.mentions || fiscalPied.length ? (
        <p className="efMentions">{[legale, e.mentions, fiscalPied.join(" · ")].filter(Boolean).join(" — ")}</p>
      ) : null}
    </div>
  );
});
