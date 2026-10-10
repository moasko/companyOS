// Congés.
//
// ─────────────────────────────────────────────────────────────────────────
// LE GUICHET DES CONGÉS
//
// Les Ressources humaines tiennent le dossier ; cette application tient
// le **guichet**. Le salarié y demande ses congés et suit son solde sans
// voir le reste du dossier du personnel ; le responsable y valide ou
// refuse, prévenu à chaque demande — et chacun est notifié de la
// décision.
//
// Une seule source de vérité : les fiches `rh/absences`. Les RH,
// l'Agenda et ce guichet lisent et écrivent les mêmes enregistrements —
// approuver ici, c'est approuvé partout. Les calculs (jours ouvrables,
// soldes, chevauchements) sont ceux du domaine RH, importés tels quels.
//
// L'app suit le réglage « Langue et région » : ses textes vivent dans
// TEXTES (fr/en, repli par clé) — voir la partie 8 du guide.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier, envoyerA } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import { useTraduction } from "../../../utils/intl";
import {
  ETATS_DEMANDE,
  REGLAGES_DEFAUT,
  TYPES_ABSENCE,
  chevauchements,
  joursOuvrables,
  soldeConges,
  today,
} from "../rh/domaine";
import * as D from "./domaine";
import "./conges.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: CongesApp };

const TEXTES = {
  fr: {
    verrou: "Connectez-vous pour gérer vos congés.",
    vueMoi: "Mes congés",
    vueValidation: "À valider",
    vuePlanning: "Planning d'équipe",
    sansFicheTitre: "Aucune fiche salarié à votre nom",
    sansFicheAide:
      "Votre compte ({email}) n'est relié à aucune fiche du dossier RH. Demandez à un responsable d'y renseigner votre adresse email.",
    salarie: "Salarié",
    joursAcquis: "jours acquis",
    joursPris: "jours pris",
    joursRestants: "jours restants",
    enAttente: "en attente",
    demanderTitre: "Demander une absence",
    champType: "Type",
    horsSolde: " (hors solde)",
    champDu: "Du",
    champAu: "Au (inclus)",
    champMotif: "Motif",
    facultatif: "Facultatif",
    motifExemple: "Congés annuels, événement familial…",
    joursOuvrables: "{n} jour(s) ouvrable(s)",
    deposer: "Déposer la demande",
    mesDemandes: "Mes demandes",
    aucuneDemande: "Aucune demande pour l'instant.",
    duAu: "du {du} au {au}",
    retirer: "Retirer",
    demandeIncomplete: "Demande incomplète",
    soldeInsuffisant: "Solde insuffisant",
    soldeInsuffisantMsg:
      "Cette demande fait {jours} jour(s) ouvrable(s) ; il vous en reste {reste}.",
    soldeInsuffisantDetail:
      "Vous pouvez la déposer quand même — le responsable tranchera.",
    deposerQuandMeme: "Déposer quand même",
    periodeCouverte: "Période déjà couverte",
    periodeCouverteMsg: "Une autre absence chevauche ces dates.",
    depotImpossible: "Dépôt impossible",
    notifDeposee: "Demande déposée",
    notifDeposeeMsg: "{n} jour(s) ouvrable(s), du {du} au {au}.",
    notifResponsable: "Demande de congés — {nom}",
    notifResponsableMsg: "{type}, du {du} au {au}.",
    retirerTitre: "Retirer cette demande ?",
    periodeMsg: "Du {du} au {au}.",
    refuserTitre: "Refuser cette demande ?",
    refuserMsg: "{nom}, du {du} au {au}.",
    refuser: "Refuser",
    approuver: "Approuver",
    decisionImpossible: "Décision impossible",
    congesApprouves: "Congés approuvés",
    congesRefuses: "Congés refusés",
    rienAValider: "Rien à valider",
    rienAValiderAide:
      "Les demandes de l'équipe apparaîtront ici, avec le solde de chacun.",
    resteCompteur: " · reste {n} j au compteur",
    depasseSolde: "Cette demande dépasse le solde restant du salarié.",
    personneAbsent: "Personne d'absent à l'horizon",
    personneAbsentAide:
      "Les absences validées, en cours et à venir, s'affichent ici pour toute l'équipe.",
    enCours: "en cours",
    "type.conge": "Congé payé",
    "type.maladie": "Maladie",
    "type.maternite": "Maternité",
    "type.permission": "Permission",
    "type.sansSolde": "Sans solde",
    "type.injustifiee": "Absence injustifiée",
    "etat.demande": "En attente",
    "etat.approuve": "Approuvé",
    "etat.refuse": "Refusé",
  },
  en: {
    verrou: "Sign in to manage your leave.",
    vueMoi: "My leave",
    vueValidation: "To approve",
    vuePlanning: "Team schedule",
    sansFicheTitre: "No employee file in your name",
    sansFicheAide:
      "Your account ({email}) is not linked to any HR file. Ask a manager to add your email address to it.",
    salarie: "Employee",
    joursAcquis: "days accrued",
    joursPris: "days taken",
    joursRestants: "days left",
    enAttente: "pending",
    demanderTitre: "Request an absence",
    champType: "Type",
    horsSolde: " (not deducted)",
    champDu: "From",
    champAu: "To (inclusive)",
    champMotif: "Reason",
    facultatif: "Optional",
    motifExemple: "Annual leave, family event…",
    joursOuvrables: "{n} working day(s)",
    deposer: "Submit the request",
    mesDemandes: "My requests",
    aucuneDemande: "No request yet.",
    duAu: "from {du} to {au}",
    retirer: "Withdraw",
    demandeIncomplete: "Incomplete request",
    soldeInsuffisant: "Insufficient balance",
    soldeInsuffisantMsg:
      "This request is {jours} working day(s); you have {reste} left.",
    soldeInsuffisantDetail:
      "You can still submit it — the manager will decide.",
    deposerQuandMeme: "Submit anyway",
    periodeCouverte: "Period already covered",
    periodeCouverteMsg: "Another absence overlaps these dates.",
    depotImpossible: "Could not submit",
    notifDeposee: "Request submitted",
    notifDeposeeMsg: "{n} working day(s), from {du} to {au}.",
    notifResponsable: "Leave request — {nom}",
    notifResponsableMsg: "{type}, from {du} to {au}.",
    retirerTitre: "Withdraw this request?",
    periodeMsg: "From {du} to {au}.",
    refuserTitre: "Refuse this request?",
    refuserMsg: "{nom}, from {du} to {au}.",
    refuser: "Refuse",
    approuver: "Approve",
    decisionImpossible: "Could not decide",
    congesApprouves: "Leave approved",
    congesRefuses: "Leave refused",
    rienAValider: "Nothing to approve",
    rienAValiderAide:
      "Your team's requests will appear here, with everyone's balance.",
    resteCompteur: " · {n} d left on the counter",
    depasseSolde: "This request exceeds the employee's remaining balance.",
    personneAbsent: "Nobody away on the horizon",
    personneAbsentAide:
      "Approved absences, current and upcoming, are shown here for the whole team.",
    enCours: "ongoing",
    "type.conge": "Paid leave",
    "type.maladie": "Sick leave",
    "type.maternite": "Maternity leave",
    "type.permission": "Short leave",
    "type.sansSolde": "Unpaid leave",
    "type.injustifiee": "Unjustified absence",
    "etat.demande": "Pending",
    "etat.approuve": "Approved",
    "etat.refuse": "Refused",
  },
};

