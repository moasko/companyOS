// Livraisons — réglages : le dépôt (point de départ des tournées), les
// frais de livraison par commune et les messages WhatsApp envoyés aux
// clients. Tout a une valeur par défaut raisonnable pour Abidjan.

import React, { useState } from "react";
import { Icon } from "../../../utils/general";
import * as L from "@companyos/shared/livraisons";
import { Champ } from "./Formulaires";
import { fcfa, useLiv } from "./commun";

const MESSAGES = [
  { id: "planifiee", label: "Livraison planifiée" },
  { id: "en_route", label: "Livreur en route" },
  { id: "livree", label: "Livraison effectuée" },
  { id: "echec", label: "Livraison manquée" },
];
const VARIABLES = ["{client}", "{numero}", "{date}", "{creneau}", "{livreur}", "{telLivreur}", "{montant}", "{motif}", "{entreprise}"];

/// Les réglages enregistrés, complétés par les valeurs par défaut.
const depart = (r) => ({
  depot: { nom: "Dépôt", commune: "Marcory", adresse: "", ...(r.depot || {}) },
  tarifs: { ...L.TARIFS_DEFAUT, ...(r.tarifs || {}) },
  gabarits: { ...L.GABARITS, ...(r.gabarits || {}) },
});

export const Reglages = () => {
  const c = useLiv();
  const [f, setF] = useState(() => depart(c.reglages));
  const [ouvert, setOuvert] = useState("depot");
  const modifie = JSON.stringify(f) !== JSON.stringify(depart(c.reglages));

  const exemple = (type) =>
    L.messageClient(
      { data: { clientNom: "Aya Kouassi", contact: "Aya Kouassi", numero: "LIV-2026-0042", date: L.aujourdhui(), creneau: L.CRENEAUX[0], montantAEncaisser: 25000, echec: { motif: "absent" } } },
      type,
      { entreprise: c.entreprise?.nom || "Votre entreprise", livreur: "Ibrahim", telLivreur: "07 00 00 00 00", gabarits: f.gabarits },
    );

  const Section = ({ id, icone, titre, resume, children }) => (
    <section className="lvReglage" data-ouvert={ouvert === id || undefined}>
      <button type="button" className="lvReglageTete" onClick={() => setOuvert(ouvert === id ? null : id)} aria-expanded={ouvert === id}>
        <span className="lvReglageIcone"><Icon fafa={icone} width={14} /></span>
        <span><b>{titre}</b><small>{resume}</small></span>
        <Icon fafa={ouvert === id ? "faChevronUp" : "faChevronDown"} width={10} />
      </button>
      {ouvert === id ? <div className="lvReglageCorps">{children}</div> : null}
    </section>
  );

  return (
    <div className="lvVue lvReglages">
      {!c.telephone ? (
        <header className="lvEntete">
          <div>
            <h1>Réglages</h1>
            <p>Valables pour toute l'équipe.</p>
          </div>
        </header>
      ) : null}

      {Section({
        id: "depot",
        icone: "faWarehouse",
        titre: "Dépôt",
        resume: `${f.depot.nom} — ${f.depot.commune}. Point de départ et de retour des tournées.`,
        children: (
          <div className="lvGrille2">
            <Champ label="Nom"><input value={f.depot.nom} onChange={(e) => setF({ ...f, depot: { ...f.depot, nom: e.target.value } })} /></Champ>
            <Champ label="Commune" aide="Sert à calculer les distances et l'ordre de passage.">
              <select value={f.depot.commune} onChange={(e) => setF({ ...f, depot: { ...f.depot, commune: e.target.value } })}>
                {L.LISTE_COMMUNES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Champ>
            <Champ label="Adresse" large><input value={f.depot.adresse} onChange={(e) => setF({ ...f, depot: { ...f.depot, adresse: e.target.value } })} placeholder="Zone 4, rue du Dr Blanchard" /></Champ>
          </div>
        ),
      })}

      {Section({
        id: "tarifs",
        icone: "faTags",
        titre: "Frais de livraison",
        resume: "Montant indicatif par commune, proposé à la création d'une livraison.",
        children: (
          <>
            <div className="lvTarifs">
              {L.LISTE_COMMUNES.map((x) => (
                <label key={x}>
                  <span>{x}</span>
                  <input type="number" min="0" step="500" value={f.tarifs[x] ?? 0} onChange={(e) => setF({ ...f, tarifs: { ...f.tarifs, [x]: Number(e.target.value) || 0 } })} />
                  <small>F</small>
                </label>
              ))}
            </div>
            <p className="lvDiscret lvNote">Exemple : une livraison à Yopougon affichera {fcfa(f.tarifs.Yopougon)} de frais.</p>
          </>
        ),
      })}

      {Section({
        id: "messages",
        icone: "faCommentDots",
        titre: "Messages WhatsApp",
        resume: "Le texte préparé quand vous écrivez au client depuis une livraison.",
        children: (
          <>
            <div className="lvAideBloc">
              <Icon fafa="faCircleInfo" width={11} /> Variables disponibles : {VARIABLES.map((v) => <code key={v}>{v}</code>)}
            </div>
            {MESSAGES.map((m) => (
              <div key={m.id} className="lvGabarit">
                <Champ label={m.label} large>
                  <textarea rows={3} value={f.gabarits[m.id]} onChange={(e) => setF({ ...f, gabarits: { ...f.gabarits, [m.id]: e.target.value } })} />
                </Champ>
                <div className="lvBulle"><small>Aperçu</small>{exemple(m.id)}</div>
                {f.gabarits[m.id] !== L.GABARITS[m.id] ? (
                  <button type="button" className="lvLien" onClick={() => setF({ ...f, gabarits: { ...f.gabarits, [m.id]: L.GABARITS[m.id] } })}>Rétablir le texte d'origine</button>
                ) : null}
              </div>
            ))}
          </>
        ),
      })}

      <div className="lvReglagesPied" data-visible={modifie || undefined}>
        <span>{modifie ? "Modifications non enregistrées" : "Tout est enregistré"}</span>
        <span className="lvEspace" />
        <button type="button" className="lvBouton" data-variante="secondaire" disabled={!modifie} onClick={() => setF(depart(c.reglages))}>
          Annuler
        </button>
        <button type="button" className="lvBouton" disabled={!modifie || c.occupe} onClick={() => c.enregistrerReglages(f)}>
          <Icon fafa="faCheck" width={11} /> Enregistrer
        </button>
      </div>
    </div>
  );
};
