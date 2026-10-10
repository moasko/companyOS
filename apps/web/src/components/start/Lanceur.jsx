import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ouvrirCorbeille } from "../../apps/explorerRequest";
import { fenetre } from "../../apps/windows";
import { modulesSysteme } from "../../apps/registry";
import { Icon } from "../../utils/general";
import { useNomApp } from "../../utils/nomsApps";
import { useTelephone } from "../../utils/telephone";
import { Ligne, dateDuJour, useLignesDuJour } from "./Aujourdhui";
import "./lanceur.scss";

// Le shell sur un téléphone.
//
// Un écran de 390 px ne porte ni fenêtres flottantes ni barre des tâches :
// les fenêtres débordaient, les icônes de la barre se chevauchaient. On
// reprend donc la logique que tout le monde connaît sur son téléphone :
//
//   - un **lanceur** plein écran : ce qui compte aujourd'hui, puis la
//     grille des applications ;
//   - **une application à la fois**, en plein écran (voir lanceur.scss) ;
//   - une **barre du bas** : revenir à l'accueil, passer d'une application
//     ouverte à l'autre.
//
// Rien ne change dans les applications elles-mêmes : ce sont les mêmes
// fenêtres, présentées autrement.

/// Les fenêtres ouvertes (réduites comprises), la plus récente d'abord.
const useOuvertes = () => {
  const apps = useSelector((s) => s.apps);
  return useMemo(
    () =>
      Object.entries(apps)
        .filter(([cle, a]) => cle !== "hz" && a && typeof a === "object" && a.hide === false)
        .map(([id, a]) => ({ id, ...a }))
        .sort((a, b) => (b.ouvert || 0) - (a.ouvert || 0)),
    [apps],
  );
};

const Horloge = () => {
  const [maintenant, setMaintenant] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="telHeure">
      {maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
};

export const Lanceur = () => {
  const telephone = useTelephone();
  const dispatch = useDispatch();
  const nomApp = useNomApp();
  const connecte = useSelector((s) => s.session.status === "authenticated");
  const verrouille = useSelector((s) => s.wallpaper.locked);
  const session = useSelector((s) => s.session);
  const bureau = useSelector((s) => s.desktop.apps);
  const lignes = useLignesDuJour();
  const ouvertes = useOuvertes();
  const [volet, setVolet] = useState(false);

  // Une seule application au premier plan : celles qui restent ouvertes
  // derrière sont réduites, sinon « Accueil » ne ramènerait qu'à la
  // précédente.
  const auPremierPlan = ouvertes.filter((a) => a.max !== false);

  useEffect(() => {
    if (!volet) return undefined;
    const echap = (e) => e.key === "Escape" && setVolet(false);
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [volet]);

  if (!telephone || !connecte || verrouille) return null;

  const accueil = () => {
    setVolet(false);
    for (const a of auPremierPlan) fenetre(a.id, "mnmz");
  };

  const ouvrir = (app) => {
    setVolet(false);
    if (app.name === "Corbeille") return ouvrirCorbeille();
    for (const a of auPremierPlan) fenetre(a.id, "mnmz");
    dispatch({ type: app.action, payload: "full" });
  };

  const basculerVers = (id) => {
    setVolet(false);
    for (const a of auPremierPlan) if (a.id !== id) fenetre(a.id, "mnmz");
    fenetre(id, "front");
  };

  const prenom = (session.user?.name || "").split(" ")[0];

  // Les outils d'administration (Automatisations…) n'ont pas d'icône de
  // bureau : sur ordinateur on les trouve par la recherche et le menu
  // Démarrer, absents du téléphone. Les administrateurs les retrouvent ici.
  const admin = ["OWNER", "ADMIN"].includes(session.user?.role);
  const outils = admin
    ? modulesSysteme.filter((m) => m.admin && !bureau.some((b) => b.action === m.action))
    : [];
  const grille = [...bureau, ...outils];

  return (
    <>
      <div className="telLanceur" data-masque={auPremierPlan.length > 0}>
        <header className="telTete">
          <Horloge />
          <span className="telDate">{dateDuJour()}</span>
          <h1>{prenom ? `Bonjour ${prenom}` : "Bonjour"}</h1>
          <span className="telEspace">{session.tenant?.name}</span>
        </header>

        {lignes.length ? (
          <section className="telJour" aria-label="Aujourd'hui">
            {lignes.map(({ cle, ...ligne }) => (
              <Ligne key={cle} {...ligne} />
            ))}
          </section>
        ) : null}

        <nav className="telGrille" aria-label="Applications">
          {grille.map((app) => (
            <button
              key={app.name}
              type="button"
              className="telApp"
              onClick={() => ouvrir(app)}
            >
              <Icon src={app.name === "Corbeille" ? "bin0" : app.icon} width={46} />
              <span>{nomApp(app)}</span>
            </button>
          ))}
        </nav>
      </div>

      {volet ? (
        <div className="telVoile" onClick={() => setVolet(false)}>
          <div
            className="telVolet"
            role="dialog"
            aria-label="Applications ouvertes"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Applications ouvertes</h2>
            {ouvertes.length ? (
              ouvertes.map((a) => (
                <div key={a.id} className="telOuverte">
                  <button type="button" onClick={() => basculerVers(a.id)}>
                    <Icon src={a.icon} width={26} />
                    <span>{nomApp(a)}</span>
                  </button>
                  <button
                    type="button"
                    className="telFermer"
                    aria-label={`Fermer ${nomApp(a)}`}
                    onClick={() => fenetre(a.id, "close")}
                  >
                    <Icon fafa="faXmark" width={12} />
                  </button>
                </div>
              ))
            ) : (
              <p className="telRien">Aucune application ouverte.</p>
            )}
          </div>
        </div>
      ) : null}

      <nav className="telBarre" aria-label="Navigation">
        <button type="button" className="telAccueil" onClick={accueil}>
          <Icon fafa="faHouse" width={16} />
          <span>Accueil</span>
        </button>
        <button
          type="button"
          className="telOuvertes"
          onClick={() => setVolet((v) => !v)}
          aria-expanded={volet}
        >
          <span className="telCompte">{ouvertes.length}</span>
          <span>Ouvertes</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setVolet(false);
            for (const a of auPremierPlan) fenetre(a.id, "mnmz");
            dispatch({ type: "SETTINGS", payload: "full" });
          }}
        >
          <Icon fafa="faGear" width={16} />
          <span>Réglages</span>
        </button>
      </nav>
    </>
  );
};