/// Libellé d'un type ou d'un état d'absence : la traduction si elle
/// existe, sinon le libellé français du domaine RH — un id inconnu
/// (introduit par une version plus récente) ne casse rien.
const libelleType = (t, id) => {
  const traduit = t(`type.${id}`);
  return traduit === `type.${id}` ? TYPES_ABSENCE[id]?.label || id : traduit;
};
const libelleEtat = (t, id) => {
  const traduit = t(`etat.${id}`);
  return traduit === `etat.${id}` ? ETATS_DEMANDE[id]?.label || id : traduit;
};

const DEMANDE_VIDE = { type: "conge", du: today(), au: today(), motif: "" };

function CongesApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const peutValider = ["OWNER", "ADMIN"].includes(session.user?.role);
  const t = useTraduction(TEXTES);

  const [vue, setVue] = useState("moi");
  const [salaries, setSalaries] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [reglages, setReglages] = useState(REGLAGES_DEFAUT);
  const [membres, setMembres] = useState([]);
  const [demande, setDemande] = useState(DEMANDE_VIDE);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [s, a, r, m] = await Promise.all([
      api.records.list("rh", "salaries").catch(() => []),
      api.records.list("rh", "absences").catch(() => []),
      api.records.list("rh", "reglages").catch(() => []),
      api.members().catch(() => []),
    ]);
    setSalaries(s);
    setAbsences(a);
    setReglages({ ...REGLAGES_DEFAUT, ...(r[0]?.data || {}) });
    setMembres(m);
  }, []);
  // Rechargement en direct quand un collègue modifie ces collections.
  const etat = useChargement(ouvert, charger, { ecoute: ["rh/absences", "rh/salaries", "conges/*"] });

  // Le salarié derrière la session — par l'email, la seule clé commune.
  const moi = useMemo(
    () => D.salarieDe(salaries, session.user?.email),
    [salaries, session.user?.email],
  );
  const monSolde = useMemo(
    () => (moi ? soldeConges(moi, absences, reglages) : null),
    [moi, absences, reglages],
  );
  const mesDemandes = useMemo(
    () => (moi ? D.mesDemandes(absences, moi.id) : []),
    [absences, moi],
  );
  const aValider = useMemo(
    () => absences.filter((a) => a.data.etat === "demande"),
    [absences],
  );
  const planning = useMemo(() => D.planningDe(absences), [absences]);

  const nomDe = (salarieId) => {
    const s = salaries.find((x) => x.id === salarieId);
    return s
      ? `${s.data.prenom || ""} ${s.data.nom || ""}`.trim()
      : t("salarie");
  };

  /// Le compte utilisateur d'un salarié — pour lui notifier la décision.
  const membreDe = (salarieId) => {
    const s = salaries.find((x) => x.id === salarieId);
    if (!s?.data.email) return null;
    return (
      membres.find(
        (m) => m.email?.toLowerCase() === s.data.email.trim().toLowerCase(),
      ) || null
    );
  };

  // ---- Demander -----------------------------------------------------------

  const deposer = async () => {
    const probleme = D.problemeDemande(demande, { reglages });
    if (probleme) {
      return modal.alert({ title: t("demandeIncomplete"), message: probleme });
    }
    const jours = joursOuvrables(demande.du, demande.au, reglages);
    const decompte = TYPES_ABSENCE[demande.type]?.decompte;
    if (decompte && monSolde && jours > monSolde.solde) {
      const ok = await modal.confirm({
        title: t("soldeInsuffisant"),
        message: t("soldeInsuffisantMsg", { jours, reste: monSolde.solde }),
        detail: t("soldeInsuffisantDetail"),
        confirmLabel: t("deposerQuandMeme"),
      });
      if (!ok) return;
    }
    const doublons = chevauchements({ data: { ...demande, salarieId: moi.id } }, absences);
    if (doublons.length) {
      return modal.alert({
        title: t("periodeCouverte"),
        message: t("periodeCouverteMsg"),
      });
    }

    setOccupe(true);
    try {
      await api.records.create("rh", "absences", {
        salarieId: moi.id,
        type: demande.type,
        du: demande.du,
        au: demande.au,
        motif: demande.motif.trim(),
        etat: "demande",
      });
      setDemande(DEMANDE_VIDE);
      await etat.rafraichir();
      notifier({
        titre: t("notifDeposee"),
        message: t("notifDeposeeMsg", { n: jours, du: demande.du, au: demande.au }),
        app: manifest.name,
        ton: "success",
      });
      // Les responsables sont prévenus — chacun sur son poste.
      for (const m of membres.filter((x) => ["OWNER", "ADMIN"].includes(x.role))) {
        envoyerA(m.id, {
          source: "conges",
          titre: t("notifResponsable", { nom: nomDe(moi.id) }),
          message: t("notifResponsableMsg", {
            type: libelleType(t, demande.type),
            du: demande.du,
            au: demande.au,
          }),
          lien: { app: "conges" },
        });
      }
    } catch (e) {
      modal.alert({ title: t("depotImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const annuler = async (fiche) => {
    const ok = await modal.confirm({
      title: t("retirerTitre"),
      message: t("periodeMsg", { du: fiche.data.du, au: fiche.data.au }),
      confirmLabel: t("retirer"),
      danger: true,
    });
    if (!ok) return;
    await api.records.remove("rh", "absences", fiche.id);
    await etat.rafraichir();
  };

  // ---- Valider ------------------------------------------------------------

  const trancher = async (fiche, decision) => {
    if (decision === "refuse") {
      const ok = await modal.confirm({
        title: t("refuserTitre"),
        message: t("refuserMsg", {
          nom: nomDe(fiche.data.salarieId),
          du: fiche.data.du,
          au: fiche.data.au,
        }),
        confirmLabel: t("refuser"),
        danger: true,
      });
      if (!ok) return;
    }
    setOccupe(true);
    try {
      await api.records.update("rh", "absences", fiche.id, {
        ...fiche.data,
        etat: decision,
      });
      await etat.rafraichir();
      const membre = membreDe(fiche.data.salarieId);
      if (membre) {
        envoyerA(membre.id, {
          source: "conges",
          titre: decision === "approuve" ? t("congesApprouves") : t("congesRefuses"),
          message: t("periodeMsg", { du: fiche.data.du, au: fiche.data.au }),
          lien: { app: "conges" },
        });
      }
    } catch (e) {
      modal.alert({ title: t("decisionImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cgsApp">
        <div className="cgsVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  const VUES = [
    { id: "moi", label: t("vueMoi"), icone: "faUmbrellaBeach" },
    ...(peutValider
      ? [{ id: "validation", label: t("vueValidation"), icone: "faListCheck", compte: aValider.length }]
      : []),
    { id: "planning", label: t("vuePlanning"), icone: "faCalendarDays" },
  ];

  return (
    <ModuleWindow manifest={manifest} className="cgsApp">
      <div className="cgsShell">
        <nav className="cgsNav">
          {VUES.map((v) => (
            <div
              key={v.id}
              className="cgsOnglet handcr"
              data-actif={vue === v.id}
              onClick={() => setVue(v.id)}
            >
              <Icon fafa={v.icone} width={13} />
              <span>{v.label}</span>
              {v.compte ? <span className="cgsCompte">{v.compte}</span> : null}
            </div>
          ))}
        </nav>

        <div className="cgsCentre cosScroll">
          <Contenu etat={etat} vide={false} lignes={4}>
            {vue === "moi" ? (
              !moi ? (
                <Vide
                  icone="faUserSlash"
                  titre={t("sansFicheTitre")}
                  aide={t("sansFicheAide", { email: session.user?.email })}
                />
              ) : (
                <MesConges
                  solde={monSolde}
                  demandes={mesDemandes}
                  demande={demande}
                  setDemande={setDemande}
                  reglages={reglages}
                  occupe={occupe}
                  onDeposer={deposer}
                  onAnnuler={annuler}
                />
              )
            ) : vue === "validation" ? (
              <Validation
                demandes={aValider}
                salaries={salaries}
                absences={absences}
                reglages={reglages}
                nomDe={nomDe}
                occupe={occupe}
                onTrancher={trancher}
              />
            ) : (
              <Planning planning={planning} nomDe={nomDe} reglages={reglages} />
            )}
          </Contenu>
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Mes congés
// ---------------------------------------------------------------------------

const MesConges = ({ solde, demandes, demande, setDemande, reglages, occupe, onDeposer, onAnnuler }) => {
  const t = useTraduction(TEXTES);
  const maj = (patch) => setDemande((d) => ({ ...d, ...patch }));
  const jours = joursOuvrables(demande.du, demande.au, reglages);

  return (
    <div className="cgsMoi">
      {/* Le solde, en trois chiffres que tout le monde comprend. */}
      <div className="cgsSolde">
        <div className="cgsSoldeCase">
          <b>{solde.acquis}</b>
          <span>{t("joursAcquis")}</span>
        </div>
        <div className="cgsSoldeCase">
          <b>{solde.pris}</b>
          <span>{t("joursPris")}</span>
        </div>
        <div className="cgsSoldeCase" data-fort="true">
          <b>{solde.solde}</b>
          <span>{t("joursRestants")}</span>
        </div>
        {solde.enAttente ? (
          <div className="cgsSoldeCase">
            <b>{solde.enAttente}</b>
            <span>{t("enAttente")}</span>
          </div>
        ) : null}
      </div>

      <div className="cgsBloc">
        <h3>{t("demanderTitre")}</h3>
        <div className="cgsFormulaire">
          <Champ label={t("champType")}>
            <select value={demande.type} onChange={(e) => maj({ type: e.target.value })}>
              {Object.keys(TYPES_ABSENCE).map((id) => (
                <option key={id} value={id}>
                  {libelleType(t, id)}
                  {TYPES_ABSENCE[id].decompte ? "" : t("horsSolde")}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label={t("champDu")}>
            <input type="date" value={demande.du} onChange={(e) => maj({ du: e.target.value })} />
          </Champ>
          <Champ label={t("champAu")}>
            <input type="date" value={demande.au} min={demande.du} onChange={(e) => maj({ au: e.target.value })} />
          </Champ>
          <Champ label={t("champMotif")} aide={t("facultatif")}>
            <input
              value={demande.motif}
              placeholder={t("motifExemple")}
              onChange={(e) => maj({ motif: e.target.value })}
            />
          </Champ>
        </div>
        <div className="cgsFormulairePied">
          <span className="cgsJours">{t("joursOuvrables", { n: jours })}</span>
          <Bouton icone="faPaperPlane" off={occupe} onClick={onDeposer}>
            {t("deposer")}
          </Bouton>
        </div>
      </div>

      <div className="cgsBloc">
        <h3>{t("mesDemandes")}</h3>
        {!demandes.length ? (
          <p className="cgsAide">{t("aucuneDemande")}</p>
        ) : (
          demandes.map((f) => {
            const e = ETATS_DEMANDE[f.data.etat] || {};
            return (
              <div key={f.id} className="cgsLigne">
                <span className="cgsLigneType">{libelleType(t, f.data.type)}</span>
                <span className="cgsLigneDates">
                  {t("duAu", { du: f.data.du, au: f.data.au })} —{" "}
                  {joursOuvrables(f.data.du, f.data.au, reglages)} j
                </span>
                <span className="cgsEtat" data-ton={e.ton}>
                  {libelleEtat(t, f.data.etat)}
                </span>
                {f.data.etat === "demande" ? (
                  <span className="cgsRetirer handcr" title={t("retirer")} onClick={() => onAnnuler(f)}>
                    <Icon fafa="faXmark" width={11} />
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// À valider
// ---------------------------------------------------------------------------

const Validation = ({ demandes, salaries, absences, reglages, nomDe, occupe, onTrancher }) => {
  const t = useTraduction(TEXTES);
  if (!demandes.length) {
    return (
      <Vide
        icone="faListCheck"
        titre={t("rienAValider")}
        aide={t("rienAValiderAide")}
      />
    );
  }
  return (
    <div className="cgsValidation">
      {demandes.map((f) => {
        const salarie = salaries.find((s) => s.id === f.data.salarieId);
        const solde = salarie ? soldeConges(salarie, absences, reglages) : null;
        const jours = joursOuvrables(f.data.du, f.data.au, reglages);
        const decompte = TYPES_ABSENCE[f.data.type]?.decompte;
        const depasse = decompte && solde && jours > solde.solde;
        return (
          <div key={f.id} className="cgsCarte">
            <div className="cgsCarteHaut">
              <span className="cgsCarteNom">{nomDe(f.data.salarieId)}</span>
              <span className="cgsCarteType">{libelleType(t, f.data.type)}</span>
            </div>
            <div className="cgsCarteDates">
              {t("duAu", { du: f.data.du, au: f.data.au })} —{" "}
              <b>{t("joursOuvrables", { n: jours })}</b>
              {solde ? t("resteCompteur", { n: solde.solde }) : ""}
            </div>
            {f.data.motif ? <div className="cgsCarteMotif">« {f.data.motif} »</div> : null}
            {depasse ? (
              <Notice ton="attention" icone="faTriangleExclamation">
                {t("depasseSolde")}
              </Notice>
            ) : null}
            <div className="cgsCarteActions">
              <Bouton icone="faCheck" off={occupe} onClick={() => onTrancher(f, "approuve")}>
                {t("approuver")}
              </Bouton>
              <Bouton
                variante="secondaire"
                icone="faXmark"
                off={occupe}
                onClick={() => onTrancher(f, "refuse")}
              >
                {t("refuser")}
              </Bouton>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Planning d'équipe
// ---------------------------------------------------------------------------

const Planning = ({ planning, nomDe, reglages }) => {
  const t = useTraduction(TEXTES);
  if (!planning.length) {
    return (
      <Vide
        icone="faCalendarDays"
        titre={t("personneAbsent")}
        aide={t("personneAbsentAide")}
      />
    );
  }
  const aujourdhui = today();
  return (
    <div className="cgsPlanning">
      {planning.map((f) => (
        <div key={f.id} className="cgsLigne" data-encours={f.data.du <= aujourdhui}>
          <span className="cgsLigneType">{nomDe(f.data.salarieId)}</span>
          <span className="cgsLigneDates">
            {t("duAu", { du: f.data.du, au: f.data.au })} —{" "}
            {joursOuvrables(f.data.du, f.data.au, reglages)} j ·{" "}
            {libelleType(t, f.data.type)}
          </span>
          {f.data.du <= aujourdhui ? (
            <span className="cgsEtat" data-ton="ok">{t("enCours")}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
};
