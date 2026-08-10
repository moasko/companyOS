import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { invaliderReferentiel } from "../../referentiel";
import { useChargement } from "../../chargement";
import { totaux } from "@companyos/shared/facturation";
import {
  ETAPES_OUVERTES,
  STATUTS,
  aFaire,
  chiffreAffaires,
  chronologie,
  clientsDormants,
  jourssansContact,
  nomDe,
  pipeline,
  plusJours,
  prochaineAction,
  tauxTransformation,
  today,
} from "./domaine";
import { Agenda } from "./vues/Agenda";
import { Analyse } from "./vues/Analyse";
import { BarreLaterale } from "./vues/BarreLaterale";
import { FicheClient } from "./vues/FicheClient";
import { FormulaireAffaire } from "./vues/FormulaireAffaire";
import { Pipeline } from "./vues/Pipeline";
import { Portefeuille } from "./vues/Portefeuille";
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
//
// Ce fichier tient l'état, les écritures et l'assemblage ; chaque écran est
// dans `vues/`, et les règles de calcul dans `domaine.js`.

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
          <BarreLaterale
            vue={vue}
            setVue={setVue}
            enRetard={enRetard}
            clients={clients}
            filtreStatut={filtreStatut}
            setFiltreStatut={setFiltreStatut}
            nouveauClient={nouveauClient}
            exporterPortefeuille={exporterPortefeuille}
          />

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
              <Portefeuille
                requete={requete}
                setRequete={setRequete}
                nouveauClient={nouveauClient}
                etat={etat}
                visibles={visibles}
                clients={clients}
                activites={activites}
                selectedId={selectedId}
                ouvrirClient={ouvrirClient}
                membreDe={membreDe}
                caParClient={caParClient}
              />
            ) : null}

            {vue === "pipeline" ? (
              <Pipeline
                opportunites={opportunites}
                clientDe={clientDe}
                oppOuverte={oppOuverte}
                ouvrirAffaire={ouvrirAffaire}
                marquerGlisse={marquerGlisse}
                deposerAffaire={deposerAffaire}
              />
            ) : null}

            {vue === "agenda" ? (
              <Agenda
                taches={taches}
                clientDe={clientDe}
                basculerTache={basculerTache}
                setVue={setVue}
                ouvrirClient={ouvrirClient}
              />
            ) : null}

            {vue === "analyse" ? (
              <Analyse
                pipeTotal={pipeTotal}
                etapes={etapes}
                transformation={transformation}
                dormants={dormants}
                membreDe={membreDe}
                setVue={setVue}
                ouvrirClient={ouvrirClient}
              />
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="crmPanneau cosScroll">
            {oppOuverte ? (
              <FormulaireAffaire
                oppOuverte={oppOuverte}
                setOppOuverte={setOppOuverte}
                clients={clients}
                busy={busy}
                enregistrerAffaire={enregistrerAffaire}
                supprimerAffaire={supprimerAffaire}
              />
            ) : !draft ? (
              <div className="crmPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un client pour voir sa fiche, ses affaires et
                  l'historique de la relation.
                </span>
              </div>
            ) : (
              <FicheClient
                draft={draft}
                selected={selected}
                selectedId={selectedId}
                caClient={caClient}
                affairesClient={affairesClient}
                onglet={onglet}
                setOnglet={setOnglet}
                champ={champ}
                membres={membres}
                busy={busy}
                enregistrerClient={enregistrerClient}
                supprimerClient={supprimerClient}
                nouvelleAffaire={nouvelleAffaire}
                ouvrirAffaire={ouvrirAffaire}
                activite={activite}
                setActivite={setActivite}
                ajouterActivite={ajouterActivite}
                timeline={timeline}
                basculerTache={basculerTache}
                supprimerActivite={supprimerActivite}
              />
            )}
          </aside>

          {notice ? <div className="crmNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}
