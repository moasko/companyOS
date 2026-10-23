import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Bouton, Notice } from "../../ui";

// Serveur : la machine qui fait tourner CompanyOS et les entreprises
// qu'elle héberge — une base de données chacune, un sous-domaine chacune.
//
// C'est l'écran de celui qui a lancé install.sh : est-ce que la machine
// tient (mémoire, disque, charge), qu'est-ce qui l'occupe (entreprise par
// entreprise), et ajouter une filiale sans ouvrir de terminal. Les gestes
// qui touchent aux conteneurs (mise à jour, restauration) restent sur le
// serveur, avec la commande `companyos` : l'API n'a volontairement aucun
// accès à Docker.

const octets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.max(1, Math.round(v / 1024))} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(1)} Go`;
};

const duree = (s) => {
  const j = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return j ? `${j} j ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
};

/// Jauge d'occupation : verte, orange au-delà de 75 %, rouge au-delà de 90 %.
const Jauge = ({ pct }) => (
  <span className="pltJauge" data-ton={pct >= 90 ? "danger" : pct >= 75 ? "attention" : "ok"}>
    <i style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
  </span>
);

const formulaireVide = { nom: "", email: "", admin: "", slug: "" };

export const Serveur = () => {
  const [serveur, setServeur] = useState(null);
  const [entreprises, setEntreprises] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [form, setForm] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [creee, setCreee] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.plateformeServeur(), api.plateformeEntreprises()]);
      setServeur(s);
      setEntreprises(e);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 30_000);
    return () => clearInterval(t);
  }, [charger]);

  const creer = async () => {
    setOccupe(true);
    try {
      const r = await api.plateformeCreerEntreprise({ ...form, slug: form.slug || undefined });
      setCreee({ ...r, nom: form.nom });
      setForm(null);
      await charger();
    } catch (e) {
      modal.alert({ title: "Création impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (e) => {
    const saisie = await modal.prompt({
      title: `Supprimer « ${e.nom} » ?`,
      message: `Sa base de données et toutes ses données seront supprimées. Toutes les bases sont sauvegardées juste avant. Pour confirmer, saisissez le sous-domaine : ${e.slug}`,
      placeholder: e.slug,
      confirmLabel: "Supprimer définitivement",
      danger: true,
    });
    if (saisie == null) return;
    if (saisie.trim() !== e.slug) {
      modal.alert({ title: "Suppression annulée", message: "Le sous-domaine saisi ne correspond pas.", tone: "info" });
      return;
    }
    setOccupe(true);
    try {
      await api.plateformeSupprimerEntreprise(e.slug);
      await charger();
    } catch (err) {
      modal.alert({ title: "Suppression impossible", message: err.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  if (erreur && !serveur) {
    return (
      <Notice ton="erreur" icone="faTriangleExclamation">
        Informations du serveur indisponibles : {erreur}
      </Notice>
    );
  }
  if (!serveur || !entreprises) return <p className="pltDiscret">Chargement…</p>;

  const { systeme: m, disque } = serveur;
  const memPct = Math.round(((m.memoireTotale - m.memoireLibre) / m.memoireTotale) * 100);
  const disquePct = disque ? Math.round(((disque.total - disque.libre) / disque.total) * 100) : null;
  const chargePct = Math.round((m.charge[0] / m.coeurs) * 100);
  const totalBases = entreprises.reduce((n, e) => n + Number(e.tailleBase || 0), 0);
  const totalFichiers = entreprises.reduce((n, e) => n + Number(e.stockage || 0), 0);

  return (
    <>
      <header className="pltTete">
        <div>
          <h2>Serveur</h2>
          <p className="pltAide">
            {serveur.domaine ? <>Installé sur <b>{serveur.domaine}</b> · </> : null}
            version {serveur.version || "—"} · {entreprises.length} entreprise{entreprises.length > 1 ? "s" : ""}, une base de données chacune
          </p>
        </div>
        <Bouton icone="faPlus" off={occupe} onClick={() => (setCreee(null), setForm({ ...formulaireVide }))}>
          Ajouter une entreprise
        </Bouton>
      </header>

      {/* ---------------- La machine ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>La machine</h3>
            <p className="pltAide">Actualisé toutes les 30 secondes.</p>
          </div>
          <span className="pltPastilleEtat" data-ton={memPct >= 90 || (disquePct ?? 0) >= 90 ? "attention" : "ok"}>
            {memPct >= 90 ? "Mémoire presque pleine" : (disquePct ?? 0) >= 90 ? "Disque presque plein" : "En bonne santé"}
          </span>
        </div>
        <div className="pltServeur">
          <div>
            <small>Processeur</small>
            <b>{chargePct} %</b>
            <Jauge pct={chargePct} />
            <small>{m.coeurs} cœur{m.coeurs > 1 ? "s" : ""} · charge {m.charge.map((c) => c.toFixed(2)).join(" / ")}</small>
          </div>
          <div>
            <small>Mémoire</small>
            <b>{memPct} %</b>
            <Jauge pct={memPct} />
            <small>{octets(m.memoireTotale - m.memoireLibre)} utilisés sur {octets(m.memoireTotale)}</small>
          </div>
          <div>
            <small>Disque</small>
            <b>{disquePct == null ? "—" : `${disquePct} %`}</b>
            {disquePct == null ? null : <Jauge pct={disquePct} />}
            <small>{disque ? `${octets(disque.libre)} libres sur ${octets(disque.total)}` : "inconnu"}</small>
          </div>
          <div>
            <small>Données</small>
            <b>{octets(totalBases + totalFichiers)}</b>
            <small>bases {octets(totalBases)} · fichiers {octets(totalFichiers)}</small>
            <small>en ligne depuis {duree(m.enLigneDepuis)}</small>
          </div>
        </div>
      </section>

      {/* ---------------- Nouvelle entreprise ---------------- */}
      {creee ? (
        <div className="pltResultat" data-ton="ok" role="status">
          <Icon fafa="faCircleCheck" width={13} />
          <span>
            <b>{creee.nom}</b> est prête : {creee.adresse ? <a href={creee.adresse} target="_blank" rel="noreferrer">{creee.adresse}</a> : creee.slug} —
            identifiant <b>{creee.email}</b>, mot de passe <code className="pltCode">{creee.motDePasse}</code> (affiché une seule fois).
          </span>
          <button type="button" aria-label="Masquer" onClick={() => setCreee(null)}>
            <Icon fafa="faXmark" width={11} />
          </button>
        </div>
      ) : null}

      {form ? (
        <section className="pltBloc">
          <div className="pltBlocTete">
            <div>
              <h3>Nouvelle entreprise</h3>
              <p className="pltAide">
                Une base de données neuve, un sous-domaine, un administrateur. Comptez une vingtaine de secondes.
              </p>
            </div>
          </div>
          <div className="pltFormEntreprise">
            <label>
              <span>Nom de l'entreprise</span>
              <input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Filiale Sud SARL" autoFocus />
            </label>
            <label>
              <span>Sous-domaine (facultatif)</span>
              <div className="pltSuffixe">
                <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="filiale-sud" />
                {serveur.domaine ? <em>.{serveur.domaine}</em> : null}
              </div>
            </label>
            <label>
              <span>Administrateur</span>
              <input value={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.value })} placeholder="Koffi Aka" />
            </label>
            <label>
              <span>Son adresse e-mail</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="dg@filiale-sud.ci" />
            </label>
          </div>
          <div className="pltActions">
            <Bouton variante="secondaire" off={occupe} onClick={() => setForm(null)}>Annuler</Bouton>
            <Bouton icone={occupe ? "faSpinner" : "faCheck"} off={occupe || form.nom.trim().length < 2 || form.admin.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(form.email)} onClick={creer}>
              {occupe ? "Création de la base…" : "Créer l'entreprise"}
            </Bouton>
          </div>
        </section>
      ) : null}

      {/* ---------------- Entreprises ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Entreprises</h3>
            <p className="pltAide">Chacune a sa base, ses comptes, ses fichiers et ses sauvegardes : rien n'est partagé.</p>
          </div>
        </div>
        <div className="pltTableEnv">
          <table className="pltTable">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Adresse</th>
                <th>Base de données</th>
                <th data-droite>Membres</th>
                <th data-droite>Fiches</th>
                <th data-droite>Fichiers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entreprises.map((e) => (
                <tr key={e.slug || "principale"}>
                  <td>
                    <b>{e.nom}</b>
                    {e.principale ? <span className="pltPastilleEtat" data-ton="info">principale</span> : null}
                  </td>
                  <td>{e.adresse ? <a href={e.adresse} target="_blank" rel="noreferrer">{e.adresse.replace("https://", "")}</a> : "—"}</td>
                  <td>
                    <code className="pltCode">{e.base}</code>
                    <small> {e.erreur ? `injoignable : ${e.erreur}` : octets(e.tailleBase)}</small>
                  </td>
                  <td data-droite>{e.membres ?? "—"}</td>
                  <td data-droite>{e.fiches ?? "—"}</td>
                  <td data-droite>{e.stockage == null ? "—" : octets(e.stockage)}</td>
                  <td data-droite>
                    {e.principale ? null : (
                      <button type="button" className="pltIconeBtn" title="Supprimer l'entreprise et sa base" aria-label={`Supprimer ${e.nom}`} disabled={occupe} onClick={() => supprimer(e)}>
                        <Icon fafa="faTrashCan" width={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Sur le serveur ---------------- */}
      <section className="pltBloc">
        <div className="pltBlocTete">
          <div>
            <h3>Sur le serveur</h3>
            <p className="pltAide">
              Mise à jour, restauration et journaux se font en SSH, avec la commande <code className="pltCode">companyos</code> :
              l'application n'a volontairement aucun accès aux conteneurs.
            </p>
          </div>
        </div>
        <ul className="pltCommandes">
          <li><code className="pltCode">sudo companyos mise-a-jour</code><span>sauvegarde, télécharge la dernière version, redémarre</span></li>
          <li><code className="pltCode">sudo companyos statut</code><span>services, HTTPS, consommation de chaque conteneur</span></li>
          <li><code className="pltCode">sudo companyos sauvegardes</code><span>les archives (une par base) ; <code className="pltCode">restaurer &lt;fichier&gt;</code> pour revenir en arrière</span></li>
          <li><code className="pltCode">sudo companyos journaux api</code><span>ce que fait l'API, en direct</span></li>
        </ul>
      </section>
    </>
  );
};
