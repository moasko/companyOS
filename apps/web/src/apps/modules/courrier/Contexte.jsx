import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../../api/client";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { suivreLien, notifier } from "../../notifications";
import { ouvrirFenetre } from "../../windows";
import { nomAffiche } from "@companyos/shared/courrier";
import { initiales, teinte } from "./outils";

// Le correspondant vu par tout l'OS : son compte CRM, ses affaires, ses
// factures, sa fiche salarié, les tâches nées de ses courriels — et les
// gestes qui relient ce courriel au reste : créer le compte, consigner
// l'échange dans le CRM, créer une tâche, planifier un rendez-vous.

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const montant = (n) => `${Number(n || 0).toLocaleString("fr-FR")} F CFA`;
const ETAPES = { prospection: "Prospection", qualification: "Qualification", proposition: "Proposition", negociation: "Négociation" };
const STATUTS_FACTURE = { envoyee: "Envoyée", payee: "Payée", partielle: "Partiellement payée", retard: "En retard", annulee: "Annulée", acceptee: "Accepté", refusee: "Refusé" };

const Formulaire = ({ champs, valider, libelle, onValider }) => {
  const [v, setV] = useState(Object.fromEntries(champs.map((c) => [c.id, c.defaut ?? ""])));
  return (
    <form
      className="crrForm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valider || valider(v)) onValider(v);
      }}
    >
      {champs.map((c) => (
        <label key={c.id} className="crrFormChamp">
          <span>{c.libelle}</span>
          {c.options ? (
            <select value={v[c.id]} onChange={(e) => setV({ ...v, [c.id]: e.target.value })}>
              {c.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.libelle}
                </option>
              ))}
            </select>
          ) : c.multiligne ? (
            <textarea rows={4} value={v[c.id]} onChange={(e) => setV({ ...v, [c.id]: e.target.value })} />
          ) : (
            <input type={c.type || "text"} value={v[c.id]} required={c.requis} autoFocus={c.focus} onChange={(e) => setV({ ...v, [c.id]: e.target.value })} />
          )}
        </label>
      ))}
      <button type="submit" className="crrEnvoyer">
        {libelle}
      </button>
    </form>
  );
};

const demander = (titre, props) => modal.open({ title: titre, render: ({ close }) => <Formulaire {...props} onValider={close} /> });

