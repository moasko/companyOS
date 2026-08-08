// Plateforme.
//
// ─────────────────────────────────────────────────────────────────────────
// LA CONSOLE DE L'EXPLOITANT
//
// Tous les espaces de travail du SaaS d'un coup d'œil : qui paie quoi,
// combien d'utilisateurs, combien de stockage, depuis quand. Et le geste
// commercial qui va avec — changer la formule d'un client qui a réglé
// par virement, offrir un mois, rétrograder un impayé.
//
// L'accès est tranché par le serveur (PLATFORM_ADMINS, une liste
// d'emails dans l'environnement) : quiconque d'autre ouvre cette fenêtre
// voit une porte fermée, pas des chiffres.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Contenu, useChargement } from "../../chargement";
import { Vide } from "../../ui";
import "./plateforme.scss";

export const manifest = {
  id: "plateforme",
  slug: "plateforme",
  name: "Plateforme",
  icon: "plateforme",
  action: "PLATEFORMEAPP",
  Window: PlateformeApp,
};

const formatOctets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.round(v / 1024)} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(1)} Go`;
};

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR")} F`;

function PlateformeApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [donnees, setDonnees] = useState(null);
  const [refus, setRefus] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDonnees(await api.plateforme());
      setRefus(false);
    } catch (e) {
      if (e.status === 403) setRefus(true);
      else throw e;
    }
  }, []);
  const etat = useChargement(ouvert, charger);

  const espaces = useMemo(() => {
    const liste = donnees?.espaces || [];
    const q = recherche.trim().toLowerCase();
    return q
      ? liste.filter((e) => [e.nom, e.slug].join(" ").toLowerCase().includes(q))
      : liste;
  }, [donnees, recherche]);

  const changerFormule = async (espace, plan) => {
    const formule = donnees.formules.find((f) => f.id === plan);
    const ok = await modal.confirm({
      title: `Passer « ${espace.nom} » en ${formule.nom} ?`,
      message: formule.prixMois
        ? `Facturation : ${fcfa(formule.prixMois)} / mois. Le quota passe à ${formatOctets(formule.quota)}.`
        : `Formule gratuite — quota ramené à ${formatOctets(formule.quota)}.`,
      detail:
        "Le geste de l'exploitant : aucun garde-fou de rétrogradation, l'espace ne perd rien mais peut se retrouver au-dessus de son quota.",
      confirmLabel: "Changer la formule",
    });
    if (!ok) return;
    setOccupe(true);
    try {
      await api.plateformeFormule(espace.id, plan);
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Changement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="pltApp">
        <div className="pltVerrou">Connectez-vous.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="pltApp">
      <div className="pltShell win11Scroll">
        {refus ? (
          <Vide
            icone="faLock"
            titre="Console réservée à l'exploitant"
            aide="Cette fenêtre montre tous les espaces clients du SaaS. Seuls les comptes listés dans PLATFORM_ADMINS, côté serveur, peuvent l'ouvrir."
          />
        ) : (
          <Contenu etat={etat} vide={!donnees} lignes={5}>
            {donnees ? (
              <>
                <div className="pltTete">
                  <div>
                    <h2>Votre SaaS</h2>
                    <p className="pltAide">
                      Tous les espaces de travail, leurs formules et leur
                      consommation. Le changement de formule est immédiat.
                    </p>
                  </div>
                  <div className="pltRecherche">
                    <Icon fafa="faMagnifyingGlass" width={11} />
                    <input
                      value={recherche}
                      placeholder="Chercher un espace"
                      onChange={(e) => setRecherche(e.target.value)}
                    />
                  </div>
                </div>

                <div className="pltChiffres">
                  <div className="pltChiffre">
                    <b>{donnees.totaux.espaces}</b>
                    <span>espaces</span>
                  </div>
                  <div className="pltChiffre">
                    <b>{donnees.totaux.utilisateurs}</b>
                    <span>utilisateurs</span>
                  </div>
                  <div className="pltChiffre">
                    <b>{formatOctets(donnees.totaux.stockage)}</b>
                    <span>stockage servi</span>
                  </div>
                  <div className="pltChiffre" data-fort="true">
                    <b>{fcfa(donnees.totaux.mrr)}</b>
                    <span>revenu mensuel</span>
                  </div>
                </div>

                <div className="pltTable">
                  <div className="pltLigne pltLigneTete">
                    <span>Espace</span>
                    <span>Formule</span>
                    <span>Membres</span>
                    <span>Apps</span>
                    <span>Fiches</span>
                    <span>Stockage</span>
                    <span>Créé le</span>
                  </div>
                  {espaces.map((e) => (
                    <div key={e.id} className="pltLigne">
                      <span className="pltNom">
                        {e.nom}
                        <em>{e.slug}</em>
                      </span>
                      <span>
                        <select
                          value={e.plan}
                          disabled={occupe}
                          onChange={(ev) => changerFormule(e, ev.target.value)}
                        >
                          {donnees.formules.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.nom}
                              {f.prixMois ? ` — ${fcfa(f.prixMois)}/mois` : " — gratuit"}
                            </option>
                          ))}
                        </select>
                      </span>
                      <span>{e.utilisateurs}</span>
                      <span>{e.applications}</span>
                      <span>{e.fiches}</span>
                      <span
                        data-plein={Number(e.usedBytes) > Number(e.quota)}
                        className="pltStockage"
                      >
                        {formatOctets(e.usedBytes)} / {formatOctets(e.quota)}
                      </span>
                      <span>{new Date(e.creeLe).toLocaleDateString("fr-FR")}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Contenu>
        )}
      </div>
    </ModuleWindow>
  );
}
