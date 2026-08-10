import React from "react";
import { Row, Toggle } from "./commun";

export const SectionBureau = ({
  section,
  desktop,
  taskbar,
  tailleIcones,
  dispatch,
  flash,
}) => (
  <section className="setSection" data-hidden={section !== "bureau"}>
    <h2>Bureau et barre des tâches</h2>
    <p className="setHint">Disposition des icônes et de la barre</p>

    <Row title="Afficher les icônes du bureau">
      <Toggle
        on={!desktop.hide}
        onClick={() => dispatch({ type: "DESKTOGG" })}
      />
    </Row>

    <Row title="Taille des icônes">
      <div className="setChips">
        {[
          { id: "small", label: "Petite", val: 1 },
          { id: "medium", label: "Moyenne", val: 1.2 },
          { id: "large", label: "Grande", val: 1.5 },
        ].map((t) => (
          <div
            key={t.id}
            className="setChip handcr"
            data-active={tailleIcones === t.id}
            onClick={() => dispatch({ type: "DESKSIZE", payload: t.val })}
          >
            {t.label}
          </div>
        ))}
      </div>
    </Row>

    <Row
      title="Disposition des icônes"
      desc="Les icônes se déplacent à la souris ; leur position est retenue"
    >
      <div
        className="setBtnGhost handcr"
        onClick={() => {
          dispatch({ type: "DESKLAYOUT_RESET" });
          flash("Icônes réorganisées en colonnes");
        }}
      >
        Réorganiser
      </div>
    </Row>

    <div className="setSubTitle">Barre des tâches</div>

    <Row title="Alignement des icônes">
      <div className="setChips">
        {[
          { id: "left", label: "À gauche", action: "TASKLEF" },
          { id: "center", label: "Au centre", action: "TASKCEN" },
        ].map((t) => (
          <div
            key={t.id}
            className="setChip handcr"
            data-active={taskbar.align === t.id}
            onClick={() => dispatch({ type: t.action })}
          >
            {t.label}
          </div>
        ))}
      </div>
    </Row>

    <Row title="Afficher la recherche">
      <Toggle
        on={taskbar.search}
        onClick={() =>
          dispatch({
            type: "TASKSRCH",
            payload: String(!taskbar.search),
          })
        }
      />
    </Row>
  </section>
);
