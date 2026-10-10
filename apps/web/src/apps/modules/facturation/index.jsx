import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { composerCourriel } from "../../courrielRequest";
import { chargerEntreprise } from "../../entreprise";
import { ouvrirDansEditeur } from "../../editeurFacturesRequest";
import { envoyerA } from "../../notifications";
import { Auteur } from "../../Auteur";
import { choisirClient, choisirProduit } from "../../referentiel";
import { Contenu, useChargement } from "../../chargement";
import { invoiceToPdf } from "./pdf";
import {
  DEVISES,
  MOYENS,
  STATUTS,
  TYPES,
  balanceAgee,
  devisVersFacture,
  encaisse,
  etatPaiement,
  joursDeRetard,
  plusJours,
  prochainNumero,
  statistiques,
  today,
  totalLigne,
  totaux,
} from "@companyos/shared/facturation";
import "./facturation.scss";

// Facturation : devis, factures, avoirs et règlements.
//
// Deux collections :
//
//   factures     tous les documents, quel que soit leur type. Le nom de la
//                collection est resté « factures » : les documents déjà
//                saisis y sont, et les renommer aurait coûté une migration
//                pour rien. Le champ `type` distingue devis, facture, avoir.
//   reglements   les encaissements, rattachés à un document.
//
// Clients et produits viennent du référentiel d'entreprise
// (`src/apps/referentiel.js`) : un seul fichier client, un seul catalogue,
// jamais de ressaisie.

