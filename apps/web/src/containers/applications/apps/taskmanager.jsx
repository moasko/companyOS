// Moniteur du système — anciennement « gestionnaire de tâches ».
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI A CHANGÉ
//
// L'ancien affichait une liste de processus avec des colonnes CPU, mémoire,
// disque, réseau et « consommation d'énergie » — toutes remplies par
// `Math.random()`. Des chiffres qui dansaient à chaque rafraîchissement
// sans mesurer quoi que ce soit. Sept onglets en anglais dont un seul
// faisait quelque chose, et ce qu'il faisait était faux.
//
// Une page web n'a pas accès au CPU de la machine ; le prétendre était le
// vrai problème. Ce moniteur ne montre que ce qu'il peut prouver : les
// fenêtres réellement ouvertes de l'OS, le stockage réel de l'espace de
// travail, la session en cours. Les règles sont dans
// src/apps/modules/_moniteur/domaine.js, éprouvées seules.
//
// Il garde sa fenêtre héritée (état `state.apps.taskmanager`, action
// TASKMANAGER) : seul son contenu est refait.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { ToolBar, Icon } from "../../../utils/general";
import { useNomApp } from "../../../utils/nomsApps";
import { api } from "../../../api/client";
import { fenetre } from "../../../apps/windows";
import { modal } from "../../../apps/modalRequest";
import * as D from "../../../apps/modules/_moniteur/domaine";
import "./assets/taskmanager.scss";

const ONGLETS = [
  { id: "fenetres", label: "Fenêtres", icone: "faWindowRestore" },
  { id: "stockage", label: "Stockage", icone: "faHardDrive" },
  { id: "systeme", label: "Système", icone: "faCircleInfo" },
];

