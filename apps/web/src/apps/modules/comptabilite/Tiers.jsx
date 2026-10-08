// Comptabilité — tiers et lettrage.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveToCloud } from "../../cloud";
import { composerCourriel } from "../../courrielRequest";
import { suivreLien } from "../../notifications";
import { etatFenetre, ouvrirFenetre } from "../../windows";
import * as D from "./domaine";
import { lignesLettrage, prochaineLettre, propositionsLettrage, resumeTiers, totauxSelection } from "./lettrage";
import { releveDeComptePdf } from "./pdf";
import { Bouton, Carte, Entete, aujourdhui, dateCourte, nb, ouvrirJustificatif, ouvrirPiece, useCpt } from "./commun";

const TRANCHES = [
  { cle: "aJour", label: "Non échu" },
  { cle: "j30", label: "1 à 30 j" },
  { cle: "j60", label: "31 à 60 j" },
  { cle: "j90", label: "61 à 90 j" },
  { cle: "plus", label: "Plus de 90 j" },
];

/// Une application de l'espace est-elle installée ? Sans elle, un lien
/// vers elle ne ferait rien — et un clic sans effet est la pire réponse.
const installee = (id) => !!etatFenetre(id);

const absente = (nom, consequence) =>
  modal.alert({
    title: `L'application ${nom} n'est pas installée`,
    message: `${consequence} Installez-la depuis la Boutique pour le faire d'ici.`,
  });

