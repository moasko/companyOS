import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { saveAs } from "../../cloud";
import { modal } from "../../modalRequest";
import { envoyerA } from "../../notifications";
import { choisirImage, redimensionnerImage } from "../../image";
import { useChargement } from "../../chargement";
import {
  REGLAGES_DEFAUT,
  STATUTS,
  TYPES_ABSENCE,
  TYPES_CONTRAT,
  absentsLe,
  ancienneteTexte,
  chevauchements,
  contratsAEcheance,
  nomComplet,
  prochainMatricule,
  soldeConges,
  statistiques,
  today,
} from "./domaine";
import { Absences } from "./vues/Absences";
import { Analyse } from "./vues/Analyse";
import { BarreLaterale } from "./vues/BarreLaterale";
import { FicheSalarie } from "./vues/FicheSalarie";
import { FormulaireAbsence } from "./vues/FormulaireAbsence";
import { Personnel } from "./vues/Personnel";
import { Reglages } from "./vues/Reglages";
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
//
// Ce fichier tient l'état, les écritures et l'assemblage ; chaque écran est
// dans `vues/`, et les règles de calcul dans `domaine.js`.

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
import { manifest as descriptif } from "./manifest";

// La photo voyage dans l'enregistrement, comme celle des produits : petite,
// affichée en liste, et disponible sans requête supplémentaire.
const PHOTO_COTE = 180;
const PHOTO_MAX = 40000;

export const manifest = { ...descriptif, Window: RhApp };

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
  // Le lien a pu arriver avant les données (ouverture à la demande).
  useEffect(() => {
    appliquerLien();
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
  /// Le paramètre s'appelle `decision` et pas `etat` : il masquait sinon
  /// l'objet de chargement `etat` du composant, et `etat.rafraichir()`
  /// devenait `"approuve".rafraichir()`. L'exception partait dans le
  /// `catch`, qui affichait un message d'erreur à la place de « Absence
  /// approuvée » — et surtout, la liste n'était jamais rechargée : la
  /// demande restait affichée « en attente » jusqu'au prochain passage
  /// dans l'app.
  const deciderAbsence = async (absence, decision) => {
    setBusy(true);
    try {
      await api.records.update(manifest.slug, "absences", absence.id, {
        ...absence.data,
        etat: decision,
        decidePar: session.user?.name || "",
        dateDecision: today(),
      });

      const s = salarieDe(absence.data.salarieId);
      const compte = s?.data.userId;
      if (compte && compte !== session.user?.id) {
        const t = TYPES_ABSENCE[absence.data.type];
        envoyerA(compte, {
          source: manifest.slug,
          titre: `${t?.label || "Absence"} ${decision === "approuve" ? "approuvé" : "refusé"}`,
          message: `Du ${absence.data.du} au ${absence.data.au}`,
          lien: { app: manifest.id, params: { salarie: s.id } },
        });
      }

      await etat.rafraichir();
      flash(decision === "approuve" ? "Absence approuvée" : "Absence refusée");
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
          <BarreLaterale
            vue={vue}
            setVue={setVue}
            enAttente={enAttente}
            salaries={salaries}
            filtreStatut={filtreStatut}
            setFiltreStatut={setFiltreStatut}
            nouveauSalarie={nouveauSalarie}
            exporterPersonnel={exporterPersonnel}
          />

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
              <Personnel
                requete={requete}
                setRequete={setRequete}
                nouveauSalarie={nouveauSalarie}
                etat={etat}
                salaries={salaries}
                visibles={visibles}
                absences={absences}
                reglages={reglages}
                absentsDuJour={absentsDuJour}
                selectedId={selectedId}
                ouvrirSalarie={ouvrirSalarie}
              />
            ) : null}

            {vue === "absences" ? (
              <Absences
                absences={absences}
                enAttente={enAttente}
                absentsDuJour={absentsDuJour}
                reglages={reglages}
                busy={busy}
                selectedId={selectedId}
                salarieDe={salarieDe}
                nouvelleAbsence={nouvelleAbsence}
                deciderAbsence={deciderAbsence}
                supprimerAbsence={supprimerAbsence}
                setVue={setVue}
                setFiltreStatut={setFiltreStatut}
                ouvrirSalarie={ouvrirSalarie}
              />
            ) : null}

            {vue === "analyse" ? (
              <Analyse
                echeances={echeances}
                salaries={salaries}
                setVue={setVue}
                setFiltreStatut={setFiltreStatut}
                ouvrirSalarie={ouvrirSalarie}
              />
            ) : null}

            {vue === "reglages" ? (
              <Reglages
                reglages={reglages}
                setReglages={setReglages}
                busy={busy}
                enregistrerReglages={enregistrerReglages}
              />
            ) : null}
          </main>

          {/* ---------- Panneau ---------- */}
          <aside className="rhPanneau cosScroll">
            {absOuverte ? (
              <FormulaireAbsence
                absOuverte={absOuverte}
                setAbsOuverte={setAbsOuverte}
                salaries={salaries}
                reglages={reglages}
                busy={busy}
                enregistrerAbsence={enregistrerAbsence}
              />
            ) : !draft ? (
              <div className="rhPanVide">
                <Icon fafa="faHandPointer" width={20} />
                <span>
                  Sélectionnez un salarié pour voir son dossier, ses congés et
                  ses absences.
                </span>
              </div>
            ) : (
              <FicheSalarie
                draft={draft}
                selected={selected}
                selectedId={selectedId}
                salaries={salaries}
                membres={membres}
                reglages={reglages}
                solde={solde}
                absencesSalarie={absencesSalarie}
                onglet={onglet}
                setOnglet={setOnglet}
                champ={champ}
                busy={busy}
                changerPhoto={changerPhoto}
                enregistrerSalarie={enregistrerSalarie}
                supprimerSalarie={supprimerSalarie}
                nouvelleAbsence={nouvelleAbsence}
              />
            )}
          </aside>

          {notice ? <div className="rhNotice">{notice}</div> : null}
        </div>
      )}
    </ModuleWindow>
  );
}
