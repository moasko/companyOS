// La fiche d'un compte, à 360° : ce que le CRM sait, et ce que les autres
// applications en disent — ventes, paiements, courriels, campagnes,
// projets — dans une seule chronologie. Et, en haut, chaque geste utile à
// un clic : appeler, écrire, planifier, chiffrer, livrer.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { montant } from "../../../../utils/monnaie";
import { ouvrirDansEditeur } from "../../../editeurFacturesRequest";
import { totaux, etatPaiement } from "@companyos/shared/facturation";
import { ETAPES_OUVERTES, nomDe } from "../domaine";
import { chronologieUnifiee } from "../regles";
import {
  abrege, dateCourte, ICONE_ACTIVITE, Initiales, lienItineraire, lienTel, lienWhatsapp,
  Pastille, TON_ACTIVITE, TON_ETAPE, Vide,
} from "../commun";

const COULEUR_SANTE = { bon: "var(--crm-green)", moyen: "var(--crm-amber)", risque: "var(--crm-red)" };
const TON_ROLE = { decideur: "info", facturation: "ok", influenceur: "violet" };

const FILTRES = {
  tout: null,
  echanges: ["echange", "courriel"],
  ventes: ["vente", "affaire"],
  paiements: ["paiement"],
  campagnes: ["campagne"],
  projets: ["projet"],
};

const Action = ({ icone, libelle, detail, onClick, href }) => {
  const contenu = (
    <>
      <Icon fafa={icone} width={13} />
      <span><b>{libelle}</b>{detail ? <em> {detail}</em> : null}</span>
    </>
  );
  return href ? (
    <a className="crmAction" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" onClick={onClick}>{contenu}</a>
  ) : (
    <button type="button" className="crmAction" onClick={onClick}>{contenu}</button>
  );
};

