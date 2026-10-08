// Comptabilité — banque et rapprochement.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { saveToCloud } from "../../cloud";
import { choisirFichierCloud, blobDuFichier } from "../../ChoisirFichier";
import * as D from "./domaine";
import {
  REGLES_DEFAUT,
  ecritureDeLigne,
  etatRapprochement,
  fusionnerReleve,
  lignesTresorerie,
  lireReleve,
  rapprocher,
  regleDe,
} from "./banque";
import { chercherComptes, estTiers } from "./journaux";
import { rapportPdf } from "./pdf";
import { Bouton, Carte, Entete, Kpi, dateCourte, dateFr, nb, nbSigne, ouvrirPiece, rangerDansLeCloud, useCpt } from "./commun";

const PAR_RECORD = 250; // un enregistrement reste sous la limite de 64 Ko

export const Banque = () => {
  const ctx = useCpt();
  const { ecritures, relevesParCompte, reglages, entreprise, intention, creer, tache, rafraichir, majReglages, occupe, contrepasser } = ctx;
  const comptes = [
    { code: "521", label: `521 · ${entreprise.banque || "Banque"}` },
    { code: "531", label: `531 · ${entreprise.mobileOperateur || "Mobile Money"}` },
  ];
  const [compte, setCompte] = useState("521");
  const [filtre, setFiltre] = useState("arapprocher");
  const [toutesRegles, setToutesRegles] = useState(false);
  const fichier = useRef(null);

  const releve = useMemo(
    () => relevesParCompte[compte] || { lignes: [], records: [], solde: null, soldeAu: "" },
    [relevesParCompte, compte],
  );
  const regles = useMemo(() => reglages.regles || [], [reglages.regles]);
  const comptables = useMemo(() => lignesTresorerie(ecritures, compte), [ecritures, compte]);
  const pointees = useMemo(() => new Set(releve.lignes.map((l) => l.ecriture).filter(Boolean)), [releve.lignes]);
  const propositions = useMemo(
    () => rapprocher({ releve: releve.lignes, comptables, pointees, regles }),
    [releve.lignes, comptables, pointees, regles],
  );
  const etat = useMemo(
    () => etatRapprochement({ releve: releve.lignes, soldeReleve: releve.solde, ecritures, compte, au: releve.soldeAu || undefined }),
    [releve, ecritures, compte],
  );
  const correspondances = propositions.filter((p) => p.type === "correspondance");
  const auLivreSeulement = comptables.filter((c) => !pointees.has(c.cle) && (!releve.soldeAu || c.date <= releve.soldeAu) && !correspondances.some((p) => p.comptable.cle === c.cle));

  // ---- Import ---------------------------------------------------------------

  const importerTexte = async (texte, nom, node) => {
    let lu;
    try {
      lu = lireReleve(texte, nom);
    } catch (e) {
      modal.alert({ title: "Relevé illisible", message: e.message, tone: "error" });
      return;
    }
    const { ajoutees } = fusionnerReleve(releve.lignes, lu.lignes);
    const connues = new Set(releve.lignes.map((l) => l.id));
    const nouvelles = lu.lignes.filter((l) => !connues.has(l.id));
    if (!ajoutees) {
      modal.alert({ title: "Rien de nouveau", message: `Les ${lu.lignes.length} opérations de « ${nom} » sont déjà importées.` });
      return;
    }
    await tache(async () => {
      for (let i = 0; i < nouvelles.length; i += PAR_RECORD) {
        const morceau = nouvelles.slice(i, i + PAR_RECORD);
        const dernier = i + PAR_RECORD >= nouvelles.length;
        await api.records.create("comptabilite", "releves", {
          compte,
          fichier: node ? { id: node.id, name: node.name } : { name: nom },
          du: morceau[0].date,
          au: dernier ? lu.au : morceau[morceau.length - 1].date,
          solde: dernier ? lu.solde : null,
          importeLe: new Date().toISOString().slice(0, 10),
          lignes: morceau,
        });
      }
      await rafraichir();
    }, "Import impossible");
    modal.alert({
      title: `${ajoutees} opération(s) importée(s)`,
      message: `Du ${dateFr(lu.du)} au ${dateFr(lu.au)}${lu.solde != null ? `, solde ${nb(lu.solde)}` : ""}. Les correspondances sont proposées ci-dessous.`,
      tone: "success",
    });
  };

  const depuisOrdinateur = async (f) => {
    if (!f) return;
    const texte = await f.text();
    // Le relevé est archivé dans le Cloud : c'est la pièce justificative du
    // rapprochement.
    const node = await saveToCloud(f, f.name, { folder: "Comptabilité" }).catch(() => null);
    await importerTexte(texte, f.name, node);
  };

  const depuisCloud = async () => {
    const node = await choisirFichierCloud({
      titre: "Choisir un relevé bancaire",
      filtre: (n) => /\.(csv|ofx|qfx|txt)$/i.test(n.name),
    });
    if (!node) return;
    const blob = await blobDuFichier(node);
    await importerTexte(await blob.text(), node.name, node);
  };

  const choisirSource = async () => {
    const source = await modal.open({
      title: "Importer un relevé",
      render: ({ close }) => (
        <div className="cptChoixSource">
          <p>CSV ou OFX, tel que l'espace client de la banque le fournit. Les opérations déjà importées sont ignorées.</p>
          <button type="button" onClick={() => close("ordinateur")}>
            <Icon fafa="faUpload" width={16} />
            <span><b>Depuis l'ordinateur</b><small>Le fichier est aussi rangé dans le Cloud, dossier Comptabilité</small></span>
          </button>
          <button type="button" onClick={() => close("cloud")}>
            <Icon fafa="faCloud" width={16} />
            <span><b>Depuis le Cloud</b><small>Un relevé déjà enregistré</small></span>
          </button>
        </div>
      ),
    });
    if (source === "ordinateur") fichier.current?.click();
    if (source === "cloud") depuisCloud();
  };

  const dejaDemande = useRef(false);
  useEffect(() => {
    if (intention?.importer && !dejaDemande.current) {
      dejaDemande.current = true;
      choisirSource();
    }
  });

  // ---- Pointage -----------------------------------------------------------

  const pointer = (paires) =>
    tache(async () => {
      const parRecord = new Map();
      for (const { ligne, cle } of paires) {
        if (!parRecord.has(ligne.recordId)) parRecord.set(ligne.recordId, new Map());
        parRecord.get(ligne.recordId).set(ligne.id, cle);
      }
      for (const [id, maj] of parRecord) {
        const rec = releve.records.find((r) => r.id === id);
        if (!rec) continue;
        await api.records.update("comptabilite", "releves", id, {
          ...rec.data,
          lignes: rec.data.lignes.map((l) => {
            if (!maj.has(l.id)) return l;
            const cle = maj.get(l.id);
            const { ecriture: _avant, ...reste } = l;
            return cle ? { ...reste, ecriture: cle } : reste;
          }),
        });
      }
      await rafraichir();
    });

  const creerPour = async (p) => {
    const choix = await modal.open({
      title: "Constater cette opération",
      render: ({ close }) => <FormCreation proposition={p} comptables={comptables} pointees={pointees} close={close} />,
    });
    if (!choix) return;
    if (choix.cle) {
      await pointer([{ ligne: p.ligne, cle: choix.cle }]);
      return;
    }
    const e = ecritureDeLigne({
      ligne: p.ligne,
      compteBanque: compte,
      compte: choix.compte,
      tiers: choix.tiers,
      journal: compte === "531" ? "MM" : "BQ",
    });
    e.libelle = choix.libelle || e.libelle;
    const rec = await creer(e);
    if (rec) {
      const rang = e.lignes.findIndex((l) => l.compte === compte);
      await pointer([{ ligne: p.ligne, cle: `${rec.id}#${rang}` }]);
      if (choix.retenir && choix.motCle) {
        await majReglages({ regles: [...regles, { contient: choix.motCle.toUpperCase(), compte: choix.compte, libelle: D.intitule(choix.compte) }] });
      }
    }
  };

  // ---- Règles ---------------------------------------------------------------

  const ajouterRegle = async () => {
    const r = await modal.open({
      title: "Nouvelle règle",
      render: ({ close }) => <FormRegle close={close} />,
    });
    if (r) await majReglages({ regles: [...regles, r] });
  };
  const retirerRegle = (i) => majReglages({ regles: regles.filter((_, k) => k !== i) });
  const usage = (r) => releve.lignes.filter((l) => regleDe(l.libelle, [r]) === r || regleDe(l.libelle, []) === r).length;

  // ---- État de rapprochement (PDF) -----------------------------------------

  const exporterEtat = async () => {
    const lignes = [
      { style: "titre", cellules: ["Soldes"] },
      { cellules: ["", "Solde du relevé", releve.soldeAu ? dateFr(releve.soldeAu) : "", nb(releve.solde ?? 0)] },
      { cellules: ["", `Solde comptable ${compte}`, "", nb(etat.soldeComptable)] },
      { style: "sous", cellules: ["", "Écart à expliquer", "", nb(etat.ecart ?? 0)] },
      { style: "titre", cellules: ["Au relevé, pas encore en comptabilité"] },
      ...releve.lignes.filter((l) => !l.ecriture).map((l) => ({ cellules: [dateFr(l.date), l.libelle, l.reference || "", nbSigne(l.montant)] })),
      { style: "titre", cellules: ["En comptabilité, pas encore au relevé"] },
      ...auLivreSeulement.map((c) => ({ cellules: [dateFr(c.date), c.libelle, c.piece, nbSigne(c.montant)] })),
    ];
    const blob = rapportPdf({
      titre: "État de rapprochement",
      sousTitre: `${comptes.find((c) => c.code === compte)?.label} — au ${dateFr(releve.soldeAu || new Date().toISOString().slice(0, 10))}`,
      entreprise,
      colonnes: [
        { label: "Date", largeur: 0.13 },
        { label: "Libellé", largeur: 0.5 },
        { label: "Pièce", largeur: 0.17 },
        { label: "Montant", largeur: 0.2, align: "right" },
      ],
      lignes,
    });
    await rangerDansLeCloud(blob, `rapprochement-${compte}-${releve.soldeAu || "en-cours"}.pdf`, "État de rapprochement enregistré");
  };

  // ---- Rendu ----------------------------------------------------------------

  const lignesAffichees = useMemo(() => {
    const parId = new Map(propositions.map((p) => [p.ligne.id, p]));
    return [...releve.lignes]
      .reverse()
      .filter((l) => (filtre === "arapprocher" ? !l.ecriture : filtre === "rapprochees" ? !!l.ecriture : true))
      .map((l) => ({ ligne: l, proposition: parId.get(l.id) }));
  }, [releve.lignes, propositions, filtre]);

  const pct = etat.total ? Math.round((etat.pointees / etat.total) * 100) : 0;
  const ecritureDe = (cle) => ecritures.find((e) => e.id === String(cle).split("#")[0]);

  return (
    <div className="cptVue">
      <Entete titre="Rapprochement bancaire">
        <select aria-label="Compte de trésorerie" value={compte} onChange={(e) => setCompte(e.target.value)} className="cptSelectTete">
          {comptes.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
        <Bouton icone="faFileImport" onClick={choisirSource} disabled={occupe}>
          Importer un relevé (CSV, OFX)
        </Bouton>
        {correspondances.length ? (
          <Bouton
            variante="principal"
            icone="faCheckDouble"
            disabled={occupe}
            onClick={() => pointer(correspondances.map((p) => ({ ligne: p.ligne, cle: p.comptable.cle })))}
          >
            {correspondances.length > 1 ? `Valider les ${correspondances.length} correspondances` : "Valider la correspondance"}
          </Bouton>
        ) : null}
        <input
          ref={fichier}
          type="file"
          hidden
          accept=".csv,.ofx,.qfx,.txt,text/csv"
          onChange={(e) => {
            depuisOrdinateur(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Entete>

      <div className="cptConteneur">
        <section className="cptKpis" aria-label="Soldes">
          <Kpi
            label={releve.soldeAu ? `Solde du relevé au ${dateCourte(releve.soldeAu)}` : "Solde du relevé"}
            valeur={releve.solde != null ? D.fcfa(releve.solde) : "—"}
            aide={releve.solde == null ? "Le relevé importé n'indique pas de solde" : `${releve.records.length} import(s)`}
          />
          <Kpi label={`Solde comptable ${compte}`} valeur={D.fcfa(etat.soldeComptable)} aide={releve.soldeAu ? `au ${dateFr(releve.soldeAu)}` : "à ce jour"} />
          <Kpi
            label="Écart à expliquer"
            valeur={etat.ecart == null ? "—" : D.fcfa(etat.ecart)}
            ton={etat.ecart ? "attention" : etat.ecart === 0 ? "ok" : ""}
            aide={etat.ecart ? "Opérations à constater ou à pointer" : etat.ecart === 0 ? "Relevé et livres concordent" : ""}
          />
          <div className="cptKpi cptKpiProgres">
            <span className="cptKpiLabel">
              Lignes rapprochées <b>{etat.pointees} / {etat.total}</b>
            </span>
            <span className="cptProgresPiste"><span style={{ width: `${pct}%` }} /></span>
            <small>{auLivreSeulement.length} écriture(s) au journal pas encore au relevé</small>
          </div>
        </section>

        <div className="cptGrille">
          <Carte
            className="cptLarge"
            actions={
              <div className="cptOnglets" role="tablist">
                {[
                  ["arapprocher", `À rapprocher (${etat.restantes})`],
                  ["rapprochees", `Rapprochées (${etat.pointees})`],
                  ["toutes", "Toutes"],
                ].map(([id, label]) => (
                  <button type="button" key={id} role="tab" aria-selected={filtre === id} onClick={() => setFiltre(id)}>
                    {label}
                  </button>
                ))}
              </div>
            }
            titre={releve.lignes.length ? "Relevé et comptabilité" : null}
          >
            {!releve.lignes.length ? (
              <div className="cptVide">
                <Icon fafa="faBuildingColumns" width={26} />
                <b>Aucun relevé importé pour ce compte</b>
                <p>Téléchargez le relevé CSV ou OFX depuis l'espace client de votre banque, puis importez-le : chaque ligne trouvera son écriture.</p>
                <Bouton variante="principal" icone="faFileImport" onClick={choisirSource}>Importer un relevé</Bouton>
              </div>
            ) : (
              <div className="cptRapprochement">
                <div className="cptRapTete">
                  <span>Relevé</span>
                  <span />
                  <span>Dans la comptabilité</span>
                </div>
                {lignesAffichees.map(({ ligne: l, proposition: p }) => {
                  const e = l.ecriture ? ecritureDe(l.ecriture) : null;
                  return (
                    <div key={l.id} className="cptRapLigne">
                      <span className="cptRapReleve">
                        <span>
                          <b className="cptEllipse">{l.libelle}</b>
                          <b className="cptMt" data-sens={l.montant > 0 ? "entree" : "sortie"}>
                            {l.montant > 0 ? "+ " : "− "}
                            {nb(Math.abs(l.montant))}
                          </b>
                        </span>
                        <small>{dateFr(l.date)}{l.reference ? ` · ${l.reference}` : ""}</small>
                      </span>
                      <span aria-hidden="true" className="cptFleche">→</span>
                      {l.ecriture ? (
                        <span className="cptRapCible" data-etat="pointe">
                          <button type="button" className="cptRapTexte" onClick={() => e && ouvrirPiece(e, { onContrepasser: contrepasser })}>
                            <b>{e ? `${e.data.numero || e.data.piece || ""} ${e.data.libelle}` : "Écriture introuvable"}</b>
                            <small>Rapprochée</small>
                          </button>
                          <Bouton onClick={() => pointer([{ ligne: l, cle: null }])} disabled={occupe}>Dépointer</Bouton>
                        </span>
                      ) : p?.type === "correspondance" ? (
                        <span className="cptRapCible" data-etat="trouve">
                          <span className="cptRapTexte">
                            <b>{p.comptable.piece ? `${p.comptable.piece} — ` : ""}{p.comptable.libelle}</b>
                            <small>{p.raison} · {dateFr(p.comptable.date)}</small>
                          </span>
                          <Bouton variante="principal" disabled={occupe} onClick={() => pointer([{ ligne: l, cle: p.comptable.cle }])}>
                            Valider
                          </Bouton>
                        </span>
                      ) : (
                        <span className="cptRapCible" data-etat="classer">
                          <span className="cptRapTexte">
                            <b>Aucune écriture correspondante</b>
                            <small>{p?.raison || ""}</small>
                          </span>
                          <Bouton disabled={occupe} onClick={() => creerPour(p || { ligne: l, type: "creer" })}>
                            Créer l'écriture
                          </Bouton>
                        </span>
                      )}
                    </div>
                  );
                })}
                {!lignesAffichees.length ? <p className="cptRien">Rien dans ce filtre.</p> : null}
              </div>
            )}
          </Carte>

          <div className="cptColonne">
            <Carte
              titre="Règles automatiques"
              actions={<Bouton icone="faPlus" onClick={ajouterRegle}>Règle</Bouton>}
            >
              <ul className="cptRegles">
                {regles.map((r, i) => (
                  <li key={`u${i}`}>
                    <span>Si le libellé contient <b>« {r.contient} »</b></span>
                    <span>→ compte <b>{r.compte}</b> {r.libelle || D.intitule(r.compte)}</span>
                    <small>
                      S'applique à {usage(r)} ligne(s) ·{" "}
                      <button type="button" className="cptLien" onClick={() => retirerRegle(i)}>retirer</button>
                    </small>
                  </li>
                ))}
                {REGLES_DEFAUT.filter((r) => toutesRegles || usage(r) > 0).map((r) => (
                  <li key={r.contient} data-defaut="true">
                    <span>Si le libellé contient <b>« {r.contient} »</b></span>
                    <span>→ compte <b>{r.compte}</b> {r.libelle}</span>
                    <small>Règle d'office · {usage(r)} ligne(s)</small>
                  </li>
                ))}
              </ul>
              <button type="button" className="cptLien" onClick={() => setToutesRegles((x) => !x)}>
                {toutesRegles ? "Masquer les règles d'office inutilisées" : `Voir toutes les règles d'office (${REGLES_DEFAUT.length})`}
              </button>
            </Carte>
            <Carte titre="État de rapprochement" aide="Le document que demande l'expert-comptable à chaque clôture.">
              <Bouton icone="faFilePdf" onClick={exporterEtat} disabled={!releve.lignes.length && !comptables.length}>
                Enregistrer en PDF dans le Cloud
              </Bouton>
            </Carte>
            <div className="cptInfo">
              <Icon fafa="faCircleInfo" width={14} />
              <span>
                Une écriture rapprochée ne se supprime pas : pour la corriger, dépointez-la puis contre-passez-la. Le relevé importé reste archivé dans le Cloud.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/// Constater une ligne du relevé : créer l'écriture, ou l'associer à une
/// écriture existante d'un autre montant (règlement groupé, frais déduits).
const FormCreation = ({ proposition, comptables, pointees, close }) => {
  const l = proposition.ligne;
  const [compte, setCompte] = useState(proposition.regle?.compte || (l.montant > 0 ? "411" : "471"));
  const [tiers, setTiers] = useState("");
  const [libelle, setLibelle] = useState(l.libelle);
  const [retenir, setRetenir] = useState(false);
  const motCle = (l.libelle.split(/\s+/).find((m) => m.length > 3 && !/^(VIR|PRLV|RECU|PAIEMENT|VERSEMENT)$/i.test(m)) || "").toUpperCase();
  const candidats = comptables
    .filter((c) => !pointees.has(c.cle) && Math.sign(c.montant) === Math.sign(l.montant))
    .sort((a, b) => Math.abs(a.montant - l.montant) - Math.abs(b.montant - l.montant))
    .slice(0, 6);
  const suggestions = chercherComptes(compte, { max: 6 });
  return (
    <div className="cptForm">
      <p className="cptAide">
        {dateFr(l.date)} · {l.libelle} · <b>{nbSigne(l.montant)}</b>
      </p>
      <label>
        <span>Compte de contrepartie</span>
        <input list="cpt-comptes-rap" value={compte} onChange={(e) => setCompte(e.target.value.trim())} />
        <datalist id="cpt-comptes-rap">
          {suggestions.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </datalist>
        <small>{D.intitule(compte)}{compte === "471" ? " — à imputer avant la clôture" : ""}</small>
      </label>
      {estTiers(compte) ? (
        <label>
          <span>Client ou fournisseur</span>
          <input value={tiers} onChange={(e) => setTiers(e.target.value)} />
        </label>
      ) : null}
      <label>
        <span>Libellé</span>
        <input value={libelle} onChange={(e) => setLibelle(e.target.value)} />
      </label>
      {motCle ? (
        <label className="cptCase">
          <input type="checkbox" checked={retenir} onChange={(e) => setRetenir(e.target.checked)} />
          <span>Retenir : « {motCle} » → {compte} pour les prochains relevés</span>
        </label>
      ) : null}
      <div className="cptActions">
        <Bouton
          variante="principal"
          icone="faCheck"
          disabled={!/^[1-8]\d{1,7}$/.test(compte) || (estTiers(compte) && !tiers.trim())}
          onClick={() => close({ compte, tiers: tiers.trim(), libelle, retenir, motCle })}
        >
          Créer et rapprocher
        </Bouton>
        <Bouton onClick={() => close(null)}>Annuler</Bouton>
      </div>
      {candidats.length ? (
        <div className="cptCandidats">
          <b>Ou l'associer à une écriture déjà passée</b>
          {candidats.map((c) => (
            <button type="button" key={c.cle} onClick={() => close({ cle: c.cle })}>
              <span>{dateFr(c.date)} · {c.piece} {c.libelle}</span>
              <b>{nbSigne(c.montant)}</b>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const FormRegle = ({ close }) => {
  const [contient, setContient] = useState("");
  const [compte, setCompte] = useState("");
  return (
    <div className="cptForm">
      <label>
        <span>Si le libellé du relevé contient</span>
        <input autoFocus value={contient} placeholder="SODECI" onChange={(e) => setContient(e.target.value)} />
      </label>
      <label>
        <span>Alors proposer le compte</span>
        <input list="cpt-comptes-regle" value={compte} placeholder="605" onChange={(e) => setCompte(e.target.value.trim())} />
        <datalist id="cpt-comptes-regle">
          {chercherComptes(compte, { max: 8 }).map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </datalist>
        <small>{compte ? D.intitule(compte) : ""}</small>
      </label>
      <div className="cptActions">
        <Bouton
          variante="principal"
          disabled={!contient.trim() || !/^[1-8]\d{1,7}$/.test(compte)}
          onClick={() => close({ contient: contient.trim().toUpperCase(), compte, libelle: D.intitule(compte) })}
        >
          Ajouter la règle
        </Bouton>
        <Bouton onClick={() => close(null)}>Annuler</Bouton>
      </div>
    </div>
  );
};
