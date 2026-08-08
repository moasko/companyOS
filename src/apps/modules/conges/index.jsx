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

export const manifest = {
  id: "conges",
  slug: "conges",
  name: "Congés",
  icon: "conges",
  action: "CONGESAPP",
  Window: CongesApp,
};

const DEMANDE_VIDE = { type: "conge", du: today(), au: today(), motif: "" };

function CongesApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const peutValider = ["OWNER", "ADMIN"].includes(session.user?.role);

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
  const etat = useChargement(ouvert, charger);

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
    return s ? `${s.data.prenom || ""} ${s.data.nom || ""}`.trim() : "Salarié";
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
      return modal.alert({ title: "Demande incomplète", message: probleme });
    }
    const jours = joursOuvrables(demande.du, demande.au, reglages);
    const decompte = TYPES_ABSENCE[demande.type]?.decompte;
    if (decompte && monSolde && jours > monSolde.solde) {
      const ok = await modal.confirm({
        title: "Solde insuffisant",
        message: `Cette demande fait ${jours} jour(s) ouvrable(s) ; il vous en reste ${monSolde.solde}.`,
        detail: "Vous pouvez la déposer quand même — le responsable tranchera.",
        confirmLabel: "Déposer quand même",
      });
      if (!ok) return;
    }
    const doublons = chevauchements({ data: { ...demande, salarieId: moi.id } }, absences);
    if (doublons.length) {
      return modal.alert({
        title: "Période déjà couverte",
        message: "Une autre absence chevauche ces dates.",
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
        titre: "Demande déposée",
        message: `${jours} jour(s) ouvrable(s), du ${demande.du} au ${demande.au}.`,
        app: "Congés",
        ton: "success",
      });
      // Les responsables sont prévenus — chacun sur son poste.
      for (const m of membres.filter((x) => ["OWNER", "ADMIN"].includes(x.role))) {
        envoyerA(m.id, {
          source: "conges",
          titre: `Demande de congés — ${nomDe(moi.id)}`,
          message: `${TYPES_ABSENCE[demande.type]?.label || demande.type}, du ${demande.du} au ${demande.au}.`,
          lien: { app: "conges" },
        });
      }
    } catch (e) {
      modal.alert({ title: "Dépôt impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const annuler = async (fiche) => {
    const ok = await modal.confirm({
      title: "Retirer cette demande ?",
      message: `Du ${fiche.data.du} au ${fiche.data.au}.`,
      confirmLabel: "Retirer",
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
        title: "Refuser cette demande ?",
        message: `${nomDe(fiche.data.salarieId)}, du ${fiche.data.du} au ${fiche.data.au}.`,
        confirmLabel: "Refuser",
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
          titre: decision === "approuve" ? "Congés approuvés" : "Congés refusés",
          message: `Du ${fiche.data.du} au ${fiche.data.au}.`,
          lien: { app: "conges" },
        });
      }
    } catch (e) {
      modal.alert({ title: "Décision impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cgsApp">
        <div className="cgsVerrou">Connectez-vous pour gérer vos congés.</div>
      </ModuleWindow>
    );
  }

  const VUES = [
    { id: "moi", label: "Mes congés", icone: "faUmbrellaBeach" },
    ...(peutValider
      ? [{ id: "validation", label: "À valider", icone: "faListCheck", compte: aValider.length }]
      : []),
    { id: "planning", label: "Planning d'équipe", icone: "faCalendarDays" },
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

        <div className="cgsCentre win11Scroll">
          <Contenu etat={etat} vide={false} lignes={4}>
            {vue === "moi" ? (
              !moi ? (
                <Vide
                  icone="faUserSlash"
                  titre="Aucune fiche salarié à votre nom"
                  aide={`Votre compte (${session.user?.email}) n'est relié à aucune fiche du dossier RH. Demandez à un responsable d'y renseigner votre adresse email.`}
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
  const maj = (patch) => setDemande((d) => ({ ...d, ...patch }));
  const jours = joursOuvrables(demande.du, demande.au, reglages);

  return (
    <div className="cgsMoi">
      {/* Le solde, en trois chiffres que tout le monde comprend. */}
      <div className="cgsSolde">
        <div className="cgsSoldeCase">
          <b>{solde.acquis}</b>
          <span>jours acquis</span>
        </div>
        <div className="cgsSoldeCase">
          <b>{solde.pris}</b>
          <span>jours pris</span>
        </div>
        <div className="cgsSoldeCase" data-fort="true">
          <b>{solde.solde}</b>
          <span>jours restants</span>
        </div>
        {solde.enAttente ? (
          <div className="cgsSoldeCase">
            <b>{solde.enAttente}</b>
            <span>en attente</span>
          </div>
        ) : null}
      </div>

      <div className="cgsBloc">
        <h3>Demander une absence</h3>
        <div className="cgsFormulaire">
          <Champ label="Type">
            <select value={demande.type} onChange={(e) => maj({ type: e.target.value })}>
              {Object.entries(TYPES_ABSENCE).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.label}
                  {t.decompte ? "" : " (hors solde)"}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Du">
            <input type="date" value={demande.du} onChange={(e) => maj({ du: e.target.value })} />
          </Champ>
          <Champ label="Au (inclus)">
            <input type="date" value={demande.au} min={demande.du} onChange={(e) => maj({ au: e.target.value })} />
          </Champ>
          <Champ label="Motif" aide="Facultatif">
            <input
              value={demande.motif}
              placeholder="Congés annuels, événement familial…"
              onChange={(e) => maj({ motif: e.target.value })}
            />
          </Champ>
        </div>
        <div className="cgsFormulairePied">
          <span className="cgsJours">
            {jours} jour{jours > 1 ? "s" : ""} ouvrable{jours > 1 ? "s" : ""}
          </span>
          <Bouton icone="faPaperPlane" off={occupe} onClick={onDeposer}>
            Déposer la demande
          </Bouton>
        </div>
      </div>

      <div className="cgsBloc">
        <h3>Mes demandes</h3>
        {!demandes.length ? (
          <p className="cgsAide">Aucune demande pour l'instant.</p>
        ) : (
          demandes.map((f) => {
            const e = ETATS_DEMANDE[f.data.etat] || {};
            return (
              <div key={f.id} className="cgsLigne">
                <span className="cgsLigneType">
                  {TYPES_ABSENCE[f.data.type]?.label || f.data.type}
                </span>
                <span className="cgsLigneDates">
                  du {f.data.du} au {f.data.au} —{" "}
                  {joursOuvrables(f.data.du, f.data.au, reglages)} j
                </span>
                <span className="cgsEtat" data-ton={e.ton}>
                  {e.label || f.data.etat}
                </span>
                {f.data.etat === "demande" ? (
                  <span className="cgsRetirer handcr" title="Retirer" onClick={() => onAnnuler(f)}>
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
  if (!demandes.length) {
    return (
      <Vide
        icone="faListCheck"
        titre="Rien à valider"
        aide="Les demandes de l'équipe apparaîtront ici, avec le solde de chacun."
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
              <span className="cgsCarteType">
                {TYPES_ABSENCE[f.data.type]?.label || f.data.type}
              </span>
            </div>
            <div className="cgsCarteDates">
              du {f.data.du} au {f.data.au} — <b>{jours} jour{jours > 1 ? "s" : ""} ouvrable{jours > 1 ? "s" : ""}</b>
              {solde ? ` · reste ${solde.solde} j au compteur` : ""}
            </div>
            {f.data.motif ? <div className="cgsCarteMotif">« {f.data.motif} »</div> : null}
            {depasse ? (
              <Notice ton="attention" icone="faTriangleExclamation">
                Cette demande dépasse le solde restant du salarié.
              </Notice>
            ) : null}
            <div className="cgsCarteActions">
              <Bouton icone="faCheck" off={occupe} onClick={() => onTrancher(f, "approuve")}>
                Approuver
              </Bouton>
              <Bouton
                variante="secondaire"
                icone="faXmark"
                off={occupe}
                onClick={() => onTrancher(f, "refuse")}
              >
                Refuser
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
  if (!planning.length) {
    return (
      <Vide
        icone="faCalendarDays"
        titre="Personne d'absent à l'horizon"
        aide="Les absences validées, en cours et à venir, s'affichent ici pour toute l'équipe."
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
            du {f.data.du} au {f.data.au} —{" "}
            {joursOuvrables(f.data.du, f.data.au, reglages)} j ·{" "}
            {TYPES_ABSENCE[f.data.type]?.label || f.data.type}
          </span>
          {f.data.du <= aujourdhui ? <span className="cgsEtat" data-ton="ok">en cours</span> : null}
        </div>
      ))}
    </div>
  );
};