export const Contexte = ({ personne, conversation, fil, onFerme, onLie }) => {
  const [ctx, setCtx] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const email = personne?.email;

  const charger = useCallback(async () => {
    if (!email) return;
    setCtx(await api.messagerie.contexte(email).catch(() => ({ erreur: true })));
  }, [email]);
  useEffect(() => {
    setCtx(null);
    charger();
  }, [charger]);

  if (!personne) return null;
  const client = ctx?.crm?.clients?.[0] || null;
  const dernier = fil?.messages?.[fil.messages.length - 1];
  const sujet = dernier?.sujet || conversation?.sujet || "";

  const agir = async (fn, succes) => {
    setOccupe(true);
    try {
      const r = await fn();
      if (succes) notifier({ titre: succes, app: "Courrier", ton: "success" });
      await charger();
      return r;
    } catch (e) {
      modal.alert({ title: "Action impossible", message: e.message, tone: "error" });
      return null;
    } finally {
      setOccupe(false);
    }
  };

  const lier = (lien) => dernier && api.messagerie.lier(dernier.id, lien).then(() => onLie?.());

  const creerCompte = () =>
    agir(async () => {
      const v = await demander("Créer le compte dans le CRM", {
        libelle: "Créer le compte",
        champs: [
          { id: "entreprise", libelle: "Entreprise", focus: true },
          { id: "nom", libelle: "Contact", defaut: personne.nom || nomAffiche(personne) },
          { id: "statut", libelle: "Statut", defaut: "prospect", options: [{ id: "prospect", libelle: "Prospect" }, { id: "actif", libelle: "Client actif" }] },
        ],
      });
      if (!v) return null;
      const c = await api.records.create("crm", "clients", { ...v, email, source: "courriel", etiquettes: [] });
      await lier({ app: "crm", collection: "clients", id: c.id, libelle: v.entreprise || v.nom });
      return c;
    }, "Compte créé dans le CRM");

  const consigner = () =>
    agir(async () => {
      await api.records.create("crm", "activites", { type: "email", resume: `Courriel — ${sujet}`, clientId: client.id, date: aujourdhui(), fait: true, faitLe: aujourdhui(), echeance: "" });
    }, "Échange consigné dans la chronologie du compte");

  const creerTache = () =>
    agir(async () => {
      let tableaux = await api.records.list("projets", "tableaux");
      const v = await demander("Créer une tâche dans Projets", {
        libelle: "Créer la tâche",
        champs: [
          { id: "titre", libelle: "Tâche", defaut: `Répondre — ${sujet}`.slice(0, 120), requis: true, focus: true },
          { id: "echeance", libelle: "Échéance", type: "date", defaut: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10) },
          ...(tableaux.length > 1 ? [{ id: "tableauId", libelle: "Tableau", defaut: tableaux[0].id, options: tableaux.map((t) => ({ id: t.id, libelle: t.data.nom })) }] : []),
        ],
      });
      if (!v) return null;
      let tableau = tableaux.find((t) => t.id === v.tableauId) || tableaux[0];
      if (!tableau) {
        const colonnes = [
          { id: Math.random().toString(36).slice(2, 9), titre: "À faire" },
          { id: Math.random().toString(36).slice(2, 9), titre: "En cours" },
          { id: Math.random().toString(36).slice(2, 9), titre: "Terminé" },
        ];
        tableau = await api.records.create("projets", "tableaux", { nom: "Courrier", couleur: "#ef6a45", colonnes });
        tableaux = [tableau];
      }
      const carte = await api.records.create("projets", "cartes", {
        tableauId: tableau.id,
        colonneId: tableau.data?.colonnes?.[0]?.id || "",
        ordre: 0,
        titre: v.titre,
        description: `Courriel de ${nomAffiche(personne)} <${email}> : « ${sujet} »\n\n${dernier?.extrait || ""}`,
        echeance: v.echeance || "",
        etiquettes: [],
        checklist: [],
        commentaires: [],
        pieces: [],
        liens: { courrielFil: conversation?.filId || dernier?.filId, ...(client ? { clientId: client.id } : {}) },
      });
      await lier({ app: "projets", collection: "cartes", id: carte.id, libelle: v.titre });
      return carte;
    }, "Tâche créée dans Projets");

  const planifier = () =>
    agir(async () => {
      const v = await demander("Planifier un rendez-vous", {
        libelle: "Ajouter à l'Agenda",
        champs: [
          { id: "titre", libelle: "Titre", defaut: `RDV — ${client?.nom || nomAffiche(personne)}`, requis: true, focus: true },
          { id: "date", libelle: "Date", type: "date", defaut: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), requis: true },
          { id: "heure", libelle: "Heure", type: "time", defaut: "10:00" },
          { id: "lieu", libelle: "Lieu ou lien de visio" },
        ],
      });
      if (!v) return null;
      const ev = await api.records.create("agenda", "evenements", { titre: v.titre, date: v.date, heure: v.heure, fin: "", lieu: v.lieu, ...(client ? { clientId: client.id } : {}), invites: [email] });
      await lier({ app: "agenda", collection: "evenements", id: ev.id, libelle: `${v.titre} (${new Date(v.date).toLocaleDateString("fr-FR")})` });
      return ev;
    }, "Rendez-vous ajouté à l'Agenda");

  return (
    <aside className="crrContexte cosScroll" aria-label="Correspondant">
      <div className="crrContexteTete">
        <span className="crrAvatar crrAvatarGrand" style={{ background: teinte(email) }}>
          {initiales(personne)}
        </span>
        <button type="button" className="crrIconeBtn crrContexteFermer" aria-label="Fermer" onClick={onFerme}>
          <Icon fafa="faXmark" width={11} />
        </button>
        <strong>{nomAffiche(personne)}</strong>
        <a href={`mailto:${email}`} onClick={(e) => e.preventDefault()}>
          {email}
        </a>
        {client ? <span className="crrBadge">{client.nom}</span> : null}
      </div>

      {!ctx ? <div className="crrContexteVide">Recherche dans les applications…</div> : null}

      {ctx && !ctx.erreur ? (
        <>
          <div className="crrContexteActions">
            {client ? (
              <button type="button" onClick={() => suivreLien({ lien: { app: "crm", params: { client: client.id } } })}>
                <Icon fafa="faUserTie" width={12} /> Ouvrir le compte
              </button>
            ) : ctx.crm ? (
              <button type="button" disabled={occupe} onClick={creerCompte}>
                <Icon fafa="faUserPlus" width={12} /> Créer le compte CRM
              </button>
            ) : null}
            {client ? (
              <button type="button" disabled={occupe} onClick={consigner}>
                <Icon fafa="faClockRotateLeft" width={12} /> Consigner dans le CRM
              </button>
            ) : null}
            <button type="button" disabled={occupe} onClick={creerTache}>
              <Icon fafa="faListCheck" width={12} /> Créer une tâche
            </button>
            <button type="button" disabled={occupe} onClick={planifier}>
              <Icon fafa="faCalendarPlus" width={12} /> Planifier un rendez-vous
            </button>
          </div>

          {client ? (
            <section className="crrContexteBloc">
              <h4>
                <Icon fafa="faBuilding" width={11} /> Compte CRM
              </h4>
              <div className="crrContexteLigne">
                <span>Statut</span>
                <strong>{client.statut === "actif" ? "Client actif" : client.statut === "prospect" ? "Prospect" : client.statut || "—"}</strong>
              </div>
              {client.ville ? (
                <div className="crrContexteLigne">
                  <span>Ville</span>
                  <strong>{client.ville}</strong>
                </div>
              ) : null}
              {client.telephone ? (
                <div className="crrContexteLigne">
                  <span>Téléphone</span>
                  <strong>{client.telephone}</strong>
                </div>
              ) : null}
            </section>
          ) : null}

          {ctx.crm?.opportunites?.length ? (
            <section className="crrContexteBloc">
              <h4>
                <Icon fafa="faHandshake" width={11} /> Affaires en cours
              </h4>
              {ctx.crm.opportunites.map((o) => (
                <button type="button" key={o.id} className="crrContexteItem" onClick={() => suivreLien({ lien: { app: "crm", params: { affaire: o.id } } })}>
                  <strong>{o.libelle}</strong>
                  <small>
                    {ETAPES[o.etape] || o.etape} · {montant(o.montant)}
                  </small>
                </button>
              ))}
            </section>
          ) : null}

          {ctx.facturation?.length ? (
            <section className="crrContexteBloc">
              <h4>
                <Icon fafa="faFileInvoice" width={11} /> Devis et factures
              </h4>
              {ctx.facturation.map((d) => (
                <button type="button" key={d.id} className="crrContexteItem" onClick={() => suivreLien({ lien: { app: "facturation", params: { facture: d.id } } })}>
                  <strong>{d.numero || (d.type === "devis" ? "Devis" : "Facture")}</strong>
                  <small>
                    {STATUTS_FACTURE[d.statut] || d.statut}
                    {d.echeance ? ` · échéance ${new Date(d.echeance).toLocaleDateString("fr-FR")}` : ""}
                  </small>
                </button>
              ))}
            </section>
          ) : null}

          {ctx.rh?.length ? (
            <section className="crrContexteBloc">
              <h4>
                <Icon fafa="faIdBadge" width={11} /> Équipe
              </h4>
              {ctx.rh.map((s) => (
                <button type="button" key={s.id} className="crrContexteItem" onClick={() => ouvrirFenetre("rh")}>
                  <strong>{s.nom}</strong>
                  <small>{[s.poste, s.service].filter(Boolean).join(" · ") || "Salarié"}</small>
                </button>
              ))}
            </section>
          ) : null}

          {ctx.projets?.length ? (
            <section className="crrContexteBloc">
              <h4>
                <Icon fafa="faTableColumns" width={11} /> Tâches liées
              </h4>
              {ctx.projets.map((c) => (
                <button type="button" key={c.id} className="crrContexteItem" onClick={() => suivreLien({ lien: { app: "projets", params: { carte: c.id } } })}>
                  <strong>{c.titre}</strong>
                  {c.echeance ? <small>échéance {new Date(c.echeance).toLocaleDateString("fr-FR")}</small> : null}
                </button>
              ))}
            </section>
          ) : null}

          <section className="crrContexteBloc">
            <h4>
              <Icon fafa="faEnvelopesBulk" width={11} /> Échanges
            </h4>
            <div className="crrContexteLigne">
              <span>Courriels</span>
              <strong>{ctx.echanges?.total || 0}</strong>
            </div>
            {ctx.echanges?.derniers?.[0] ? (
              <div className="crrContexteLigne">
                <span>Dernier</span>
                <strong>{new Date(ctx.echanges.derniers[0].date).toLocaleDateString("fr-FR")}</strong>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </aside>
  );
};
