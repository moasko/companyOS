import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { Auteur } from "../../Auteur";
import { Avatar } from "../../Avatar";
import { choisirImage, redimensionnerImage } from "../../image";
import { Contenu, useChargement } from "../../chargement";
import {
  ETATS_DEMANDE,
  REGLAGES_DEFAUT,
  STATUTS,
  TYPES_ABSENCE,
  TYPES_CONTRAT,
  absentsLe,
  ancienneteTexte,
  chevauchements,
  contratsAEcheance,
  joursOuvrables,
  parAnciennete,
  parDepartement,
  prochainMatricule,
  soldeConges,
  statistiques,
  today,
} from "./domaine";
import "./rh.scss";

// Ressources humaines : dossiers du personnel, congés et absences.
//
// Trois collections :
//
//   salaries   le dossier : identité, contrat, rémunération, rattachement
//   absences   congés, maladies, permissions — demandés, approuvés, refusés
//   reglages   un seul enregistrement : taux d'acquisition, jours ouvrés,
//              jours fériés. Paramétrable parce que le droit du travail
//              varie, et qu'un module qui l'écrit en dur ment quelque part.
//
// Un salarié peut être rattaché à un membre de l'espace de travail. Ce
// n'est pas obligatoire — un magasinier n'a pas forcément de compte — mais
// quand le lien existe, les décisions de congé lui parviennent.

const VUES = [
  { id: "personnel", label: "Personnel", icone: "faUsers" },
  { id: "absences", label: "Congés & absences", icone: "faUmbrellaBeach" },
  { id: "analyse", label: "Analyse", icone: "faChartColumn" },
  { id: "reglages", label: "Réglages", icone: "faSliders" },
];

const SALARIE_VIDE = {
  matricule: "",
  nom: "",
  prenom: "",
  photo: "",
  sexe: "",
  dateNaissance: "",
  telephone: "",
  email: "",
  adresse: "",
  ville: "",
  poste: "",
  departement: "",
  typeContrat: "cdi",
  dateEmbauche: today(),
  dateFin: "",
  salaireBase: 0,
  numeroCnps: "",
  banque: "",
  statut: "actif",
  reportConges: 0,
  userId: "",
  notes: "",
};

const ABSENCE_VIDE = {
  salarieId: "",
  type: "conge",
  du: today(),
  au: today(),
  motif: "",
  etat: "demande",
};

import { montant as money } from "../../../utils/monnaie";

const nomComplet = (s) =>
  [s?.data?.prenom, s?.data?.nom].filter(Boolean).join(" ") || "Sans nom";

// La photo voyage dans l'enregistrement, comme celle des produits : petite,
// affichée en liste, et disponible sans requête supplémentaire.
const PHOTO_COTE = 180;
const PHOTO_MAX = 40000;

export const manifest = {
  id: "rh",
  slug: "rh",
  version: "1.0.0",
  nouveautes: [
    {
      version: "1.0.0",
      texte:
        "Dossiers du personnel, congés et absences avec soldes calculés, alertes de fin de contrat.",
    },
  ],
  name: "Ressources humaines",
  icon: "rh",
  action: "RHAPP",
  Window: RhApp,
};

function RhApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);

  const [salaries, setSalaries] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [membres, setMembres] = useState([]);
  const [reglages, setReglages] = useState({ ...REGLAGES_DEFAUT });
  const [reglagesId, setReglagesId] = useState(null);

  const [vue, setVue] = useState("personnel");
  const [filtreStatut, setFiltreStatut] = useState("actif");
  const [requete, setRequete] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [onglet, setOnglet] = useState("fiche");
  const [absOuverte, setAbsOuverte] = useState(null);

  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3500);
  };

  const ouvert = wnapp && !wnapp.hide && session.status === "authenticated";

  // ---- Chargement ---------------------------------------------------------

  const charger = async () => {
    const [sal, abs, reg, gens] = await Promise.all([
      api.records.list(manifest.slug, "salaries"),
      api.records.list(manifest.slug, "absences").catch(() => []),
      api.records.list(manifest.slug, "reglages").catch(() => []),
      api.members().catch(() => []),
    ]);
    setSalaries(sal);
    setAbsences(abs);
    setMembres(gens);
    if (reg[0]) {
      setReglages({ ...REGLAGES_DEFAUT, ...reg[0].data });
      setReglagesId(reg[0].id);
    }
  };

  const etat = useChargement(ouvert, charger);

  // ---- Arrivée depuis une notification ------------------------------------

  const lienEnAttente = React.useRef(null);

  useEffect(() => {
    const aller = (e) => {
      if (e.detail?.app !== manifest.id) return;
      lienEnAttente.current = e.detail.params?.salarie || null;
      appliquerLien();
    };
    window.addEventListener("companyos:lien", aller);
    return () => window.removeEventListener("companyos:lien", aller);
  }, [salaries]);

  const appliquerLien = () => {
    const vise = lienEnAttente.current;
    if (!vise) return;
    const s = salaries.find((x) => x.id === vise);
    if (!s) return; // pas encore chargé : on retentera après `charger()`
    lienEnAttente.current = null;
    setVue("personnel");
    setFiltreStatut("tous");
    ouvrirSalarie(s);
  };

  useEffect(appliquerLien, [salaries]);

  // ---- Dérivés ------------------------------------------------------------

  const selected = salaries.find((s) => s.id === selectedId) || null;
  const membreDe = (id) => membres.find((m) => m.id === id);
  const salarieDe = (id) => salaries.find((s) => s.id === id);

  const stats = useMemo(
    () => statistiques(salaries, absences, reglages),
    [salaries, absences, reglages],
  );

  const echeances = useMemo(
    () => contratsAEcheance(salaries, 60),
    [salaries],
  );

  const absentsDuJour = useMemo(
    () => absentsLe(today(), absences, salaries),
    [absences, salaries],
  );

  const visibles = useMemo(() => {
    const q = requete.trim().toLowerCase();
    return salaries
      .filter((s) => {
        if (filtreStatut !== "tous" && s.data.statut !== filtreStatut) return false;
        if (!q) return true;
        return [s.data.nom, s.data.prenom, s.data.matricule, s.data.poste, s.data.departement]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => nomComplet(a).localeCompare(nomComplet(b), "fr"));
  }, [salaries, filtreStatut, requete]);

  const absencesSalarie = useMemo(
    () =>
      absences
        .filter((a) => a.data.salarieId === selectedId)
        .sort((a, b) => (a.data.du < b.data.du ? 1 : -1)),
    [absences, selectedId],
  );

  const solde = useMemo(
    () => (selected ? soldeConges(selected, absences, reglages) : null),
    [selected, absences, reglages],
  );

  const enAttente = useMemo(
    () => absences.filter((a) => a.data.etat === "demande"),
    [absences],
  );

  // ---- Salariés -----------------------------------------------------------

  const ouvrirSalarie = (record) => {
    setSelectedId(record.id);
    setDraft({ ...SALARIE_VIDE, ...record.data });
    setAbsOuverte(null);
    setOnglet("fiche");
  };

  const nouveauSalarie = () => {
    setSelectedId(null);
    setDraft({ ...SALARIE_VIDE, matricule: prochainMatricule(salaries) });
    setAbsOuverte(null);
    setOnglet("fiche");
  };

  const champ = (cle) => (e) => {
    const brut = e.target.value;
    const valeur = ["salaireBase", "reportConges"].includes(cle)
      ? Number(brut) || 0
      : brut;
    setDraft((d) => ({ ...d, [cle]: valeur }));
  };

  const changerPhoto = async () => {
    const fichier = await choisirImage();
    if (!fichier) return;
    setBusy(true);
    try {
      const photo = await redimensionnerImage(fichier, { cote: PHOTO_COTE, qualite: 0.7 });
      if (photo.length > PHOTO_MAX) {
        flash("Image trop lourde après réduction — essayez une autre photo");
        return;
      }
      setDraft((d) => ({ ...d, photo }));
      flash("Photo prête — enregistrez la fiche");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enregistrerSalarie = async () => {
    if (!draft?.nom.trim()) {
      flash("Le nom est obligatoire");
      return;
    }
    // Un matricule en double rend la paie et l'historique inexploitables :
    // deux personnes se confondraient dans tous les états.
    const mat = draft.matricule.trim();
    if (
      mat &&
      salaries.some(
        (s) =>
          s.id !== selectedId &&
          (s.data.matricule || "").toLowerCase() === mat.toLowerCase(),
      )
    ) {
      flash(`Le matricule « ${mat} » est déjà attribué`);
      return;
    }
    if (TYPES_CONTRAT[draft.typeContrat]?.duree && !draft.dateFin) {
      flash("Un contrat à durée déterminée doit porter une date de fin");
      return;
    }

    setBusy(true);
    try {
      const donnees = { ...draft, matricule: mat };
      if (selectedId) {
        await api.records.update(manifest.slug, "salaries", selectedId, donnees);
        flash("Dossier mis à jour");
      } else {
        const cree = await api.records.create(manifest.slug, "salaries", donnees);
        setSelectedId(cree.id);
        flash("Dossier créé");
      }
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerSalarie = async () => {
    if (!selectedId) return;
    const liees = absencesSalarie.length;

    const ok = await modal.confirm({
      title: "Supprimer le dossier",
      message: `Supprimer le dossier de ${nomComplet(selected)} ?`,
      detail:
        "Un salarié qui quitte l'entreprise se met en « Sorti des effectifs » : son historique reste consultable. " +
        (liees ? `Supprimer efface aussi ses ${liees} absence(s).` : ""),
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      for (const a of absencesSalarie) {
        await api.records.remove(manifest.slug, "absences", a.id);
      }
      await api.records.remove(manifest.slug, "salaries", selectedId);
      setSelectedId(null);
      setDraft(null);
      await etat.rafraichir();
      flash("Dossier supprimé");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Absences -----------------------------------------------------------

  const nouvelleAbsence = (salarieId) => {
    setAbsOuverte({ ...ABSENCE_VIDE, salarieId: salarieId || selectedId || "" });
  };

  const enregistrerAbsence = async () => {
    if (!absOuverte?.salarieId) {
      flash("Choisissez un salarié");
      return;
    }
    if (absOuverte.au < absOuverte.du) {
      flash("La date de fin précède la date de début");
      return;
    }

    // Deux absences sur les mêmes dates déduiraient deux fois le même congé
    // du solde. On le refuse à la saisie plutôt que de le découvrir en paie.
    const collisions = chevauchements(absOuverte, absences, absOuverte.id);
    if (collisions.length) {
      const c = collisions[0];
      flash(
        `Chevauche une absence du ${c.data.du} au ${c.data.au} (${TYPES_ABSENCE[c.data.type]?.label})`,
      );
      return;
    }

    setBusy(true);
    try {
      const { id, ...donnees } = absOuverte;
      if (id) await api.records.update(manifest.slug, "absences", id, donnees);
      else await api.records.create(manifest.slug, "absences", donnees);
      setAbsOuverte(null);
      await etat.rafraichir();
      flash("Absence enregistrée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  /// Approuver ou refuser. C'est la seule décision du module qui concerne
  /// quelqu'un d'autre : elle part donc en notification, quand le salarié
  /// est rattaché à un compte de l'espace.
  const deciderAbsence = async (absence, etat) => {
    setBusy(true);
    try {
      await api.records.update(manifest.slug, "absences", absence.id, {
        ...absence.data,
        etat,
        decidePar: session.user?.name || "",
        dateDecision: today(),
      });

      const s = salarieDe(absence.data.salarieId);
      const compte = s?.data.userId;
      if (compte && compte !== session.user?.id) {
        const t = TYPES_ABSENCE[absence.data.type];
        envoyerA(compte, {
          source: manifest.slug,
          titre: `${t?.label || "Absence"} ${etat === "approuve" ? "approuvé" : "refusé"}`,
          message: `Du ${absence.data.du} au ${absence.data.au}`,
          lien: { app: manifest.id, params: { salarie: s.id } },
        });
      }

      await etat.rafraichir();
      flash(etat === "approuve" ? "Absence approuvée" : "Absence refusée");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  const supprimerAbsence = async (a) => {
    const ok = await modal.confirm({
      title: "Supprimer l'absence",
      message: `${TYPES_ABSENCE[a.data.type]?.label} du ${a.data.du} au ${a.data.au} ?`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.records.remove(manifest.slug, "absences", a.id);
      await etat.rafraichir();
    } catch (err) {
      flash(err.message);
    }
  };

  // ---- Réglages -----------------------------------------------------------

  const enregistrerReglages = async () => {
    setBusy(true);
    try {
      if (reglagesId) {
        await api.records.update(manifest.slug, "reglages", reglagesId, reglages);
      } else {
        const cree = await api.records.create(manifest.slug, "reglages", reglages);
        setReglagesId(cree.id);
      }
      flash("Réglages enregistrés");
    } catch (err) {
      flash(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Export -------------------------------------------------------------

  const exporterPersonnel = async () => {
    const lignes = [
      [
        "Matricule",
        "Nom",
        "Prénom",
        "Poste",
        "Département",
        "Contrat",
        "Embauche",
        "Fin",
        "Salaire de base",
        "CNPS",
        "Ancienneté",
        "Solde congés",
        "Statut",
      ],
      ...visibles.map((s) => {
        const so = soldeConges(s, absences, reglages);
        return [
          s.data.matricule,
          s.data.nom,
          s.data.prenom,
          s.data.poste,
          s.data.departement,
          TYPES_CONTRAT[s.data.typeContrat]?.label || s.data.typeContrat,
          s.data.dateEmbauche,
          s.data.dateFin,
          Math.round(Number(s.data.salaireBase) || 0),
          s.data.numeroCnps,
          ancienneteTexte(s.data.dateEmbauche),
          so.solde,
          STATUTS[s.data.statut]?.label || s.data.statut,
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
      "personnel.csv",
      { folder: "Ressources humaines" },
    );
    if (node) flash(`« ${node.name} » enregistré dans l'Explorateur`);
  };

  // ---- Rendu --------------------------------------------------------------

  return (
    <ModuleWindow manifest={manifest} className="rhApp">
      {session.status !== "authenticated" ? (
        <div className="rhLocked">
          <Icon fafa="faLock" width={22} />
          <span>Connectez-vous pour accéder aux ressources humaines.</span>
        </div>
      ) : (
        <div className="rhShell">
          {/* ---------- Barre latérale ---------- */}
          <aside className="rhNav cosScroll">
            {VUES.map((v) => (
              <div
                key={v.id}
                className="rhNavItem handcr"
                data-actif={vue === v.id}
                onClick={() => setVue(v.id)}
              >
                <Icon fafa={v.icone} width={13} />
                <span>{v.label}</span>
                {v.id === "absences" && enAttente.length ? (
                  <span className="rhPastille">{enAttente.length}</span>
                ) : null}
              </div>
            ))}

            {vue === "personnel" ? (
              <>
                <div className="rhNavTitre">Statut</div>
                {[["tous", "Tous"], ...Object.entries(STATUTS).map(([id, s]) => [id, s.label])].map(
                  ([id, label]) => (
                    <div
                      key={id}
                      className="rhFiltre handcr"
                      data-actif={filtreStatut === id}
                      onClick={() => setFiltreStatut(id)}
                    >
                      <span>{label}</span>
                      <span className="rhFiltreCompte">
                        {id === "tous"
                          ? salaries.length
                          : salaries.filter((s) => s.data.statut === id).length}
                      </span>
                    </div>
                  ),
                )}

                <div className="rhNavTitre">Personnel</div>
                <div className="rhNavItem handcr" onClick={nouveauSalarie}>
                  <Icon fafa="faUserPlus" width={12} />
                  <span>Nouveau dossier</span>
                </div>
                <div className="rhNavItem handcr" onClick={exporterPersonnel}>
                  <Icon fafa="faFileCsv" width={12} />
                  <span>Exporter</span>
                </div>
              </>
            ) : null}
          </aside>

          {/* ---------- Contenu ---------- */}
          <main className="rhMain">
            <div className="rhStats">
              <div className="rhStat">
                <span className="rhStatVal">{stats.effectif}</span>
                <span className="rhStatLbl">à l'effectif</span>
              </div>
              <div className="rhStat">
                <span className="rhStatVal">{money(stats.masse)}</span>
                <span className="rhStatLbl">masse salariale</span>
              </div>
              <div
                className="rhStat handcr"
                data-ton="info"
                onClick={() => setVue("absences")}
              >
                <span className="rhStatVal">{stats.absentsAujourdhui}</span>
                <span className="rhStatLbl">absents aujourd'hui</span>
              </div>
              <div
                className="rhStat handcr"
                data-ton={stats.echeances ? "bad" : "idle"}
                onClick={() => setVue("analyse")}
              >
                <span className="rhStatVal">{stats.echeances}</span>
                <span className="rhStatLbl">contrats à échéance</span>
              </div>
            </div>

            {vue === "personnel" ? (
              <>
                <div className="rhBarre">
                  <div className="rhRecherche">
                    <Icon fafa="faMagnifyingGlass" width={11} />
                    <input
                      type="text"
                      placeholder="Nom, matricule, poste, département…"
                      value={requete}
                      onChange={(e) => setRequete(e.target.value)}
                    />
                    {requete ? (
                      <Icon fafa="faXmark" width={10} onClick={() => setRequete("")} />
                    ) : null}
                  </div>
                  <div className="rhPrimary handcr" onClick={nouveauSalarie}>
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouveau dossier</span>
                  </div>
                </div>

                {etat.initial || etat.erreur ? (
                  <Contenu etat={etat} vide={false} lignes={7} />
                ) : !visibles.length ? (
                  <div className="rhVide">
                    <Icon fafa="faUsers" width={26} />
                    <span>
                      {salaries.length
                        ? "Aucun salarié pour ce filtre."
                        : "Aucun dossier du personnel."}
                    </span>
                    {!salaries.length ? (
                      <div className="rhPrimary handcr" onClick={nouveauSalarie}>
                        Créer le premier dossier
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rhTable cosScroll">
                    <div className="rhTr rhTrSal rhTh">
                      <span />
                      <span>Salarié</span>
                      <span>Poste</span>
                      <span>Contrat</span>
                      <span>Ancienneté</span>
                      <span className="rhNum">Salaire</span>
                      <span className="rhNum">Congés</span>
                      <span>Statut</span>
                    </div>
                    {visibles.map((s) => {
                      const so = soldeConges(s, absences, reglages);
                      const st = STATUTS[s.data.statut] || STATUTS.actif;
                      const c = TYPES_CONTRAT[s.data.typeContrat];
                      const absent = absentsDuJour.some((a) => a.salarie.id === s.id);
                      return (
                        <div
                          key={s.id}
                          className="rhTr rhTrSal handcr"
                          data-actif={s.id === selectedId}
                          onClick={() => ouvrirSalarie(s)}
                        >
                          <Avatar
                            user={{ avatar: s.data.photo, name: nomComplet(s) }}
                            taille={28}
                          />
                          <span className="rhTdNom">
                            <strong>
                              {nomComplet(s)}
                              {absent ? <em className="rhEstAbsent"> · absent</em> : null}
                            </strong>
                            <em>{s.data.matricule}</em>
                          </span>
                          <span className="rhMuted">{s.data.poste || "—"}</span>
                          <span className="rhMuted">
                            {c?.label}
                            {c?.duree && s.data.dateFin ? ` · ${s.data.dateFin}` : ""}
                          </span>
                          <span className="rhMuted">
                            {ancienneteTexte(s.data.dateEmbauche)}
                          </span>
                          <span className="rhNum">{money(s.data.salaireBase)}</span>
                          <span className="rhNum" data-alerte={so.solde < 0}>
                            {so.solde} j
                          </span>
                          <span>
                            <span className="rhTag" data-ton={st.ton}>
                              {st.label}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}

            {vue === "absences" ? (
              <>
                <div className="rhBarre">
                  <div
                    className="rhPrimary handcr"
                    onClick={() => nouvelleAbsence(selectedId)}
                  >
                    <Icon fafa="faPlus" width={10} />
                    <span>Nouvelle absence</span>
                  </div>
                </div>

                {enAttente.length ? (
                  <>
                    <div className="rhSousTitre">
                      À décider — {enAttente.length} demande
                      {enAttente.length > 1 ? "s" : ""}
                    </div>
                    {enAttente.map((a) => {
                      const s = salarieDe(a.data.salarieId);
                      const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
                      const jours = joursOuvrables(a.data.du, a.data.au, reglages);
                      const so = s ? soldeConges(s, absences, reglages) : null;
                      return (
                        <div key={a.id} className="rhDemande">
                          <Avatar
                            user={{ avatar: s?.data.photo, name: nomComplet(s) }}
                            taille={30}
                          />
                          <div className="rhDemandeInfo">
                            <div className="rhDemandeNom">
                              {nomComplet(s)} — {t.label}
                            </div>
                            <div className="rhDemandeMeta">
                              Du {a.data.du} au {a.data.au} · {jours} jour
                              {jours > 1 ? "s" : ""} ouvrable{jours > 1 ? "s" : ""}
                              {a.data.motif ? ` · ${a.data.motif}` : ""}
                            </div>
                            {/* Le solde restant si la demande est accordée :
                                approuver sans le voir, c'est créer les
                                dépassements qu'on découvre en fin d'année. */}
                            {t.decompte && so ? (
                              <div
                                className="rhDemandeSolde"
                                data-alerte={so.solde - jours < 0}
                              >
                                Solde après accord : {Math.round((so.solde - jours) * 10) / 10} j
                                {so.solde - jours < 0 ? " — dépassement" : ""}
                              </div>
                            ) : null}
                          </div>
                          <div className="rhDemandeActions">
                            <div
                              className="rhBtnGhost handcr"
                              data-off={busy}
                              onClick={() => deciderAbsence(a, "approuve")}
                            >
                              Approuver
                            </div>
                            <div
                              className="rhBtnGhost rhDanger handcr"
                              data-off={busy}
                              onClick={() => deciderAbsence(a, "refuse")}
                            >
                              Refuser
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : null}

                <div className="rhSousTitre">Absents aujourd'hui</div>
                {!absentsDuJour.length ? (
                  <div className="rhEmptyBox">Tout le monde est présent.</div>
                ) : (
                  absentsDuJour.map(({ absence, salarie }) => {
                    const t = TYPES_ABSENCE[absence.data.type] || TYPES_ABSENCE.conge;
                    return (
                      <div
                        key={absence.id}
                        className="rhAbsent handcr"
                        onClick={() => {
                          setVue("personnel");
                          setFiltreStatut("tous");
                          ouvrirSalarie(salarie);
                        }}
                      >
                        <span className="rhTag" data-ton={t.ton}>
                          {t.label}
                        </span>
                        <span className="rhAbsentNom">{nomComplet(salarie)}</span>
                        <span className="rhMuted">
                          jusqu'au {absence.data.au}
                        </span>
                      </div>
                    );
                  })
                )}

                <div className="rhSousTitre">Historique</div>
                {!absences.length ? (
                  <div className="rhEmptyBox">Aucune absence enregistrée.</div>
                ) : (
                  <div className="rhTable cosScroll">
                    <div className="rhTr rhTrAbs rhTh">
                      <span>Salarié</span>
                      <span>Type</span>
                      <span>Du</span>
                      <span>Au</span>
                      <span className="rhNum">Jours</span>
                      <span>État</span>
                      <span />
                    </div>
                    {[...absences]
                      .sort((a, b) => (a.data.du < b.data.du ? 1 : -1))
                      .slice(0, 200)
                      .map((a) => {
                        const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
                        const e = ETATS_DEMANDE[a.data.etat] || ETATS_DEMANDE.demande;
                        return (
                          <div key={a.id} className="rhTr rhTrAbs">
                            <span className="rhMuted">
                              {nomComplet(salarieDe(a.data.salarieId))}
                            </span>
                            <span className="rhSens" data-ton={t.ton}>
                              <Icon fafa={t.icone} width={9} />
                              {t.label}
                            </span>
                            <span className="rhMuted">{a.data.du}</span>
                            <span className="rhMuted">{a.data.au}</span>
                            <span className="rhNum">
                              {joursOuvrables(a.data.du, a.data.au, reglages)}
                            </span>
                            <span>
                              <span className="rhTag" data-ton={e.ton}>
                                {e.label}
                              </span>
                            </span>
                            <span
                              className="rhRetirer handcr"
                              onClick={() => supprimerAbsence(a)}
                            >
                              <Icon fafa="faXmark" width={10} />
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            ) : null}

            {vue === "analyse" ? (
              <div className="rhAnalyse cosScroll">
                <div className="rhSousTitre">Contrats à échéance — 60 jours</div>
                {!echeances.length ? (
                  <div className="rhEmptyBox">
                    Aucun contrat à durée déterminée n'arrive à terme.
                  </div>
                ) : (
                  echeances.map(({ salarie: s, jours }) => (
                    <div
                      key={s.id}
                      className="rhAlerte handcr"
                      onClick={() => {
                        setVue("personnel");
                        setFiltreStatut("tous");
                        ouvrirSalarie(s);
                      }}
                    >
                      <span className="rhTag" data-ton={jours <= 15 ? "bad" : "warn"}>
                        {jours < 0 ? `dépassé de ${-jours} j` : `dans ${jours} j`}
                      </span>
                      <span className="rhAlerteNom">{nomComplet(s)}</span>
                      <span className="rhMuted">
                        {TYPES_CONTRAT[s.data.typeContrat]?.label} · fin {s.data.dateFin}
                      </span>
                      <span className="rhMuted">{s.data.poste || "—"}</span>
                    </div>
                  ))
                )}

                <div className="rhSousTitre">Effectif par département</div>
                {(() => {
                  const liste = parDepartement(salaries);
                  if (!liste.length)
                    return <div className="rhEmptyBox">Aucun salarié actif.</div>;
                  const max = Math.max(1, ...liste.map((d) => d.effectif));
                  return liste.map((d) => (
                    <div key={d.nom} className="rhJauge">
                      <span className="rhJaugeNom">{d.nom}</span>
                      <span className="rhJaugeFond">
                        <span
                          className="rhJaugeVal"
                          style={{ width: `${(d.effectif / max) * 100}%` }}
                        />
                      </span>
                      <span className="rhJaugeChiffre">
                        {d.effectif}
                        <em> · {money(d.masse)}</em>
                      </span>
                    </div>
                  ));
                })()}

                <div className="rhSousTitre">Ancienneté</div>
                {(() => {
                  const tranches = parAnciennete(salaries);
                  const max = Math.max(1, ...tranches.map((t) => t.effectif));
                  if (!tranches.some((t) => t.effectif))
                    return <div className="rhEmptyBox">Aucun salarié actif.</div>;
                  return tranches.map((t) => (
                    <div key={t.id} className="rhJauge">
                      <span className="rhJaugeNom">{t.label}</span>
                      <span className="rhJaugeFond">
                        <span
                          className="rhJaugeVal"
                          style={{ width: `${(t.effectif / max) * 100}%` }}
                        />
                      </span>
                      <span className="rhJaugeChiffre">{t.effectif}</span>
                    </div>
                  ));
                })()}
              </div>
            ) : null}

            {vue === "reglages" ? (
              <div className="rhAnalyse cosScroll">
                <div className="rhSousTitre">Congés payés</div>
                <div className="rhNote">
                  Ces valeurs servent à calculer les soldes. Elles suivent
                  l'usage le plus répandu en Afrique de l'Ouest — deux jours et
                  deux dixièmes acquis par mois de service, dimanche seul
                  chômé. Une convention collective ou un accord d'entreprise
                  peut en décider autrement : ajustez-les, le module ne dit pas
                  le droit, il calcule.
                </div>

                <div className="rhDeux">
                  <label className="rhField">
                    <span className="rhLabel">Jours acquis par mois</span>
                    <input
                      type="number"
                      step="0.1"
                      value={reglages.acquisParMois}
                      onChange={(e) =>
                        setReglages((r) => ({
                          ...r,
                          acquisParMois: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                  <label className="rhField">
                    <span className="rhLabel">Soit par an</span>
                    <div className="rhReadonly">
                      {Math.round(reglages.acquisParMois * 12 * 10) / 10} jours
                    </div>
                  </label>
                </div>

                <div className="rhField">
                  <span className="rhLabel">Jours ouvrables de la semaine</span>
                  <div className="rhJours">
                    {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((j, i) => (
                      <span
                        key={j}
                        className="handcr"
                        data-actif={reglages.joursOuvres.includes(i)}
                        onClick={() =>
                          setReglages((r) => ({
                            ...r,
                            joursOuvres: r.joursOuvres.includes(i)
                              ? r.joursOuvres.filter((x) => x !== i)
                              : [...r.joursOuvres, i].sort(),
                          }))
                        }
                      >
                        {j}
                      </span>
                    ))}
                  </div>
                </div>

                <label className="rhField">
                  <span className="rhLabel">
                    Jours fériés — une date AAAA-MM-JJ par ligne
                  </span>
                  <textarea
                    rows={5}
                    placeholder="2026-08-07"
                    value={(reglages.feries || []).join("\n")}
                    onChange={(e) =>
                      setReglages((r) => ({
                        ...r,
                        feries: e.target.value
                          .split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      }))
                    }
                  />
                </label>
                <div className="rhNote">
                  Volontairement vide au départ : les fériés changent chaque
                  année et selon le pays. En inventer serait pire que de ne
                  rien mettre — un congé mal compté se voit sur une paie.
                </div>

                <div className="rhFormActions">
                  <div
                    className="rhPrimary handcr"
                    data-off={busy}
                    onClick={enregistrerReglages}
                  >
                    <Icon fafa="faFloppyDisk" width={11} />
                    <span>{busy ? "…" : "Enregistrer"}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="rhPanneau cosScroll">
            {absOuverte ? (
              <>
                <div className="rhPanTitre">
                  {absOuverte.id ? "Absence" : "Nouvelle absence"}
                </div>

                <label className="rhField">
                  <span className="rhLabel">Salarié</span>
                  <select
                    value={absOuverte.salarieId}
                    onChange={(e) =>
                      setAbsOuverte((a) => ({ ...a, salarieId: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {salaries
                      .filter((s) => s.data.statut !== "sorti")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {nomComplet(s)}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="rhField">
                  <span className="rhLabel">Type</span>
                  <select
                    value={absOuverte.type}
                    onChange={(e) =>
                      setAbsOuverte((a) => ({ ...a, type: e.target.value }))
                    }
                  >
                    {Object.entries(TYPES_ABSENCE).map(([id, t]) => (
                      <option key={id} value={id}>
                        {t.label}
                        {t.decompte ? " (décompté)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rhDeux">
                  <label className="rhField">
                    <span className="rhLabel">Du</span>
                    <input
                      type="date"
                      value={absOuverte.du}
                      onChange={(e) =>
                        setAbsOuverte((a) => ({ ...a, du: e.target.value }))
                      }
                    />
                  </label>
                  <label className="rhField">
                    <span className="rhLabel">Au</span>
                    <input
                      type="date"
                      value={absOuverte.au}
                      onChange={(e) =>
                        setAbsOuverte((a) => ({ ...a, au: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="rhRecap">
                  <span>Jours ouvrables</span>
                  <strong>{joursOuvrables(absOuverte.du, absOuverte.au, reglages)}</strong>
                </div>

                <label className="rhField">
                  <span className="rhLabel">Motif</span>
                  <input
                    type="text"
                    value={absOuverte.motif}
                    onChange={(e) =>
                      setAbsOuverte((a) => ({ ...a, motif: e.target.value }))
                    }
                  />
                </label>

                <label className="rhField">
                  <span className="rhLabel">État</span>
                  <select
                    value={absOuverte.etat}
                    onChange={(e) =>
                      setAbsOuverte((a) => ({ ...a, etat: e.target.value }))
                    }
                  >
                    {Object.entries(ETATS_DEMANDE).map(([id, e]) => (
                      <option key={id} value={id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rhFormActions">
                  <div
                    className="rhPrimary handcr"
                    data-off={busy}
                    onClick={enregistrerAbsence}
                  >
                    Enregistrer
                  </div>
                  <div className="rhBtnGhost handcr" onClick={() => setAbsOuverte(null)}>
                    Fermer
                  </div>
                </div>
              </>
            ) : !draft ? (
              <div className="rhPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un salarié pour voir son dossier, ses congés et
                  ses absences.
                </span>
              </div>
            ) : (
              <>
                <div className="rhPanTete">
                  <div className="rhPhoto">
                    <Avatar
                      user={{ avatar: draft.photo, name: nomComplet({ data: draft }) }}
                      taille={54}
                    />
                    <span
                      className="rhPhotoBtn handcr"
                      title="Changer la photo"
                      onClick={changerPhoto}
                    >
                      <Icon fafa="faCamera" width={9} />
                    </span>
                  </div>
                  <div className="rhPanInfo">
                    <div className="rhPanNom">
                      {nomComplet({ data: draft }) || "Nouveau dossier"}
                    </div>
                    <div className="rhPanMeta">
                      {[draft.poste, draft.matricule].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                </div>

                {selectedId && solde ? (
                  <div className="rhResume">
                    <div>
                      <span className="rhResumeLbl">Solde de congés</span>
                      <strong data-ton={solde.solde < 0 ? "bad" : "ok"}>
                        {solde.solde} j
                      </strong>
                    </div>
                    <div>
                      <span className="rhResumeLbl">Ancienneté</span>
                      <strong>{ancienneteTexte(draft.dateEmbauche)}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="rhOnglets">
                  {[
                    ["fiche", "Fiche"],
                    ["contrat", "Contrat"],
                    ["absences", "Absences"],
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
                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Nom *</span>
                        <input type="text" value={draft.nom} onChange={champ("nom")} />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Prénom</span>
                        <input
                          type="text"
                          value={draft.prenom}
                          onChange={champ("prenom")}
                        />
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Matricule</span>
                        <input
                          type="text"
                          value={draft.matricule}
                          onChange={champ("matricule")}
                        />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Date de naissance</span>
                        <input
                          type="date"
                          value={draft.dateNaissance}
                          onChange={champ("dateNaissance")}
                        />
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Téléphone</span>
                        <input
                          type="text"
                          value={draft.telephone}
                          onChange={champ("telephone")}
                        />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">E-mail</span>
                        <input type="text" value={draft.email} onChange={champ("email")} />
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Ville</span>
                        <input type="text" value={draft.ville} onChange={champ("ville")} />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Sexe</span>
                        <select value={draft.sexe} onChange={champ("sexe")}>
                          <option value="">Non précisé</option>
                          <option value="F">Féminin</option>
                          <option value="M">Masculin</option>
                        </select>
                      </label>
                    </div>

                    <label className="rhField">
                      <span className="rhLabel">Adresse</span>
                      <input
                        type="text"
                        value={draft.adresse}
                        onChange={champ("adresse")}
                      />
                    </label>

                    <label className="rhField">
                      <span className="rhLabel">
                        Compte CompanyOS — pour recevoir les décisions de congé
                      </span>
                      <select value={draft.userId} onChange={champ("userId")}>
                        <option value="">Aucun</option>
                        {membres.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {m.email}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="rhField">
                      <span className="rhLabel">Notes</span>
                      <textarea rows={3} value={draft.notes} onChange={champ("notes")} />
                    </label>

                    {selected ? <Auteur record={selected} /> : null}

                    <div className="rhFormActions">
                      <div
                        className="rhPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerSalarie}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                      {selectedId ? (
                        <div
                          className="rhBtnGhost rhDanger handcr"
                          onClick={supprimerSalarie}
                        >
                          Supprimer
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {onglet === "contrat" ? (
                  <>
                    <label className="rhField">
                      <span className="rhLabel">Poste</span>
                      <input type="text" value={draft.poste} onChange={champ("poste")} />
                    </label>

                    <label className="rhField">
                      <span className="rhLabel">Département</span>
                      <input
                        type="text"
                        list="rhDepartements"
                        value={draft.departement}
                        onChange={champ("departement")}
                      />
                      {/* Une liste de suggestions plutôt qu'un référentiel :
                          trois départements ne méritent pas un écran de
                          gestion, mais taper « Ventes » puis « ventes »
                          casserait tous les regroupements. */}
                      <datalist id="rhDepartements">
                        {[...new Set(salaries.map((s) => s.data.departement).filter(Boolean))].map(
                          (d) => (
                            <option key={d} value={d} />
                          ),
                        )}
                      </datalist>
                    </label>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Type de contrat</span>
                        <select value={draft.typeContrat} onChange={champ("typeContrat")}>
                          {Object.entries(TYPES_CONTRAT).map(([id, c]) => (
                            <option key={id} value={id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Statut</span>
                        <select value={draft.statut} onChange={champ("statut")}>
                          {Object.entries(STATUTS).map(([id, s]) => (
                            <option key={id} value={id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Date d'embauche</span>
                        <input
                          type="date"
                          value={draft.dateEmbauche}
                          onChange={champ("dateEmbauche")}
                        />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">
                          Fin de contrat
                          {TYPES_CONTRAT[draft.typeContrat]?.duree ? " *" : ""}
                        </span>
                        <input
                          type="date"
                          value={draft.dateFin}
                          disabled={!TYPES_CONTRAT[draft.typeContrat]?.duree}
                          onChange={champ("dateFin")}
                        />
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">Salaire de base</span>
                        <input
                          type="number"
                          value={draft.salaireBase}
                          onChange={champ("salaireBase")}
                        />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Report de congés (jours)</span>
                        <input
                          type="number"
                          step="0.5"
                          value={draft.reportConges}
                          onChange={champ("reportConges")}
                        />
                      </label>
                    </div>

                    <div className="rhDeux">
                      <label className="rhField">
                        <span className="rhLabel">N° CNPS</span>
                        <input
                          type="text"
                          value={draft.numeroCnps}
                          onChange={champ("numeroCnps")}
                        />
                      </label>
                      <label className="rhField">
                        <span className="rhLabel">Compte de paiement</span>
                        <input
                          type="text"
                          placeholder="Banque ou Mobile Money"
                          value={draft.banque}
                          onChange={champ("banque")}
                        />
                      </label>
                    </div>

                    {solde ? (
                      <>
                        <div className="rhRecap">
                          <span>Congés acquis</span>
                          <strong>{solde.acquis} j</strong>
                        </div>
                        <div className="rhRecap">
                          <span>Pris</span>
                          <strong>{solde.pris} j</strong>
                        </div>
                        {solde.enAttente ? (
                          <div className="rhRecap">
                            <span>Demandés, non tranchés</span>
                            <strong>{solde.enAttente} j</strong>
                          </div>
                        ) : null}
                        <div className="rhRecap rhRecapFort">
                          <span>Solde</span>
                          <strong data-ton={solde.solde < 0 ? "bad" : "ok"}>
                            {solde.solde} j
                          </strong>
                        </div>
                      </>
                    ) : null}

                    <div className="rhFormActions">
                      <div
                        className="rhPrimary handcr"
                        data-off={busy}
                        onClick={enregistrerSalarie}
                      >
                        <Icon fafa="faFloppyDisk" width={11} />
                        <span>{busy ? "…" : "Enregistrer"}</span>
                      </div>
                    </div>
                  </>
                ) : null}

                {onglet === "absences" ? (
                  !selectedId ? (
                    <div className="rhEmptyBox">
                      Enregistrez le dossier avant de saisir une absence.
                    </div>
                  ) : (
                    <>
                      <div className="rhFormActions">
                        <div
                          className="rhPrimary handcr"
                          onClick={() => nouvelleAbsence(selectedId)}
                        >
                          <Icon fafa="faPlus" width={10} />
                          <span>Nouvelle absence</span>
                        </div>
                      </div>

                      {!absencesSalarie.length ? (
                        <div className="rhEmptyBox">Aucune absence enregistrée.</div>
                      ) : (
                        <div className="rhHisto">
                          {absencesSalarie.map((a) => {
                            const t = TYPES_ABSENCE[a.data.type] || TYPES_ABSENCE.conge;
                            const e = ETATS_DEMANDE[a.data.etat] || ETATS_DEMANDE.demande;
                            return (
                              <div key={a.id} className="rhHistoLigne">
                                <span className="rhHistoIcone" data-ton={t.ton}>
                                  <Icon fafa={t.icone} width={9} />
                                </span>
                                <div className="rhHistoInfo">
                                  <div className="rhHistoTitre">
                                    {t.label} ·{" "}
                                    {joursOuvrables(a.data.du, a.data.au, reglages)} j
                                  </div>
                                  <div className="rhHistoMeta">
                                    {a.data.du} → {a.data.au}
                                    {a.data.motif ? ` · ${a.data.motif}` : ""}
                                  </div>
                                </div>
                                <span className="rhTag" data-ton={e.ton}>
                                  {e.label}
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

          {notice ? <div className="rhNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}
