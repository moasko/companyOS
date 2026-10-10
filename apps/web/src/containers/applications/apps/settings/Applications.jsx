import React from "react";
import { Icon } from "../../../../utils/general";
import { moduleBySlug } from "../../../../apps/sync";

/// Ce que dit la règle d'accès, en une phrase courte.
const libelleOuverture = (acces) => {
  if (!acces || acces.mode === "membres") return "Tous les membres";
  if (acces.mode === "admins") return "Administrateurs seulement";
  const n = acces.membres?.length || 0;
  return n
    ? `Administrateurs et ${n} membre${n > 1 ? "s" : ""} choisi${n > 1 ? "s" : ""}`
    : "Personnes choisies : aucune pour l'instant";
};

const libelleEcriture = (acces) => {
  const e = acces?.ecriture;
  if (!e || e.mode === "tous" || acces?.mode === "admins") return "";
  if (e.mode === "admins") return " · lecture seule pour les membres";
  const n = e.membres?.length || 0;
  return ` · modification : administrateurs${n ? ` et ${n} membre${n > 1 ? "s" : ""}` : ""}`;
};

const libelleAcces = (acces) => `${libelleOuverture(acces)}${libelleEcriture(acces)}`;

/// Une règle complète, à partir de l'actuelle et d'un changement : ouvrir
/// à d'autres ne doit pas effacer la règle de modification, et l'inverse.
const regleAvec = (acces, patch) => {
  const base = acces || { mode: "membres" };
  const suivante = { mode: base.mode, ...(base.mode === "selection" ? { membres: base.membres || [] } : {}), ...(base.ecriture ? { ecriture: base.ecriture } : {}), ...patch };
  if (suivante.mode !== "selection") delete suivante.membres;
  if (!suivante.ecriture || suivante.ecriture.mode === "tous") delete suivante.ecriture;
  return suivante;
};

/// Le choix de la règle, dans la ligne de l'application.
const ChoixRegle = ({ app, busy, changerAcces }) => {
  const acces = app.acces || { mode: "membres" };
  return (
    <select
      className="setRole"
      value={acces.mode}
      disabled={busy}
      aria-label={`Qui peut ouvrir ${app.name}`}
      onChange={(e) =>
        changerAcces(
          app,
          regleAvec(acces, e.target.value === "selection" ? { mode: "selection", membres: acces.membres || [] } : { mode: e.target.value }),
        )
      }
    >
      <option value="membres">Tous les membres</option>
      <option value="admins">Administrateurs</option>
      <option value="selection">Personnes choisies</option>
    </select>
  );
};

/// La liste des membres à cocher, sous la ligne, quand on choisit nommément.
///
/// Les administrateurs n'y figurent pas : ils ont toujours accès, les cocher
/// ou non ne changerait rien — les montrer laisserait croire le contraire.
const ChoixMembres = ({ app, membres, busy, changerAcces }) => {
  const simples = membres.filter((m) => m.role === "MEMBER");
  const choisis = new Set(app.acces?.membres || []);

  const basculer = (id) => {
    const suivants = new Set(choisis);
    if (suivants.has(id)) suivants.delete(id);
    else suivants.add(id);
    changerAcces(app, regleAvec(app.acces, { mode: "selection", membres: [...suivants] }));
  };

  return (
    <div className="setAccesChoix">
      {simples.length ? (
        simples.map((m) => (
          <label key={m.id} className="setAccesMembre">
            <input
              type="checkbox"
              checked={choisis.has(m.id)}
              disabled={busy}
              onChange={() => basculer(m.id)}
            />
            <span>{m.name}</span>
            <em>{m.email}</em>
          </label>
        ))
      ) : (
        <p className="setHint">
          Aucun membre simple dans l'espace : seuls les administrateurs y ont accès
          pour l'instant.
        </p>
      )}
    </div>
  );
};

