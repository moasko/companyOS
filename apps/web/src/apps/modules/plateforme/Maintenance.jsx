import React, { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { viderCachesNavigateur } from "../../../api/caches";
import { modal } from "../../modalRequest";
import { Bouton, Notice } from "../../ui";

// Maintenance : l'instance qui répond, ses caches, et le ménage.
//
// Les gestes d'après incident, réunis au même endroit : une donnée
// corrigée à la main en base que les serveurs gardent encore en mémoire,
// un fournisseur SSO qui a changé ses clés, une attaque qui a rempli les
// tables de signaux. Avant cet écran, la seule réponse était « redémarrer
// l'API » — et derrière un répartiteur, redémarrer chaque instance.
//
// Vider un cache ne perd jamais de donnée : tout ce qui est en mémoire se
// relit en base. Le coût est de quelques requêtes plus lentes, juste après.

const octets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.max(1, Math.round(v / 1024))} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(2)} Go`;
};

const duree = (s) => {
  const j = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (j) return `${j} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
};

/// Ce que la purge supprime, dit pour un humain.
const EXPIREES = [
  { id: "jetons", libelle: "Liens à usage unique échus", aide: "réinitialisation de mot de passe, lecture vidéo, retour SSO" },
  { id: "verrous", libelle: "Compteurs d'échecs de connexion", aide: "plus d'une heure sans nouvel essai" },
  { id: "sessions", libelle: "Sessions closes", aide: "expirées ou révoquées depuis plus de 30 jours" },
  { id: "signaux", libelle: "Signaux de détection", aide: "plus de 24 heures — les alertes, elles, restent" },
  { id: "blocages", libelle: "Blocages d'adresses levés", aide: "échus depuis plus de 30 jours" },
  { id: "versions", libelle: "Historique des fiches supprimées", aide: "au-delà des 180 jours de corbeille" },
];