const VUES = [
  { id: "documents", label: "Documents", icone: "faFileInvoice" },
  { id: "reglements", label: "Règlements", icone: "faMoneyBillTransfer" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
];

const FILTRES = [
  { id: "tous", label: "Tous" },
  { id: "devis", label: "Devis" },
  { id: "facture", label: "Factures" },
  { id: "avoir", label: "Avoirs" },
  { id: "impaye", label: "À encaisser" },
  { id: "retard", label: "En retard" },
];

const LIGNE_VIDE = { designation: "", qte: 1, pu: 0, remise: 0, tva: 18 };

// Une facture porte sa propre devise : on formate dans celle du document,
// sans conversion — le réglage d'affichage global ne réécrit pas un
// document commercial.
import { montantDans as money } from "../../../utils/monnaie";
import { manifest as descriptif } from "./manifest";

const documentVide = (type = "facture") => ({
  type,
  numero: "",
  clientId: "",
  clientNom: "",
  clientEntreprise: "",
  clientEmail: "",
  clientVille: "",
  clientTelephone: "",
  date: today(),
  echeance: plusJours(type === "devis" ? 15 : 30),
  devise: "XOF",
  statut: "brouillon",
  remiseGlobale: 0,
  notes: "",
  conditions: "",
  lignes: [{ ...LIGNE_VIDE }],
});

export const manifest = { ...descriptif, Window: FacturationApp };

function FacturationApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [documents, setDocuments] = useState([]);
  const [reglements, setReglements] = useState([]);
  const [membres, setMembres] = useState([]);

  const [vue, setVue] = useState("documents");
  const [filtre, setFiltre] = useState("tous");
  const [requete, setRequete] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [onglet, setOnglet] = useState("document");
  const [encaissement, setEncaissement] = useState({
    montant: "",
    moyen: MOYENS[0],
    date: today(),
    reference: "",
  });

  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3500);
  };

  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  // ---- Chargement ---------------------------------------------------------

  const charger = async () => {
    const [docs, regs, gens] = await Promise.all([
      api.records.list(manifest.slug, "factures"),
      api.records.list(manifest.slug, "reglements").catch(() => []),
      api.members().catch(() => []),
    ]);
    // Les documents saisis avant l'arrivée des devis n'ont pas de `type` :
    // ce sont des factures. On le pose à la lecture plutôt que de migrer
    // la base — une valeur par défaut vaut mieux qu'un script à rejouer.
    setDocuments(
      docs.map((d) => ({ ...d, data: { type: "facture", ...d.data } })),
    );
    setReglements(regs);
    setMembres(gens);
  };

  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["facturation/*", "crm/clients"] });

  // ---- Arrivée depuis une notification ------------------------------------

  const lienEnAttente = React.useRef(null);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== manifest.id) return;
      lienEnAttente.current = e.detail.params?.facture || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [documents]);
  // Le lien a pu arriver avant les données (ouverture à la demande).
  useEffect(() => {
    appliquerLien();
  }, [documents]);

  const appliquerLien = () => {
    const vise = lienEnAttente.current;
    if (!vise) return;
    const doc = documents.find((d) => d.id === vise);
    if (!doc) return; // pas encore chargé : on retentera après `charger()`
    lienEnAttente.current = null;
    setVue("documents");
    ouvrirDocument(doc);
  };

  useEffect(appliquerLien, [documents]);

  // ---- Dérivés ------------------------------------------------------------

  const selected = documents.find((d) => d.id === selectedId) || null;
  const totals = useMemo(() => totaux(draft || {}), [draft]);
  const stats = useMemo(
    () => statistiques(documents, reglements),
    [documents, reglements],
  );

  const reglementsDoc = useMemo(
    () =>
      reglements
        .filter((r) => r.data.documentId === selectedId)
        .sort((a, b) => (a.data.date < b.data.date ? 1 : -1)),
    [reglements, selectedId],
  );

  const visibles = useMemo(() => {
    const q = requete.trim().toLowerCase();
    return documents
      .filter((d) => {
        if (["devis", "facture", "avoir"].includes(filtre) && d.data.type !== filtre)
          return false;
        if (filtre === "impaye" || filtre === "retard") {
          const e = etatPaiement(d, reglements);
          if (filtre === "retard" && e.id !== "retard") return false;
          if (filtre === "impaye" && !["impayee", "partielle", "retard"].includes(e.id))
            return false;
        }
        if (!q) return true;
        return [d.data.numero, d.data.clientEntreprise, d.data.clientNom]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
  }, [documents, reglements, filtre, requete]);

  // ---- Documents ----------------------------------------------------------

  const ouvrirDocument = (record) => {
    setSelectedId(record.id);
    setDraft({ ...documentVide(record.data.type), ...record.data });
    setOnglet("document");
  };

  const nouveauDocument = (type) => {
    setSelectedId(null);
    setDraft({ ...documentVide(type), numero: prochainNumero(documents, type) });
    setOnglet("document");
  };

  const champ = (cle) => (e) => {
    const brut = e.target.value;
    const valeur = cle === "remiseGlobale" ? Number(brut) || 0 : brut;
    setDraft((d) => ({ ...d, [cle]: valeur }));
  };

  const setLigne = (index, cle) => (e) => {
    const brut = e.target.value;
    const valeur = cle === "designation" ? brut : Number(brut) || 0;
    setDraft((d) => ({
      ...d,
      lignes: d.lignes.map((l, i) => (i === index ? { ...l, [cle]: valeur } : l)),
    }));
  };

  const ajouterLigne = () =>
    setDraft((d) => ({ ...d, lignes: [...d.lignes, { ...LIGNE_VIDE }] }));

  const retirerLigne = (index) =>
    setDraft((d) => ({
      ...d,
      // On garde toujours une ligne : un document sans aucune ligne
      // n'offrirait plus nulle part où saisir.
      lignes: d.lignes.length > 1 ? d.lignes.filter((_, i) => i !== index) : d.lignes,
    }));

  /// Reprend un produit du catalogue d'entreprise : désignation, prix et
  /// taux de TVA sont recopiés, plus de ressaisie ni d'écart de tarif.
  const prendreProduit = async (index) => {
    const produit = await choisirProduit({ titre: "Ajouter un produit" });
    if (!produit) return;
    setDraft((d) => ({
      ...d,
      lignes: d.lignes.map((l, i) =>
        i === index
          ? {
              ...l,
              articleId: produit.id,
              designation: produit.data.designation,
              pu: Number(produit.data.prixVente) || 0,
              tva: Number(produit.data.tva ?? l.tva) || 0,
            }
          : l,
      ),
    }));
  };

  /// Reprend un client du fichier d'entreprise. Les coordonnées sont
  /// **recopiées** dans le document : une facture émise doit rester
  /// identique même si le client déménage l'année suivante.
  const prendreClient = async () => {
    const client = await choisirClient({ titre: "Choisir le client" });
    if (!client) return;
    setDraft((d) => ({
      ...d,
      clientId: client.id,
      clientNom: client.data.nom || "",
      clientEntreprise: client.data.entreprise || "",
      clientEmail: client.data.email || "",
      clientVille: client.data.ville || "",
      clientTelephone: client.data.telephone || "",
    }));
  };

  const enregistrerDocument = async () => {
    if (!draft) return;
    if (!draft.clientEntreprise && !draft.clientNom) {
      flash("Choisissez un client");
      return;
    }
    // Un numéro en double rend la comptabilité inexploitable : on le
    // refuse à la saisie plutôt que de le découvrir au contrôle fiscal.
    if (
      documents.some(
        (d) => d.id !== selectedId && d.data.numero === draft.numero.trim(),
      )
    ) {
      flash(`Le numéro « ${draft.numero} » est déjà utilisé`);
      return;
    }

    setBusy(true);
    try {
      const donnees = { ...draft, numero: draft.numero.trim() };
      if (selectedId) {
        await api.records.update(manifest.slug, "factures", selectedId, donnees);
        flash("Document enregistré");
      } else {
        const cree = await api.records.create(manifest.slug, "factures", donnees);
        setSelectedId(cree.id);
        flash(`${TYPES[draft.type].label} créé${draft.type === "facture" ? "e" : ""}`);
      }
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerDocument = async () => {
    if (!selectedId) return;
    const paiements = reglementsDoc.length;

    const ok = await modal.confirm({
      title: "Supprimer le document",
      message: `Supprimer ${TYPES[draft.type].label.toLowerCase()} ${draft.numero} ?`,
      detail:
        draft.statut !== "brouillon"
          ? "Ce document a été émis. Une comptabilité n'efface pas une pièce émise : préférez un avoir, qui garde la trace de l'annulation."
          : paiements
            ? `Ses ${paiements} règlement${paiements > 1 ? "s" : ""} partiront avec lui.`
            : undefined,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      for (const r of reglementsDoc) {
        await api.records.remove(manifest.slug, "reglements", r.id);
      }
      await api.records.remove(manifest.slug, "factures", selectedId);
      setSelectedId(null);
      setDraft(null);
      await etat.rafraichir();
      flash("Document supprimé");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  /// Change l'état décidé par l'utilisateur. L'état de paiement, lui, ne se
  /// pose jamais à la main : il se déduit des règlements.
  const changerStatut = async (statut) => {
    if (!selectedId) return;
    try {
      const donnees = { ...draft, statut };
      setDraft(donnees);
      await api.records.update(manifest.slug, "factures", selectedId, donnees);
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  /// Transforme un devis accepté en facture. Le devis reste intact : c'est
  /// une pièce du dossier client, pas un brouillon.
  const convertirEnFacture = async () => {
    if (!selected || selected.data.type !== "devis") return;

    const ok = await modal.confirm({
      title: "Convertir en facture",
      message: `Créer une facture à partir du devis ${draft.numero} ?`,
      detail: "Le devis est conservé tel quel et reste consultable.",
      confirmLabel: "Convertir",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const numero = prochainNumero(documents, "facture");
      const cree = await api.records.create(
        manifest.slug,
        "factures",
        devisVersFacture(selected, numero),
      );
      await api.records.update(manifest.slug, "factures", selected.id, {
        ...draft,
        statut: "accepte",
      });
      await etat.rafraichir();
      setSelectedId(cree.id);
      setDraft({ ...documentVide("facture"), ...cree.data });
      setFiltre("tous");
      flash(`Facture ${numero} créée`);
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Règlements ---------------------------------------------------------

  const ajouterReglement = async () => {
    if (!selectedId) return;
    const montant = Number(encaissement.montant);
    if (!Number.isFinite(montant) || montant <= 0) {
      flash("Indiquez un montant positif");
      return;
    }

    const etatAvant = etatPaiement(selected, reglements);
    const reste = etatAvant.reste ?? totals.ttc;
    if (montant > reste + 0.01) {
      const ok = await modal.confirm({
        title: "Montant supérieur au reste dû",
        message: `Le reste dû est de ${money(reste, draft.devise)}.`,
        detail: "Enregistrer davantage créera un trop-perçu à régulariser par un avoir.",
        confirmLabel: "Enregistrer quand même",
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      await api.records.create(manifest.slug, "reglements", {
        documentId: selectedId,
        montant,
        moyen: encaissement.moyen,
        date: encaissement.date || today(),
        reference: encaissement.reference.trim(),
      });
      prevenirSiSolde(montant, reste);
      setEncaissement({ montant: "", moyen: MOYENS[0], date: today(), reference: "" });
      await etat.rafraichir();
      flash("Règlement enregistré");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerReglement = async (r) => {
    const ok = await modal.confirm({
      title: "Supprimer le règlement",
      message: `${money(r.data.montant, draft.devise)} du ${r.data.date} ?`,
      detail: "Le reste dû sera recalculé sans lui.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "reglements", r.id);
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  /// Prévient l'émetteur quand un règlement solde **sa** facture.
  ///
  /// Au solde seulement : un acompte sur trois n'intéresse que la caisse,
  /// et une notification par encaissement rendrait les autres illisibles.
  const prevenirSiSolde = (montant, resteAvant) => {
    if (montant < resteAvant - 0.01) return;
    const emetteur = selected?.auteur;
    if (!emetteur || emetteur.id === session.user?.id) return;

    envoyerA(emetteur.id, {
      source: manifest.slug,
      titre: `${draft.numero} soldée`,
      message: [draft.clientEntreprise || draft.clientNom, money(totals.ttc, draft.devise)]
        .filter(Boolean)
        .join(" · "),
      lien: { app: manifest.id, params: { facture: selectedId } },
    });
  };

  // ---- Export -------------------------------------------------------------

  const exporterPdf = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const e = etatPaiement({ id: selectedId, data: draft }, reglements);
      const entreprise = await chargerEntreprise();
      const blob = invoiceToPdf({
        facture: draft,
        totaux: totals,
        typeLabel: TYPES[draft.type].label,
        emetteur: { ...(entreprise || {}), nom: entreprise?.nom || session.tenant?.name || "CompanyOS" },
        statutLabel:
          draft.type === "devis"
            ? STATUTS[draft.statut]?.label || draft.statut
            : e.label,
      });
      const node = await saveAs(blob, `${draft.numero}.pdf`, { folder: "Facturation" });
      if (node) {
        flash(`« ${node.name} » enregistré dans l'Explorateur`);
        // Le PDF est dans le cloud : on propose de l'envoyer au client par
        // l'app Courrier — brouillon prérempli, l'utilisateur relit avant
        // d'envoyer.
        const envoyer = await modal.confirm({
          title: "Envoyer au client ?",
          message: draft.clientEmail
            ? `Ouvrir un courriel à ${draft.clientEmail}, avec « ${node.name} » en pièce jointe.`
            : `Ouvrir un courriel avec « ${node.name} » en pièce jointe — la fiche client n'a pas d'adresse.`,
          confirmLabel: "Écrire le courriel",
          cancelLabel: "Plus tard",
        });
        if (envoyer) {
          composerCourriel({
            a: draft.clientEmail || "",
            sujet: `${TYPES[draft.type].label} ${draft.numero} — ${session.tenant?.name || ""}`.trim(),
            texte: `Bonjour,\n\nVeuillez trouver ci-joint ${draft.type === "devis" ? "notre devis" : "notre facture"} ${draft.numero}.\n\nCordialement,\n${session.user?.name || ""}`,
            pieceJointeId: node.id,
            pieceJointeNom: node.name,
          });
        }
      }
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const exporterCsv = async () => {
    const lignes = [
      ["Type", "Numéro", "Date", "Échéance", "Client", "HT", "TVA", "TTC", "Encaissé", "Reste", "État"],
      ...visibles.map((d) => {
        const t = totaux(d.data);
        const e = etatPaiement(d, reglements);
        return [
          TYPES[d.data.type]?.label || d.data.type,
          d.data.numero,
          d.data.date,
          d.data.echeance,
          d.data.clientEntreprise || d.data.clientNom,
          Math.round(t.ht),
          Math.round(t.tva),
          Math.round(t.ttc),
          Math.round(encaisse(d.id, reglements)),
          Math.round(e.reste ?? 0),
          e.label,
        ];
      }),
    ];

    // BOM UTF-8 et point-virgule : sans les deux, Excel en configuration
    // française ouvre le fichier en une seule colonne, accents cassés.
    const csv =
      "﻿" +
      lignes
        .map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"))
        .join("\r\n");

    const node = await saveAs(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "journal-des-ventes.csv",
      { folder: "Facturation" },
    );
    if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
  };

  // ---- Rendu --------------------------------------------------------------

  const etatDoc = selected ? etatPaiement(selected, reglements) : null;
  const paye = selectedId ? encaisse(selectedId, reglements) : 0;

  return (
    <ModuleWindow manifest={manifest} className="fctApp">
      {session.status !== "authenticated" ? (
        <div className="fctLocked">
          <Icon fafa="faLock" width={22} />
          <span>Connectez-vous pour accéder à la facturation.</span>
        </div>
      ) : (
        <div className="fctShell">
          {/* ---------- Barre latérale ---------- */}
          <aside className="fctNav cosScroll">
            {VUES.map((v) => (
              <div
                key={v.id}
                className="fctNavItem handcr"
                data-actif={vue === v.id}
                onClick={() => setVue(v.id)}
              >
                <Icon fafa={v.icone} width={13} />
                <span>{v.label}</span>
              </div>
            ))}

            {vue === "documents" ? (
              <>
                <div className="fctNavTitre">Filtrer</div>
                {FILTRES.map((f) => (
                  <div
                    key={f.id}
                    className="fctFiltre handcr"
                    data-actif={filtre === f.id}
                    onClick={() => setFiltre(f.id)}
                  >
                    <span>{f.label}</span>
                    <span className="fctFiltreCompte">
                      {
                        documents.filter((d) => {
                          if (["devis", "facture", "avoir"].includes(f.id))
                            return d.data.type === f.id;
                          if (f.id === "retard")
                            return etatPaiement(d, reglements).id === "retard";
                          if (f.id === "impaye")
                            return ["impayee", "partielle", "retard"].includes(
                              etatPaiement(d, reglements).id,
                            );
                          return true;
                        }).length
                      }
                    </span>
                  </div>
                ))}

                <div className="fctNavTitre">Créer</div>
                {Object.entries(TYPES).map(([id, t]) => (
                  <div
                    key={id}
                    className="fctNavItem handcr"
                    onClick={() => nouveauDocument(id)}
                  >
                    <Icon fafa={t.icone} width={12} />
                    <span>Nouveau {t.label.toLowerCase()}</span>
                  </div>
                ))}
              </>
            ) : null}
          </aside>

          {/* ---------- Contenu ---------- */}
          <main className="fctMain">
            <div className="fctStats">
              <div className="fctStat">
                <span className="fctStatVal">{money(stats.facture)}</span>
                <span className="fctStatLbl">facturé</span>
              </div>
              <div className="fctStat" data-ton="ok">
                <span className="fctStatVal">{money(stats.encaisse)}</span>
                <span className="fctStatLbl">encaissé</span>
              </div>
              <div
                className="fctStat handcr"
                data-ton="info"
                onClick={() => {
                  setVue("documents");
                  setFiltre("impaye");
                }}
              >
                <span className="fctStatVal">{money(stats.enAttente)}</span>
                <span className="fctStatLbl">à encaisser</span>
              </div>
              <div
                className="fctStat handcr"
                data-ton="bad"
                onClick={() => {
                  setVue("documents");
                  setFiltre("retard");
                }}
              >
                <span className="fctStatVal">{money(stats.enRetard)}</span>
                <span className="fctStatLbl">
                  en retard{stats.nbRetard ? ` · ${stats.nbRetard}` : ""}
                </span>
              </div>
            </div>

            {vue === "documents" ? (
              <>
                <div className="fctBarre">
                  <div className="fctRecherche">
                    <Icon fafa="faMagnifyingGlass" width={11} />
                    <input
                      type="text"
                      placeholder="Numéro ou client…"
                      value={requete}
                      onChange={(e) => setRequete(e.target.value)}
                    />
                    {requete ? (
                      <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
                    ) : null}
                  </div>
                  <div
                    className="fctPrimary handcr"
                    onClick={() => nouveauDocument("facture")}
                  >
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouvelle facture</span>
                  </div>
                  <div className="fctBtnGhost handcr" onClick={exporterCsv}>
                    Export
                  </div>
                </div>

                {etat.initial || etat.erreur ? (
                  <Contenu etat={etat} vide={false} lignes={7} />
                ) : !visibles.length ? (
                  <div className="fctVide">
                    <Icon fafa="faFileInvoice" width={26} />
                    <span>
                      {documents.length
                        ? "Aucun document pour ce filtre."
                        : "Aucun document émis."}
                    </span>
                    {!documents.length ? (
                      <div
                        className="fctPrimary handcr"
                        onClick={() => nouveauDocument("facture")}
                      >
                        Créer la première facture
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="fctTable cosScroll">
                    <div className="fctTr fctTrDoc fctTh">
                      <span>Numéro</span>
                      <span>Client</span>
                      <span>Date</span>
                      <span>Échéance</span>
                      <span className="fctNum">Total TTC</span>
                      <span className="fctNum">Reste</span>
                      <span>État</span>
                    </div>
                    {visibles.map((d) => {
                      const t = totaux(d.data);
                      const e = etatPaiement(d, reglements);
                      const retard = joursDeRetard(d);
                      return (
                        <div
                          key={d.id}
                          className="fctTr fctTrDoc handcr"
                          data-actif={d.id === selectedId}
                          onClick={() => ouvrirDocument(d)}
                        >
                          <span className="fctNumero">
                            <strong>{d.data.numero}</strong>
                            <em>{TYPES[d.data.type]?.label}</em>
                          </span>
                          <span className="fctMuted">
                            {d.data.clientEntreprise || d.data.clientNom || "—"}
                          </span>
                          <span className="fctMuted">{d.data.date}</span>
                          <span className="fctMuted">
                            {d.data.echeance}
                            {retard && e.id === "retard" ? (
                              <em className="fctRetard"> +{retard} j</em>
                            ) : null}
                          </span>
                          <span className="fctNum">
                            {d.data.type === "avoir" ? "−" : ""}
                            {money(t.ttc, d.data.devise)}
                          </span>
                          <span className="fctNum fctMuted">
                            {e.reste ? money(e.reste, d.data.devise) : "—"}
                          </span>
                          <span>
                            <span className="fctTag" data-ton={e.ton}>
                              {e.label}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}

            {vue === "reglements" ? (
              !reglements.length ? (
                <div className="fctVide">
                  <Icon fafa="faMoneyBillTransfer" width={24} />
                  <span>Aucun règlement enregistré.</span>
                </div>
              ) : (
                <div className="fctTable cosScroll">
                  <div className="fctTr fctTrReg fctTh">
                    <span>Date</span>
                    <span>Document</span>
                    <span>Client</span>
                    <span>Moyen</span>
                    <span>Référence</span>
                    <span className="fctNum">Montant</span>
                  </div>
                  {[...reglements]
                    .sort((a, b) => (a.data.date < b.data.date ? 1 : -1))
                    .map((r) => {
                      const doc = documents.find((d) => d.id === r.data.documentId);
                      return (
                        <div key={r.id} className="fctTr fctTrReg">
                          <span className="fctMuted">{r.data.date}</span>
                          <span
                            className="fctLien handcr"
                            onClick={() => {
                              if (!doc) return;
                              setVue("documents");
                              ouvrirDocument(doc);
                            }}
                          >
                            {doc?.data.numero || "document supprimé"}
                          </span>
                          <span className="fctMuted">
                            {doc?.data.clientEntreprise || doc?.data.clientNom || "—"}
                          </span>
                          <span className="fctMuted">{r.data.moyen}</span>
                          <span className="fctMuted">{r.data.reference || "—"}</span>
                          <span className="fctNum">
                            {money(r.data.montant, doc?.data.devise)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )
            ) : null}

            {vue === "analyse" ? (
              <div className="fctAnalyse cosScroll">
                <div className="fctSousTitre">Balance âgée des impayés</div>
                {(() => {
                  const tranches = balanceAgee(documents, reglements);
                  const max = Math.max(1, ...tranches.map((t) => t.montant));
                  if (!tranches.some((t) => t.montant))
                    return (
                      <div className="fctEmptyBox">
                        Aucun impayé. Rien à relancer aujourd'hui.
                      </div>
                    );
                  return tranches.map((t) => (
                    <div key={t.id} className="fctJauge">
                      <span className="fctJaugeNom">{t.label}</span>
                      <span className="fctJaugeFond">
                        <span
                          className="fctJaugeVal"
                          data-alerte={t.id === "j90" || t.id === "plus"}
                          style={{ width: `${(t.montant / max) * 100}%` }}
                        />
                      </span>
                      <span className="fctJaugeChiffre">{money(t.montant)}</span>
                    </div>
                  ));
                })()}

                <div className="fctSousTitre">Premiers clients</div>
                {(() => {
                  const parClient = new Map();
                  for (const d of documents) {
                    if (d.data.type === "devis" || d.data.statut === "brouillon") continue;
                    const cle = d.data.clientEntreprise || d.data.clientNom || "—";
                    const signe = d.data.type === "avoir" ? -1 : 1;
                    parClient.set(
                      cle,
                      (parClient.get(cle) || 0) + totaux(d.data).ttc * signe,
                    );
                  }
                  const liste = [...parClient.entries()]
                    .map(([nom, montant]) => ({ nom, montant }))
                    .sort((a, b) => b.montant - a.montant)
                    .slice(0, 8);

                  if (!liste.length)
                    return <div className="fctEmptyBox">Aucune vente enregistrée.</div>;

                  const max = Math.max(1, ...liste.map((c) => c.montant));
                  return liste.map((c) => (
                    <div key={c.nom} className="fctJauge">
                      <span className="fctJaugeNom">{c.nom}</span>
                      <span className="fctJaugeFond">
                        <span
                          className="fctJaugeVal"
                          style={{ width: `${(c.montant / max) * 100}%` }}
                        />
                      </span>
                      <span className="fctJaugeChiffre">{money(c.montant)}</span>
                    </div>
                  ));
                })()}

                <div className="fctSousTitre">À relancer</div>
                {(() => {
                  const retard = documents
                    .filter((d) => etatPaiement(d, reglements).id === "retard")
                    .sort((a, b) => joursDeRetard(b) - joursDeRetard(a));
                  if (!retard.length)
                    return <div className="fctEmptyBox">Aucune facture en retard.</div>;
                  return retard.map((d) => {
                    const e = etatPaiement(d, reglements);
                    return (
                      <div
                        key={d.id}
                        className="fctRelance handcr"
                        onClick={() => {
                          setVue("documents");
                          ouvrirDocument(d);
                        }}
                      >
                        <span className="fctTag" data-ton="bad">
                          +{joursDeRetard(d)} j
                        </span>
                        <span className="fctRelanceNom">
                          {d.data.clientEntreprise || d.data.clientNom}
                        </span>
                        <span className="fctMuted">{d.data.numero}</span>
                        <span className="fctNum">{money(e.reste, d.data.devise)}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="fctPanneau cosScroll">
            {!draft ? (
              <div className="fctPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un document, ou créez un devis, une facture ou un
                  avoir.
                </span>
              </div>
            ) : (
              <>
                <div className="fctPanTete">
                  <div>
                    <div className="fctPanNum">{draft.numero}</div>
                    <div className="fctPanType">{TYPES[draft.type].label}</div>
                  </div>
                  {etatDoc ? (
                    <span className="fctTag" data-ton={etatDoc.ton}>
                      {etatDoc.label}
                    </span>
                  ) : null}
                </div>

                {selectedId && draft.type !== "devis" ? (
                  <div className="fctSolde">
                    <div>
                      <span className="fctSoldeLbl">Encaissé</span>
                      <strong>{money(paye, draft.devise)}</strong>
                    </div>
                    <div>
                      <span className="fctSoldeLbl">Reste dû</span>
                      <strong data-ton={etatDoc?.reste ? "bad" : "ok"}>
                        {money(etatDoc?.reste ?? totals.ttc, draft.devise)}
                      </strong>
                    </div>
                  </div>
                ) : null}

                <div className="fctOnglets">
                  {[
                    ["document", "Document"],
                    ["lignes", "Lignes"],
                    ["reglements", "Règlements"],
                  ].map(([id, label]) => (
                    <span
                      key={id}
                      className="handcr"
                      data-actif={onglet === id}
                      onClick={() => setOnglet(id)}
                    >
                      {label}
                    </span>
                  ))}
                </div>

                {onglet === "document" ? (
                  <>
                    <div className="fctClient">
                      <div className="fctClientInfo">
                        <div className="fctClientNom">
                          {draft.clientEntreprise || draft.clientNom || "Aucun client"}
                        </div>
                        <div className="fctClientMeta">
                          {[draft.clientEntreprise ? draft.clientNom : null, draft.clientVille, draft.clientEmail]
                            .filter(Boolean)
                            .join(" · ") || "Choisissez un client du fichier"}
                        </div>
                      </div>
                      <div className="fctBtnGhost handcr" onClick={prendreClient}>
                        {draft.clientId ? "Changer" : "Choisir"}
                      </div>
                    </div>

                    <div className="fctDeux">
                      <label className="fctField">
                        <span className="fctLabel">Numéro</span>
                        <input type="text" value={draft.numero} onChange={champ("numero")} />
                      </label>
                      <label className="fctField">
                        <span className="fctLabel">Devise</span>
                        <select value={draft.devise} onChange={champ("devise")}>
                          {DEVISES.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="fctDeux">
                      <label className="fctField">
                        <span className="fctLabel">Date</span>
                        <input type="date" value={draft.date} onChange={champ("date")} />
                      </label>
                      <label className="fctField">
                        <span className="fctLabel">Échéance</span>
                        <input
                          type="date"
                          value={draft.echeance}
                          onChange={champ("echeance")}
                        />
                      </label>
                    </div>

                    <div className="fctField">
                      <span className="fctLabel">État</span>
                      <div className="fctStatuts">
                        {/* « Accepté » et « Refusé » n'ont de sens que pour
                            un devis : une facture ne se refuse pas, elle
                            s'annule ou se contre-passe par un avoir. */}
                        {Object.entries(STATUTS)
                          .filter(
                            ([id]) =>
                              draft.type === "devis" ||
                              !["accepte", "refuse"].includes(id),
                          )
                          .map(([id, s]) => (
                            <span
                              key={id}
                              className="handcr"
                              data-actif={draft.statut === id}
                              data-ton={s.ton}
                              onClick={() => changerStatut(id)}
                            >
                              {s.label}
                            </span>
                          ))}
                      </div>
                    </div>

                    <label className="fctField">
                      <span className="fctLabel">Notes</span>
                      <textarea rows={2} value={draft.notes} onChange={champ("notes")} />
                    </label>

                    <label className="fctField">
                      <span className="fctLabel">Conditions de paiement</span>
                      <input
                        type="text"
                        placeholder="Paiement à 30 jours, Mobile Money accepté"
                        value={draft.conditions}
                        onChange={champ("conditions")}
                      />
                    </label>

                    {selected ? <Auteur record={selected} /> : null}

                    <div className="fctFormActions">
                      <div
                        className="fctPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerDocument}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                      <div className="fctBtnGhost handcr" onClick={exporterPdf}>
                        PDF
                      </div>
                      {/* La mise en page soignée (modèles, logo, couleurs,
                          échéancier) se fait dans l'Éditeur de factures,
                          sur la même fiche : rien n'est dupliqué. */}
                      {selectedId && draft.type === "facture" ? (
                        <div
                          className="fctBtnGhost handcr"
                          title="Ouvrir cette facture dans l'Éditeur de factures (modèles, logo, envoi)"
                          onClick={() => ouvrirDansEditeur({ id: selectedId })}
                        >
                          <Icon fafa="faWandMagicSparkles" width={11} />
                          <span>Éditeur avancé</span>
                        </div>
                      ) : null}
                    </div>

                    {selectedId ? (
                      <div className="fctFormActions">
                        {draft.type === "devis" ? (
                          <div
                            className="fctBtnGhost handcr"
                            data-off={busy}
                            onClick={convertirEnFacture}
                          >
                            Convertir en facture
                          </div>
                        ) : null}
                        <div
                          className="fctBtnGhost fctDanger handcr"
                          onClick={supprimerDocument}
                        >
                          Supprimer
                        </div>
                      </div>
                    ) : null}

                    {draft.sourceNumero ? (
                      <div className="fctNote">
                        Établie à partir du devis {draft.sourceNumero}.
                      </div>
                    ) : null}
                  </>
                ) : null}

                {onglet === "lignes" ? (
                  <>
                    {draft.lignes.map((l, i) => (
                      <div key={i} className="fctLigne">
                        <div className="fctLigneTete">
                          <input
                            type="text"
                            placeholder="Désignation"
                            value={l.designation}
                            onChange={setLigne(i, "designation")}
                          />
                          <span
                            className="fctIconBtn handcr"
                            title="Choisir dans le catalogue"
                            onClick={() => prendreProduit(i)}
                          >
                            <Icon fafa="faBoxesStacked" width={11} />
                          </span>
                          <span
                            className="fctIconBtn handcr"
                            title="Retirer la ligne"
                            onClick={() => retirerLigne(i)}
                          >
                            <Icon fafa="faXmark" width={10} />
                          </span>
                        </div>
                        <div className="fctQuatre">
                          <label className="fctField">
                            <span className="fctLabel">Qté</span>
                            <input
                              type="number"
                              value={l.qte}
                              onChange={setLigne(i, "qte")}
                            />
                          </label>
                          <label className="fctField">
                            <span className="fctLabel">P.U.</span>
                            <input type="number" value={l.pu} onChange={setLigne(i, "pu")} />
                          </label>
                          <label className="fctField">
                            <span className="fctLabel">Remise %</span>
                            <input
                              type="number"
                              value={l.remise || 0}
                              onChange={setLigne(i, "remise")}
                            />
                          </label>
                          <label className="fctField">
                            <span className="fctLabel">TVA %</span>
                            <input
                              type="number"
                              value={l.tva}
                              onChange={setLigne(i, "tva")}
                            />
                          </label>
                        </div>
                        <div className="fctLigneTotal">
                          {money(totalLigne(l), draft.devise)}
                        </div>
                      </div>
                    ))}

                    <div className="fctFormActions">
                      <div className="fctBtnGhost handcr" onClick={ajouterLigne}>
                        <Icon fafa="faPlus" width={9} />
                        <span>Ajouter une ligne</span>
                      </div>
                    </div>

                    <label className="fctField">
                      <span className="fctLabel">Remise globale %</span>
                      <input
                        type="number"
                        value={draft.remiseGlobale || 0}
                        onChange={champ("remiseGlobale")}
                      />
                    </label>

                    <div className="fctRecap">
                      <span>Sous-total</span>
                      <strong>{money(totals.brut, draft.devise)}</strong>
                    </div>
                    {totals.abattement ? (
                      <div className="fctRecap">
                        <span>Remise globale</span>
                        <strong>− {money(totals.abattement, draft.devise)}</strong>
                      </div>
                    ) : null}
                    <div className="fctRecap">
                      <span>Total HT</span>
                      <strong>{money(totals.ht, draft.devise)}</strong>
                    </div>
                    {/* Le détail par taux n'est pas décoratif : une facture
                        doit le porter, et il permet de repérer une ligne
                        dont le taux a été saisi de travers. */}
                    {totals.parTaux.map((t) => (
                      <div key={t.taux} className="fctRecap fctRecapFin">
                        <span>TVA {t.taux} % sur {money(t.base, draft.devise)}</span>
                        <strong>{money(t.montant, draft.devise)}</strong>
                      </div>
                    ))}
                    <div className="fctRecap fctRecapTtc">
                      <span>Total TTC</span>
                      <strong>{money(totals.ttc, draft.devise)}</strong>
                    </div>

                    <div className="fctFormActions">
                      <div
                        className="fctPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerDocument}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                    </div>
                  </>
                ) : null}

                {onglet === "reglements" ? (
                  !selectedId ? (
                    <div className="fctEmptyBox">
                      Enregistrez le document avant d'encaisser.
                    </div>
                  ) : draft.type === "devis" ? (
                    <div className="fctEmptyBox">
                      Un devis ne s'encaisse pas. Convertissez-le en facture.
                    </div>
                  ) : (
                    <>
                      <div className="fctDeux">
                        <label className="fctField">
                          <span className="fctLabel">Montant</span>
                          <input
                            type="number"
                            placeholder={String(Math.round(etatDoc?.reste ?? 0))}
                            value={encaissement.montant}
                            onChange={(e) =>
                              setEncaissement((v) => ({ ...v, montant: e.target.value }))
                            }
                          />
                        </label>
                        <label className="fctField">
                          <span className="fctLabel">Date</span>
                          <input
                            type="date"
                            value={encaissement.date}
                            onChange={(e) =>
                              setEncaissement((v) => ({ ...v, date: e.target.value }))
                            }
                          />
                        </label>
                      </div>

                      <div className="fctDeux">
                        <label className="fctField">
                          <span className="fctLabel">Moyen</span>
                          <select
                            value={encaissement.moyen}
                            onChange={(e) =>
                              setEncaissement((v) => ({ ...v, moyen: e.target.value }))
                            }
                          >
                            {MOYENS.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="fctField">
                          <span className="fctLabel">Référence</span>
                          <input
                            type="text"
                            placeholder="N° de transaction"
                            value={encaissement.reference}
                            onChange={(e) =>
                              setEncaissement((v) => ({ ...v, reference: e.target.value }))
                            }
                          />
                        </label>
                      </div>

                      <div className="fctFormActions">
                        <div
                          className="fctPrimary handcr"
                          data-off={busy}
                          onClick={ajouterReglement}
                        >
                          Enregistrer le règlement
                        </div>
                        {etatDoc?.reste ? (
                          <div
                            className="fctBtnGhost handcr"
                            onClick={() =>
                              setEncaissement((v) => ({
                                ...v,
                                montant: String(Math.round(etatDoc.reste)),
                              }))
                            }
                          >
                            Solder
                          </div>
                        ) : null}
                      </div>

                      {!reglementsDoc.length ? (
                        <div className="fctEmptyBox">Aucun règlement enregistré.</div>
                      ) : (
                        <div className="fctHisto">
                          {reglementsDoc.map((r) => (
                            <div key={r.id} className="fctHistoLigne">
                              <div className="fctHistoInfo">
                                <div className="fctHistoTitre">
                                  {money(r.data.montant, draft.devise)} · {r.data.moyen}
                                </div>
                                <div className="fctHistoMeta">
                                  {[r.data.date, r.data.reference, r.auteur?.name]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              </div>
                              <span
                                className="fctIconBtn handcr"
                                onClick={() => supprimerReglement(r)}
                              >
                                <Icon fafa="faXmark" width={10} />
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                ) : null}
              </>
            )}
          </aside>

          {notice ? <div className="fctNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}
