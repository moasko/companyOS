import React from "react";
import { Icon } from "../../../../utils/general";
import { moduleBySlug } from "../../../../apps/sync";

export const SectionApplications = ({
  section,
  parCategorie,
  nomApp,
  busy,
  dispatch,
  desinstaller,
}) => (
  <section className="setSection" data-hidden={section !== "applications"}>
    <h2>Applications</h2>
    <p className="setHint">Modules installés dans cet espace de travail</p>

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
            <div key={a.slug} className="setAppRow">
              <Icon src={a.icon} width={22} />
              <div className="setAppInfo">
                <div className="setAppName">{nomApp(a)}</div>
                <div className="setAppMeta">
                  v{a.version}
                  {a.kind === "CUSTOM" ? " · créée dans le Studio" : ""}
                  {a.kind === "NATIVE" && !moduleBySlug[a.slug] && !a.isCore
                    ? " · module à venir"
                    : ""}
                </div>
              </div>
              {a.isCore ? (
                <div className="setBadge">Socle</div>
              ) : (
                <div
                  className="setBtnGhost setDanger handcr"
                  data-off={busy}
                  onClick={() => desinstaller(a)}
                >
                  Désinstaller
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    ))}
  </section>
);