export const Maintenance = () => {
  const queryClient = useQueryClient();
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [choix, setChoix] = useState(() => new Set());
  const [navigateurs, setNavigateurs] = useState(true);
  const [occupe, setOccupe] = useState(null);
  const [resultat, setResultat] = useState(null);

  const charger = useCallback(async () => {
    try {
      setEtat(await api.plateformeMaintenance());
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const basculer = (nom) =>
    setChoix((c) => {
      const s = new Set(c);
      if (s.has(nom)) s.delete(nom);
      else s.add(nom);
      return s;
    });

  const vider = async (tous) => {
    const noms = tous ? [] : [...choix];
    const libelles = tous
      ? "tous les caches"
      : etat.caches.filter((c) => choix.has(c.nom)).map((c) => `« ${c.libelle} »`).join(", ");
    const ok = await modal.confirm({
      title: tous ? "Vider tous les caches ?" : "Vider les caches choisis ?",
      message: `Toutes les instances de l'API oublieront ${libelles} et reliront la base à la demande suivante.`,
      detail: navigateurs
        ? "Les navigateurs connectés oublieront aussi leurs listes et relirons ce qu'ils affichent. Aucune donnée n'est perdue, aucune session n'est fermée."
        : "Aucune donnée n'est perdue : seules les premières requêtes seront un peu plus lentes.",
      confirmLabel: "Vider",
    });
    if (!ok) return;
    setOccupe(tous ? "tous" : "choix");
    try {
      const r = await api.plateformeViderCaches({ noms, navigateurs });
      setResultat({
        ton: "ok",
        texte:
          `${r.caches.length} cache${r.caches.length > 1 ? "s" : ""} vidé${r.caches.length > 1 ? "s" : ""} ` +
          `(${r.entrees} entrée${r.entrees > 1 ? "s" : ""} sur cette instance)` +
          (r.navigateurs ? ", navigateurs connectés prévenus." : "."),
      });
      setChoix(new Set());
      await charger();
    } catch (e) {
      modal.alert({ title: "Vidage impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(null);
    }
  };

  const viderCeNavigateur = async () => {
    setOccupe("navigateur");
    try {
      await viderCachesNavigateur(queryClient);
      setResultat({ ton: "ok", texte: "Ce navigateur a oublié ses listes ; les fenêtres ouvertes relisent." });
    } finally {
      setOccupe(null);
    }
  };

  const purger = async () => {
    const ok = await modal.confirm({
      title: "Purger les données expirées ?",
      message: `${etat.expirees.total} ligne${etat.expirees.total > 1 ? "s" : ""} périmée${etat.expirees.total > 1 ? "s" : ""} seront supprimées de la base.`,
      detail: "C'est ce que le ménage automatique ferait de lui-même dans les heures qui viennent. Rien d'actif n'est touché : ni session ouverte, ni alerte, ni fiche.",
      confirmLabel: "Purger",
      danger: true,
    });
    if (!ok) return;
    setOccupe("purge");
    try {
      const r = await api.plateformePurge();
      setResultat({ ton: "ok", texte: `${r.total} ligne${r.total > 1 ? "s" : ""} supprimée${r.total > 1 ? "s" : ""}.` });
      await charger();
    } catch (e) {
      modal.alert({ title: "Purge impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(null);
    }
  };

  if (erreur && !etat) {
    return (
      <Notice ton="erreur" icone="faTriangleExclamation">
        Maintenance indisponible : {erreur}
      </Notice>
    );
  }
  if (!etat) return <p className="pltDiscret">Chargement…</p>;

  const { serveur: s, tempsReel, caches, expirees } = etat;
  const totalEntrees = caches.reduce((n, c) => n + c.entrees, 0);
  const lente = s.base.latenceMs == null || s.base.latenceMs > 50;

  return (
    <>
      <header className="pltTete">
        <div>
          <h2>Maintenance</h2>
          <p className="pltAide">
            Caches, ménage et état du serveur — les gestes d'après incident, sans
            redémarrer l'API.
          </p>
        </div>
        <Bouton variante="secondaire" icone="faRotate" off={!!occupe} onClick={charger}>
          Actualiser
        </Bouton>
      </header>

      {resultat ? (
        <div className="pltResultat" data-ton={resultat.ton} role="status">
          <Icon fafa="faCircleCheck" width={13} />
          <span>{resultat.texte}</span>
          <button type="button" aria-label="Masquer" onClick={() => setResultat(null)}>
            <Icon fafa="faXmark" width={11} />
          </button>
        </div>
      ) : null}

      {/* ---------------- Serveur ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Serveur</h3>
            <p className="pltAide">
              L'instance qui a répondu à cette page. Derrière un répartiteur de
              charge, une autre peut répondre à l'actualisation suivante.
            </p>
          </div>
          <span className="pltPastilleEtat" data-ton={!s.bus ? "attention" : lente ? "attention" : "ok"}>
            {!s.bus ? "Bus temps réel coupé" : lente ? "Base lente" : "En bonne santé"}
          </span>
        </div>
        <div className="pltServeur">
          <div>
            <small>Version</small>
            <b>{s.version || "—"}</b>
            <small>Node {s.node} · {s.environnement}</small>
          </div>
          <div>
            <small>En ligne depuis</small>
            <b>{duree(s.dureeSecondes)}</b>
            <small>instance {s.instance}</small>
          </div>
          <div>
            <small>Mémoire</small>
            <b>{octets(s.memoire.rss)}</b>
            <small>tas {octets(s.memoire.tas)} / {octets(s.memoire.tasTotal)}</small>
          </div>
          <div data-alerte={lente || undefined}>
            <small>Base de données</small>
            <b>{s.base.latenceMs == null ? "injoignable" : `${s.base.latenceMs.toFixed(1)} ms`}</b>
            <small>{s.base.taille ? `${octets(s.base.taille)} sur disque` : "taille inconnue"}</small>
          </div>
          <div data-alerte={!s.bus || undefined}>
            <small>Temps réel</small>
            <b>{s.bus ? "Bus actif" : "Bus coupé"}</b>
            <small>
              {tempsReel.flux} flux · {tempsReel.personnes} personne{tempsReel.personnes > 1 ? "s" : ""}
            </small>
          </div>
          <div>
            <small>Sessions</small>
            <b>{s.sessionsActives ?? "—"} ouvertes</b>
            <small>{s.personnes7j ?? "—"} personne{s.personnes7j > 1 ? "s" : ""} actives sur 7 jours</small>
          </div>
        </div>
      </section>

      {/* ---------------- Caches ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Caches du serveur</h3>
            <p className="pltAide">
              Copies en mémoire de données lues en base. Les vider après une
              correction faite directement en base, ou si un réglage tarde à
              s'appliquer. L'ordre part à toutes les instances.
            </p>
          </div>
          <span className="pltPastilleEtat">{totalEntrees} entrée{totalEntrees > 1 ? "s" : ""}</span>
        </div>

        <ul className="pltCaches">
          {caches.map((c) => (
            <li key={c.nom}>
              <label>
                <input
                  type="checkbox"
                  checked={choix.has(c.nom)}
                  disabled={!!occupe}
                  onChange={() => basculer(c.nom)}
                />
                <span>
                  <b>{c.libelle}</b>
                  <small>{c.description}</small>
                </span>
              </label>
              <em>{c.entrees}</em>
            </li>
          ))}
        </ul>

        <label className="pltCase">
          <input
            type="checkbox"
            checked={navigateurs}
            disabled={!!occupe}
            onChange={(e) => setNavigateurs(e.target.checked)}
          />
          <span>
            Faire aussi relire les navigateurs connectés
            <small>Chacun oublie ses listes en cache et relit ce qu'il affiche, sans être déconnecté.</small>
          </span>
        </label>

        <div className="pltActions">
          <Bouton icone="faBroom" off={!!occupe} onClick={() => vider(true)}>
            {occupe === "tous" ? "Vidage…" : "Tout vider"}
          </Bouton>
          <Bouton variante="secondaire" icone="faListCheck" off={!!occupe || !choix.size} onClick={() => vider(false)}>
            {occupe === "choix" ? "Vidage…" : `Vider la sélection${choix.size ? ` (${choix.size})` : ""}`}
          </Bouton>
          <Bouton variante="secondaire" icone="faDesktop" off={!!occupe} onClick={viderCeNavigateur}>
            {occupe === "navigateur" ? "Vidage…" : "Vider ce navigateur seulement"}
          </Bouton>
        </div>
      </section>

      {/* ---------------- Données expirées ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Données expirées</h3>
            <p className="pltAide">
              Le ménage passe tout seul toutes les dix minutes ou chaque jour selon
              les tables. Purger tout de suite après une attaque ou avant une
              sauvegarde.
            </p>
          </div>
          <span className="pltPastilleEtat" data-ton={expirees.total ? "attention" : "ok"}>
            {expirees.total ? `${expirees.total} ligne${expirees.total > 1 ? "s" : ""} à purger` : "Rien à purger"}
          </span>
        </div>
        <ul className="pltCaches">
          {EXPIREES.map((x) => (
            <li key={x.id}>
              <span>
                <b>{x.libelle}</b>
                <small>{x.aide}</small>
              </span>
              <em>{expirees.lignes[x.id] ?? 0}</em>
            </li>
          ))}
        </ul>
        <div className="pltActions">
          <Bouton variante="secondaire" icone="faTrashCan" off={!!occupe || !expirees.total} onClick={purger}>
            {occupe === "purge" ? "Purge…" : "Purger maintenant"}
          </Bouton>
        </div>
      </section>
    </>
  );
};
