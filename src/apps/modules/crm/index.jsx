import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { Auteur } from "../../Auteur";
import { Avatar } from "../../Avatar";
import { invaliderReferentiel } from "../../referentiel";
import { Contenu, useChargement } from "../../chargement";
import { totaux } from "../facturation/domaine";
import {
  ACTIVITES,
  ETAPES,
  ETAPES_OUVERTES,
  STATUTS,
  aFaire,
  chiffreAffaires,
  chronologie,
  clientsDormants,
  dernierContact,
  jourssansContact,
  pipeline,
  plusJours,
  prochaineAction,
  tauxTransformation,
  today,
  valeurPonderee,
} from "./domaine";
import "./crm.scss";

// CRM : portefeuille, pipeline commercial et suivi de la relation.
//
// Trois collections :
//
//   clients        le fichier client de l'entreprise — lu par la
//                  Facturation et les Projets via le référentiel partagé
//   opportunites   les affaires en cours, avec leur étape et leur montant
//   activites      appels, rendez-vous, e-mails, notes et **tâches**
//
// Une tâche est une activité qui porte une échéance et qui n'est pas
// encore faite : même chronologie, pas une entité à part. Séparer les deux
// obligerait à regarder à deux endroits pour savoir où en est un dossier.

const VUES = [
  { id: "portefeuille", label: "Portefeuille", icone: "faUsers" },
  { id: "pipeline", label: "Pipeline", icone: "faFilter" },
  { id: "agenda", label: "À faire", icone: "faListCheck" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
];

const CLIENT_VIDE = {
  nom: "",
  entreprise: "",
  email: "",
  telephone: "",
  ville: "",
  adresse: "",
  secteur: "",
  statut: "prospect",
  responsableId: "",
  notes: "",
};

const OPPORTUNITE_VIDE = {
  clientId: "",
  libelle: "",
  montant: 0,
  etape: "contact",
  probabilite: "",
  dateCloture: "",
  notes: "",
};

import { montant as money } from "../../../utils/monnaie";

const nomDe = (c) => c?.data.entreprise || c?.data.nom || "Sans nom";
const initiale = (c) => nomDe(c).trim().charAt(0).toUpperCase();

export const manifest = {
  id: "crm",
  slug: "crm",
  version: "2.0.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "2.0.0", texte: "Pipeline commercial, suivi des échanges, relances datées et chiffre d'affaires par client." },
    { version: "1.1.0", texte: "Responsable de compte, prévenu à l'attribution." },
  ],
  name: "CRM",
  icon: "people",
  action: "CRMAPP",
  // Le chiffre d'affaires d'un client se lit dans la Facturation : c'est
  // la seule source qui fasse foi, et la recopier ici la ferait diverger.
  capacites: { lit: ["facturation:factures"], ecrit: [] },
  Window: CrmApp,
};

/// Carte d'affaire du pipeline.
///
/// Définie **hors** du composant parent et mémorisée : déclarée à
/// l'intérieur, React en ferait un type nouveau à chaque rendu, démonterait
/// puis remonterait chaque carte, et détruirait le nœud en cours de
/// glissement au premier `dragover` — le glisser-déposer serait cassé.
const CarteAffaire = React.memo(function CarteAffaire({
  opp,
  client,
  actif,
  onOuvrir,
  onGlisser,
}) {
  return (
    <div
      className="crmAffaire handcr"
      data-actif={actif}
      draggable
      onDragStart={(e) => {
        // Sans `setData`, le navigateur n'initie tout simplement pas le
        // glissement — il ne suffit pas de poser `draggable`.
        e.dataTransfer.setData("text/plain", opp.id);
        e.dataTransfer.effectAllowed = "move";
        onGlisser(opp.id);
      }}
      onClick={() => onOuvrir(opp)}
    >
      <div className="crmAffaireNom">{opp.data.libelle || "Sans libellé"}</div>
      <div className="crmAffaireClient">{client ? nomDe(client) : "—"}</div>
      <div className="crmAffairePied">
        <span className="crmAffaireMontant">{money(opp.data.montant)}</span>
        {opp.data.dateCloture ? (
          <span className="crmAffaireDate">{opp.data.dateCloture}</span>
        ) : null}
      </div>
    </div>
  );
});

function CrmApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id || manifest.icon]);
  const session = useSelector((state) => state.session);

  const [clients, setClients] = useState([]);
  const [opportunites, setOpportunites] = useState([]);
  const [activites, setActivites] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [membres, setMembres] = useState([]);

  const [vue, setVue] = useState("portefeuille");
  const [filtreStatut, setFiltreStatut] = useState("tous");
  const [requete, setRequete] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [onglet, setOnglet] = useState("fiche");
  const [oppOuverte, setOppOuverte] = useState(null);
  const [glisse, setGlisse] = useState(null);

  const [activite, setActivite] = useState({
    type: "appel",
    date: today(),
    resume: "",
    echeance: "",
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
    const [cl, op, ac, doc, gens] = await Promise.all([
      api.records.list(manifest.slug, "clients"),
      api.records.list(manifest.slug, "opportunites"),
      api.records.list(manifest.slug, "activites").catch(() => []),
      // La Facturation peut ne pas être installée : le CRM reste
      // parfaitement utilisable, simplement sans chiffre d'affaires.
      api.records.list("facturation", "factures").catch(() => []),
      api.members().catch(() => []),
    ]);
    setClients(cl);
    setOpportunites(op);
    setActivites(ac);
    setDocuments(doc);
    setMembres(gens);
  };

  const etat = useChargement(ouvert, charger);

  /// Le fichier client est partagé : toute écriture doit prévenir le reste
  /// de l'OS, sinon la Facturation ouverte à côté propose une liste périmée.
  const rafraichir = async () => {
    await etat.rafraichir();
    invaliderReferentiel();
  };

  // ---- Arrivée depuis une notification ------------------------------------

  const lienEnAttente = React.useRef(null);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== manifest.id) return;
      lienEnAttente.current = e.detail.params?.client || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [clients]);

  const appliquerLien = () => {
    const vise = lienEnAttente.current;
    if (!vise) return;
    const client = clients.find((c) => c.id === vise);
    if (!client) return; // pas encore chargé : on retentera après `charger()`
    lienEnAttente.current = null;
    setVue("portefeuille");
    ouvrirClient(client);
  };

  useEffect(appliquerLien, [clients]);

  // ---- Dérivés ------------------------------------------------------------

  const selected = clients.find((c) => c.id === selectedId) || null;
  const membreDe = (id) => membres.find((m) => m.id === id);
  const clientDe = (id) => clients.find((c) => c.id === id);

  const visibles = useMemo(() => {
    const q = requete.trim().toLowerCase();
    return clients
      .filter((c) => {
        if (filtreStatut !== "tous" && c.data.statut !== filtreStatut) return false;
        if (filtreStatut === "arelancer") return false;
        if (!q) return true;
        return [c.data.nom, c.data.entreprise, c.data.ville, c.data.email, c.data.telephone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => nomDe(a).localeCompare(nomDe(b), "fr"));
  }, [clients, filtreStatut, requete]);

  const taches = useMemo(() => aFaire(activites, today(), 14), [activites]);
  const dormants = useMemo(
    () => clientsDormants(clients, activites, 60),
    [clients, activites],
  );
  const etapes = useMemo(() => pipeline(opportunites), [opportunites]);
  const transformation = useMemo(
    () => tauxTransformation(opportunites),
    [opportunites],
  );

  const affairesClient = useMemo(
    () => opportunites.filter((o) => o.data.clientId === selectedId),
    [opportunites, selectedId],
  );

  const timeline = useMemo(
    () => (selectedId ? chronologie(selectedId, activites, opportunites) : []),
    [selectedId, activites, opportunites],
  );

  /// Chiffre d'affaires par client, calculé une fois pour toute la liste.
  /// Le faire par ligne relirait tous les documents à chaque rendu — ce qui
  /// se voit dès la centième fiche.
  const caParClient = useMemo(() => {
    const par = {};
    for (const c of clients) par[c.id] = chiffreAffaires(c.id, documents, totaux);
    return par;
  }, [clients, documents]);

  const caClient = selectedId ? caParClient[selectedId] || 0 : 0;

  const pipeTotal = etapes.reduce((s, e) => s + e.montant, 0);
  const pipePondere = etapes.reduce((s, e) => s + e.pondere, 0);

  // ---- Clients ------------------------------------------------------------

  const ouvrirClient = (record) => {
    setSelectedId(record.id);
    setDraft({ ...CLIENT_VIDE, ...record.data });
    setOppOuverte(null);
    setOnglet("fiche");
  };

  const nouveauClient = () => {
    setSelectedId(null);
    setDraft({ ...CLIENT_VIDE });
    setOppOuverte(null);
    setOnglet("fiche");
  };

  const champ = (cle) => (e) => {
    const valeur = e.target.value;
    setDraft((d) => ({ ...d, [cle]: valeur }));
  };

  /// Confier un client, c'est demander quelque chose à quelqu'un : il doit
  /// l'apprendre autrement qu'en rouvrant la fiche par hasard.
  const prevenirResponsable = (idClient) => {
    const avant = selected?.data.responsableId || "";
    const apres = draft.responsableId || "";
    if (!apres || apres === avant || apres === session.user?.id) return;

    envoyerA(apres, {
      source: manifest.slug,
      titre: `Client à suivre : ${draft.entreprise || draft.nom}`,
      message: [draft.ville, STATUTS[draft.statut]?.label].filter(Boolean).join(" · "),
      lien: { app: manifest.id, params: { client: idClient } },
    });
  };

  const enregistrerClient = async () => {
    if (!draft?.nom.trim() && !draft?.entreprise.trim()) {
      flash("Renseignez au moins un nom ou une entreprise");
      return;
    }
    setBusy(true);
    try {
      if (selectedId) {
        prevenirResponsable(selectedId);
        await api.records.update(manifest.slug, "clients", selectedId, draft);
        flash("Fiche mise à jour");
      } else {
        const cree = await api.records.create(manifest.slug, "clients", draft);
        setSelectedId(cree.id);
        // Après création seulement : avant, il n'y a pas d'identifiant à
        // mettre dans le lien de la notification.
        prevenirResponsable(cree.id);
        flash("Client créé");
      }
      await rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerClient = async () => {
    if (!selectedId) return;
    const nbAffaires = affairesClient.length;
    const nbActivites = activites.filter((a) => a.data.clientId === selectedId).length;
    const nbDocs = documents.filter((d) => d.data.clientId === selectedId).length;

    const ok = await modal.confirm({
      title: "Supprimer la fiche",
      message: `Supprimer « ${nomDe(selected)} » ?`,
      detail: [
        nbAffaires ? `${nbAffaires} affaire${nbAffaires > 1 ? "s" : ""}` : null,
        nbActivites ? `${nbActivites} activité${nbActivites > 1 ? "s" : ""}` : null,
      ]
        .filter(Boolean)
        .join(" et ")
        ? `${[
            nbAffaires ? `${nbAffaires} affaire${nbAffaires > 1 ? "s" : ""}` : null,
            nbActivites ? `${nbActivites} activité${nbActivites > 1 ? "s" : ""}` : null,
          ]
            .filter(Boolean)
            .join(" et ")} partiront avec elle.${
            nbDocs
              ? ` Ses ${nbDocs} document${nbDocs > 1 ? "s" : ""} de facturation, eux, restent : une pièce comptable ne s'efface pas.`
              : ""
          }`
        : nbDocs
          ? "Ses documents de facturation restent : une pièce comptable ne s'efface pas."
          : undefined,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      for (const o of affairesClient) {
        await api.records.remove(manifest.slug, "opportunites", o.id);
      }
      for (const a of activites.filter((x) => x.data.clientId === selectedId)) {
        await api.records.remove(manifest.slug, "activites", a.id);
      }
      await api.records.remove(manifest.slug, "clients", selectedId);
      setSelectedId(null);
      setDraft(null);
      await rafraichir();
      flash("Fiche supprimée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Affaires -----------------------------------------------------------

  const ouvrirAffaire = useCallback((opp) => {
    setOppOuverte({ id: opp.id, ...opp.data });
  }, []);

  const nouvelleAffaire = () => {
    if (!selectedId) {
      flash("Ouvrez d'abord une fiche client");
      return;
    }
    setOppOuverte({
      ...OPPORTUNITE_VIDE,
      clientId: selectedId,
      dateCloture: plusJours(30),
    });
  };

  const enregistrerAffaire = async () => {
    if (!oppOuverte?.libelle.trim()) {
      flash("Donnez un libellé à l'affaire");
      return;
    }
    setBusy(true);
    try {
      const { id, ...donnees } = oppOuverte;
      donnees.montant = Number(donnees.montant) || 0;
      if (id) await api.records.update(manifest.slug, "opportunites", id, donnees);
      else await api.records.create(manifest.slug, "opportunites", donnees);
      setOppOuverte(null);
      await etat.rafraichir();
      flash("Affaire enregistrée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerAffaire = async (opp) => {
    const ok = await modal.confirm({
      title: "Supprimer l'affaire",
      message: `Supprimer « ${opp.data?.libelle || opp.libelle} » ?`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "opportunites", opp.id);
      setOppOuverte(null);
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  /// Déplacement d'une affaire d'une colonne du pipeline à l'autre.
  const deposerAffaire = async (etape) => {
    const opp = opportunites.find((o) => o.id === glisse);
    setGlisse(null);
    if (!opp || opp.data.etape === etape) return;
    try {
      await api.records.update(manifest.slug, "opportunites", opp.id, {
        ...opp.data,
        etape,
      });
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  const marquerGlisse = useCallback((id) => setGlisse(id), []);

  // ---- Activités ----------------------------------------------------------

  const ajouterActivite = async () => {
    if (!selectedId) return;
    if (!activite.resume.trim()) {
      flash("Décrivez l'échange en quelques mots");
      return;
    }
    setBusy(true);
    try {
      await api.records.create(manifest.slug, "activites", {
        clientId: selectedId,
        type: activite.type,
        date: activite.date || today(),
        resume: activite.resume.trim(),
        // Seule une tâche porte une échéance : c'est ce qui la distingue
        // d'une note, et ce qui la fait apparaître dans « À faire ».
        echeance: activite.type === "tache" ? activite.echeance || today() : "",
        fait: false,
      });
      setActivite({ type: "appel", date: today(), resume: "", echeance: "" });
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const basculerTache = async (a) => {
    try {
      await api.records.update(manifest.slug, "activites", a.id, {
        ...a.data,
        fait: !a.data.fait,
      });
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  const supprimerActivite = async (a) => {
    const ok = await modal.confirm({
      title: "Supprimer l'activité",
      message: a.data.resume,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "activites", a.id);
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Export -------------------------------------------------------------

  const exporterPortefeuille = async () => {
    const lignes = [
      [
        "Entreprise",
        "Contact",
        "Ville",
        "Téléphone",
        "E-mail",
        "Statut",
        "Responsable",
        "Affaires ouvertes",
        "Chiffre d'affaires",
        "Dernier contact",
        "Prochaine action",
      ],
      ...visibles.map((c) => {
        const ouvertes = opportunites.filter(
          (o) => o.data.clientId === c.id && ETAPES_OUVERTES.includes(o.data.etape),
        );
        const prochaine = prochaineAction(c.id, activites);
        const jours = jourssansContact(c.id, activites);
        return [
          c.data.entreprise,
          c.data.nom,
          c.data.ville,
          c.data.telephone,
          c.data.email,
          STATUTS[c.data.statut]?.label || c.data.statut,
          membreDe(c.data.responsableId)?.name || "",
          ouvertes.length,
          Math.round(chiffreAffaires(c.id, documents, totaux)),
          jours === null ? "jamais" : `il y a ${jours} j`,
          prochaine ? `${prochaine.data.echeance} — ${prochaine.data.resume}` : "",
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
      "portefeuille.csv",
      { folder: "CRM" },
    );
    if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
  };

  // ---- Rendu --------------------------------------------------------------

  const enRetard = taches.filter((t) => t.enRetard).length;

  return (
    <ModuleWindow manifest={manifest} className="crmApp">
      {session.status !== "authenticated" ? (
        <div className="crmLocked">
          <Icon fafa="faLock" width={22} />
          <span>Connectez-vous pour accéder à votre portefeuille.</span>
        </div>
      ) : (
        <div className="crmShell">
          {/* ---------- Barre latérale ---------- */}
          <aside className="crmNav win11Scroll">
            {VUES.map((v) => (
              <div
                key={v.id}
                className="crmNavItem handcr"
                data-actif={vue === v.id}
                onClick={() => setVue(v.id)}
              >
                <Icon fafa={v.icone} width={13} />
                <span>{v.label}</span>
                {v.id === "agenda" && enRetard ? (
                  <span className="crmPastille">{enRetard}</span>
                ) : null}
              </div>
            ))}

            {vue === "portefeuille" ? (
              <>
                <div className="crmNavTitre">Statut</div>
                {[["tous", "Tous"], ...Object.entries(STATUTS).map(([id, s]) => [id, s.label])].map(
                  ([id, label]) => (
                    <div
                      key={id}
                      className="crmFiltre handcr"
                      data-actif={filtreStatut === id}
                      onClick={() => setFiltreStatut(id)}
                    >
                      <span>{label}</span>
                      <span className="crmFiltreCompte">
                        {id === "tous"
                          ? clients.length
                          : clients.filter((c) => c.data.statut === id).length}
                      </span>
                    </div>
                  ),
                )}

                <div className="crmNavTitre">Portefeuille</div>
                <div className="crmNavItem handcr" onClick={nouveauClient}>
                  <Icon fafa="faUserPlus" width={12} />
                  <span>Nouveau client</span>
                </div>
                <div className="crmNavItem handcr" onClick={exporterPortefeuille}>
                  <Icon fafa="faFileCsv" width={12} />
                  <span>Exporter</span>
                </div>
              </>
            ) : null}
          </aside>

          {/* ---------- Contenu ---------- */}
          <main className="crmMain">
            <div className="crmStats">
              <div className="crmStat">
                <span className="crmStatVal">{clients.length}</span>
                <span className="crmStatLbl">clients</span>
              </div>
              <div className="crmStat" data-ton="info">
                <span className="crmStatVal">{money(pipeTotal)}</span>
                <span className="crmStatLbl">pipeline</span>
              </div>
              <div className="crmStat" data-ton="ok">
                <span className="crmStatVal">{money(pipePondere)}</span>
                <span className="crmStatLbl">pondéré</span>
              </div>
              <div
                className="crmStat handcr"
                data-ton={enRetard ? "bad" : "idle"}
                onClick={() => setVue("agenda")}
              >
                <span className="crmStatVal">{enRetard}</span>
                <span className="crmStatLbl">relances en retard</span>
              </div>
            </div>

            {vue === "portefeuille" ? (
              <>
                <div className="crmBarre">
                  <div className="crmRecherche">
                    <Icon fafa="faMagnifyingGlass" width={11} />
                    <input
                      type="text"
                      placeholder="Nom, entreprise, ville, téléphone…"
                      value={requete}
                      onChange={(e) => setRequete(e.target.value)}
                    />
                    {requete ? (
                      <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
                    ) : null}
                  </div>
                  <div className="crmPrimary handcr" onClick={nouveauClient}>
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouveau client</span>
                  </div>
                </div>

                {etat.initial || etat.erreur ? (
                  <Contenu etat={etat} vide={false} lignes={7} />
                ) : !visibles.length ? (
                  <div className="crmVide">
                    <Icon fafa="faUsers" width={26} />
                    <span>
                      {clients.length
                        ? "Aucun client ne correspond à ce filtre."
                        : "Votre portefeuille est vide."}
                    </span>
                    {!clients.length ? (
                      <div className="crmPrimary handcr" onClick={nouveauClient}>
                        Créer la première fiche
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="crmTable win11Scroll">
                    <div className="crmTr crmTrClient crmTh">
                      <span />
                      <span>Client</span>
                      <span>Ville</span>
                      <span>Suivi par</span>
                      <span>Dernier contact</span>
                      <span>Prochaine action</span>
                      <span className="crmNum">CA</span>
                      <span>Statut</span>
                    </div>
                    {visibles.map((c) => {
                      const jours = jourssansContact(c.id, activites);
                      const prochaine = prochaineAction(c.id, activites);
                      const s = STATUTS[c.data.statut] || STATUTS.prospect;
                      const retard =
                        prochaine && prochaine.data.echeance < today();
                      return (
                        <div
                          key={c.id}
                          className="crmTr crmTrClient handcr"
                          data-actif={c.id === selectedId}
                          onClick={() => ouvrirClient(c)}
                        >
                          <span className="crmInitiale">{initiale(c)}</span>
                          <span className="crmTdNom">
                            <strong>{nomDe(c)}</strong>
                            <em>{c.data.entreprise ? c.data.nom : c.data.email}</em>
                          </span>
                          <span className="crmMuted">{c.data.ville || "—"}</span>
                          <span className="crmResp">
                            {membreDe(c.data.responsableId) ? (
                              <Avatar user={membreDe(c.data.responsableId)} taille={22} />
                            ) : (
                              <em className="crmMuted">personne</em>
                            )}
                          </span>
                          {/* « Jamais contacté » n'est pas une absence de
                              donnée : c'est le signal le plus fort du
                              tableau, il doit se voir comme tel. */}
                          <span
                            className="crmMuted"
                            data-alerte={jours === null || jours > 60}
                          >
                            {jours === null ? "jamais" : `il y a ${jours} j`}
                          </span>
                          <span className="crmMuted" data-alerte={retard}>
                            {prochaine
                              ? `${prochaine.data.echeance} · ${prochaine.data.resume}`
                              : "—"}
                          </span>
                          <span className="crmNum">
                            {caParClient[c.id] ? money(caParClient[c.id]) : "—"}
                          </span>
                          <span>
                            <span className="crmTag" data-ton={s.ton}>
                              {s.label}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}

            {vue === "pipeline" ? (
              <div className="crmPipeline win11Scroll">
                {ETAPES_OUVERTES.concat(["gagnee", "perdue"]).map((id) => {
                  const e = ETAPES[id];
                  const liste = opportunites.filter((o) => o.data.etape === id);
                  const montant = liste.reduce(
                    (s, o) => s + (Number(o.data.montant) || 0),
                    0,
                  );
                  return (
                    <div
                      key={id}
                      className="crmColonne"
                      onDragOver={(e2) => e2.preventDefault()}
                      onDrop={(e2) => {
                        e2.preventDefault();
                        deposerAffaire(id);
                      }}
                    >
                      <div className="crmColonneTete" data-ton={e.ton}>
                        <span className="crmColonneNom">{e.label}</span>
                        <span className="crmColonneCompte">{liste.length}</span>
                      </div>
                      <div className="crmColonneMontant">{money(montant)}</div>
                      {liste.map((o) => (
                        <CarteAffaire
                          key={o.id}
                          opp={o}
                          client={clientDe(o.data.clientId)}
                          actif={oppOuverte?.id === o.id}
                          onOuvrir={ouvrirAffaire}
                          onGlisser={marquerGlisse}
                        />
                      ))}
                      {!liste.length ? (
                        <div className="crmColonneVide">Déposez une affaire ici</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {vue === "agenda" ? (
              <div className="crmAgenda win11Scroll">
                {!taches.length ? (
                  <div className="crmVide">
                    <Icon fafa="faListCheck" width={24} />
                    <span>Rien à relancer dans les quinze jours.</span>
                  </div>
                ) : (
                  taches.map(({ activite: a, enRetard: tard, aujourdhui }) => {
                    const c = clientDe(a.data.clientId);
                    return (
                      <div
                        key={a.id}
                        className="crmTache"
                        data-retard={tard}
                        data-aujourdhui={aujourdhui}
                      >
                        <span
                          className="crmCase handcr"
                          onClick={() => basculerTache(a)}
                          title="Marquer comme faite"
                        >
                          <Icon fafa="faCheck" width={9} />
                        </span>
                        <div className="crmTacheInfo">
                          <div className="crmTacheTitre">{a.data.resume}</div>
                          <div className="crmTacheMeta">
                            {a.data.echeance}
                            {tard ? " · en retard" : aujourdhui ? " · aujourd'hui" : ""}
                          </div>
                        </div>
                        <span
                          className="crmLien handcr"
                          onClick={() => {
                            if (!c) return;
                            setVue("portefeuille");
                            ouvrirClient(c);
                          }}
                        >
                          {c ? nomDe(c) : "client supprimé"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}

            {vue === "analyse" ? (
              <div className="crmAnalyse win11Scroll">
                <div className="crmSousTitre">Pipeline par étape</div>
                {!pipeTotal ? (
                  <div className="crmEmptyBox">Aucune affaire en cours.</div>
                ) : (
                  etapes.map((e) => (
                    <div key={e.id} className="crmJauge">
                      <span className="crmJaugeNom">{e.label}</span>
                      <span className="crmJaugeFond">
                        <span
                          className="crmJaugeVal"
                          style={{
                            width: `${(e.montant / Math.max(1, ...etapes.map((x) => x.montant))) * 100}%`,
                          }}
                        />
                      </span>
                      <span className="crmJaugeChiffre">
                        {money(e.montant)}
                        <em> → {money(e.pondere)}</em>
                      </span>
                    </div>
                  ))
                )}

                <div className="crmSousTitre">Transformation</div>
                {!transformation ? (
                  <div className="crmEmptyBox">
                    Aucune affaire close : le taux se calcule sur les affaires
                    gagnées et perdues, pas sur celles en cours.
                  </div>
                ) : (
                  <div className="crmCartes">
                    <div className="crmCarteStat">
                      <span className="crmCarteVal">{transformation.taux} %</span>
                      <span className="crmCarteLbl">affaires gagnées</span>
                    </div>
                    <div className="crmCarteStat">
                      <span className="crmCarteVal">
                        {money(transformation.montantGagne)}
                      </span>
                      <span className="crmCarteLbl">
                        {transformation.gagnees} gagnées · {transformation.perdues} perdues
                      </span>
                    </div>
                  </div>
                )}

                <div className="crmSousTitre">Clients à rappeler</div>
                {!dormants.length ? (
                  <div className="crmEmptyBox">
                    Tout le portefeuille a été contacté récemment.
                  </div>
                ) : (
                  dormants.slice(0, 12).map(({ client: c, jours }) => (
                    <div
                      key={c.id}
                      className="crmDormant handcr"
                      onClick={() => {
                        setVue("portefeuille");
                        ouvrirClient(c);
                      }}
                    >
                      <span className="crmTag" data-ton={jours === null ? "bad" : "warn"}>
                        {jours === null ? "jamais" : `${jours} j`}
                      </span>
                      <span className="crmDormantNom">{nomDe(c)}</span>
                      <span className="crmMuted">{c.data.ville || "—"}</span>
                      <span className="crmMuted">
                        {membreDe(c.data.responsableId)?.name || "sans responsable"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="crmPanneau win11Scroll">
            {oppOuverte ? (
              <>
                <div className="crmPanTitre">
                  {oppOuverte.id ? "Affaire" : "Nouvelle affaire"}
                </div>

                <label className="crmField">
                  <span className="crmLabel">Libellé</span>
                  <input
                    type="text"
                    value={oppOuverte.libelle}
                    onChange={(e) =>
                      setOppOuverte((o) => ({ ...o, libelle: e.target.value }))
                    }
                  />
                </label>

                <label className="crmField">
                  <span className="crmLabel">Client</span>
                  <select
                    value={oppOuverte.clientId}
                    onChange={(e) =>
                      setOppOuverte((o) => ({ ...o, clientId: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nomDe(c)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="crmDeux">
                  <label className="crmField">
                    <span className="crmLabel">Montant</span>
                    <input
                      type="number"
                      value={oppOuverte.montant}
                      onChange={(e) =>
                        setOppOuverte((o) => ({ ...o, montant: e.target.value }))
                      }
                    />
                  </label>
                  <label className="crmField">
                    <span className="crmLabel">Clôture prévue</span>
                    <input
                      type="date"
                      value={oppOuverte.dateCloture || ""}
                      onChange={(e) =>
                        setOppOuverte((o) => ({ ...o, dateCloture: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="crmField">
                  <span className="crmLabel">Étape</span>
                  <select
                    value={oppOuverte.etape}
                    onChange={(e) =>
                      setOppOuverte((o) => ({ ...o, etape: e.target.value }))
                    }
                  >
                    {Object.entries(ETAPES).map(([id, e]) => (
                      <option key={id} value={id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="crmField">
                  <span className="crmLabel">
                    Probabilité % — vide : celle de l'étape (
                    {ETAPES[oppOuverte.etape]?.probabilite} %)
                  </span>
                  <input
                    type="number"
                    placeholder={String(ETAPES[oppOuverte.etape]?.probabilite ?? "")}
                    value={oppOuverte.probabilite ?? ""}
                    onChange={(e) =>
                      setOppOuverte((o) => ({ ...o, probabilite: e.target.value }))
                    }
                  />
                </label>

                <div className="crmRecap">
                  <span>Valeur pondérée</span>
                  <strong>{money(valeurPonderee({ data: oppOuverte }))}</strong>
                </div>

                <label className="crmField">
                  <span className="crmLabel">Notes</span>
                  <textarea
                    rows={3}
                    value={oppOuverte.notes || ""}
                    onChange={(e) =>
                      setOppOuverte((o) => ({ ...o, notes: e.target.value }))
                    }
                  />
                </label>

                <div className="crmFormActions">
                  <div
                    className="crmPrimary handcr"
                    data-off={busy}
                    onClick={enregistrerAffaire}
                  >
                    Enregistrer
                  </div>
                  <div className="crmBtnGhost handcr" onClick={() => setOppOuverte(null)}>
                    Fermer
                  </div>
                  {oppOuverte.id ? (
                    <div
                      className="crmBtnGhost crmDanger handcr"
                      onClick={() => supprimerAffaire({ id: oppOuverte.id, ...oppOuverte })}
                    >
                      Supprimer
                    </div>
                  ) : null}
                </div>
              </>
            ) : !draft ? (
              <div className="crmPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un client pour voir sa fiche, ses affaires et
                  l'historique de la relation.
                </span>
              </div>
            ) : (
              <>
                <div className="crmPanTete">
                  <span className="crmGrandeInitiale">{initiale({ data: draft })}</span>
                  <div className="crmPanInfo">
                    <div className="crmPanNom">
                      {draft.entreprise || draft.nom || "Nouveau client"}
                    </div>
                    <div className="crmPanMeta">
                      {[draft.entreprise ? draft.nom : null, draft.ville]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                </div>

                {selectedId ? (
                  <div className="crmResume">
                    <div>
                      <span className="crmResumeLbl">Chiffre d'affaires</span>
                      <strong>{money(caClient)}</strong>
                    </div>
                    <div>
                      <span className="crmResumeLbl">Affaires ouvertes</span>
                      <strong>
                        {
                          affairesClient.filter((o) =>
                            ETAPES_OUVERTES.includes(o.data.etape),
                          ).length
                        }
                      </strong>
                    </div>
                  </div>
                ) : null}

                <div className="crmOnglets">
                  {[
                    ["fiche", "Fiche"],
                    ["affaires", "Affaires"],
                    ["suivi", "Suivi"],
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

                {onglet === "fiche" ? (
                  <>
                    <div className="crmDeux">
                      <label className="crmField">
                        <span className="crmLabel">Entreprise</span>
                        <input
                          type="text"
                          value={draft.entreprise}
                          onChange={champ("entreprise")}
                        />
                      </label>
                      <label className="crmField">
                        <span className="crmLabel">Contact</span>
                        <input type="text" value={draft.nom} onChange={champ("nom")} />
                      </label>
                    </div>

                    <div className="crmDeux">
                      <label className="crmField">
                        <span className="crmLabel">Téléphone</span>
                        <input
                          type="text"
                          value={draft.telephone}
                          onChange={champ("telephone")}
                        />
                      </label>
                      <label className="crmField">
                        <span className="crmLabel">E-mail</span>
                        <input type="text" value={draft.email} onChange={champ("email")} />
                      </label>
                    </div>

                    <div className="crmDeux">
                      <label className="crmField">
                        <span className="crmLabel">Ville</span>
                        <input type="text" value={draft.ville} onChange={champ("ville")} />
                      </label>
                      <label className="crmField">
                        <span className="crmLabel">Secteur</span>
                        <input
                          type="text"
                          placeholder="Distribution, BTP…"
                          value={draft.secteur}
                          onChange={champ("secteur")}
                        />
                      </label>
                    </div>

                    <label className="crmField">
                      <span className="crmLabel">Adresse</span>
                      <input
                        type="text"
                        placeholder="Cocody, rue des Jardins"
                        value={draft.adresse}
                        onChange={champ("adresse")}
                      />
                    </label>

                    <div className="crmDeux">
                      <label className="crmField">
                        <span className="crmLabel">Statut</span>
                        <select value={draft.statut} onChange={champ("statut")}>
                          {Object.entries(STATUTS).map(([id, s]) => (
                            <option key={id} value={id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="crmField">
                        <span className="crmLabel">Suivi par</span>
                        <select
                          value={draft.responsableId || ""}
                          onChange={champ("responsableId")}
                        >
                          <option value="">Personne</option>
                          {membres.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="crmField">
                      <span className="crmLabel">Notes</span>
                      <textarea rows={3} value={draft.notes} onChange={champ("notes")} />
                    </label>

                    {selected ? <Auteur record={selected} /> : null}

                    <div className="crmFormActions">
                      <div
                        className="crmPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerClient}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                      {selectedId ? (
                        <div
                          className="crmBtnGhost crmDanger handcr"
                          onClick={supprimerClient}
                        >
                          Supprimer
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {onglet === "affaires" ? (
                  !selectedId ? (
                    <div className="crmEmptyBox">
                      Enregistrez la fiche avant d'ajouter des affaires.
                    </div>
                  ) : (
                    <>
                      <div className="crmFormActions">
                        <div className="crmPrimary handcr" onClick={nouvelleAffaire}>
                          <Icon fafa="faPlus" width={10} />
                          <span>Nouvelle affaire</span>
                        </div>
                      </div>

                      {!affairesClient.length ? (
                        <div className="crmEmptyBox">Aucune affaire pour ce client.</div>
                      ) : (
                        affairesClient.map((o) => {
                          const e = ETAPES[o.data.etape] || ETAPES.contact;
                          return (
                            <div
                              key={o.id}
                              className="crmAffaireLigne handcr"
                              onClick={() => ouvrirAffaire(o)}
                            >
                              <div className="crmAffaireInfo">
                                <div className="crmAffaireTitre">{o.data.libelle}</div>
                                <div className="crmAffaireMeta">
                                  {money(o.data.montant)}
                                  {o.data.dateCloture ? ` · ${o.data.dateCloture}` : ""}
                                </div>
                              </div>
                              <span className="crmTag" data-ton={e.ton}>
                                {e.label}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </>
                  )
                ) : null}

                {onglet === "suivi" ? (
                  !selectedId ? (
                    <div className="crmEmptyBox">
                      Enregistrez la fiche avant de noter un échange.
                    </div>
                  ) : (
                    <>
                      <div className="crmTypes">
                        {Object.entries(ACTIVITES).map(([id, a]) => (
                          <span
                            key={id}
                            className="handcr"
                            data-actif={activite.type === id}
                            onClick={() => setActivite((v) => ({ ...v, type: id }))}
                            title={a.label}
                          >
                            <Icon fafa={a.icone} width={11} />
                          </span>
                        ))}
                      </div>

                      <label className="crmField">
                        <span className="crmLabel">
                          {activite.type === "tache" ? "Quoi faire" : "Ce qui s'est dit"}
                        </span>
                        <input
                          type="text"
                          placeholder={
                            activite.type === "tache"
                              ? "Rappeler pour le devis"
                              : "Relance devis, rappelle vendredi"
                          }
                          value={activite.resume}
                          onChange={(e) =>
                            setActivite((v) => ({ ...v, resume: e.target.value }))
                          }
                        />
                      </label>

                      <div className="crmDeux">
                        <label className="crmField">
                          <span className="crmLabel">Date</span>
                          <input
                            type="date"
                            value={activite.date}
                            onChange={(e) =>
                              setActivite((v) => ({ ...v, date: e.target.value }))
                            }
                          />
                        </label>
                        {activite.type === "tache" ? (
                          <label className="crmField">
                            <span className="crmLabel">À faire le</span>
                            <input
                              type="date"
                              value={activite.echeance || today()}
                              onChange={(e) =>
                                setActivite((v) => ({ ...v, echeance: e.target.value }))
                              }
                            />
                          </label>
                        ) : (
                          <div />
                        )}
                      </div>

                      <div className="crmFormActions">
                        <div
                          className="crmPrimary handcr"
                          data-off={busy}
                          onClick={ajouterActivite}
                        >
                          Ajouter au suivi
                        </div>
                      </div>

                      {!timeline.length ? (
                        <div className="crmEmptyBox">
                          Aucun échange enregistré. Notez le premier appel : c'est ce qui
                          fait la différence six mois plus tard.
                        </div>
                      ) : (
                        <div className="crmTimeline">
                          {timeline.map((ev) => {
                            if (ev.genre === "opportunite") {
                              const e = ETAPES[ev.record.data.etape] || ETAPES.contact;
                              return (
                                <div key={ev.id} className="crmEvent">
                                  <span className="crmEventIcone" data-ton={e.ton}>
                                    <Icon fafa="faBriefcase" width={9} />
                                  </span>
                                  <div className="crmEventInfo">
                                    <div className="crmEventTitre">
                                      {ev.record.data.libelle} ·{" "}
                                      {money(ev.record.data.montant)}
                                    </div>
                                    <div className="crmEventMeta">
                                      {e.label} · {ev.date}
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            const a = ev.record;
                            const t = ACTIVITES[a.data.type] || ACTIVITES.note;
                            const tache = a.data.type === "tache";
                            return (
                              <div key={ev.id} className="crmEvent" data-fait={a.data.fait}>
                                <span
                                  className="crmEventIcone handcr"
                                  data-ton={t.ton}
                                  onClick={() => tache && basculerTache(a)}
                                  title={tache ? "Marquer comme faite" : t.label}
                                >
                                  <Icon
                                    fafa={tache && a.data.fait ? "faCheck" : t.icone}
                                    width={9}
                                  />
                                </span>
                                <div className="crmEventInfo">
                                  <div className="crmEventTitre">{a.data.resume}</div>
                                  <div className="crmEventMeta">
                                    {[
                                      t.label,
                                      tache ? `à faire le ${a.data.echeance}` : a.data.date,
                                      a.auteur?.name,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                </div>
                                <span
                                  className="crmRetirer handcr"
                                  onClick={() => supprimerActivite(a)}
                                >
                                  <Icon fafa="faXmark" width={10} />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )
                ) : null}
              </>
            )}
          </aside>

          {notice ? <div className="crmNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}
