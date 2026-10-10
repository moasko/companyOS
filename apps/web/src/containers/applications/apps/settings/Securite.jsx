import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../api/client";
import { modal } from "../../../../apps/modalRequest";
import { CodesSecours, ConfigurationMfa } from "../../../../components/securite/ConfigurationMfa";
import { Row, Toggle } from "./commun";
import { ReglageSso } from "./Sso";

/// Un appareil lisible à partir de l'en-tête User-Agent : assez pour
/// reconnaître « mon téléphone » d'« un poste inconnu ».
const appareil = (agent = "") => {
  const a = String(agent);
  const nav = /Edg\//.test(a)
    ? "Edge"
    : /Chrome\//.test(a)
      ? "Chrome"
      : /Firefox\//.test(a)
        ? "Firefox"
        : /Safari\//.test(a)
          ? "Safari"
          : null;
  const os = /Windows/.test(a)
    ? "Windows"
    : /Android/.test(a)
      ? "Android"
      : /iPhone|iPad/.test(a)
        ? "iOS"
        : /Mac OS X/.test(a)
          ? "macOS"
          : /Linux/.test(a)
            ? "Linux"
            : null;
  return [nav, os].filter(Boolean).join(" · ") || "Appareil inconnu";
};

const quand = (date) =>
  new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const GRAVITES = {
  critique: "Critique",
  haute: "Haute",
  moyenne: "Moyenne",
  info: "Info",
};

/// Détection d'intrusion, vue de l'espace : les tentatives qui visent ses
/// comptes (mots de passe en série, codes erronés, nouveaux appareils,
/// refus en rafale). Les alertes graves sont aussi envoyées en
/// notification aux administrateurs. Voir apps/api/src/detection.js.
const AlertesSecurite = ({ flash }) => {
  const [donnees, setDonnees] = useState(null);
  const [toutes, setToutes] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDonnees(await api.securiteAlertes(toutes ? {} : { etat: "ouvertes" }));
    } catch (err) {
      flash(err.message);
    }
  }, [toutes, flash]);
  useEffect(() => {
    charger();
  }, [charger]);

  const traiter = async (a) => {
    try {
      await api.securiteTraiter(a.id);
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };
  const toutTraiter = async () => {
    try {
      const r = await api.securiteTraiterTout();
      flash(`${r.traitees} alerte${r.traitees > 1 ? "s" : ""} marquée${r.traitees > 1 ? "s" : ""} comme traitée${r.traitees > 1 ? "s" : ""}`);
      await charger();
    } catch (err) {
      flash(err.message);
    }
  };

  const alertes = donnees?.alertes || [];
  const jour = donnees?.resume?.jour || {};
  const graves = (jour.haute || 0) + (jour.critique || 0);

  return (
    <>
      <div className="setSubTitle">Alertes de sécurité</div>
      <p className="setHint">
        Tentatives d'intrusion visant les comptes de l'espace : mots de passe essayés en série,
        codes de double authentification erronés, connexions depuis un nouvel appareil, accès
        refusés en rafale. Les adresses qui attaquent sont bloquées automatiquement.
      </p>
      <Row
        title={
          graves
            ? `${graves} alerte${graves > 1 ? "s" : ""} grave${graves > 1 ? "s" : ""} ces dernières 24 h`
            : "Aucune alerte grave ces dernières 24 h"
        }
        desc={`${Object.values(jour).reduce((t, n) => t + n, 0)} alerte(s) au total sur 24 h`}
      >
        <div className="setActionsRow">
          <div className="setBtnGhost handcr" onClick={() => setToutes((v) => !v)}>
            {toutes ? "À traiter seulement" : "Voir l'historique"}
          </div>
          {!toutes && alertes.length ? (
            <div className="setBtnGhost handcr" onClick={toutTraiter}>
              Tout marquer comme traité
            </div>
          ) : null}
        </div>
      </Row>
      <div className="setList">
        {alertes.map((a) => (
          <div className="setRow setAlerte" key={a.id} data-gravite={a.gravite} data-traitee={!!a.traiteLe}>
            <div className="setRowText">
              <div className="setRowTitle">
                {a.titre} <span className="setBadge setGravite" data-gravite={a.gravite}>{GRAVITES[a.gravite] || a.gravite}</span>
              </div>
              <div className="setRowDesc">{a.message}</div>
              <div className="setRowDesc">
                {quand(a.creeLe)}
                {a.traiteLe ? ` · traitée par ${a.traitePar || "?"}` : ""}
              </div>
            </div>
            {!a.traiteLe ? (
              <div className="setBtnGhost handcr" onClick={() => traiter(a)}>
                Traitée
              </div>
            ) : null}
          </div>
        ))}
        {donnees && !alertes.length ? (
          <div className="setRow">
            <div className="setRowDesc">{toutes ? "Aucune alerte enregistrée." : "Rien à traiter."}</div>
          </div>
        ) : null}
      </div>
    </>
  );
};

