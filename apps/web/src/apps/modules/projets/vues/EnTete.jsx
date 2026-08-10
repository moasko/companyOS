// L'en-tête du tableau : son nom, le choix de la vue, les filtres, les
// actions, puis la ligne d'indicateurs.
//
// Les filtres sont communs aux trois vues : on les pose une fois, et on
// passe de la planche à la liste ou à l'échéancier sans les reposer.

import React from "react";
import { Icon } from "../../../../utils/general";
import { ETIQUETTES, FILTRE_VIDE, filtreActif } from "../board";

const VUES = [
  { id: "tableau", label: "Tableau", icone: "faTableColumns" },
  { id: "liste", label: "Liste", icone: "faListUl" },
  { id: "echeances", label: "Échéances", icone: "faCalendarDay" },
];

export const EnTete = ({
  tableau,
  renommerTableau,
  vue,
  setVue,
  filtre,
  setFiltre,
  membres,
  exporter,
  supprimerTableau,
  stats,
}) => (
  <>
    <div className="pjTete">
      <span
        className="pjPuce"
        style={{ background: tableau.data.couleur }}
      />
      <span
        className="pjNom"
        onClick={renommerTableau}
        title="Renommer"
      >
        {tableau.data.nom}
      </span>

      <div className="pjVues">
        {VUES.map((v) => (
          <span
            key={v.id}
            className="pjVue"
            data-actif={vue === v.id ? "true" : "false"}
            onClick={() => setVue(v.id)}
          >
            <Icon fafa={v.icone} width={11} />
            {v.label}
          </span>
        ))}
      </div>

      <div className="pjSpacer" />

      <input
        className="pjRecherche"
        placeholder="Rechercher…"
        value={filtre.texte}
        onChange={(e) =>
          setFiltre((f) => ({ ...f, texte: e.target.value }))
        }
      />
      <select
        className="pjFiltre"
        value={filtre.etiquette || ""}
        onChange={(e) =>
          setFiltre((f) => ({
            ...f,
            etiquette: e.target.value || null,
          }))
        }
      >
        <option value="">Étiquette</option>
        {ETIQUETTES.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nom}
          </option>
        ))}
      </select>
      <select
        className="pjFiltre"
        value={filtre.membre || ""}
        onChange={(e) =>
          setFiltre((f) => ({
            ...f,
            membre: e.target.value || null,
          }))
        }
      >
        <option value="">Membre</option>
        {membres.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <span
        className="pjBascule"
        data-actif={filtre.retardSeulement ? "true" : "false"}
        onClick={() =>
          setFiltre((f) => ({
            ...f,
            retardSeulement: !f.retardSeulement,
          }))
        }
      >
        En retard
      </span>
      {filtreActif(filtre) ? (
        <span
          className="pjBascule"
          onClick={() => setFiltre(FILTRE_VIDE)}
        >
          Effacer
        </span>
      ) : null}

      {/* `Icon` ne transmet pas l'attribut `title` : l'infobulle
          est portée par l'enveloppe. */}
      <span title="Exporter en CSV vers le cloud">
        <Icon
          className="pjAction"
          fafa="faFileCsv"
          width={13}
          onClick={exporter}
        />
      </span>
      <span title="Supprimer le tableau">
        <Icon
          className="pjAction"
          fafa="faTrashCan"
          width={13}
          onClick={supprimerTableau}
        />
      </span>
    </div>

    <div className="pjStats">
      <span>
        <b>{stats.total}</b> carte{stats.total > 1 ? "s" : ""}
      </span>
      <span>
        <b>{stats.terminees}</b> terminée
        {stats.terminees > 1 ? "s" : ""}
      </span>
      <span data-alerte={stats.enRetard ? "true" : "false"}>
        <b>{stats.enRetard}</b> en retard
      </span>
      <span>
        <b>{stats.sansAssigne}</b> non assignée
        {stats.sansAssigne > 1 ? "s" : ""}
      </span>
      <div
        className="pjJauge"
        title={`${stats.avancement} % terminé`}
      >
        <div style={{ width: `${stats.avancement}%` }} />
      </div>
      <span className="pjPourcent">{stats.avancement} %</span>
    </div>
  </>
);