/// Qui peut modifier, parmi ceux qui ont accès : « lecture seule » pour
/// les autres. Sans objet quand l'app est réservée aux administrateurs.
const ChoixEcriture = ({ app, membres, busy, changerAcces }) => {
  const acces = app.acces || { mode: "membres" };
  const e = acces.ecriture || { mode: "tous" };
  const simples = membres.filter((m) => m.role === "MEMBER" && (acces.mode !== "selection" || (acces.membres || []).includes(m.id)));
  const choisis = new Set(e.membres || []);
  return (
    <div className="setAccesChoix setAccesEcriture">
      <label className="setAccesLigne">
        <span>Modification des données</span>
        <select
          className="setRole"
          value={e.mode}
          disabled={busy}
          aria-label={`Qui peut modifier les données de ${app.name}`}
          onChange={(ev) =>
            changerAcces(app, regleAvec(acces, { ecriture: ev.target.value === "selection" ? { mode: "selection", membres: e.membres || [] } : { mode: ev.target.value } }))
          }
        >
          <option value="tous">Tous ceux qui y ont accès</option>
          <option value="admins">Administrateurs (lecture seule pour les autres)</option>
          <option value="selection">Personnes choisies</option>
        </select>
      </label>
      {e.mode === "selection"
        ? simples.map((m) => (
            <label key={m.id} className="setAccesMembre">
              <input
                type="checkbox"
                checked={choisis.has(m.id)}
                disabled={busy}
                onChange={() => {
                  const suivants = new Set(choisis);
                  if (suivants.has(m.id)) suivants.delete(m.id);
                  else suivants.add(m.id);
                  changerAcces(app, regleAvec(acces, { ecriture: { mode: "selection", membres: [...suivants] } }));
                }}
              />
              <span>{m.name}</span>
              <em>{m.email}</em>
            </label>
          ))
        : null}
    </div>
  );
};

export const SectionApplications = ({
  section,
  parCategorie,
  nomApp,
  busy,
  dispatch,
  desinstaller,
  peutGerer,
  membres = [],
  changerAcces,
}) => (
  <section className="setSection" data-hidden={section !== "applications"}>
    <h2>Applications</h2>
    <p className="setHint">
      Modules installés dans cet espace de travail.
      {peutGerer
        ? " Choisissez qui peut ouvrir chacun, puis qui peut en modifier les données (les autres consultent en lecture seule). Les administrateurs ont toujours tous les droits. La Paie et les RH sont réservées aux administrateurs tant que vous n'en décidez pas autrement."
        : ""}
    </p>

    <div className="setActionsRow">
      <div
        className="setBtnGhost handcr"
        onClick={() => dispatch({ type: "WNSTORE", payload: "full" })}
      >
        Ouvrir la Boutique
      </div>
      <div
        className="setBtnGhost handcr"
        onClick={() => dispatch({ type: "STUDIOAPP", payload: "full" })}
      >
        Créer une application
      </div>
    </div>

    {parCategorie.map(([categorie, liste]) => (
      <div key={categorie}>
        <div className="setSubTitle">{categorie}</div>
        <div className="setList">
          {liste.map((a) => (
            <div key={a.slug} className="setAppBloc">
              <div className="setAppRow">
                <Icon src={a.icon} width={22} />
                <div className="setAppInfo">
                  <div className="setAppName">{nomApp(a)}</div>
                  <div className="setAppMeta">
                    v{a.version}
                    {a.kind === "CUSTOM" ? " · créée dans le Studio" : ""}
                    {a.kind === "NATIVE" && !moduleBySlug[a.slug] && !a.isCore
                      ? " · module à venir"
                      : ""}
                    {a.isCore ? "" : ` · ${libelleAcces(a.acces)}`}
                  </div>
                </div>
                {a.isCore ? (
                  <div className="setBadge">Socle</div>
                ) : (
                  <>
                    {peutGerer ? (
                      <ChoixRegle app={a} busy={busy} changerAcces={changerAcces} />
                    ) : null}
                    {peutGerer ? (
                      <div
                        className="setBtnGhost setDanger handcr"
                        data-off={busy}
                        onClick={() => desinstaller(a)}
                      >
                        Désinstaller
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              {peutGerer && !a.isCore && a.acces?.mode === "selection" ? (
                <ChoixMembres
                  app={a}
                  membres={membres}
                  busy={busy}
                  changerAcces={changerAcces}
                />
              ) : null}
              {peutGerer && !a.isCore && a.acces?.mode !== "admins" ? (
                <ChoixEcriture app={a} membres={membres} busy={busy} changerAcces={changerAcces} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    ))}
  </section>
);