const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export const Tiers = () => {
  const {
    ecritures,
    lettrages,
    lettres,
    documents,
    clientsCrm,
    entreprise,
    occupe,
    tache,
    rafraichir,
    contrepasser,
    contexte,
    echeances,
  } = useCpt();
  const [compte, setCompte] = useState("411");
  const [choisi, setChoisi] = useState("");
  const [masquer, setMasquer] = useState(true);
  const [selection, setSelection] = useState(() => new Set());
  const sens = compte === "411" ? 1 : -1;

  const lignes = useMemo(() => lignesLettrage(ecritures, compte, lettrages), [ecritures, compte, lettrages]);
  const agee = useMemo(
    () => D.balanceAgee(ecritures, compte, { axe: contexte.axe }, aujourdhui(), lettres[compte], echeances),
    [ecritures, compte, contexte.axe, lettres, echeances],
  );
  const propositions = useMemo(() => propositionsLettrage(lignes), [lignes]);
  const totalDu = agee.reduce((s, t) => s + t.total, 0) * sens;

  const noms = useMemo(() => {
    const s = new Set(agee.map((t) => t.tiers));
    for (const l of lignes) s.add(l.tiers || "Sans tiers");
    return [...s];
  }, [agee, lignes]);
  const tiers = noms.includes(choisi) ? choisi : agee[0]?.tiers || noms[0] || "";
  const resume = resumeTiers(lignes, tiers);
  const visibles = resume.lignes.filter((l) => !(masquer && l.lettre && !l.partiel));
  const choisies = lignes.filter((l) => selection.has(l.cle));
  const totaux = totauxSelection(choisies);
  const lettreesManuelles = [...new Set(choisies.filter((l) => l.lettrageId).map((l) => l.lettrageId))];

  const max = Math.max(1, ...agee.map((t) => Math.abs(t.total)));

  // ---- Lettrage -------------------------------------------------------------

  const lettrer = (cles, { partiel = false, nomTiers = tiers, montant = 0 } = {}) =>
    tache(async () => {
      await api.records.create("comptabilite", "lettrages", {
        compte,
        lettre: prochaineLettre(lettrages, compte),
        lignes: cles,
        partiel,
        tiers: nomTiers,
        montant,
        date: aujourdhui(),
      });
      setSelection(new Set());
      await rafraichir();
    });

  const delettrer = (ids) =>
    tache(async () => {
      for (const id of ids) await api.records.remove("comptabilite", "lettrages", id);
      setSelection(new Set());
      await rafraichir();
    });

  const lettrageAuto = async () => {
    if (!propositions.length) {
      modal.alert({ title: "Rien à lettrer automatiquement", message: "Aucun couple facture et règlement de même montant n'attend." });
      return;
    }
    const ok = await modal.confirm({
      title: `Lettrer ${propositions.length} couple(s) ?`,
      message: "Chaque facture sera rapprochée du règlement de même montant chez le même tiers.",
      detail: "Un lettrage se défait à tout moment : il ne modifie aucune écriture.",
      confirmLabel: "Lettrer",
    });
    if (!ok) return;
    await tache(async () => {
      let liste = [...lettrages];
      for (const p of propositions) {
        const data = { compte, lettre: prochaineLettre(liste, compte), lignes: p.lignes, partiel: false, tiers: p.tiers, montant: p.montant, date: aujourdhui() };
        await api.records.create("comptabilite", "lettrages", data);
        liste = [...liste, { data }];
      }
      await rafraichir();
    });
  };

  const basculer = (cle) =>
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });

  // ---- Actions vers les autres applications --------------------------------

  const clientCrm = clientsCrm.find((c) => memeNom(c.data.entreprise, tiers) || memeNom(c.data.nom, tiers));

  const envoyerReleve = async () => {
    const blob = releveDeComptePdf({
      entreprise,
      tiers,
      compte,
      lignes: resume.lignes,
      au: aujourdhui(),
    });
    const nom = `releve-${tiers.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-${aujourdhui()}.pdf`;
    const node = await tache(() => saveToCloud(blob, nom, { folder: "Comptabilité" }), "Relevé impossible");
    if (!node) return;
    if (!installee("courrier")) {
      const ouvrir = await modal.confirm({
        title: "Relevé enregistré dans le Cloud",
        message: `« ${node.name} » est dans le dossier Comptabilité. L'application Courrier n'est pas installée : envoyez-le depuis votre messagerie habituelle.`,
        confirmLabel: "Ouvrir le relevé",
        cancelLabel: "Fermer",
      });
      if (ouvrir) ouvrirJustificatif({ id: node.id, name: node.name, mimeType: "application/pdf" });
      return;
    }
    const du = Math.abs(resume.solde);
    composerCourriel({
      a: clientCrm?.data.email || "",
      sujet: `Relevé de compte — ${entreprise.nom || ""}`.trim(),
      texte:
        `Bonjour,\n\nVeuillez trouver ci-joint votre relevé de compte au ${aujourdhui().split("-").reverse().join("/")}.\n` +
        (compte === "411" && resume.solde > 0
          ? `Il fait apparaître un solde de ${nb(du)} F en notre faveur. Nous vous remercions de bien vouloir procéder à son règlement.\n`
          : "") +
        `\nCordialement,\n${entreprise.signataire || entreprise.nom || ""}`,
      pieces: [{ id: node.id, nom: node.name }],
    });
  };

  const relancer = () => {
    if (!installee("facturation")) return absente("Facturation", "Les relances partent des factures.");
    const ouverts = D.postesOuverts(ecritures, "411", undefined, { lettres: lettres["411"] }).filter((p) => memeNom(p.tiers, tiers) && p.solde > 0);
    const doc = ouverts
      .map((p) => documents.find((d) => d.data.numero === p.piece))
      .find(Boolean);
    if (doc) suivreLien({ lien: { app: "facturation", params: { facture: doc.id } } });
    else ouvrirFenetre("facturation");
  };

  const ficheCrm = () => {
    if (!installee("crm")) return absente("CRM", "Les fiches clients y sont tenues.");
    if (clientCrm) suivreLien({ lien: { app: "crm", params: { client: clientCrm.id } } });
    else
      modal.alert({
        title: "Client absent du CRM",
        message: `« ${tiers} » n'a pas de fiche dans le CRM. Créez-la pour retrouver ses coordonnées et son historique.`,
      });
  };

  return (
    <div className="cptVue">
      <Entete titre="Tiers et lettrage">
        <div className="cptOnglets" role="tablist" aria-label="Compte de tiers">
          {[
            ["411", "Clients · 411"],
            ["401", "Fournisseurs · 401"],
          ].map(([c, label]) => (
            <button
              type="button"
              key={c}
              role="tab"
              aria-selected={compte === c}
              onClick={() => {
                setCompte(c);
                setChoisi("");
                setSelection(new Set());
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Bouton variante="principal" icone="faWandMagicSparkles" disabled={occupe} onClick={lettrageAuto}>
          Lettrage automatique{propositions.length ? ` (${propositions.length})` : ""}
        </Bouton>
      </Entete>

      <div className="cptConteneur">
        <Carte
          titre={`Balance âgée des ${compte === "411" ? "clients" : "fournisseurs"} · ${D.fcfa(totalDu)} ${compte === "411" ? "à encaisser" : "à payer"}`}
          actions={
            <ul className="cptLegende" aria-label="Légende">
              {TRANCHES.map((t, i) => (
                <li key={t.cle}>
                  <span className="cptPastilleTranche" data-tranche={i} />
                  {t.label}
                </li>
              ))}
            </ul>
          }
        >
          {agee.length ? (
            <div className="cptAgee">
              {agee.slice(0, 10).map((t) => (
                <button
                  type="button"
                  key={t.tiers}
                  className="cptAgeeLigne"
                  aria-pressed={t.tiers === tiers}
                  onClick={() => {
                    setChoisi(t.tiers);
                    setSelection(new Set());
                  }}
                  aria-label={`${t.tiers} : ${TRANCHES.filter((x) => t[x.cle]).map((x) => `${x.label} ${nb(t[x.cle] * sens)}`).join(", ")}`}
                >
                  <span className="cptEllipse">{t.tiers}</span>
                  <span className="cptAgeePiste">
                    {TRANCHES.map((x, i) =>
                      t[x.cle] * sens > 0 ? (
                        <span
                          key={x.cle}
                          data-tranche={i}
                          title={`${x.label} : ${nb(t[x.cle] * sens)}`}
                          style={{ width: `${((t[x.cle] * sens) / max) * 100}%` }}
                        />
                      ) : null,
                    )}
                  </span>
                  <b className="cptMt">{nb(t.total * sens)}</b>
                </button>
              ))}
            </div>
          ) : (
            <p className="cptRien">{compte === "411" ? "Aucun client ne vous doit d'argent." : "Rien à payer aux fournisseurs."}</p>
          )}
        </Carte>

        <div className="cptGrille">
          <Carte className="cptLarge">
            {tiers ? (
              <>
                <div className="cptTiersTete">
                  <div>
                    <h2>
                      <select value={tiers} onChange={(e) => { setChoisi(e.target.value); setSelection(new Set()); }} aria-label="Tiers">
                        {noms.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span className="cptCode"> · {compte}</span>
                    </h2>
                    <p>
                      Solde {resume.solde * sens >= 0 ? (compte === "411" ? "débiteur" : "créditeur") : "inversé"} {D.fcfa(Math.abs(resume.solde))} ·{" "}
                      {resume.nonLettrees} ligne(s) non lettrée(s)
                    </p>
                  </div>
                  <label className="cptCase">
                    <input type="checkbox" checked={masquer} onChange={(e) => setMasquer(e.target.checked)} />
                    <span>Masquer les lignes lettrées</span>
                  </label>
                </div>

                <div className="cptTableau" role="table">
                  <div className="cptLigneT cptEnteteT cptColsLettrage" role="row">
                    <span className="sr" aria-label="Sélection" />
                    <span>Date</span>
                    <span>Pièce</span>
                    <span>Libellé</span>
                    <span className="cptMt">Débit</span>
                    <span className="cptMt">Crédit</span>
                    <span>Lettre</span>
                  </div>
                  {visibles.map((l) => (
                    <div key={l.cle} className="cptLigneT cptColsLettrage" role="row" data-lettree={l.lettre && !l.partiel ? "true" : "false"}>
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${l.libelle}`}
                        checked={selection.has(l.cle)}
                        disabled={l.lettre === "auto"}
                        onChange={() => basculer(l.cle)}
                      />
                      <span>{dateCourte(l.date)}</span>
                      <button
                        type="button"
                        className="cptLien cptCode"
                        onClick={() => {
                          const e = ecritures.find((x) => x.id === l.ecritureId);
                          if (e) ouvrirPiece(e, { onContrepasser: contrepasser });
                        }}
                      >
                        {l.numero || l.piece || "—"}
                      </button>
                      <span className="cptEllipse">{l.libelle}</span>
                      <span className="cptMt">{l.debit ? nb(l.debit) : ""}</span>
                      <span className="cptMt">{l.credit ? nb(l.credit) : ""}</span>
                      <span className="cptLettre" title={l.lettre === "auto" ? "Soldée par sa pièce : facture et règlements portent le même numéro" : l.partiel ? "Lettrage partiel" : ""}>
                        {l.lettre === "auto" ? "✓" : l.lettre ? `${l.lettre}${l.partiel ? "*" : ""}` : ""}
                      </span>
                    </div>
                  ))}
                  {!visibles.length ? <p className="cptRien">Toutes les lignes de ce tiers sont lettrées.</p> : null}
                </div>

                <div className="cptSelectionPied" data-active={choisies.length ? "true" : "false"}>
                  <span>
                    {choisies.length
                      ? `Sélection : débit ${nb(totaux.debit)} · crédit ${nb(totaux.credit)} · écart ${nb(Math.abs(totaux.ecart))}`
                      : "Cochez une facture et le règlement qui l'éteint."}
                  </span>
                  {lettreesManuelles.length ? (
                    <Bouton disabled={occupe} onClick={() => delettrer(lettreesManuelles)}>Délettrer</Bouton>
                  ) : null}
                  {totaux.possible && !totaux.total ? (
                    <small>Un lettrage partiel garde la facture ouverte pour le reste dû</small>
                  ) : null}
                  <Bouton
                    variante="principal"
                    disabled={occupe || !totaux.possible || lettreesManuelles.length > 0}
                    onClick={() => lettrer([...selection], { partiel: !totaux.total, montant: Math.min(totaux.debit, totaux.credit) })}
                  >
                    {totaux.possible && !totaux.total ? "Lettrer partiellement" : "Lettrer"}
                  </Bouton>
                </div>
              </>
            ) : (
              <p className="cptRien">Aucun mouvement sur le compte {compte}.</p>
            )}
          </Carte>

          <div className="cptColonne">
            <Carte titre="Propositions de lettrage">
              {propositions.length ? (
                <ul className="cptPropositions">
                  {propositions.slice(0, 8).map((p) => (
                    <li key={p.lignes.join()}>
                      <span>
                        <b>{p.tiers}</b>
                        <small>{p.detail}</small>
                      </span>
                      <Bouton disabled={occupe} onClick={() => lettrer(p.lignes, { nomTiers: p.tiers, montant: p.montant })}>
                        Lettrer
                      </Bouton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cptRien">Aucune proposition : chaque règlement a trouvé sa facture, ou attend un choix.</p>
              )}
            </Carte>

            {tiers && tiers !== "Sans tiers" ? (
              <Carte titre={compte === "411" ? "Agir sur le client" : "Agir sur le fournisseur"}>
                <div className="cptLiens">
                  <button type="button" className="cptLien" onClick={envoyerReleve}>
                    <Icon fafa="faEnvelope" width={12} /> Envoyer le relevé de compte (PDF) →
                  </button>
                  {compte === "411" ? (
                    <>
                      <button type="button" className="cptLien" onClick={relancer}>
                        <Icon fafa="faBell" width={12} /> Relancer depuis la Facturation →
                      </button>
                      <button type="button" className="cptLien" onClick={ficheCrm}>
                        <Icon fafa="faAddressCard" width={12} /> Ouvrir la fiche CRM →
                      </button>
                    </>
                  ) : (
                    <button type="button" className="cptLien" onClick={() => (installee("achats") ? ouvrirFenetre("achats") : absente("Achats", "Les paiements fournisseurs s'y enregistrent."))}>
                      <Icon fafa="faCartShopping" width={12} /> Régler depuis les Achats →
                    </button>
                  )}
                </div>
              </Carte>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
