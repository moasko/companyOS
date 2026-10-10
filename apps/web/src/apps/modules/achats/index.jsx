// Achats.
//
// ─────────────────────────────────────────────────────────────────────────
// LE CYCLE, ET QUI FAIT QUOI
//
// Commander → recevoir → être facturé → payer. Chaque temps a son effet,
// et un seul :
//
//   - la **commande** n'engage que la parole — rien au stock, rien en
//     comptabilité ;
//   - la **réception** fait monter le stock, aux quantités réellement
//     comptées sur le quai, prix d'achat compris (c'est lui qui nourrit le
//     prix moyen pondéré du Stock) ;
//   - la **facture fournisseur** crée la dette et la TVA déductible — elle
//     est proposée à la Comptabilité, comme les tickets de caisse et les
//     factures de vente ;
//   - le **paiement** éteint la dette, sous la même pièce, donc le poste
//     401 se lettre tout seul.
//
// Les fournisseurs et les articles viennent du Stock : ce module n'a pas
// de catalogue à lui, il ne tient que le cycle.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import { chargerReferentiel, invaliderReferentiel } from "../../referentiel";
import * as D from "./domaine";
import "./achats.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: AchatsApp };

const money = D.fcfa;

function AchatsApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [commandes, setCommandes] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [factures, setFactures] = useState([]);
  const [paiements, setPaiements] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [catalogue, setCatalogue] = useState({ produits: [], stocks: {} });

  const [selectionId, setSelectionId] = useState(null);
  const [draft, setDraft] = useState(null); // commande en cours d'édition
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [c, r, f, p, four, ref] = await Promise.all([
      api.records.list(manifest.slug, "commandes"),
      api.records.list(manifest.slug, "receptions"),
      api.records.list(manifest.slug, "factures"),
      api.records.list(manifest.slug, "paiements"),
      api.records.list("stock", "fournisseurs").catch(() => []),
      chargerReferentiel(),
    ]);
    setCommandes(c);
    setReceptions(r);
    setFactures(f);
    setPaiements(p);
    setFournisseurs(four);
    setCatalogue(ref);
  }, []);
  const etat = useChargement(ouvert, charger);

  const stats = useMemo(
    () => D.statistiques(commandes, receptions, factures, paiements),
    [commandes, receptions, factures, paiements],
  );
  const reappro = useMemo(
    () => D.aReapprovisionner(catalogue.produits || [], catalogue.stocks || {}),
    [catalogue],
  );

  const selection = commandes.find((c) => c.id === selectionId) || null;
  const nomFournisseur = (id) =>
    fournisseurs.find((f) => f.id === id)?.data?.nom || "";

  const triees = useMemo(
    () =>
      [...commandes].sort((a, b) =>
        String(b.data.date || "").localeCompare(String(a.data.date || "")),
      ),
    [commandes],
  );

  // ---- Commande -----------------------------------------------------------

  const nouvelle = (lignesInitiales = []) => {
    setSelectionId(null);
    setDraft({
      numero: D.prochainNumero(commandes),
      date: D.today(),
      fournisseurId: fournisseurs[0]?.id || "",
      statut: "brouillon",
      lignes: lignesInitiales,
      note: "",
    });
  };

  /// Depuis le panneau réappro : la commande part pré-remplie, groupée par
  /// le fournisseur de chaque article quand il est connu.
  const commanderReappro = () => {
    const lignes = reappro.map((r) => ({
      articleId: r.article.id,
      designation: r.article.data.designation,
      qte: r.suggestion,
      pu: Number(r.article.data.prixAchat) || 0,
      tva: Number(r.article.data.tva) || 0,
    }));
    nouvelle(lignes);
  };

  const enregistrerCommande = async (statut) => {
    if (!draft.fournisseurId) {
      return modal.alert({
        title: "Fournisseur manquant",
        message: "Une commande s'adresse à quelqu'un — choisissez le fournisseur.",
        tone: "error",
      });
    }
    const lignes = draft.lignes.filter(
      (l) => l.articleId && (Number(l.qte) || 0) > 0,
    );
    if (!lignes.length) {
      return modal.alert({
        title: "Commande vide",
        message: "Ajoutez au moins un article avec une quantité.",
        tone: "error",
      });
    }
    setOccupe(true);
    try {
      const donnees = { ...draft, lignes, statut };
      const { id, ...corps } = donnees;
      let enregistree;
      if (id) {
        enregistree = await api.records.update(manifest.slug, "commandes", id, corps);
      } else {
        enregistree = await api.records.create(manifest.slug, "commandes", corps);
      }
      await etat.rafraichir();
      setDraft(null);
      setSelectionId(enregistree.id);
      if (statut === "envoyee") {
        notifier({
          titre: "Commande envoyée",
          message: `${corps.numero} — ${money(D.totaux(corps).ttc)} chez ${nomFournisseur(corps.fournisseurId)}.`,
          app: "Achats",
          ton: "success",
        });
      }
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const annulerCommande = async (commande) => {
    const ok = await modal.confirm({
      title: "Annuler cette commande ?",
      message: `${commande.data.numero} ne sera plus attendue.`,
      detail: "Ce qui a déjà été reçu reste au stock ; seule l'attente s'arrête.",
      confirmLabel: "Annuler la commande",
      danger: true,
    });
    if (!ok) return;
    await api.records.update(manifest.slug, "commandes", commande.id, {
      ...commande.data,
      statut: "annulee",
    });
    await etat.rafraichir();
  };

  // ---- Réception ----------------------------------------------------------

  /// Le camion est là : on saisit ce qui est réellement descendu, ligne à
  /// ligne, pré-rempli avec le reste attendu.
  const recevoir = async (commande) => {
    const restes = D.resteARecevoir(commande, receptions);
    const saisies = await modal.open({
      title: `Réception — ${commande.data.numero}`,
      render: ({ close }) => <FormReception restes={restes} onValider={close} />,
    });
    if (!saisies) return;

    const lignes = saisies.filter((l) => (Number(l.qte) || 0) > 0);
    if (!lignes.length) return;

    setOccupe(true);
    try {
      const reception = { commandeId: commande.id, date: D.today(), lignes };
      await api.records.create(manifest.slug, "receptions", reception);

      // Le stock monte tout de suite, prix d'achat compris. Un échec ne
      // doit pas annuler la réception — la marchandise est là — mais il
      // doit se voir.
      const manques = [];
      for (const m of D.mouvementsDeReception(reception, commande.data.numero)) {
        try {
          await api.records.create("stock", "mouvements", m);
        } catch {
          manques.push(m.articleId);
        }
      }
      if (manques.length) {
        modal.alert({
          title: "Réception enregistrée, stock non mis à jour",
          message: `${manques.length} article(s) n'ont pas pu être incrémentés.`,
          detail: "Corrigez par un inventaire dans l'application Stock.",
          tone: "warning",
        });
      } else {
        invaliderReferentiel();
      }
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Réception impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Facture et paiement ------------------------------------------------

  const facturer = async (commande) => {
    const t = D.totaux(commande.data);
    const saisie = await modal.open({
      title: `Facture fournisseur — ${commande.data.numero}`,
      render: ({ close }) => <FormFacture defaut={t} onValider={close} />,
    });
    if (!saisie) return;
    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "factures", {
        commandeId: commande.id,
        fournisseurId: commande.data.fournisseurId,
        ...saisie,
      });
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const payer = async (facture) => {
    const reste =
      (Number(facture.data.ttc) || 0) - D.dejaPaye(facture, paiements);
    const saisie = await modal.open({
      title: `Payer — ${facture.data.reference}`,
      render: ({ close }) => <FormPaiement reste={reste} onValider={close} />,
    });
    if (!saisie) return;
    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "paiements", {
        factureId: facture.id,
        ...saisie,
      });
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Paiement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="achApp">
        <div className="achVerrou">Connectez-vous pour gérer vos achats.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="achApp">
      <div className="achShell">
        {/* ---- Colonne des commandes ---- */}
        <aside className="achListe">
          <div className="achListeTete">
            <h3>Commandes</h3>
            <Bouton icone="faPlus" onClick={() => nouvelle()}>
              Nouvelle
            </Bouton>
          </div>
          <div className="achCartes">
            <div className="achCarte">
              <span>En attente de livraison</span>
              <b>{stats.enAttente}</b>
              <em>{money(stats.engagement)} engagés</em>
            </div>
            <div className="achCarte" data-ton={stats.duFournisseurs ? "attention" : "ok"}>
              <span>À payer</span>
              <b>{money(stats.duFournisseurs)}</b>
              <em>{stats.impayees} facture(s)</em>
            </div>
          </div>
          <div className="achDefile cosScroll">
            <Contenu etat={etat} vide={!commandes.length} lignes={6}
              rendreVide={() => (
                <Vide
                  icone="faTruckField"
                  titre="Aucune commande"
                  aide="Commandez à un fournisseur du Stock — la réception fera monter les niveaux toute seule."
                />
              )}
            >
              {triees.map((c) => {
                const st = D.statutReel(c, receptions);
                return (
                  <div
                    key={c.id}
                    className="achLigne handcr"
                    data-actif={selectionId === c.id && !draft}
                    onClick={() => {
                      setDraft(null);
                      setSelectionId(c.id);
                    }}
                  >
                    <div className="achLigneTete">
                      <b>{c.data.numero}</b>
                      <span className="achStatut" data-ton={D.STATUTS[st]?.ton}>
                        {D.STATUTS[st]?.label}
                      </span>
                    </div>
                    <div className="achLigneSous">
                      {nomFournisseur(c.data.fournisseurId) || "Fournisseur ?"} ·{" "}
                      {money(D.totaux(c.data).ttc)}
                    </div>
                  </div>
                );
              })}
            </Contenu>
          </div>
        </aside>

        {/* ---- Centre : détail ou édition ---- */}
        <div className="achCentre cosScroll">
          {draft ? (
            <Edition
              draft={draft}
              setDraft={setDraft}
              fournisseurs={fournisseurs}
              produits={catalogue.produits || []}
              occupe={occupe}
              onEnregistrer={enregistrerCommande}
              onFermer={() => setDraft(null)}
            />
          ) : selection ? (
            <Detail
              commande={selection}
              receptions={receptions}
              factures={factures}
              paiements={paiements}
              nomFournisseur={nomFournisseur}
              occupe={occupe}
              onModifier={() => setDraft({ id: selection.id, ...selection.data })}
              onEnvoyer={() =>
                api.records
                  .update(manifest.slug, "commandes", selection.id, {
                    ...selection.data,
                    statut: "envoyee",
                  })
                  .then(() => etat.rafraichir())
              }
              onAnnuler={() => annulerCommande(selection)}
              onRecevoir={() => recevoir(selection)}
              onFacturer={() => facturer(selection)}
              onPayer={payer}
            />
          ) : (
            <Vide
              icone="faTruckField"
              titre="Choisissez une commande"
              aide="Ou créez-en une — le panneau de droite propose ce qui manque au stock."
            />
          )}
        </div>

        {/* ---- Panneau : réapprovisionnement ---- */}
        <aside className="achPanneau cosScroll">
          <h3>Sous le seuil</h3>
          {reappro.length ? (
            <>
              <p className="achAide">
                Ces articles sont au seuil ou en dessous. Les quantités
                proposées ramènent chaque stock au double de son seuil.
              </p>
              {reappro.map((r) => (
                <div key={r.article.id} className="achReappro">
                  <span className="achReapproNom">{r.article.data.designation}</span>
                  <span className="achReapproStock" data-zero={r.stock <= 0}>
                    {r.stock} / seuil {r.seuil}
                  </span>
                  <b>+{r.suggestion}</b>
                </div>
              ))}
              <Bouton large icone="faCartPlus" onClick={commanderReappro}>
                Tout mettre en commande
              </Bouton>
            </>
          ) : (
            <p className="achAide">
              Rien sous le seuil : les niveaux du Stock sont bons.
            </p>
          )}
        </aside>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Édition d'une commande
// ---------------------------------------------------------------------------

const Edition = ({
  draft,
  setDraft,
  fournisseurs,
  produits,
  occupe,
  onEnregistrer,
  onFermer,
}) => {
  const t = D.totaux(draft);
  const maj = (i, champ, valeur) =>
    setDraft((d) => ({
      ...d,
      lignes: d.lignes.map((l, j) => (j === i ? { ...l, [champ]: valeur } : l)),
    }));

  const ajouterLigne = (articleId) => {
    const a = produits.find((p) => p.id === articleId);
    if (!a) return;
    setDraft((d) => ({
      ...d,
      lignes: [
        ...d.lignes,
        {
          articleId: a.id,
          designation: a.data.designation,
          qte: 1,
          pu: Number(a.data.prixAchat) || 0,
          tva: Number(a.data.tva) || 0,
        },
      ],
    }));
  };

  return (
    <div className="achBloc">
      <div className="achBlocTete">
        <h3>{draft.id ? `Modifier ${draft.numero}` : `Nouvelle commande ${draft.numero}`}</h3>
        <span className="achFermer handcr" onClick={onFermer}>
          <Icon fafa="faXmark" width={12} />
        </span>
      </div>

      <div className="achChamps">
        <Champ label="Fournisseur">
          <select
            value={draft.fournisseurId}
            onChange={(e) => setDraft((d) => ({ ...d, fournisseurId: e.target.value }))}
          >
            <option value="">— choisir —</option>
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.data.nom}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          />
        </Champ>
      </div>

      {fournisseurs.length === 0 ? (
        <Notice ton="attention">
          Aucun fournisseur : créez-les dans l'application Stock, onglet
          Fournisseurs.
        </Notice>
      ) : null}

      <table className="achTable">
        <thead>
          <tr>
            <th>Article</th>
            <th className="achMt">Qté</th>
            <th className="achMt">PU HT</th>
            <th className="achMt">TVA %</th>
            <th className="achMt">Total HT</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {draft.lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.designation}</td>
              <td className="achMt">
                <input
                  type="number"
                  min="0"
                  value={l.qte}
                  onChange={(e) => maj(i, "qte", Number(e.target.value))}
                />
              </td>
              <td className="achMt">
                <input
                  type="number"
                  min="0"
                  value={l.pu}
                  onChange={(e) => maj(i, "pu", Number(e.target.value))}
                />
              </td>
              <td className="achMt">
                <input
                  type="number"
                  min="0"
                  value={l.tva}
                  onChange={(e) => maj(i, "tva", Number(e.target.value))}
                />
              </td>
              <td className="achMt">{money(D.totalLigne(l))}</td>
              <td>
                <span
                  className="achFermer handcr"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      lignes: d.lignes.filter((_, j) => j !== i),
                    }))
                  }
                >
                  <Icon fafa="faTrashCan" width={11} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="achAjout">
        <select value="" onChange={(e) => ajouterLigne(e.target.value)}>
          <option value="" disabled>
            + Ajouter un article du catalogue…
          </option>
          {produits.map((p) => (
            <option key={p.id} value={p.id}>
              {p.data.designation} — achat {money(p.data.prixAchat)}
            </option>
          ))}
        </select>
      </div>

      <div className="achTotaux">
        <span>HT {money(t.ht)}</span>
        <span>TVA {money(t.tva)}</span>
        <b>TTC {money(t.ttc)}</b>
      </div>

      <div className="achActions">
        <Bouton icone="faPaperPlane" off={occupe} onClick={() => onEnregistrer("envoyee")}>
          Enregistrer et envoyer
        </Bouton>
        <Bouton variante="secondaire" off={occupe} onClick={() => onEnregistrer("brouillon")}>
          Garder en brouillon
        </Bouton>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Détail d'une commande
// ---------------------------------------------------------------------------

const Detail = ({
  commande,
  receptions,
  factures,
  paiements,
  nomFournisseur,
  occupe,
  onModifier,
  onEnvoyer,
  onAnnuler,
  onRecevoir,
  onFacturer,
  onPayer,
}) => {
  const d = commande.data;
  const st = D.statutReel(commande, receptions);
  const t = D.totaux(d);
  const restes = D.resteARecevoir(commande, receptions);
  const recu = D.dejaRecu(commande, receptions);
  const sesFactures = factures.filter((f) => f.data.commandeId === commande.id);

  return (
    <>
      <div className="achBloc">
        <div className="achBlocTete">
          <h3>{d.numero}</h3>
          <span className="achStatut" data-ton={D.STATUTS[st]?.ton}>
            {D.STATUTS[st]?.label}
          </span>
          <div className="achBlocFin">
            {st === "brouillon" ? (
              <>
                <Bouton variante="secondaire" icone="faPen" onClick={onModifier}>
                  Modifier
                </Bouton>
                <Bouton icone="faPaperPlane" off={occupe} onClick={onEnvoyer}>
                  Envoyer
                </Bouton>
              </>
            ) : null}
            {st !== "annulee" && st !== "recue" && st !== "brouillon" ? (
              <Bouton icone="faDolly" off={occupe} onClick={onRecevoir}>
                Réceptionner
              </Bouton>
            ) : null}
            {st !== "annulee" && st !== "brouillon" ? (
              <Bouton variante="secondaire" icone="faFileInvoice" off={occupe} onClick={onFacturer}>
                Saisir la facture
              </Bouton>
            ) : null}
            {st === "brouillon" || st === "envoyee" ? (
              <Bouton variante="secondaire" icone="faBan" onClick={onAnnuler}>
                Annuler
              </Bouton>
            ) : null}
          </div>
        </div>

        <p className="achAide">
          {nomFournisseur(d.fournisseurId) || "Fournisseur inconnu"} · commandé le{" "}
          {d.date} · {money(t.ttc)} TTC
        </p>

        <table className="achTable">
          <thead>
            <tr>
              <th>Article</th>
              <th className="achMt">Commandé</th>
              <th className="achMt">Reçu</th>
              <th className="achMt">Reste</th>
              <th className="achMt">PU HT</th>
              <th className="achMt">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {(d.lignes || []).map((l, i) => {
              const r = recu[l.articleId] || 0;
              const reste = Math.max(0, (Number(l.qte) || 0) - r);
              return (
                <tr key={i}>
                  <td>{l.designation}</td>
                  <td className="achMt">{l.qte}</td>
                  <td className="achMt" data-ok={r >= l.qte}>
                    {r}
                  </td>
                  <td className="achMt" data-attention={reste > 0 && r > 0}>
                    {reste}
                  </td>
                  <td className="achMt">{money(l.pu)}</td>
                  <td className="achMt">{money(D.totalLigne(l))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sesFactures.length ? (
        <div className="achBloc">
          <h3>Factures fournisseur</h3>
          {sesFactures.map((f) => {
            const paye = D.dejaPaye(f, paiements);
            const reste = (Number(f.data.ttc) || 0) - paye;
            return (
              <div key={f.id} className="achFacture">
                <b>{f.data.reference}</b>
                <span>{f.data.date}</span>
                <span className="achMt">{money(f.data.ttc)}</span>
                {reste > 0.5 ? (
                  <>
                    <span className="achStatut" data-ton="attention">
                      reste {money(reste)}
                    </span>
                    <Bouton icone="faMoneyBillTransfer" off={occupe} onClick={() => onPayer(f)}>
                      Payer
                    </Bouton>
                  </>
                ) : (
                  <span className="achStatut" data-ton="ok">
                    payée
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Formulaires de modale
// ---------------------------------------------------------------------------

/// Réception : les quantités réellement descendues du camion, pré-remplies
/// avec le reste attendu — on corrige, on ne ressaisit pas.
const FormReception = ({ restes, onValider }) => {
  const [lignes, setLignes] = useState(() =>
    restes.map((l) => ({ articleId: l.articleId, designation: l.designation, qte: l.reste, pu: l.pu })),
  );
  return (
    <div className="achFormModale">
      {lignes.map((l, i) => (
        <label key={l.articleId} className="achFormLigne">
          <span>{l.designation}</span>
          <input
            type="number"
            min="0"
            value={l.qte}
            onChange={(e) =>
              setLignes((x) =>
                x.map((y, j) => (j === i ? { ...y, qte: Number(e.target.value) } : y)),
              )
            }
          />
        </label>
      ))}
      <div className="achFormActions">
        <button className="cosmPrimary handcr" onClick={() => onValider(lignes)}>
          Valider la réception
        </button>
      </div>
    </div>
  );
};

/// Facture fournisseur : référence et montants, pré-remplis depuis la
/// commande — la facture réelle peut différer, c'est elle qui fait foi.
const FormFacture = ({ defaut, onValider }) => {
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(D.today());
  const [ht, setHt] = useState(defaut.ht);
  const [tva, setTva] = useState(defaut.tva);
  return (
    <div className="achFormModale">
      <label className="achFormLigne">
        <span>Référence de la facture</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="FA-…" autoFocus />
      </label>
      <label className="achFormLigne">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="achFormLigne">
        <span>Montant HT</span>
        <input type="number" value={ht} onChange={(e) => setHt(Number(e.target.value))} />
      </label>
      <label className="achFormLigne">
        <span>TVA</span>
        <input type="number" value={tva} onChange={(e) => setTva(Number(e.target.value))} />
      </label>
      <div className="achFormTotal">TTC {money((Number(ht) || 0) + (Number(tva) || 0))}</div>
      <div className="achFormActions">
        <button
          className="cosmPrimary handcr"
          onClick={() =>
            reference.trim() &&
            onValider({ reference: reference.trim(), date, ht, tva, ttc: (Number(ht) || 0) + (Number(tva) || 0) })
          }
        >
          Enregistrer la facture
        </button>
      </div>
    </div>
  );
};

const FormPaiement = ({ reste, onValider }) => {
  const [montant, setMontant] = useState(reste);
  const [moyen, setMoyen] = useState("banque");
  const [date, setDate] = useState(D.today());
  return (
    <div className="achFormModale">
      <label className="achFormLigne">
        <span>Montant</span>
        <input type="number" value={montant} onChange={(e) => setMontant(Number(e.target.value))} autoFocus />
      </label>
      <label className="achFormLigne">
        <span>Moyen</span>
        <select value={moyen} onChange={(e) => setMoyen(e.target.value)}>
          <option value="banque">Virement / banque</option>
          <option value="mobile">Mobile Money</option>
          <option value="especes">Espèces</option>
        </select>
      </label>
      <label className="achFormLigne">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="achFormActions">
        <button
          className="cosmPrimary handcr"
          onClick={() => (Number(montant) || 0) > 0 && onValider({ montant, moyen, date })}
        >
          Enregistrer le paiement
        </button>
      </div>
    </div>
  );
};