/// Paramètres → Sécurité : double authentification, sessions ouvertes,
/// jetons d'outils, et (propriétaire) obligation dans tout l'espace.
export const SectionSecurite = ({ section, session, flash: flashParent }) => {
  // `flash` change à chaque rendu du parent : on garde la dernière version
  // sans en faire une dépendance (sinon le chargement bouclerait).
  const flashRef = useRef(flashParent);
  flashRef.current = flashParent;
  const flash = useCallback((m) => flashRef.current(m), []);
  const [etat, setEtat] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [configuration, setConfiguration] = useState(false);
  const [nouveauxCodes, setNouveauxCodes] = useState(null);
  const [desactivation, setDesactivation] = useState({ ouvert: false, password: "", code: "" });
  const [occupe, setOccupe] = useState(false);
  const visible = section === "securite";
  const proprietaire = session.user?.role === "OWNER";

  const charger = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api.mfa(), api.sessions()]);
      setEtat(m);
      setSessions(s);
    } catch (err) {
      flash(err.message);
    }
  }, [flash]);

  useEffect(() => {
    if (visible) charger();
  }, [visible, charger]);

  const regenererCodes = async () => {
    const code = await modal.prompt({
      title: "Nouveaux codes de secours",
      label: "Code à 6 chiffres de votre application",
      message: "Les codes actuels cesseront de fonctionner.",
      confirmLabel: "Générer",
    });
    if (!code) return;
    try {
      const r = await api.mfaCodes(code.trim());
      setNouveauxCodes(r.codesSecours);
      charger();
    } catch (err) {
      flash(err.message);
    }
  };

  const desactiver = async () => {
    setOccupe(true);
    try {
      await api.mfaDesactiver(desactivation.password, desactivation.code.trim());
      setDesactivation({ ouvert: false, password: "", code: "" });
      flash("Double authentification désactivée");
      charger();
    } catch (err) {
      flash(err.message);
    } finally {
      setOccupe(false);
    }
  };

  const basculerObligation = async () => {
    const exiger = !etat?.obligatoireEspace;
    if (exiger) {
      const ok = await modal.confirm({
        title: "Exiger la double authentification",
        message: "Tous les membres de l'espace devront l'activer.",
        detail:
          "À leur prochaine action, ceux qui ne l'ont pas encore verront l'écran de configuration ; rien d'autre ne leur sera accessible tant qu'ils ne l'auront pas faite.",
        confirmLabel: "Exiger",
      });
      if (!ok) return;
    }
    try {
      await api.mfaObligatoire(exiger);
      flash(exiger ? "Double authentification obligatoire pour l'espace" : "Double authentification facultative");
      charger();
    } catch (err) {
      flash(err.message);
    }
  };

  const fermer = async (s) => {
    const ok = await modal.confirm({
      title: s.actuelle ? "Fermer cette session" : "Fermer la session",
      message: s.actuelle
        ? "Vous serez déconnecté de ce navigateur."
        : `${s.type === "api" ? s.libelle || "Jeton d'outil" : appareil(s.agent)} sera déconnecté.`,
      confirmLabel: "Fermer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.fermerSession(s.id);
      if (s.actuelle) {
        window.location.reload();
        return;
      }
      flash("Session fermée");
      charger();
    } catch (err) {
      flash(err.message);
    }
  };

  return (
    <section className="setSection" data-hidden={!visible}>
      <h2>Sécurité</h2>
      <p className="setHint">Double authentification, appareils connectés et jetons d'outils</p>

      <div className="setSubTitle">Double authentification</div>
      <p className="setHint">
        En plus du mot de passe, un code à usage unique généré par une application sur votre
        téléphone. Un mot de passe volé ne suffit plus à entrer.
      </p>

      {nouveauxCodes ? (
        <div className="setCard">
          <CodesSecours
            codes={nouveauxCodes}
            email={session.user?.email}
            onTermine={() => setNouveauxCodes(null)}
            libelleFin="Terminé"
          />
        </div>
      ) : etat?.actif ? (
        <>
          <Row
            title={<span>Activée <span className="setBadge">Protégé</span></span>}
            desc={`${etat.codesRestants} code${etat.codesRestants > 1 ? "s" : ""} de secours restant${etat.codesRestants > 1 ? "s" : ""}`}
          >
            <div className="setActionsRow">
              <div className="setBtnGhost handcr" onClick={regenererCodes}>
                Nouveaux codes de secours
              </div>
              {!etat.exigee ? (
                <div
                  className="setBtnGhost setDanger handcr"
                  onClick={() => setDesactivation((d) => ({ ...d, ouvert: !d.ouvert }))}
                >
                  Désactiver
                </div>
              ) : null}
            </div>
          </Row>
          {desactivation.ouvert ? (
            <div className="setGrid">
              <label className="setField">
                <span className="setLabel">Mot de passe</span>
                <input
                  type="password"
                  value={desactivation.password}
                  onChange={(e) => setDesactivation((d) => ({ ...d, password: e.target.value }))}
                />
              </label>
              <label className="setField">
                <span className="setLabel">Code de l'application</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={desactivation.code}
                  onChange={(e) => setDesactivation((d) => ({ ...d, code: e.target.value }))}
                />
              </label>
              <div
                className="setPrimary setDanger handcr"
                data-off={occupe || !desactivation.password || !desactivation.code}
                onClick={desactiver}
              >
                Confirmer la désactivation
              </div>
            </div>
          ) : null}
        </>
      ) : configuration ? (
        <div className="setCard">
          <ConfigurationMfa
            email={session.user?.email}
            onActive={() => flash("Double authentification activée — vos autres appareils ont été déconnectés")}
            onTermine={() => {
              setConfiguration(false);
              charger();
            }}
          />
        </div>
      ) : (
        <Row title="Désactivée" desc="Recommandé pour tous les comptes, indispensable pour les administrateurs">
          <div className="setPrimary handcr" onClick={() => setConfiguration(true)}>
            Activer
          </div>
        </Row>
      )}

      {proprietaire && etat ? (
        <Row
          title="Exiger pour tout l'espace"
          desc={
            etat.actif || etat.obligatoireEspace
              ? "Chaque membre devra activer la double authentification pour accéder à l'espace."
              : "Activez-la d'abord sur votre propre compte."
          }
        >
          <Toggle
            on={!!etat.obligatoireEspace}
            onClick={etat.actif || etat.obligatoireEspace ? basculerObligation : undefined}
          />
        </Row>
      ) : null}

      {["OWNER", "ADMIN"].includes(session.user?.role) && visible ? <ReglageSso session={session} flash={flash} /> : null}

      {["OWNER", "ADMIN"].includes(session.user?.role) && visible ? <AlertesSecurite flash={flash} /> : null}

      <div className="setSubTitle">Sessions ouvertes</div>
      <p className="setHint">
        Chaque navigateur connecté et chaque jeton d'outil (serveur MCP…). Une session sans
        activité pendant 12 heures se ferme d'elle-même.
      </p>
      <div className="setList">
        {sessions.map((s) => (
          <div className="setRow" key={s.id}>
            <div className="setRowText">
              <div className="setRowTitle">
                {s.type === "api" ? `🔑 ${s.libelle || "Jeton d'outil"}` : appareil(s.agent)}
                {s.actuelle ? <span className="setBadge"> Cette session</span> : null}
                {s.mfa ? <span className="setBadge"> 2FA</span> : null}
              </div>
              <div className="setRowDesc">
                {s.ip ? `${s.ip} · ` : ""}
                Activité : {quand(s.vuLe)} · Ouverte le {quand(s.creeLe)}
                {s.type === "api" ? ` · Expire le ${quand(s.expireLe)}` : ""}
              </div>
            </div>
            <div className="setBtnGhost setDanger handcr" onClick={() => fermer(s)}>
              Fermer
            </div>
          </div>
        ))}
        {!sessions.length ? <div className="setRow"><div className="setRowDesc">Chargement…</div></div> : null}
      </div>
    </section>
  );
};
