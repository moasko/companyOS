import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { BASE_URL, api, apiFetch } from "../../../api/client";
import { modal } from "../../modalRequest";
import "./mcp.scss";
import { manifest as descriptif } from "./manifest";

export const manifest = { ...descriptif, Window: McpApp };

const OUTILS = [
  ["companyos_status", "État de l’API, session et droits d’écriture"],
  ["companyos_list_apps", "Catalogue et applications installées"],
  ["companyos_list_records", "Lecture des fiches de toutes les applications"],
  ["companyos_save_record", "Création et modification des fiches"],
  ["companyos_request", "Fichiers, membres, audit, courrier et administration"],
];

const RESSOURCES = [
  "Compte et espace courants",
  "Applications installées",
  "Catalogue des applications",
  "Arborescence des fichiers",
  "Notifications",
  "Journal d’audit",
];

const masquer = (token) =>
  token ? `${token.slice(0, 12)}${"•".repeat(18)}${token.slice(-8)}` : "Aucun jeton";

const copier = async (texte, message) => {
  await navigator.clipboard.writeText(texte);
  await modal.alert({ title: "Copié", message });
};

function McpApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const [onglet, setOnglet] = useState("connexion");
  const [etat, setEtat] = useState({ chargement: true, api: false, session: false });
  const [ecriture, setEcriture] = useState(
    () => localStorage.getItem("companyos-mcp-writes") !== "0",
  );
  const [nodePath, setNodePath] = useState("C:\\Program Files\\nodejs\\node.exe");
  const [serveurPath, setServeurPath] = useState(
    "E:\\companyos\\apps\\mcp\\src\\index.js",
  );
  // Le jeton de session du navigateur est dans un cookie illisible par la
  // page : le serveur MCP reçoit son **propre** jeton, créé à la demande,
  // montré une seule fois et révocable dans Paramètres → Sécurité.
  const [token, setToken] = useState("");
  const [creation, setCreation] = useState(false);
  const genererJeton = async () => {
    setCreation(true);
    try {
      const r = await api.creerJeton("Serveur MCP");
      setToken(r.token);
    } catch (err) {
      await modal.alert({ title: "Jeton non créé", message: err.message, tone: "error" });
    } finally {
      setCreation(false);
    }
  };
  const jetonAffiche = token || "<générez un jeton>";

  useEffect(() => {
    if (!ouvert) return;
    let actif = true;
    Promise.all([
      fetch(`${BASE_URL}/health`).then((r) => r.ok),
      apiFetch(`${BASE_URL}/api/auth/me`).then((r) => r.ok),
    ])
      .then(([api, auth]) => actif && setEtat({ chargement: false, api, session: auth }))
      .catch(() => actif && setEtat({ chargement: false, api: false, session: false }));
    return () => {
      actif = false;
    };
  }, [ouvert]);

  const config = useMemo(
    () => ({
      mcp_servers: {
        companyos: {
          command: nodePath,
          args: [serveurPath],
          startup_timeout_sec: 30,
          env: {
            COMPANYOS_API_URL: BASE_URL,
            COMPANYOS_TOKEN: jetonAffiche,
            COMPANYOS_ALLOW_WRITES: ecriture ? "1" : "0",
          },
        },
      },
    }),
    [nodePath, serveurPath, jetonAffiche, ecriture],
  );

  const json = JSON.stringify(
    { mcpServers: { companyos: config.mcp_servers.companyos } },
    null,
    2,
  );
  const toml = `[mcp_servers.companyos]\ncommand = '${nodePath}'\nargs = ['${serveurPath}']\nstartup_timeout_sec = 30\n\n[mcp_servers.companyos.env]\nCOMPANYOS_API_URL = '${BASE_URL}'\nCOMPANYOS_TOKEN = '${jetonAffiche}'\nCOMPANYOS_ALLOW_WRITES = '${ecriture ? "1" : "0"}'`;
  const commande = `codex mcp add companyos --env COMPANYOS_API_URL=${BASE_URL} --env COMPANYOS_TOKEN=${jetonAffiche} --env COMPANYOS_ALLOW_WRITES=${ecriture ? "1" : "0"} -- "${nodePath}" "${serveurPath}"`;
  const proteger = (texte) => (token ? texte.replaceAll(token, masquer(token)) : texte);

  const changerEcriture = (value) => {
    setEcriture(value);
    localStorage.setItem("companyos-mcp-writes", value ? "1" : "0");
  };

  return (
    <ModuleWindow manifest={manifest} className="mcpApp">
      <header className="mcpHero">
        <div>
          <span className="mcpEyebrow">CompanyOS · Model Context Protocol</span>
          <h1>MCP Center</h1>
          <p>Une seule console pour connecter et gouverner vos assistants.</p>
        </div>
        <div className="mcpHealth" data-ok={etat.api && etat.session}>
          <span />
          {etat.chargement
            ? "Diagnostic…"
            : etat.api && etat.session
              ? "Prêt"
              : "Action requise"}
        </div>
      </header>

      <nav className="mcpTabs">
        {[
          ["connexion", "Connexion"],
          ["configuration", "Configuration"],
          ["capacites", "Capacités"],
          ["securite", "Sécurité"],
        ].map(([id, label]) => (
          <button key={id} data-active={onglet === id} onClick={() => setOnglet(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="mcpMain">
        {onglet === "connexion" ? (
          <>
            <section className="mcpGrid">
              <article className="mcpCard">
                <span>API CompanyOS</span>
                <strong data-ok={etat.api}>
                  {etat.api ? "En ligne" : "Injoignable"}
                </strong>
                <small>{BASE_URL}</small>
              </article>
              <article className="mcpCard">
                <span>Authentification</span>
                <strong data-ok={etat.session}>
                  {etat.session ? "Valide" : "À renouveler"}
                </strong>
                <small>{session.user?.name || "Compte courant"}</small>
              </article>
              <article className="mcpCard">
                <span>Mode</span>
                <strong>{ecriture ? "Lecture + écriture" : "Lecture seule"}</strong>
                <small>Suppression toujours confirmée</small>
              </article>
            </section>
            <section className="mcpPanel">
              <h2>Jeton de connexion</h2>
              <p>
                Le MCP agit avec votre compte et exactement les mêmes rôles. Son jeton
                lui est propre : il est affiché une seule fois, et se révoque dans
                Paramètres → Sécurité sans vous déconnecter.
              </p>
              <div className="mcpToken">
                <code>{token ? masquer(token) : "Aucun jeton généré"}</code>
                {token ? (
                  <button
                    onClick={() =>
                      copier(
                        token,
                        "Le jeton est dans le presse-papiers. Ne le partagez pas.",
                      )
                    }
                  >
                    Copier
                  </button>
                ) : (
                  <button disabled={creation} onClick={genererJeton}>
                    {creation ? "…" : "Générer un jeton"}
                  </button>
                )}
              </div>
              <div className="mcpWarning">
                Secret sensible : ne le collez jamais dans un ticket, un dépôt Git ou une
                conversation publique.
              </div>
            </section>
          </>
        ) : null}

        {onglet === "configuration" ? (
          <>
            <section className="mcpPanel">
              <h2>Emplacement du serveur</h2>
              <div className="mcpFields">
                <label>
                  Node.js
                  <input value={nodePath} onChange={(e) => setNodePath(e.target.value)} />
                </label>
                <label>
                  Serveur MCP
                  <input
                    value={serveurPath}
                    onChange={(e) => setServeurPath(e.target.value)}
                  />
                </label>
              </div>
            </section>
            <section className="mcpPanel">
              <div className="mcpPanelTitle">
                <div>
                  <h2>Installation Codex</h2>
                  <p>Commande officielle, prête à exécuter dans PowerShell.</p>
                </div>
                <button
                  disabled={!token}
                  onClick={() => copier(commande, "Commande Codex copiée.")}
                >
                  Copier
                </button>
              </div>
              <pre>{proteger(commande)}</pre>
            </section>
            <section className="mcpPanel">
              <div className="mcpPanelTitle">
                <div>
                  <h2>Fichier TOML Codex</h2>
                  <p>À placer dans la configuration Codex.</p>
                </div>
                <button
                  disabled={!token}
                  onClick={() => copier(toml, "Configuration TOML copiée.")}
                >
                  Copier
                </button>
              </div>
              <pre>{proteger(toml)}</pre>
            </section>
            <section className="mcpPanel">
              <div className="mcpPanelTitle">
                <div>
                  <h2>Claude Desktop / client JSON</h2>
                </div>
                <button
                  disabled={!token}
                  onClick={() => copier(json, "Configuration JSON copiée.")}
                >
                  Copier
                </button>
              </div>
              <pre>{proteger(json)}</pre>
            </section>
          </>
        ) : null}

        {onglet === "capacites" ? (
          <section className="mcpColumns">
            <div className="mcpPanel">
              <h2>Outils</h2>
              {OUTILS.map(([nom, desc]) => (
                <div className="mcpItem" key={nom}>
                  <code>{nom}</code>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <div className="mcpPanel">
              <h2>Ressources</h2>
              {RESSOURCES.map((nom) => (
                <div className="mcpItem" key={nom}>
                  <b>{nom}</b>
                  <span>Ressource JSON actualisée</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {onglet === "securite" ? (
          <section className="mcpPanel">
            <h2>Permissions du serveur</h2>
            <div className="mcpChoice">
              <button data-active={!ecriture} onClick={() => changerEcriture(false)}>
                <strong>Lecture seule</strong>
                <span>Consultation sans aucune écriture</span>
              </button>
              <button data-active={ecriture} onClick={() => changerEcriture(true)}>
                <strong>Lecture + écriture</strong>
                <span>Actions selon votre rôle CompanyOS</span>
              </button>
            </div>
            <ul>
              <li>Les rôles MEMBER, ADMIN et OWNER restent appliqués côté API.</li>
              <li>Les suppressions exigent une confirmation explicite.</li>
              <li>Le MCP ne peut appeler que l’hôte CompanyOS configuré.</li>
              <li>
                Changer le mode nécessite de recopier la configuration et de redémarrer le
                client MCP.
              </li>
            </ul>
          </section>
        ) : null}
      </main>
    </ModuleWindow>
  );
}
