// Console Plateforme — où atterrissent les fichiers.
//
// ─────────────────────────────────────────────────────────────────────────
// LE RÉGLAGE LE PLUS LOURD DE CONSÉQUENCES DU SAAS
//
// Il décide où vivent les fichiers de **tous** les clients. Trois
// précautions, chacune pour une façon de tout casser :
//
//   • La configuration est **essayée avant d'être adoptée** — on écrit un
//     objet témoin, on le relit, on le supprime. Un accès en lecture seule
//     ou un bucket mal nommé serait sinon découvert au premier
//     téléversement d'un client.
//   • La clé secrète ne revient **jamais** du serveur : l'écran en montre
//     les quatre derniers caractères. Laisser le champ vide conserve celle
//     déjà enregistrée.
//   • Changer de destination **ne déplace rien**. Chaque fichier retient
//     où il est ; les anciens continuent d'être lus là-bas. L'écran le dit
//     explicitement, parce que c'est contre-intuitif — et que croire
//     l'inverse mène à supprimer un bucket encore utilisé.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { Bouton, Champ, Notice } from "../../ui";

const octets = (n) => {
  const v = Number(n) || 0;
  if (v < 1024 ** 2) return `${Math.round(v / 1024)} Ko`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} Mo`;
  return `${(v / 1024 ** 3).toFixed(1)} Go`;
};

/// Les fournisseurs courants, avec ce qui change d'un à l'autre.
///
/// Chacun a ses pièges : R2 veut la région « auto », MinIO et les NAS
/// exigent le style « chemin », AWS accepte les deux. Les pré-remplir
/// évite la demi-heure de tâtonnement classique.
const FOURNISSEURS = [
  {
    id: "r2",
    nom: "Cloudflare R2",
    aide: "Adresse : https://<compte>.r2.cloudflarestorage.com",
    valeurs: { region: "auto", pathStyle: true },
  },
  {
    id: "aws",
    nom: "Amazon S3",
    aide: "Adresse : https://s3.<région>.amazonaws.com",
    valeurs: { region: "eu-west-3", pathStyle: false },
  },
  {
    id: "wasabi",
    nom: "Wasabi",
    aide: "Adresse : https://s3.<région>.wasabisys.com",
    valeurs: { region: "eu-central-1", pathStyle: true },
  },
  {
    id: "scaleway",
    nom: "Scaleway",
    aide: "Adresse : https://s3.<région>.scw.cloud",
    valeurs: { region: "fr-par", pathStyle: true },
  },
  {
    id: "minio",
    nom: "NAS ou serveur privé (MinIO, Garage, Ceph)",
    aide: "L'adresse de votre serveur, port compris. Le style « chemin » est requis.",
    valeurs: { region: "us-east-1", pathStyle: true },
  },
];

const VIDE = {
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKey: "",
  secretKey: "",
  prefix: "",
  pathStyle: true,
};

export const Stockage = ({ config, onRecharger }) => {
  const [stockage, setStockage] = useState(config?.actif || "local");
  const [s3, setS3] = useState({ ...VIDE, ...(config?.s3 || {}), secretKey: "" });
  const [occupe, setOccupe] = useState(false);
  const [essai, setEssai] = useState(null); // { ok, message }

  const maj = (patch) => {
    setS3((v) => ({ ...v, ...patch }));
    setEssai(null);
  };

  const appliquerFournisseur = (id) => {
    const f = FOURNISSEURS.find((x) => x.id === id);
    if (f) maj(f.valeurs);
  };

  const corps = () => ({
    stockage,
    s3: stockage === "s3" ? s3 : undefined,
  });

  const tester = async () => {
    setOccupe(true);
    setEssai(null);
    try {
      await api.plateformeStockageTest(corps());
      setEssai({ ok: true, message: "Écriture, lecture et suppression réussies." });
    } catch (e) {
      setEssai({ ok: false, message: e.message });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrer = async () => {
    const versObjet = stockage === "s3";
    const ok = await modal.confirm({
      title: versObjet ? "Basculer vers le stockage objet ?" : "Revenir au disque du serveur ?",
      message: versObjet
        ? `Les nouveaux fichiers de tous les espaces iront dans « ${s3.bucket} ».`
        : "Les nouveaux fichiers seront écrits sur le disque du serveur.",
      detail:
        "Les fichiers déjà enregistrés ne bougent pas : chacun retient sa destination et continue d'être lu depuis là. Il n'y a donc rien à migrer, et ce choix se défait aussi facilement.",
      confirmLabel: "Appliquer",
    });
    if (!ok) return;

    setOccupe(true);
    try {
      await api.plateformeStockage(corps());
      setS3((v) => ({ ...v, secretKey: "" })); // ne jamais garder le secret à l'écran
      await onRecharger?.();
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const repartition = config?.repartition || [];
  const nomDestination = (d) => (d === "s3" ? "Stockage objet" : "Disque du serveur");

  return (
    <section className="pltBloc">
      <div className="pltBlocTete">
        <div>
          <h3>Stockage des fichiers</h3>
          <p className="pltAide">
            Où atterrissent les fichiers de tous les espaces clients : le disque
            du serveur, ou un stockage objet compatible S3.
          </p>
        </div>
        <span className="pltPastilleEtat" data-actif={config?.actif}>
          {nomDestination(config?.actif)}
        </span>
      </div>

      {config?.secretIllisible ? (
        <Notice ton="attention" icone="faTriangleExclamation">
          La clé secrète enregistrée est illisible — le secret de chiffrement du
          serveur a changé depuis. Ressaisissez-la pour rétablir l'accès.
        </Notice>
      ) : null}

      {config?.demande === "s3" && !config?.utilisable ? (
        <Notice ton="attention" icone="faTriangleExclamation">
          Le stockage objet est demandé mais sa configuration est incomplète :
          les fichiers repartent sur le disque du serveur en attendant.
        </Notice>
      ) : null}

      {repartition.length > 1 ? (
        <Notice ton="info" icone="faCircleInfo">
          Vos fichiers sont répartis sur deux destinations — c'est normal après
          une bascule, et sans conséquence : chacun est relu là où il se trouve.
          Ne supprimez aucune des deux tant qu'elle contient des fichiers.
        </Notice>
      ) : null}

      {repartition.length ? (
        <div className="pltRepartition">
          {repartition.map((r) => (
            <div key={r.destination} className="pltRepartCase">
              <span className="pltRepartNom">{nomDestination(r.destination)}</span>
              <b>{r.fichiers} fichier(s)</b>
              <span className="pltRepartTaille">{octets(r.octets)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pltChoixStockage">
        {[
          { id: "local", nom: "Disque du serveur", aide: "Simple, sans compte externe. La sauvegarde vous incombe." },
          { id: "s3", nom: "Stockage objet (S3)", aide: "Amazon, Cloudflare R2, Wasabi, Scaleway, ou votre NAS." },
        ].map((o) => (
          <button
            key={o.id}
            type="button"
            className="pltOption"
            data-actif={stockage === o.id}
            onClick={() => { setStockage(o.id); setEssai(null); }}
          >
            <Icon fafa={o.id === "local" ? "faHardDrive" : "faCloud"} width={14} />
            <b>{o.nom}</b>
            <span>{o.aide}</span>
          </button>
        ))}
      </div>

      {stockage === "s3" ? (
        <div className="pltFormulaireS3">
          <Champ label="Fournisseur" aide="Pré-remplit la région et le style d'adresse">
            <select defaultValue="" onChange={(e) => appliquerFournisseur(e.target.value)}>
              <option value="">Choisir…</option>
              {FOURNISSEURS.map((f) => (
                <option key={f.id} value={f.id}>{f.nom}</option>
              ))}
            </select>
          </Champ>

          <Champ label="Adresse du service (endpoint)" aide="URL complète, https:// compris">
            <input
              value={s3.endpoint}
              placeholder="https://xxxx.r2.cloudflarestorage.com"
              onChange={(e) => maj({ endpoint: e.target.value.trim() })}
            />
          </Champ>

          <Champ label="Bucket">
            <input value={s3.bucket} placeholder="companyos-fichiers"
                   onChange={(e) => maj({ bucket: e.target.value.trim() })} />
          </Champ>

          <Champ label="Région" aide="« auto » chez Cloudflare R2">
            <input value={s3.region} placeholder="auto"
                   onChange={(e) => maj({ region: e.target.value.trim() })} />
          </Champ>

          <Champ label="Clé d'accès">
            <input value={s3.accessKey} autoComplete="off"
                   onChange={(e) => maj({ accessKey: e.target.value.trim() })} />
          </Champ>

          <Champ
            label="Clé secrète"
            aide={config?.s3?.secretMasque
              ? `Enregistrée (${config.s3.secretMasque}) — laissez vide pour la conserver`
              : "Chiffrée avant d'être enregistrée ; jamais réaffichée"}
          >
            <input
              type="password"
              value={s3.secretKey}
              autoComplete="new-password"
              placeholder={config?.s3?.secretMasque || ""}
              onChange={(e) => maj({ secretKey: e.target.value })}
            />
          </Champ>

          <Champ label="Préfixe" aide="Facultatif : un dossier dans le bucket">
            <input value={s3.prefix} placeholder="companyos/"
                   onChange={(e) => maj({ prefix: e.target.value.trim() })} />
          </Champ>

          <Champ
            label="Style d'adresse"
            aide="« Chemin » pour MinIO, un NAS et la plupart des fournisseurs"
          >
            <select
              value={s3.pathStyle ? "chemin" : "sousdomaine"}
              onChange={(e) => maj({ pathStyle: e.target.value === "chemin" })}
            >
              <option value="chemin">Chemin — https://service/bucket/objet</option>
              <option value="sousdomaine">Sous-domaine — https://bucket.service/objet</option>
            </select>
          </Champ>
        </div>
      ) : null}

      {essai ? (
        <Notice ton={essai.ok ? "ok" : "attention"}
                icone={essai.ok ? "faCircleCheck" : "faTriangleExclamation"}>
          {essai.message}
        </Notice>
      ) : null}

      <div className="pltActionsStockage">
        <Bouton variante="secondaire" icone="faVialCircleCheck" off={occupe} onClick={tester}>
          Tester la connexion
        </Bouton>
        <Bouton icone="faFloppyDisk" off={occupe} onClick={enregistrer}>
          Appliquer
        </Bouton>
        <span className="pltAide pltNoteEssai">
          L'enregistrement refait le test : une configuration qui ne répond pas
          n'est jamais adoptée.
        </span>
      </div>
    </section>
  );
};
