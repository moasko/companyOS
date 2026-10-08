import React from "react";
import { Icon } from "../../../../utils/general";
import { moduleBySlug } from "../../../../apps/sync";

/// Ce que dit la règle d'accès, en une phrase courte.
const libelleAcces = (acces) => {
  if (!acces || acces.mode === "membres") return "Tous les membres";
  if (acces.mode === "admins") return "Administrateurs seulement";
  const n = acces.membres?.length || 0;
  return n
    ? `Administrateurs et ${n} membre${n > 1 ? "s" : ""} choisi${n > 1 ? "s" : ""}`
    : "Personnes choisies : aucune pour l'instant";
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
          e.target.value === "selection"
            ? { mode: "selection", membres: acces.membres || [] }
            : { mode: e.target.value },
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
    changerAcces(app, { mode: "selection", membres: [...suivants] });
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
        ? " Choisissez qui peut ouvrir chacun : les administrateurs y ont toujours accès. La Paie et les RH sont réservées aux administrateurs tant que vous n'en décidez pas autrement."
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
            </div>
          ))}
        </div>
      </div>
    ))}
  </section>
);