export const Taskmanager = () => {
  const nomApp = useNomApp();
  const wnapp = useSelector((state) => state.apps.taskmanager);
  const apps = useSelector((state) => state.apps);
  const session = useSelector((state) => state.session);

  const [onglet, setOnglet] = useState("fenetres");
  const [nav, setNav] = useState("open");
  const [usage, setUsage] = useState(null);
  const [memoire, setMemoire] = useState(null);

  const ouvert = wnapp && !wnapp.hide;

  // La consommation de l'espace de travail se relit à chaque ouverture, et
  // toutes les cinq secondes tant que la fenêtre est là : une caisse ou un
  // import peut la faire bouger pendant qu'on regarde.
  useEffect(() => {
    if (!ouvert) return undefined;
    const rafraichir = () => {
      api.usage().then(setUsage).catch(() => {});
      setMemoire(D.memoire());
    };
    rafraichir();
    const t = setInterval(rafraichir, 5000);
    return () => clearInterval(t);
  }, [ouvert]);

  const fenetres = D.fenetresOuvertes(apps);

  const fermer = (id) => fenetre(id, "close");
  const afficher = (id) => fenetre(id, "front");


  return (
    <div
      className="taskmanagerApp floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{
        ...(wnapp.size == "cstm" ? wnapp.dim : null),
        zIndex: wnapp.z,
      }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={nomApp("taskmanager")}
      />
      <div className="windowScreen flex flex-col" data-dock="true">
        <div className="restWindow flex-grow flex flex-col">
          <nav className={nav}>
            {ONGLETS.map((t) => (
              <div
                key={t.id}
                className={`navLink ${t.id === onglet ? "selected" : ""}`}
                onClick={() => setOnglet(t.id)}
              >
                <Icon className="mx-2" fafa={t.icone} />
                <span className="tabName">{t.label}</span>
              </div>
            ))}
            <div className="marker" />
          </nav>

          <main className="cosScroll">
            {onglet === "fenetres" ? (
              <Fenetres
                fenetres={fenetres}
                onAfficher={afficher}
                onFermer={fermer}
              />
            ) : onglet === "stockage" ? (
              <Stockage usage={usage} memoire={memoire} />
            ) : (
              <Systeme session={session} nbApps={fenetres.length} usage={usage} />
            )}
          </main>

          <div className="navMenuBtn" onClick={() => setNav(nav ? "" : "open")}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 48 48"
              width={24}
              height={24}
            >
              <path d="M5.5 9a1.5 1.5 0 1 0 0 3h37a1.5 1.5 0 1 0 0-3h-37zm0 13.5a1.5 1.5 0 1 0 0 3h37a1.5 1.5 0 1 0 0-3h-37zm0 13.5a1.5 1.5 0 1 0 0 3h37a1.5 1.5 0 1 0 0-3h-37z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Fenêtres ouvertes
// ---------------------------------------------------------------------------

const Fenetres = ({ fenetres, onAfficher, onFermer }) => (
  <div className="tmBloc">
    <h3>Applications ouvertes</h3>
    {fenetres.length ? (
      <table className="tmTable">
        <thead>
          <tr>
            <th>Application</th>
            <th>État</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {fenetres.map((f) => (
            <tr key={f.id}>
              <td className="tmNom">
                <Icon src={f.icone} width={18} />
                <span>{f.nom}</span>
              </td>
              <td className="tmEtat">{f.agrandie ? "Plein écran" : "Fenêtrée"}</td>
              <td className="tmActions">
                <span className="tmLien handcr" onClick={() => onAfficher(f.id)}>
                  Afficher
                </span>
                {/* Le moniteur ne ferme pas sa propre fenêtre : on ne se
                    coupe pas la branche sur laquelle on est assis. */}
                {f.id !== "taskmanager" ? (
                  <span
                    className="tmLien tmDanger handcr"
                    onClick={() => onFermer(f.id)}
                  >
                    Fermer
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="tmVide">Aucune application ouverte pour le moment.</p>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Stockage
// ---------------------------------------------------------------------------

const Stockage = ({ usage, memoire }) => (
  <div className="tmBloc">
    <h3>Stockage de l'espace de travail</h3>
    {usage ? (
      <>
        <Jauge
          part={D.part(usage.usedBytes, usage.quota)}
          gauche={`${D.octets(usage.usedBytes)} utilisés`}
          droite={`sur ${D.octets(usage.quota)}`}
        />
        <p className="tmHint">
          Ce que tous les fichiers de l'entreprise occupent — imports,
          exports, documents, pièces jointes. Il reste{" "}
          {D.octets(usage.availableBytes)}.
        </p>
      </>
    ) : (
      <p className="tmVide">Consommation indisponible.</p>
    )}

    {memoire ? (
      <>
        <h3 style={{ marginTop: 18 }}>Mémoire de CompanyOS</h3>
        <Jauge
          part={memoire.part}
          gauche={`${D.octets(memoire.utilisee)} en usage`}
          droite={`limite ${D.octets(memoire.limite)}`}
        />
        <p className="tmHint">
          La mémoire que cet onglet occupe dans le navigateur — pas celle de
          la machine, qu'une page web ne peut pas mesurer.
        </p>
      </>
    ) : null}
  </div>
);

const Jauge = ({ part, gauche, droite }) => (
  <div className="tmJauge">
    <div className="tmJaugeBarre">
      <span
        className="tmJaugeRemplie"
        data-alerte={part > 0.9}
        style={{ width: `${Math.round(part * 100)}%` }}
      />
    </div>
    <div className="tmJaugeLegende">
      <span>{gauche}</span>
      <span>{droite}</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Système
// ---------------------------------------------------------------------------

const Systeme = ({ session, nbApps, usage }) => {
  const lignes = [
    { label: "Espace de travail", valeur: session.tenant?.name || "—" },
    { label: "Connecté", valeur: session.user?.name || "—" },
    { label: "Rôle", valeur: session.user?.role || "—" },
    { label: "Fenêtres ouvertes", valeur: String(nbApps) },
    {
      label: "Stockage utilisé",
      valeur: usage ? `${D.octets(usage.usedBytes)} / ${D.octets(usage.quota)}` : "—",
    },
    { label: "Navigateur", valeur: navigator.language || "—" },
  ];
  return (
    <div className="tmBloc">
      <h3>Informations</h3>
      <table className="tmTable tmInfos">
        <tbody>
          {lignes.map((l) => (
            <tr key={l.label}>
              <td className="tmInfoLabel">{l.label}</td>
              <td>{l.valeur}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tmHint">
        CompanyOS s'exécute entièrement dans votre navigateur. Les seules
        données qui quittent l'appareil sont celles que vous enregistrez dans
        le cloud de l'espace de travail.
      </p>
    </div>
  );
};
