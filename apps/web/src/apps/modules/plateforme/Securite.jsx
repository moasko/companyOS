import React, { useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Bouton, Notice } from "../../ui";

// Détection d'intrusion, vue de la plateforme : ce qui attaque, ce qui a
// été bloqué, et la main pour bloquer ou débloquer une adresse.
//
// Les règles vivent côté serveur (apps/api/src/detection.js) : force brute,
// bourrage d'identifiants, codes de double authentification erronés,
// recherche de failles, balayage, refus en rafale, nouvel appareil.

const GRAVITES = {
  critique: { libelle: "Critique", ton: "danger" },
  haute: { libelle: "Haute", ton: "danger" },
  moyenne: { libelle: "Moyenne", ton: "attention" },
  info: { libelle: "Info", ton: "ok" },
};

const quand = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const restant = (iso) => {
  const min = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} j`;
};

export const Securite = ({ securite, onRecharger }) => {
  const [filtre, setFiltre] = useState("ouvertes");
  const [blocage, setBlocage] = useState({ ip: "", heures: 24, motif: "" });
  const [occupe, setOccupe] = useState(false);
  const { alertes, resume, ipsBloquees } = securite;

  const visibles = alertes.filter((a) =>
    filtre === "ouvertes" ? !a.traiteLe : filtre === "graves" ? ["haute", "critique"].includes(a.gravite) : true,
  );
  const jour = resume.jour || {};
  const etat = resume.ouvertesGraves
    ? { ton: "danger", texte: `${resume.ouvertesGraves} alerte${resume.ouvertesGraves > 1 ? "s" : ""} grave${resume.ouvertesGraves > 1 ? "s" : ""} à traiter` }
    : { ton: "ok", texte: "Aucune alerte grave en attente" };

  const agir = async (fn, titreErreur) => {
    setOccupe(true);
    try {
      await fn();
      await onRecharger();
    } catch (e) {
      modal.alert({ title: titreErreur, message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const bloquer = () =>
    agir(async () => {
      await api.plateformeBloquerIp({
        ip: blocage.ip.trim(),
        heures: Number(blocage.heures) || 24,
        ...(blocage.motif.trim() ? { motif: blocage.motif.trim() } : {}),
      });
      setBlocage({ ip: "", heures: 24, motif: "" });
    }, "Blocage impossible");

  const debloquer = async (b) => {
    const ok = await modal.confirm({
      title: `Débloquer ${b.ip} ?`,
      message: `Bloquée pour : ${b.motif}.`,
      detail: "Ses compteurs repartent de zéro : si l'activité reprend, elle sera bloquée de nouveau, plus longtemps.",
      confirmLabel: "Débloquer",
    });
    if (ok) agir(() => api.plateformeDebloquerIp(b.ip), "Déblocage impossible");
  };

  return (
    <>
      <header className="pltTete">
        <div>
          <h2>Sécurité</h2>
          <p className="pltAide">
            Les tentatives d'intrusion repérées sur la plateforme et les adresses bloquées. Les
            administrateurs des espaces concernés sont prévenus des alertes graves.
          </p>
        </div>
      </header>

      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Dernières 24 heures</h3>
            <p className="pltAide">
              Force brute, bourrage d'identifiants, codes de double authentification erronés,
              recherche de failles, balayage, accès refusés en série, nouveaux appareils.
            </p>
          </div>
          <span className="pltPastilleEtat" data-ton={etat.ton}>
            {etat.texte}
          </span>
        </div>
        <div className="pltRepartition">
          {["critique", "haute", "moyenne", "info"].map((g) => (
            <div className="pltRepartCase" key={g}>
              <small>{GRAVITES[g].libelle}</small>
              <b>{jour[g] || 0}</b>
              <small>alerte{(jour[g] || 0) > 1 ? "s" : ""}</small>
            </div>
          ))}
          <div className="pltRepartCase">
            <small>Adresses bloquées</small>
            <b>{ipsBloquees.length}</b>
            <small>en ce moment</small>
          </div>
        </div>
        {resume.semaine?.length ? (
          <p className="pltAide pltSecSemaine">
            Sur 7 jours :{" "}
            {resume.semaine
              .slice(0, 6)
              .map((t) => `${t.titre.toLowerCase()} (${t.n})`)
              .join(", ")}
            .
          </p>
        ) : null}
      </section>

      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Alertes</h3>
            <p className="pltAide">Les 300 plus récentes. « Traitée » la retire des alertes à traiter.</p>
          </div>
          <div className="pltSecFiltres" role="tablist">
            {[
              ["ouvertes", "À traiter"],
              ["graves", "Graves"],
              ["toutes", "Toutes"],
            ].map(([id, libelle]) => (
              <button key={id} type="button" role="tab" aria-selected={filtre === id} data-actif={filtre === id} onClick={() => setFiltre(id)}>
                {libelle}
              </button>
            ))}
          </div>
        </div>
        {visibles.length ? (
          <div className="pltTableEnveloppe">
            <table className="pltTable pltSecTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Gravité</th>
                  <th>Alerte</th>
                  <th>Espace</th>
                  <th>Adresse</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.map((a) => (
                  <tr key={a.id} data-alerte={["haute", "critique"].includes(a.gravite) && !a.traiteLe ? "danger" : undefined}>
                    <td className="pltNom">
                      <span>{quand(a.creeLe)}</span>
                    </td>
                    <td>
                      <span className="pltPastilleEtat" data-ton={GRAVITES[a.gravite]?.ton}>
                        {GRAVITES[a.gravite]?.libelle || a.gravite}
                      </span>
                    </td>
                    <td className="pltSecAlerte">
                      <strong>{a.titre}</strong>
                      <small>{a.message}</small>
                    </td>
                    <td>{a.espace || "Plateforme"}</td>
                    <td>
                      <code>{a.ip || "—"}</code>
                    </td>
                    <td>
                      {a.traiteLe ? (
                        <small title={`par ${a.traitePar || "?"}`}>Traitée</small>
                      ) : (
                        <button type="button" className="pltLien" disabled={occupe} onClick={() => agir(() => api.plateformeSecuriteTraiter(a.id), "Action impossible")}>
                          Traitée
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pltRien">
            <Icon fafa="faShieldHalved" width={12} /> Rien à signaler.
          </p>
        )}
      </section>

      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Adresses bloquées</h3>
            <p className="pltAide">
              Bloquées 1 h à la première alerte, puis 6 h, 24 h et 7 jours en cas de récidive.
              Une adresse bloquée reçoit un refus sur toute l'API.
            </p>
          </div>
        </div>
        {ipsBloquees.length ? (
          <div className="pltTableEnveloppe">
            <table className="pltTable">
              <thead>
                <tr>
                  <th>Adresse</th>
                  <th>Motif</th>
                  <th>Reste</th>
                  <th>Origine</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ipsBloquees.map((b) => (
                  <tr key={b.ip}>
                    <td className="pltNom">
                      <code>{b.ip}</code>
                    </td>
                    <td>{b.motif}</td>
                    <td title={quand(b.jusqua)}>{restant(b.jusqua)}</td>
                    <td>{b.manuel ? `Manuel${b.parEmail ? ` · ${b.parEmail}` : ""}` : `Automatique${b.recidives ? ` · récidive ${b.recidives}` : ""}`}</td>
                    <td>
                      <button type="button" className="pltLien" disabled={occupe} onClick={() => debloquer(b)}>
                        Débloquer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pltRien">Aucune adresse bloquée.</p>
        )}

        <div className="pltSecBloquer">
          <input
            type="text"
            placeholder="Adresse IP (ex. 203.0.113.7)"
            aria-label="Adresse IP à bloquer"
            value={blocage.ip}
            onChange={(e) => setBlocage((b) => ({ ...b, ip: e.target.value }))}
          />
          <select aria-label="Durée" value={blocage.heures} onChange={(e) => setBlocage((b) => ({ ...b, heures: Number(e.target.value) }))}>
            <option value={1}>1 heure</option>
            <option value={24}>24 heures</option>
            <option value={168}>7 jours</option>
            <option value={720}>30 jours</option>
          </select>
          <input
            type="text"
            placeholder="Motif (facultatif)"
            aria-label="Motif du blocage"
            value={blocage.motif}
            maxLength={200}
            onChange={(e) => setBlocage((b) => ({ ...b, motif: e.target.value }))}
          />
          <Bouton icone="faBan" off={occupe || !blocage.ip.trim()} onClick={bloquer}>
            Bloquer
          </Bouton>
        </div>
        <Notice ton="info" icone="faCircleInfo">
          Les adresses de supervision ou de vos bureaux peuvent être exemptées des blocages
          automatiques avec la variable <code>IDS_IPS_CONFIANCE</code>.
        </Notice>
      </section>
    </>
  );
};
