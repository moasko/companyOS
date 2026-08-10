import React from "react";
import { Icon } from "../../../../utils/general";
import { formatBytes } from "./commun";

export const SectionStockage = ({
  section,
  usage,
  pctStockage,
  dossiers,
  dispatch,
}) => (
  <section className="setSection" data-hidden={section !== "stockage"}>
    <h2>Stockage</h2>
    <p className="setHint">Espace consommé par l'espace de travail</p>

    <div className="setCard">
      <div className="setStorageHead">
        <span>{usage ? formatBytes(usage.usedBytes) : "—"} utilisés</span>
        <span className="setMuted">
          sur {usage ? formatBytes(usage.quota) : "—"}
        </span>
      </div>
      <div className="setStorageBar">
        <div
          className="setStorageFill"
          data-alert={pctStockage > 85}
          style={{ width: `${Math.max(pctStockage, 0.5)}%` }}
        />
      </div>
      <div className="setStorageFree">
        {usage ? formatBytes(usage.availableBytes) : "—"} disponibles
      </div>
    </div>

    <div className="setSubTitle">Dossiers à la racine</div>
    {dossiers.length === 0 ? (
      <div className="setEmptyBox">Aucun dossier pour l'instant.</div>
    ) : (
      <div className="setList">
        {dossiers.map((d) => (
          <div key={d.id} className="setAppRow">
            <Icon src="win/folder" width={20} />
            <div className="setAppInfo">
              <div className="setAppName">{d.name}</div>
            </div>
            <div
              className="setBtnGhost handcr"
              onClick={() => dispatch({ type: "EXPLORER", payload: "full" })}
            >
              Ouvrir
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);
