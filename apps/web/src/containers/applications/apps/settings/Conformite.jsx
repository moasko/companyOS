import React, { useEffect, useState } from "react";
import { COLLECTIONS } from "@companyos/shared/automatisations";
import { api, apiFetch } from "../../../../api/client";
import { modal } from "../../../../apps/modalRequest";
import { ouvrirCorbeilleFiches } from "../../../../apps/historique";
import { Row, Toggle } from "./commun";

/// Télécharge un fichier servi par l'API avec la session (cookie).
const telecharger = async (url, nom) => {
  const r = await apiFetch(url);
  if (!r.ok) {
    const corps = await r.json().catch(() => null);
    throw new Error(corps?.error || `Erreur ${r.status}`);
  }
  const blob = await r.blob();
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(blob);
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
};

const jour = () => new Date().toISOString().slice(0, 10);

/// Paramètres → Données et conformité : accès à ses données, export de
/// l'espace, droit à l'effacement, fiches supprimées.
export const SectionConformite = ({ section, session, flash }) => {
  const role = session.user?.role;
  const admin = role === "OWNER" || role === "ADMIN";
  const proprietaire = role === "OWNER";
  const [occupe, setOccupe] = useState("");
  const [cible, setCible] = useState("");
  const [resultat, setResultat] = useState(null);
  const [collection, setCollection] = useState(`${COLLECTIONS[0].module}/${COLLECTIONS[0].collection}`);
  const [reglages, setReglages] = useState(null);
  const visible = section === "conformite";

  useEffect(() => {
    if (!visible) return;
    api.reglagesConformite().then(setReglages).catch(() => setReglages(null));
  }, [visible]);

  const basculerPartage = () =>
    agir("partage", async () => {
      const suivant = !reglages.partagePublic;
      if (!suivant) {
        const ok = await modal.confirm({
          title: "Désactiver les liens publics",
          message: "Les liens déjà envoyés cesseront aussitôt de fonctionner, et personne ne pourra en créer de nouveaux.",
          confirmLabel: "Désactiver",
          danger: true,
        });
        if (!ok) return;
      }
      setReglages(await api.enregistrerReglagesConformite({ partagePublic: suivant }));
    });

  const agir = async (cle, fn) => {
    if (occupe) return;
    setOccupe(cle);
    try {
      await fn();
    } catch (err) {
      flash(err.message);
    } finally {
      setOccupe("");
    }
  };

  const rechercher = () =>
    agir("recherche", async () => {
      setResultat({ valeur: cible.trim(), ...(await api.rechercherPersonne(cible.trim())) });
    });

  const anonymiser = () =>
    agir("effacement", async () => {
      const ok = await modal.confirm({
        title: "Effacer cette personne",
        message: `Les données personnelles liées à « ${resultat.valeur} » seront remplacées par « [anonymisé] » dans ${resultat.fiches.length} fiche(s), et leur historique purgé. C'est irréversible.`,
        confirmLabel: "Anonymiser",
        danger: true,
      });
      if (!ok) return;
      const r = await api.anonymiserPersonne(resultat.valeur);
      flash(`${r.fiches} fiche(s) anonymisée(s)${r.reste ? " — relancez pour traiter la suite" : ""}`);
      setResultat(null);
      setCible("");
    });

  return (
    <section className="setSection" data-hidden={section !== "conformite"}>
      <h2>Données et conformité</h2>
      <p className="setHint">
        Vos droits et ceux des personnes dont l'espace garde les données (RGPD et loi ivoirienne n° 2013-450) :
        accès, portabilité, effacement.
      </p>

      <div className="setSubTitle">Mes données</div>
      <div className="setList">
        <Row title="Télécharger mes données" desc="Profil, sessions, notifications, journal de vos actions et fiches que vous avez saisies, au format JSON.">
          <div className="setBtnGhost handcr" data-off={!!occupe} onClick={() => agir("mes", () => telecharger(api.urlMesDonnees(), `mes-donnees-${jour()}.json`))}>
            {occupe === "mes" ? "…" : "Télécharger"}
          </div>
        </Row>
      </div>

      {proprietaire ? (
        <>
          <div className="setSubTitle">Export de l'espace</div>
          <div className="setList">
            <Row
              title="Exporter tout l'espace"
              desc="Membres, applications, toutes les fiches, arborescence du Cloud, automatisations et journal, dans un seul fichier JSON — pour une sauvegarde ou une migration. Le contenu des fichiers se télécharge depuis le Cloud."
            >
              <div className="setBtnGhost handcr" data-off={!!occupe} onClick={() => agir("export", () => telecharger(api.urlExportEspace(), `export-companyos-${jour()}.json`))}>
                {occupe === "export" ? "Préparation…" : "Exporter"}
              </div>
            </Row>
          </div>
        </>
      ) : null}

      {admin && reglages ? (
        <>
          <div className="setSubTitle">Partage de fichiers</div>
          <div className="setList">
            <Row
              title="Autoriser les liens publics"
              desc="Les membres peuvent envoyer un fichier du Cloud par un lien (expiration obligatoire, mot de passe facultatif). Désactivé, tous les liens existants cessent de fonctionner."
            >
              <Toggle on={!!reglages.partagePublic} onClick={occupe ? undefined : basculerPartage} />
            </Row>
          </div>
        </>
      ) : null}

      {admin ? (
        <>
          <div className="setSubTitle">Droit à l'effacement</div>
          <p className="setHint">
            Un client, un candidat ou un ancien salarié demande l'effacement de ses données : retrouvez toutes les fiches qui le
            mentionnent, puis anonymisez-les. Les documents comptables restent (obligation de conservation), sans nom ni coordonnées.
          </p>
          <div className="setCard setConformiteRecherche">
            <input
              className="setInput"
              value={cible}
              placeholder="Adresse e-mail, téléphone ou nom complet"
              onChange={(e) => {
                setCible(e.target.value);
                setResultat(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && cible.trim().length >= 5 && rechercher()}
            />
            <div className="setPrimary handcr" data-off={!!occupe || cible.trim().length < 5} onClick={rechercher}>
              {occupe === "recherche" ? "…" : "Rechercher"}
            </div>
          </div>
          {resultat ? (
            <div className="setList">
              {resultat.compteMembre ? (
                <Row title={`Membre de l'espace : ${resultat.compteMembre}`} desc="Retirez d'abord son compte dans Espace de travail ; ses fiches restent à l'espace." />
              ) : null}
              {resultat.fiches.length ? (
                <>
                  {resultat.fiches.slice(0, 20).map((f) => (
                    <Row key={f.id} title={f.titre || "Fiche sans titre"} desc={`${f.module} · ${f.collection}`} />
                  ))}
                  {resultat.fiches.length > 20 ? <Row title={`… et ${resultat.fiches.length - 20} autre(s)`} /> : null}
                  <Row title={`${resultat.fiches.length} fiche(s) concernée(s)${resultat.tronque ? " (au moins)" : ""}`}>
                    <div className="setPrimary setDanger handcr" data-off={!!occupe} onClick={anonymiser}>
                      {occupe === "effacement" ? "…" : "Anonymiser"}
                    </div>
                  </Row>
                </>
              ) : (
                <div className="setEmptyBox">Aucune fiche ne mentionne « {resultat.valeur} ».</div>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="setSubTitle">Fiches supprimées</div>
      <p className="setHint">Une fiche supprimée reste récupérable six mois, avec son historique.</p>
      <div className="setCard setConformiteRecherche">
        <select className="setRole" value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Collection">
          {COLLECTIONS.map((c) => (
            <option key={`${c.module}/${c.collection}`} value={`${c.module}/${c.collection}`}>
              {c.libelle}
            </option>
          ))}
        </select>
        <div
          className="setBtnGhost handcr"
          onClick={() => {
            const [module, col] = collection.split("/");
            const libelle = COLLECTIONS.find((c) => c.module === module && c.collection === col)?.libelle;
            ouvrirCorbeilleFiches({ module, collection: col, titre: libelle, onRestaure: () => flash("Fiche restaurée") });
          }}
        >
          Voir les fiches supprimées
        </div>
      </div>
    </section>
  );
};