export const Fiche = ({ t, d, ctx, actions, client, membreDe, telephone, maintenant }) => {
  const [onglet, setOnglet] = useState("activite");
  const [filtre, setFiltre] = useState("tout");
  const [saisie, setSaisie] = useState("");
  const [voirSante, setVoirSante] = useState(false);

  const c = client.data;
  const contacts = d.contacts.filter((x) => x.data.clientId === client.id);
  const affaires = d.opportunites.filter((o) => o.data.clientId === client.id);
  const ouvertes = affaires.filter((o) => ETAPES_OUVERTES.includes(o.data.etape));
  const docs = d.documents
    .filter((x) => x.data.clientId === client.id && x.data.statut !== "brouillon")
    .sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
  const aVenir = d.activites
    .filter((a) => a.data.clientId === client.id && a.data.type === "tache" && !a.data.fait)
    .sort((a, b) => (a.data.echeance < b.data.echeance ? -1 : 1));
  const ventes = ctx.ventes[client.id] || {};
  const sante = ctx.sante[client.id] || { score: 50, niveau: "moyen", facteurs: [] };
  const resp = membreDe(c.responsableId);
  const contactDe = (id) => contacts.find((x) => x.id === id);

  const evenements = useMemo(
    () =>
      chronologieUnifiee({
        client,
        activites: d.activites,
        opportunites: d.opportunites,
        documents: d.documents,
        reglements: d.reglements,
        envois: d.envois,
        campagnes: d.campagnes,
        cartes: d.cartes,
        totauxDe: totaux,
      }),
    [client, d],
  );
  const visibles = FILTRES[filtre] ? evenements.filter((e) => FILTRES[filtre].includes(e.famille)) : evenements;

  /// Ce qu'on montre d'un événement : un code, une couleur, un titre, un
  /// détail et l'app d'où il vient.
  const decrire = (e) => {
    const r = e.record;
    switch (e.famille) {
      case "echange": {
        const contact = contactDe(r.data.contactId);
        const auteur = membreDe(r.data.auteurId)?.name;
        return {
          icone: ICONE_ACTIVITE[r.data.type] || "faNoteSticky",
          ton: TON_ACTIVITE[r.data.type],
          titre: r.data.resume,
          detail: [t(`ev_${r.data.type}`), r.data.resultat ? t(`res_${r.data.resultat}`) : "", contact ? [contact.data.prenom, contact.data.nom].join(" ") : "", auteur].filter(Boolean).join(" · "),
          app: "crm",
          onSupprimer: () => actions.supprimerActivite(r),
        };
      }
      case "affaire":
        return { icone: "faBriefcase", ton: TON_ETAPE[r.data.etape], titre: t("ev_affaire", { libelle: r.data.libelle, etape: t(`etape_${r.data.etape}`) }), detail: montant(r.data.montant), app: "crm", onOuvrir: () => actions.editerAffaire(r) };
      case "vente": {
        const type = ["devis", "avoir"].includes(r.data.type) ? r.data.type : "facture";
        const ep = etatPaiement(r, d.reglements, maintenant);
        return { icone: "faFileInvoice", ton: type === "devis" ? "info" : ep.id === "retard" ? "bad" : "ok", titre: t(`ev_${type}`, { numero: r.data.numero || "", montant: montant(e.montant) }), detail: ep.label && ep.id !== "sansObjet" ? ep.label : "", app: "facturation", onOuvrir: () => ouvrirDansEditeur({ id: r.id }) };
      }
      case "paiement":
        return { icone: "faMoneyBillWave", ton: "ok", titre: t("ev_paiement", { montant: montant(e.montant) }), detail: r.data.moyen || "", app: "facturation" };
      case "courriel":
        return { icone: "faEnvelope", ton: "idle", titre: t("ev_courriel", { sujet: r.data.sujet || "" }), detail: r.data.extrait || "", app: "courrier" };
      case "campagne":
        return { icone: "faBullhorn", ton: "orange", titre: t(e.action === "clic" ? "ev_clic" : "ev_ouverture", { nom: r.data.nom || r.data.sujet || "" }), detail: "", app: "campagnes" };
      case "projet":
        return { icone: "faDiagramProject", ton: "violet", titre: t("ev_projet", { titre: r.data.titre || "" }), detail: "", app: "projets", onOuvrir: () => actions.ouvrirApp("projets") };
      default:
        return { icone: "faCircle", ton: "idle", titre: "", detail: "", app: "crm" };
    }
  };

  const envoyer = async () => {
    if (await actions.saisieRapide(client.id, saisie)) setSaisie("");
  };

  const appeler = (tel, contactId = "") => ({
    href: lienTel(tel),
    onClick: () => setTimeout(() => actions.compteRendu(client.id, contactId), 400),
  });

  // ---- Morceaux ------------------------------------------------------------

  const chiffres = (
    <section className="crmCarte">
      <header className="crmCarteTete"><h2>{t("chiffres")}</h2><span className="crmMuted crmPetit">{t("sourceChiffres")}</span></header>
      <div className="crmChiffres">
        <div>
          <span className="crmMuted">{t("ca12")}</span>
          <strong>{abrege(ventes.ca12)}</strong>
          {ventes.evolution !== null && ventes.evolution !== undefined ? (
            <span className={ventes.evolution >= 0 ? "crmVert" : "crmRouge"}>{ventes.evolution >= 0 ? "+" : ""}{ventes.evolution} %</span>
          ) : null}
        </div>
        <div>
          <span className="crmMuted">{t("du")}</span>
          <strong className={ventes.echu > 0 ? "crmRouge" : ""}>{abrege(ventes.du)}</strong>
          {ventes.echu > 0 ? <span className="crmMuted">{t("dontEchu", { montant: abrege(ventes.echu) })}</span> : null}
        </div>
        <div>
          <span className="crmMuted">{t("pipelineCompte")}</span>
          <strong>{abrege(ouvertes.reduce((s, o) => s + (Number(o.data.montant) || 0), 0))}</strong>
          <span className="crmMuted">{t("nbAffaires", { n: ouvertes.length })}</span>
        </div>
        <div>
          <span className="crmMuted">{t("delaiPaiement")}</span>
          <strong>{ventes.delaiMoyen === null || ventes.delaiMoyen === undefined ? "—" : t("jours", { n: ventes.delaiMoyen })}</strong>
        </div>
      </div>
    </section>
  );

  const blocContacts = (complet) => (
    <section className="crmCarte">
      <header className="crmCarteTete">
        <h2>{t("contacts")}</h2>
        <button type="button" className="crmLien" onClick={() => actions.editerContact(null, client.id)}>{t("ajouter")}</button>
      </header>
      {contacts.length ? (
        <ul className="crmLignes">
          {contacts.map((x) => {
            const nom = [x.data.prenom, x.data.nom].filter(Boolean).join(" ");
            return (
              <li key={x.id} className="crmLigne">
                <Initiales nom={nom} />
                <button type="button" className="crmLigneCorps" onClick={() => actions.editerContact(x)}>
                  <strong>{nom} <Pastille ton={TON_ROLE[x.data.role] || "idle"}>{t(`role_${x.data.role || "autre"}`)}</Pastille></strong>
                  <span className="crmMuted">{[x.data.poste, complet ? x.data.email : ""].filter(Boolean).join(" · ")}</span>
                </button>
                {x.data.telephone ? <a className="crmIb" aria-label={`${t("appeler")} ${nom}`} {...appeler(x.data.telephone, x.id)}><Icon fafa="faPhone" width={12} /></a> : null}
                {x.data.email ? <button type="button" className="crmIb" aria-label={`${t("ecrire")} ${nom}`} onClick={() => actions.ecrire(client, x)}><Icon fafa="faEnvelope" width={12} /></button> : null}
                {complet ? <button type="button" className="crmIb" aria-label={t("supprimer")} onClick={() => actions.supprimerContact(x)}><Icon fafa="faTrash" width={11} /></button> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Vide icone="faUserPlus">{t("aucunContact")}</Vide>
      )}
    </section>
  );

  const blocAffaires = (
    <section className="crmCarte">
      <header className="crmCarteTete">
        <h2>{t("affaires")}</h2>
        <button type="button" className="crmLien" onClick={() => actions.editerAffaire(null, { clientId: client.id })}>{t("ajouter")}</button>
      </header>
      {affaires.length ? (
        <ul className="crmLignes">
          {affaires.map((o) => (
            <li key={o.id} className="crmLigne">
              <button type="button" className="crmLigneCorps" onClick={() => actions.editerAffaire(o)}>
                <strong>{o.data.libelle}</strong>
                <span className="crmMuted">
                  <Pastille ton={TON_ETAPE[o.data.etape]}>{t(`etape_${o.data.etape}`)}{o.data.etape === "perdue" && o.data.motifPerte ? ` — ${t(`motif_${o.data.motifPerte}`)}` : ""}</Pastille>
                  {ctx.stag[o.id]?.stagne ? <span className="crmRouge"> · {t("joursSansActivite", { n: ctx.stag[o.id].jours })}</span> : null}
                </span>
              </button>
              <strong>{abrege(o.data.montant)}</strong>
              {ETAPES_OUVERTES.includes(o.data.etape) ? (
                <button type="button" className="crmIb" aria-label={t("creerDevis")} title={t("creerDevis")} onClick={() => actions.creerDocument(client, o, "devis")}>
                  <Icon fafa="faFileInvoice" width={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Vide icone="faBriefcase">{t("aucuneAffaire")}</Vide>
      )}
    </section>
  );

  const chronologie = (
    <section className="crmCarte crmChrono">
      <div className="crmSaisie">
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && envoyer()}
          placeholder={t("saisieRapide")}
          aria-label={t("nouvelleActivite")}
        />
        <button type="button" className="crmBtn crmBtnPrimaire" onClick={envoyer} disabled={!saisie.trim()}>{t("enregistrer")}</button>
        <button type="button" className="crmIb" aria-label={t("nouvelleActivite")} title={t("nouvelleActivite")} onClick={() => actions.noterActivite(client.id)}>
          <Icon fafa="faSliders" width={12} />
        </button>
      </div>
      <div className="crmPills crmFiltresChrono">
        {Object.keys(FILTRES).map((f) => (
          <button key={f} type="button" className="crmPuce" data-on={filtre === f ? "1" : undefined} onClick={() => setFiltre(f)}>
            {t(`filtre${f[0].toUpperCase()}${f.slice(1)}`)}
          </button>
        ))}
      </div>
      {aVenir.length ? (
        <>
          <div className="crmIntertitre">{t("aVenir")}</div>
          <ul className="crmLignes">
            {aVenir.map((a) => {
              const retard = a.data.echeance < maintenant;
              return (
                <li key={a.id} className="crmEv" data-retard={retard ? "1" : undefined}>
                  <span className="crmEvIcone" data-ton={retard ? "bad" : "warn"}><Icon fafa="faListCheck" width={12} /></span>
                  <div className="crmEvCorps">
                    <strong>{a.data.resume}</strong>
                    <span className="crmMuted">{t("act_tache")} · {retard ? t("retardJ", { n: Math.round((new Date(maintenant) - new Date(a.data.echeance)) / 86400000) }) : dateCourte(a.data.echeance)}</span>
                  </div>
                  <div className="crmEvActions">
                    <button type="button" className="crmBtn crmBtnPetit" onClick={() => actions.basculerTache(a)}>{t("fait")}</button>
                    <button type="button" className="crmBtn crmBtnPetit" onClick={() => actions.reporterTache(a)}>{t("reporter")}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <div className="crmIntertitre">{t("historique")}</div>
      {visibles.length ? (
        <ul className="crmLignes">
          {visibles.slice(0, 80).map((e) => {
            const x = decrire(e);
            return (
              <li key={e.id} className="crmEv">
                <span className="crmEvIcone" data-ton={x.ton}><Icon fafa={x.icone} width={12} /></span>
                <div className="crmEvCorps">
                  {x.onOuvrir ? (
                    <button type="button" className="crmLienTexte" onClick={x.onOuvrir}><strong>{x.titre}</strong></button>
                  ) : (
                    <strong>{x.titre}</strong>
                  )}
                  <span className="crmMuted">{[t(`app_${x.app}`), x.detail].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="crmMuted crmPetit crmEvDate">{dateCourte(e.date)}</span>
                {x.onSupprimer ? (
                  <button type="button" className="crmIb crmIbDiscret" aria-label={t("supprimer")} onClick={x.onSupprimer}><Icon fafa="faXmark" width={10} /></button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Vide icone="faComments">{t("historiqueVide")}</Vide>
      )}
    </section>
  );

  const ventesOnglet = (
    <section className="crmCarte">
      <header className="crmCarteTete">
        <h2>{t("documents")}</h2>
        <button type="button" className="crmLien" onClick={() => actions.creerDocument(client, null, "devis")}>{t("creerDevis")}</button>
      </header>
      {docs.length ? (
        <div className="crmTableBoite crmTableBoiteSimple">
          <table className="crmTable">
            <tbody>
              {docs.map((x) => {
                const ep = etatPaiement(x, d.reglements, maintenant);
                return (
                  <tr key={x.id}>
                    <td><strong>{x.data.numero}</strong> <span className="crmMuted">{x.data.type}</span></td>
                    <td>{dateCourte(x.data.date)}</td>
                    <td className="crmNum">{montant(totaux(x.data).ttc)}</td>
                    <td>{ep.id !== "sansObjet" ? <Pastille ton={ep.ton === "off" ? "idle" : ep.ton}>{ep.label}</Pastille> : null}</td>
                    <td><button type="button" className="crmBtn crmBtnPetit" onClick={() => ouvrirDansEditeur({ id: x.id })}>{t("ouvrirDocument")}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Vide icone="faFileInvoice">{t("aucunDocument")}</Vide>
      )}
    </section>
  );

  const infos = (
    <section className="crmCarte">
      <header className="crmCarteTete">
        <h2>{t("ongletInfos")}</h2>
        <button type="button" className="crmLien" onClick={() => actions.editerCompte(client)}>{t("modifier")}</button>
      </header>
      <dl className="crmInfos">
        {[
          ["entreprise", c.entreprise], ["contactPrincipal", c.nom], ["telephone", c.telephone], ["email", c.email],
          ["adresse", c.adresse], ["ville", c.ville], ["secteur", c.secteur],
          ["source", c.source ? t(`source_${c.source}`) : ""], ["responsable", resp?.name],
          ["etiquettes", (c.etiquettes || []).join(", ")], ["notes", c.notes],
        ].map(([cle, v]) => (
          <div key={cle}><dt>{t(cle)}</dt><dd>{v || "—"}</dd></div>
        ))}
      </dl>
      <div className="crmInfosPied">
        <button type="button" className="crmBtn crmBtnDanger" onClick={() => actions.supprimerCompte(client)}>{t("supprimerCompte")}</button>
      </div>
    </section>
  );

  const ONGLETS = [
    ["activite", t("ongletActivite")],
    ["contacts", t("ongletContacts", { n: contacts.length })],
    ["affaires", t("ongletAffaires", { n: affaires.length })],
    ["ventes", t("ongletVentes")],
    ["infos", t("ongletInfos")],
  ];

  return (
    <div className="crmFiche">
      <header className="crmFicheTete">
        <button type="button" className="crmRetour" onClick={actions.fermerCompte}>
          <Icon fafa="faChevronLeft" width={10} /> {t("retour")}
        </button>
        <div className="crmFicheIdentite">
          <Initiales nom={nomDe(client)} taille={telephone ? 46 : 52} carre />
          <div className="crmFicheNom">
            <div className="crmFicheTitre">
              <h1>{nomDe(client)}</h1>
              <Pastille ton={{ prospect: "info", actif: "ok", inactif: "idle" }[c.statut]}>{t(`statut_${c.statut || "prospect"}`)}</Pastille>
              {c.secteur ? <Pastille>{c.secteur}</Pastille> : null}
              {(c.etiquettes || []).slice(0, 3).map((e) => <Pastille key={e} ton="violet">{e}</Pastille>)}
            </div>
            <p className="crmSous">
              {[c.entreprise ? c.nom : "", c.ville, resp ? `${t("responsable")} : ${resp.name}` : "", c.clientDepuis ? t("clientDepuis", { date: dateCourte(c.clientDepuis) }) : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button type="button" className="crmSante" onClick={() => setVoirSante((v) => !v)} aria-expanded={voirSante} title={t("sante")}>
            <span className="crmAnneau" style={{ "--pct": `${sante.score}%`, "--couleur": COULEUR_SANTE[sante.niveau] }}>
              <span>{sante.score}</span>
            </span>
            <span className="crmSanteTexte">
              <strong>{t("sante")}</strong>
              <span className="crmMuted">{t(`sante_${sante.niveau}`)}</span>
            </span>
          </button>
        </div>
        {voirSante ? (
          <ul className="crmFacteurs">
            {sante.facteurs.map((f) => (
              <li key={f.cle}>
                <Pastille ton={f.points >= 0 ? "ok" : "bad"}>{f.points > 0 ? `+${f.points}` : f.points}</Pastille> {t(`f_${f.cle}`, f)}
              </li>
            ))}
          </ul>
        ) : null}

        <div className={telephone ? "crmActionsRondes" : "crmActions"}>
          {c.telephone ? <Action icone="faPhone" libelle={t("appeler")} {...appeler(c.telephone)} /> : null}
          {c.email || contacts.some((x) => x.data.email) ? (
            <Action icone="faEnvelope" libelle={t("ecrire")} detail={telephone ? "" : t("viaCourrier")} onClick={() => actions.ecrire(client, contacts.find((x) => x.data.email && !c.email) || null)} />
          ) : null}
          {c.telephone ? <Action icone="faComment" libelle={t("whatsapp")} href={lienWhatsapp(c.telephone)} /> : null}
          {telephone && (c.adresse || c.ville) ? <Action icone="faLocationDot" libelle={t("itineraire")} href={lienItineraire(c.adresse, c.ville)} /> : null}
          <Action icone="faCalendarPlus" libelle={t("planifierRdv")} detail={telephone ? "" : t("viaAgenda")} onClick={() => actions.planifierRdv(client)} />
          <Action icone="faFileInvoice" libelle={t("creerDevis")} detail={telephone ? "" : t("viaEditeur")} onClick={() => actions.creerDocument(client, ouvertes[0] || null, "devis")} />
          {!telephone ? <Action icone="faDiagramProject" libelle={t("ouvrirProjet")} detail={t("viaProjets")} onClick={() => actions.ouvrirProjet(client, ouvertes[0] || null)} /> : null}
          {!telephone ? <Action icone="faBullhorn" libelle={t("ajouterCampagne")} onClick={() => actions.ajouterListe(client)} /> : null}
          {!telephone && (c.adresse || c.ville) ? <Action icone="faLocationDot" libelle={t("itineraire")} href={lienItineraire(c.adresse, c.ville)} /> : null}
        </div>

        <nav className="crmOnglets" aria-label={nomDe(client)}>
          {ONGLETS.map(([id, lib]) => (
            <button key={id} type="button" data-on={onglet === id ? "1" : undefined} aria-current={onglet === id ? "page" : undefined} onClick={() => setOnglet(id)}>
              {lib}
            </button>
          ))}
        </nav>
      </header>

      <div className="crmFicheCorps" data-onglet={onglet}>
        <div className="crmFichePrincipal">
          {telephone && onglet === "activite" ? chiffres : null}
          {onglet === "activite" ? chronologie : null}
          {onglet === "contacts" ? blocContacts(true) : null}
          {onglet === "affaires" ? blocAffaires : null}
          {onglet === "ventes" ? (<>{chiffres}{ventesOnglet}</>) : null}
          {onglet === "infos" ? infos : null}
        </div>
        {!telephone && onglet === "activite" ? (
          <aside className="crmFicheCote">
            {chiffres}
            {blocContacts(false)}
            {blocAffaires}
          </aside>
        ) : null}
      </div>
    </div>
  );
};
