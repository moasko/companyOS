import React, { useState } from "react";
import { Icon } from "../../../utils/general";
import { api, BASE_URL, apiFetch } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Bouton, Notice } from "../../ui";

// La santé de la plateforme : les sauvegardes, et les erreurs que
// rencontrent l'API et les navigateurs des clients.
//
// La question à laquelle l'écran répond d'abord : « si le serveur brûle
// cette nuit, qu'est-ce que je perds ? » — d'où la pastille en tête, qui
// passe au rouge dès que la dernière sauvegarde de la base a plus d'un jour
// et demi, et l'avertissement quand les copies ne quittent pas le serveur.

const octets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.max(1, Math.round(v / 1024))} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(1)} Go`;
};

const quand = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const depuis = (iso) => {
  if (!iso) return "jamais";
  const h = (Date.now() - new Date(iso)) / 3600_000;
  if (h < 1) return "il y a moins d'une heure";
  if (h < 48) return `il y a ${Math.round(h)} h`;
  return `il y a ${Math.round(h / 24)} jours`;
};

/// L'état d'ensemble des sauvegardes, en une pastille.
const etatSauvegardes = (s) => {
  if (!s.active) return { ton: "danger", texte: "Sauvegardes désactivées" };
  const age = s.derniereBase ? (Date.now() - new Date(s.derniereBase.debut)) / 3600_000 : Infinity;
  if (age > 36) return { ton: "danger", texte: "Base non sauvegardée depuis plus d'un jour" };
  if (!s.horsSitePossible) return { ton: "attention", texte: "Copies sur le serveur seulement" };
  return { ton: "ok", texte: "Base sauvegardée et copiée hors site" };
};

const telecharger = async (s) => {
  const rep = await apiFetch(`${BASE_URL}/api/plateforme/sauvegardes/${s.id}/fichier`, {});
  if (!rep.ok) {
    const corps = await rep.json().catch(() => null);
    throw new Error(corps?.error || `Erreur ${rep.status}`);
  }
  const url = URL.createObjectURL(await rep.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: s.fichier });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const Sante = ({ sante, onRecharger, onAllerStockage }) => {
  const [occupe, setOccupe] = useState(null);
  const [ouverte, setOuverte] = useState(null);
  const { sauvegardes: s, erreurs } = sante;
  const etat = etatSauvegardes(s);

  const sauvegarder = async (type) => {
    setOccupe(type);
    try {
      const r = await api.plateformeSauvegarder(type);
      modal.alert({
        title: "Sauvegarde terminée",
        message: `${r.fichier} — ${octets(r.octets)}${r.horsSite ? ", copiée hors site" : ""}.`,
      });
      await onRecharger();
    } catch (e) {
      modal.alert({ title: "Sauvegarde en échec", message: e.message, tone: "error" });
      await onRecharger();
    } finally {
      setOccupe(null);
    }
  };

  const basculer = async (e) => {
    try {
      await api.plateformeErreurResolue(e.id, !e.resolue);
      await onRecharger();
    } catch (err) {
      modal.alert({ title: "Action impossible", message: err.message, tone: "error" });
    }
  };

  return (
    <>
      <header className="pltTete">
        <div>
          <h2>Santé</h2>
          <p className="pltAide">
            Ce que vous perdriez si le serveur tombait cette nuit, et ce qui casse chez
            vos clients.
          </p>
        </div>
      </header>

      {/* ---------------- Sauvegardes ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Sauvegardes</h3>
            <p className="pltAide">
              La base chaque jour vers {s.heure} h UTC, gardée {s.retentionJours} jours
              {s.archiveFichiers
                ? ` ; les fichiers du cloud chaque semaine, gardés ${s.fichiersSemaines} semaines`
                : ""}
              . Chaque copie est relue avant d'être déclarée bonne.
            </p>
          </div>
          <span className="pltPastilleEtat" data-ton={etat.ton}>
            {etat.texte}
          </span>
        </div>

        {!s.horsSitePossible ? (
          <Notice ton="attention" icone="faTriangleExclamation">
            Les copies restent sur le disque du serveur : elles disparaîtraient avec lui.
            Configurez un stockage objet (Cloudflare R2, S3…) et chaque sauvegarde de la
            base y sera envoyée automatiquement.{" "}
            <button type="button" className="pltLien" onClick={onAllerStockage}>
              Configurer le stockage
            </button>
          </Notice>
        ) : null}

        <div className="pltRepartition">
          <div className="pltRepartCase">
            <small>Dernière sauvegarde de la base</small>
            <b>{depuis(s.derniereBase?.debut)}</b>
            <small>
              {s.derniereBase
                ? `${octets(s.derniereBase.octets)}${s.derniereBase.horsSite ? " · hors site" : " · sur le serveur"}`
                : "aucune réussie"}
            </small>
          </div>
          {s.archiveFichiers ? (
            <div className="pltRepartCase">
              <small>Dernière archive des fichiers</small>
              <b>{depuis(s.derniersFichiers?.debut)}</b>
              <small>
                {s.derniersFichiers ? octets(s.derniersFichiers.octets) : "aucune réussie"}
              </small>
            </div>
          ) : null}
        </div>

        <div className="pltActions">
          <Bouton icone="faDatabase" off={!!occupe} onClick={() => sauvegarder("base")}>
            {occupe === "base" ? "Sauvegarde en cours…" : "Sauvegarder la base maintenant"}
          </Bouton>
          {s.archiveFichiers ? (
            <Bouton
              variante="secondaire"
              icone="faBoxArchive"
              off={!!occupe}
              onClick={() => sauvegarder("fichiers")}
            >
              {occupe === "fichiers" ? "Archivage en cours…" : "Archiver les fichiers"}
            </Bouton>
          ) : null}
        </div>

        {s.historique.length ? (
          <div className="pltTableEnveloppe">
            <table className="pltTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>État</th>
                  <th>Taille</th>
                  <th>Hors site</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.historique.map((h) => (
                  <tr key={h.id} data-alerte={h.statut === "echec" ? "danger" : undefined}>
                    <td className="pltNom">
                      <span>{quand(h.debut)}</span>
                    </td>
                    <td>
                      {h.type === "base" ? "Base" : "Fichiers"}
                      {h.declencheur === "manuelle" ? " · manuelle" : ""}
                    </td>
                    <td title={h.erreur || undefined}>
                      {h.statut === "ok"
                        ? h.verifiee
                          ? "Vérifiée"
                          : "Réussie"
                        : h.statut === "echec"
                          ? `Échec — ${(h.erreur || "").slice(0, 70)}`
                          : "En cours…"}
                    </td>
                    <td>{h.octets ? octets(h.octets) : "—"}</td>
                    <td>{h.horsSite ? "Oui" : "—"}</td>
                    <td>
                      {h.statut === "ok" && h.fichier ? (
                        <button
                          type="button"
                          className="pltLien"
                          onClick={() =>
                            telecharger(h).catch((e) =>
                              modal.alert({
                                title: "Téléchargement impossible",
                                message: e.message,
                                tone: "error",
                              }),
                            )
                          }
                        >
                          Télécharger
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pltRien">
            Aucune sauvegarde encore. La première part cinq minutes après le démarrage
            de l'API — ou maintenant, avec le bouton ci-dessus.
          </p>
        )}
      </section>

      {/* ---------------- Erreurs ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Erreurs</h3>
            <p className="pltAide">
              Les erreurs de l'API et des navigateurs, regroupées. Une erreur résolue qui
              revient repasse « à traiter » ; chaque nouvelle erreur vous est envoyée par
              courriel quand un relais SMTP est configuré.
            </p>
          </div>
          <span className="pltPastilleEtat" data-ton={erreurs.aTraiter ? "attention" : "ok"}>
            {erreurs.aTraiter
              ? `${erreurs.aTraiter} à traiter`
              : "Aucune erreur à traiter"}
          </span>
        </div>

        {erreurs.liste.length ? (
          <ul className="pltErreurs">
            {erreurs.liste.map((e) => (
              <li key={e.id} data-resolue={e.resolue}>
                <div className="pltErreurLigne">
                  <span className="pltErreurSource" data-source={e.source}>
                    {e.source === "web" ? "Navigateur" : "API"}
                  </span>
                  <button
                    type="button"
                    className="pltErreurMessage"
                    aria-expanded={ouverte === e.id}
                    onClick={() => setOuverte(ouverte === e.id ? null : e.id)}
                  >
                    {e.message}
                  </button>
                  <span className="pltErreurCompte" title="Occurrences">
                    ×{e.occurrences}
                  </span>
                  <span className="pltErreurDate">{quand(e.derniere)}</span>
                  <button type="button" className="pltLien" onClick={() => basculer(e)}>
                    {e.resolue ? "Rouvrir" : "Résolue"}
                  </button>
                </div>
                {ouverte === e.id ? (
                  <div className="pltErreurDetail">
                    <p>
                      Vue la première fois le {quand(e.premiere)}
                      {e.url ? ` · ${e.url}` : ""}
                      {e.tenantId ? ` · espace ${e.tenantId}` : ""}
                    </p>
                    {e.pile ? <pre>{e.pile}</pre> : <p>Pas de pile d'appels.</p>}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="pltRien">
            <Icon fafa="faCircleCheck" width={12} /> Aucune erreur enregistrée.
          </p>
        )}
      </section>
    </>
  );
};
