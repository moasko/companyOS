// Livraisons — formulaires (panneaux latéraux).
//
// Règle commune : le moins de saisie possible. Une livraison se crée en
// deux clics depuis une facture ; à la main, le client se choisit dans le
// CRM et remplit téléphone et commune ; un lien Google Maps collé donne la
// position. Sur le terrain, « Livrée » ne demande que ce qui prouve la
// remise, et l'encaissement est pré-rempli.

import React, { useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import * as L from "@companyos/shared/livraisons";
import { Panneau, ZoneSignature, fcfa, useLiv } from "./commun";

export const Champ = ({ label, aide, children, large }) => (
  <label className="lvChamp" data-large={large || undefined}>
    <span>{label}</span>
    {children}
    {aide ? <small>{aide}</small> : null}
  </label>
);

// ---------------------------------------------------------------------------
// Nouvelle / modifier une livraison
// ---------------------------------------------------------------------------

const VIDE = (jour) => ({
  type: "livraison", statut: "a_planifier", date: jour, creneau: { ...L.CRENEAUX[3] }, priorite: "normale",
  clientId: "", clientNom: "", contact: "", telephone: "", commune: "", adresse: "", repere: "", gps: null,
  colis: [], factureId: "", factureNumero: "", montantAEncaisser: 0, instructions: "", tourneeId: "", ordre: 0, livreurId: "",
});

export const FormLivraison = ({ contexte, onFermer }) => {
  const c = useLiv();
  const existante = contexte.livraison;
  const aLivrer = useMemo(() => L.facturesALivrer(c.factures, { mouvements: c.mouvements, livraisons: c.livraisons }), [c.factures, c.mouvements, c.livraisons]);
  const [mode, setMode] = useState(existante ? "saisie" : contexte.depuisFacture || contexte.factureId ? "facture" : "saisie");
  const [f, setF] = useState(() => {
    if (existante) return { ...VIDE(c.jour), ...existante.data };
    if (contexte.factureId) {
      const fac = c.factures.find((x) => x.id === contexte.factureId);
      if (fac) return L.depuisFacture(fac, { client: c.clients.find((x) => x.id === fac.data.clientId), reglements: c.reglements, jour: c.jour });
    }
    return { ...VIDE(contexte.date || c.jour) };
  });
  const [recherche, setRecherche] = useState("");
  const [lienGps, setLienGps] = useState("");
  const [choixFactures, setChoixFactures] = useState(() => new Set());
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const clientsTrouves = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return [];
    return c.clients.filter((x) => `${x.data.entreprise || ""} ${x.data.nom || ""} ${x.data.telephone || ""}`.toLowerCase().includes(q)).slice(0, 6);
  }, [recherche, c.clients]);

  const choisirClient = (cl) => {
    const commune = L.communeDe(cl.data.adresse || "") || L.communeDe(cl.data.ville || "");
    set({ clientId: cl.id, clientNom: cl.data.entreprise || cl.data.nom, contact: cl.data.nom || "", telephone: cl.data.telephone || "", commune: commune || f.commune, adresse: f.adresse || (L.communeDe(cl.data.adresse || "") ? "" : cl.data.adresse || "") });
    setRecherche("");
  };

  const manque = L.manques(f);

  const enregistrer = async () => {
    if (mode === "facture" && !existante) {
      const choisies = aLivrer.filter((x) => choixFactures.has(x.id));
      for (const fac of choisies) {
        await c.creerLivraison(L.depuisFacture(fac, { client: c.clients.find((x) => x.id === fac.data.clientId), reglements: c.reglements, jour: c.jour }));
      }
      onFermer();
      return;
    }
    const data = { ...f, montantAEncaisser: Math.max(0, Math.round(Number(f.montantAEncaisser) || 0)), colis: (f.colis || []).filter((x) => x.designation && Number(x.qte) > 0) };
    const ok = existante ? await c.modifierLivraison(existante, data) : await c.creerLivraison(data);
    if (ok) onFermer();
  };

  const pied = (
    <>
      <button type="button" className="lvBouton" data-variante="secondaire" onClick={onFermer}>Annuler</button>
      <span className="lvEspace" />
      {mode === "facture" && !existante ? (
        <button type="button" className="lvBouton" disabled={!choixFactures.size || c.occupe} onClick={enregistrer}>
          <Icon fafa="faPlus" width={11} /> Créer {choixFactures.size || ""} livraison{choixFactures.size > 1 ? "s" : ""}
        </button>
      ) : (
        <button type="button" className="lvBouton" disabled={manque.length > 0 || c.occupe} title={manque.length ? `Manque : ${manque.join(", ")}` : ""} onClick={enregistrer}>
          <Icon fafa="faCheck" width={11} /> {existante ? "Enregistrer" : "Créer la livraison"}
        </button>
      )}
    </>
  );

  return (
    <Panneau titre={existante ? `Modifier ${existante.data.numero}` : "Nouvelle livraison"} sousTitre={existante ? null : "Depuis une facture, ou saisie directe"} onFermer={onFermer} pied={pied} large>
      {!existante ? (
        <div className="lvSegment" role="tablist">
          <button type="button" role="tab" data-actif={mode === "facture" || undefined} aria-selected={mode === "facture"} onClick={() => setMode("facture")}>
            <Icon fafa="faFileInvoice" width={11} /> Depuis une facture {aLivrer.length ? <em>{aLivrer.length}</em> : null}
          </button>
          <button type="button" role="tab" data-actif={mode === "saisie" || undefined} aria-selected={mode === "saisie"} onClick={() => setMode("saisie")}>
            <Icon fafa="faPenToSquare" width={11} /> Saisie directe
          </button>
        </div>
      ) : null}

      {mode === "facture" && !existante ? (
        aLivrer.length ? (
          <div className="lvChoixFactures">
            <div className="lvAideBloc">Factures émises dont la marchandise n'est pas encore sortie du stock. Le client, les colis et le reste à encaisser sont repris automatiquement.</div>
            {aLivrer.map((fac) => {
              const reste = L.resteDu(fac, c.reglements);
              const nb = (fac.data.lignes || []).filter((x) => !x.livraison).reduce((s, x) => s + (Number(x.qte) || 0), 0);
              return (
                <label key={fac.id} className="lvLigneChoix" data-coche={choixFactures.has(fac.id) || undefined}>
                  <input type="checkbox" checked={choixFactures.has(fac.id)} onChange={() => setChoixFactures((s) => { const n = new Set(s); if (n.has(fac.id)) n.delete(fac.id); else n.add(fac.id); return n; })} />
                  <span className="lvLigneChoixCorps">
                    <b>{fac.data.clientEntreprise || fac.data.clientNom}</b>
                    <small><span className="lvMono">{fac.data.numero}</span> · {nb} article{nb > 1 ? "s" : ""} · {fac.data.clientVille || ""}</small>
                  </span>
                  <span className="lvLigneChoixMontant">{reste ? <>{fcfa(reste)}<small>à encaisser</small></> : <small>réglée</small>}</span>
                </label>
              );
            })}
            <button type="button" className="lvLien" onClick={() => setChoixFactures(new Set(aLivrer.map((x) => x.id)))}>Tout sélectionner</button>
          </div>
        ) : (
          <div className="lvVideMini">
            <Icon fafa="faCircleCheck" width={20} />
            <b>Aucune facture en attente de livraison</b>
            <span>Toutes les factures émises sont livrées ou déjà planifiées.</span>
            <button type="button" className="lvLien" onClick={() => setMode("saisie")}>Saisir une livraison</button>
          </div>
        )
      ) : (
        <div className="lvForm">
          <fieldset>
            <legend>Client</legend>
            {!f.clientId ? (
              <div className="lvRecherche">
                <Icon fafa="faMagnifyingGlass" width={11} />
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un client du CRM (nom, entreprise, téléphone)" aria-label="Chercher un client" />
                {clientsTrouves.length ? (
                  <ul className="lvSuggestions" role="listbox">
                    {clientsTrouves.map((cl) => (
                      <li key={cl.id} role="option" aria-selected="false" onMouseDown={(e) => (e.preventDefault(), choisirClient(cl))}>
                        <b>{cl.data.entreprise || cl.data.nom}</b>
                        <small>{[cl.data.nom, cl.data.telephone, cl.data.ville].filter(Boolean).join(" · ")}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="lvClientChoisi">
                <Icon fafa="faUserTie" width={13} />
                <b>{f.clientNom}</b>
                <button type="button" className="lvLien" onClick={() => set({ clientId: "" })}>Changer</button>
              </div>
            )}
            <div className="lvGrille2">
              <Champ label="Client / entreprise"><input value={f.clientNom} onChange={(e) => set({ clientNom: e.target.value })} placeholder="Hôtel Ivoire Lagune" /></Champ>
              <Champ label="Contact sur place"><input value={f.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="Paul Ahoussou" /></Champ>
              <Champ label="Téléphone" aide="Pour l'appel et WhatsApp"><input type="tel" value={f.telephone} onChange={(e) => set({ telephone: e.target.value })} placeholder="07 07 00 00 00" /></Champ>
              <Champ label="Priorité">
                <div className="lvMiniChips">
                  {Object.entries(L.PRIORITES).map(([id, p]) => (
                    <button key={id} type="button" data-actif={f.priorite === id || undefined} data-ton={id === "urgente" ? "danger" : undefined} onClick={() => set({ priorite: id })}>{p.label}</button>
                  ))}
                </div>
              </Champ>
            </div>
          </fieldset>

          <fieldset>
            <legend>Adresse</legend>
            <div className="lvGrille2">
              <Champ label="Commune / quartier">
                <select value={f.commune} onChange={(e) => set({ commune: e.target.value, ...(Number(f.montantAEncaisser) ? {} : {}) })}>
                  <option value="">Choisir…</option>
                  {L.LISTE_COMMUNES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Champ>
              <Champ label="Rue, immeuble"><input value={f.adresse} onChange={(e) => set({ adresse: e.target.value })} placeholder="Bd Latrille, immeuble Les Hévéas" /></Champ>
              <Champ label="Repère" aide="Ce qui aide vraiment le livreur à trouver" large><input value={f.repere} onChange={(e) => set({ repere: e.target.value })} placeholder="Derrière la pharmacie du Golf, portail vert" /></Champ>
              <Champ label="Position GPS (facultatif)" aide={f.gps ? `Position retenue : ${f.gps.lat.toFixed(5)}, ${f.gps.lng.toFixed(5)}` : "Collez le lien Google Maps envoyé par le client"} large>
                <input value={lienGps} onChange={(e) => { setLienGps(e.target.value); const g = L.gpsDepuisTexte(e.target.value); if (g) set({ gps: g }); }} placeholder="https://maps.google.com/?q=5.36,-3.98" />
              </Champ>
            </div>
          </fieldset>

          <fieldset>
            <legend>Quand</legend>
            <div className="lvGrille2">
              <Champ label="Date"><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Champ>
              <Champ label="Créneau">
                <div className="lvMiniChips">
                  {L.CRENEAUX.map((cr) => (
                    <button key={cr.id} type="button" data-actif={f.creneau?.debut === cr.debut && f.creneau?.fin === cr.fin || undefined} onClick={() => set({ creneau: { debut: cr.debut, fin: cr.fin } })} title={`${cr.debut}–${cr.fin}`}>{cr.label}</button>
                  ))}
                </div>
              </Champ>
            </div>
          </fieldset>

          <fieldset>
            <legend>Colis et paiement</legend>
            <Colis colis={f.colis || []} onChange={(colis) => set({ colis })} />
            <div className="lvGrille2">
              <Champ label="Montant à encaisser à la livraison" aide={f.factureId ? `Reste dû sur ${f.factureNumero}` : "0 si la commande est déjà payée"}>
                <div className="lvMontant"><input type="number" min="0" step="100" value={f.montantAEncaisser} onChange={(e) => set({ montantAEncaisser: e.target.value })} /><span>F CFA</span></div>
              </Champ>
              <Champ label="Frais de livraison indicatifs" aide="Selon la grille des Réglages">
                <div className="lvValeur">{f.commune ? fcfa(L.fraisLivraison(f.commune, c.reglages.tarifs)) : "Choisissez la commune"}</div>
              </Champ>
              <Champ label="Instructions au livreur" large><textarea rows={2} value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Appeler 15 min avant · livrer à la réception · fragile" /></Champ>
            </div>
          </fieldset>
          {manque.length ? <div className="lvManque"><Icon fafa="faCircleInfo" width={11} /> Il manque {manque.join(", ")}.</div> : null}
        </div>
      )}
    </Panneau>
  );
};

/// Lignes de colis : un article du stock, ou un libellé libre.
const Colis = ({ colis, onChange }) => {
  const c = useLiv();
  const articles = c.articles.filter((a) => !a.data.archive);
  const maj = (i, patch) => onChange(colis.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="lvColisSaisie">
      {colis.map((x, i) => (
        <div key={i} className="lvColisLigne">
          <input list="lv-articles" value={x.designation} onChange={(e) => { const a = articles.find((y) => y.data.designation === e.target.value); maj(i, { designation: e.target.value, articleId: a?.id || "" }); }} placeholder="Article ou description" aria-label="Article" />
          <input type="number" min="1" value={x.qte} onChange={(e) => maj(i, { qte: e.target.value })} aria-label="Quantité" />
          <button type="button" className="lvIconeBtn" aria-label="Retirer" onClick={() => onChange(colis.filter((_, j) => j !== i))}><Icon fafa="faXmark" width={10} /></button>
        </div>
      ))}
      <datalist id="lv-articles">{articles.map((a) => <option key={a.id} value={a.data.designation} />)}</datalist>
      <button type="button" className="lvLien" onClick={() => onChange([...colis, { designation: "", qte: 1, articleId: "" }])}><Icon fafa="faPlus" width={9} /> Ajouter un colis</button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tournée
// ---------------------------------------------------------------------------

export const FormTournee = ({ contexte, onFermer }) => {
  const c = useLiv();
  const t = contexte.tournee;
  const [f, setF] = useState(() => ({ date: contexte.date || c.jour, livreurId: contexte.livreurId || "", vehiculeId: "", notes: "", ...(t?.data || {}) }));
  const vehiculeDuLivreur = (id) => c.vehicules.find((v) => v.data.livreurId === id && v.data.statut !== "maintenance")?.id || "";
  const enregistrer = async () => {
    if (t) {
      if (await c.modifierTournee(t, f)) onFermer();
      return;
    }
    const nouvelle = await c.creerTournee(f);
    if (nouvelle && contexte.livraisons?.length) await c.affecter(contexte.livraisons, nouvelle);
    if (nouvelle) onFermer();
  };
  const pied = (
    <>
      {t ? <button type="button" className="lvBouton" data-variante="danger-doux" onClick={async () => { await c.supprimerTournee(t); onFermer(); }}>Supprimer</button> : <button type="button" className="lvBouton" data-variante="secondaire" onClick={onFermer}>Annuler</button>}
      <span className="lvEspace" />
      <button type="button" className="lvBouton" disabled={!f.livreurId || !f.date || c.occupe} onClick={enregistrer}><Icon fafa="faCheck" width={11} /> {t ? "Enregistrer" : "Créer la tournée"}</button>
    </>
  );
  return (
    <Panneau titre={t ? `Tournée ${t.data.numero}` : "Nouvelle tournée"} sousTitre="Un livreur, un véhicule, une journée" onFermer={onFermer} pied={pied}>
      <div className="lvForm">
        <Champ label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
        <Champ label="Livreur" aide="Les salariés des Ressources humaines">
          <div className="lvChoixListe">
            {c.livreurs.map((x) => (
              <button key={x.id} type="button" data-actif={f.livreurId === x.id || undefined} onClick={() => setF({ ...f, livreurId: x.id, vehiculeId: f.vehiculeId || vehiculeDuLivreur(x.id) })}>
                <b>{x.nom}</b>
                <small>{x.poste || "—"}</small>
              </button>
            ))}
          </div>
        </Champ>
        <Champ label="Véhicule">
          <select value={f.vehiculeId} onChange={(e) => setF({ ...f, vehiculeId: e.target.value })}>
            <option value="">Sans véhicule</option>
            {c.vehicules.map((v) => <option key={v.id} value={v.id} disabled={v.data.statut === "maintenance"}>{v.data.nom} — {L.TYPES_VEHICULE[v.data.type]?.label}{v.data.statut === "maintenance" ? " (en maintenance)" : ""}</option>)}
          </select>
        </Champ>
        <Champ label="Notes"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Passer d'abord récupérer la commande au dépôt de Yopougon" /></Champ>
        {contexte.livraisons?.length ? <div className="lvAideBloc">{contexte.livraisons.length} livraison(s) sélectionnée(s) y seront ajoutées.</div> : null}
      </div>
    </Panneau>
  );
};

// ---------------------------------------------------------------------------
// Véhicule
// ---------------------------------------------------------------------------

export const FormVehicule = ({ contexte, onFermer }) => {
  const c = useLiv();
  const v = contexte.vehicule;
  const [f, setF] = useState(() => ({ nom: "", type: "moto", immatriculation: "", livreurId: "", statut: "disponible", assuranceFin: "", visiteFin: "", kilometrage: "", prochaineVidange: "", notes: "", ...(v?.data || {}) }));
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const pied = (
    <>
      {v ? <button type="button" className="lvBouton" data-variante="danger-doux" onClick={async () => { await c.supprimerVehicule(v); onFermer(); }}>Retirer</button> : <button type="button" className="lvBouton" data-variante="secondaire" onClick={onFermer}>Annuler</button>}
      <span className="lvEspace" />
      <button type="button" className="lvBouton" disabled={!f.nom || c.occupe} onClick={async () => { if (await c.enregistrerVehicule(v, { ...f, kilometrage: Number(f.kilometrage) || 0, prochaineVidange: Number(f.prochaineVidange) || 0 })) onFermer(); }}><Icon fafa="faCheck" width={11} /> Enregistrer</button>
    </>
  );
  return (
    <Panneau titre={v ? v.data.nom : "Nouveau véhicule"} onFermer={onFermer} pied={pied}>
      <div className="lvForm">
        <Champ label="Type">
          <div className="lvMiniChips">
            {Object.entries(L.TYPES_VEHICULE).map(([id, t]) => <button key={id} type="button" data-actif={f.type === id || undefined} onClick={() => set({ type: id })}><Icon fafa={t.icone} width={11} /> {t.label}</button>)}
          </div>
        </Champ>
        <div className="lvGrille2">
          <Champ label="Nom"><input value={f.nom} onChange={(e) => set({ nom: e.target.value })} placeholder="Moto 2 — Yamaha" /></Champ>
          <Champ label="Immatriculation"><input value={f.immatriculation} onChange={(e) => set({ immatriculation: e.target.value.toUpperCase() })} placeholder="1234 AB 01" /></Champ>
          <Champ label="Livreur attitré">
            <select value={f.livreurId} onChange={(e) => set({ livreurId: e.target.value })}>
              <option value="">Aucun</option>
              {c.livreurs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </Champ>
          <Champ label="État">
            <select value={f.statut} onChange={(e) => set({ statut: e.target.value })}>
              <option value="disponible">Disponible</option>
              <option value="maintenance">En maintenance</option>
            </select>
          </Champ>
          <Champ label="Fin d'assurance"><input type="date" value={f.assuranceFin} onChange={(e) => set({ assuranceFin: e.target.value })} /></Champ>
          <Champ label="Prochaine visite technique"><input type="date" value={f.visiteFin} onChange={(e) => set({ visiteFin: e.target.value })} /></Champ>
          <Champ label="Kilométrage"><input type="number" min="0" value={f.kilometrage} onChange={(e) => set({ kilometrage: e.target.value })} /></Champ>
          <Champ label="Prochaine vidange à (km)"><input type="number" min="0" value={f.prochaineVidange} onChange={(e) => set({ prochaineVidange: e.target.value })} /></Champ>
        </div>
      </div>
    </Panneau>
  );
};

// ---------------------------------------------------------------------------
// Preuve de livraison
// ---------------------------------------------------------------------------

export const FormPreuve = ({ contexte, onFermer }) => {
  const c = useLiv();
  const l = c.livraisons.find((x) => x.id === contexte.livraisonId);
  const d = l?.data || {};
  const [recuPar, setRecuPar] = useState(d.contact || "");
  const [signature, setSignature] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [envoiPhoto, setEnvoiPhoto] = useState(false);
  const [montant, setMontant] = useState(Number(d.montantAEncaisser) || 0);
  const [moyen, setMoyen] = useState("especes");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const fichier = useRef(null);
  if (!l) return null;
  const aEncaisser = Number(d.montantAEncaisser) > 0;
  const mobile = L.moyenDe(moyen).reglement === "Mobile Money";

  const prendrePhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setEnvoiPhoto(true);
    try {
      setPhoto(await c.deposerPhoto(f, d.numero));
    } catch (err) {
      setPhoto({ erreur: err.message });
    } finally {
      setEnvoiPhoto(false);
    }
  };

  const valider = async () => {
    const le = new Date().toISOString();
    const ok = await c.changerStatut(l, "livree", {
      preuve: { recuPar: recuPar.trim(), signature, photo: photo?.id ? photo : null, le, note: note.trim() },
      ...(aEncaisser && Number(montant) > 0 ? { encaissement: { montant: Math.round(Number(montant)), moyen, reference: reference.trim(), le } } : {}),
      note: note.trim(),
    });
    if (ok) onFermer(true);
  };

  const pied = (
    <>
      <button type="button" className="lvBouton" data-variante="secondaire" onClick={onFermer}>Annuler</button>
      <span className="lvEspace" />
      <button type="button" className="lvBouton" data-variante="ok" data-large disabled={!recuPar.trim() || envoiPhoto || c.occupe} onClick={valider}>
        <Icon fafa="faCircleCheck" width={13} /> Confirmer la livraison
      </button>
    </>
  );

  return (
    <Panneau titre="Confirmer la livraison" sousTitre={`${d.numero} · ${d.clientNom || d.contact}`} onFermer={onFermer} pied={pied}>
      <div className="lvForm">
        <Champ label="Remis à"><input value={recuPar} onChange={(e) => setRecuPar(e.target.value)} placeholder="Nom de la personne qui reçoit" /></Champ>
        <Champ label="Signature du client"><ZoneSignature onChange={setSignature} /></Champ>
        <Champ label="Photo du colis remis (facultatif)">
          <input ref={fichier} type="file" accept="image/*" capture="environment" hidden onChange={prendrePhoto} />
          <button type="button" className="lvPhoto" onClick={() => fichier.current?.click()} disabled={envoiPhoto}>
            <Icon fafa={photo?.id ? "faCircleCheck" : "faCamera"} width={14} />
            {envoiPhoto ? "Envoi de la photo…" : photo?.id ? `Photo ajoutée — ${photo.name}` : photo?.erreur ? `Échec : ${photo.erreur}` : "Prendre une photo"}
          </button>
        </Champ>
        {aEncaisser ? (
          <fieldset className="lvEncaissement">
            <legend>Encaissement — {fcfa(d.montantAEncaisser)} attendus</legend>
            <div className="lvMoyens">
              {L.MOYENS.map((m) => (
                <button key={m.id} type="button" data-actif={moyen === m.id || undefined} onClick={() => setMoyen(m.id)} style={m.couleur ? { "--lvMoyen": m.couleur } : undefined}>
                  <i />
                  {m.label}
                </button>
              ))}
            </div>
            <div className="lvGrille2">
              <Champ label="Montant reçu"><div className="lvMontant"><input type="number" min="0" step="100" value={montant} onChange={(e) => setMontant(e.target.value)} /><span>F CFA</span></div></Champ>
              {mobile ? <Champ label="Référence de la transaction"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. MP261017.1530.A12345" /></Champ> : null}
            </div>
            {Number(montant) < Number(d.montantAEncaisser) ? <div className="lvManque"><Icon fafa="faTriangleExclamation" width={11} /> Paiement partiel : il restera {fcfa(Number(d.montantAEncaisser) - Number(montant))} à percevoir.</div> : null}
          </fieldset>
        ) : null}
        <Champ label="Remarque (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Colis laissé à la réception" /></Champ>
        <div className="lvAideBloc"><Icon fafa="faCircleInfo" width={11} /> {d.factureId ? "La facture recevra le règlement et le stock sortira automatiquement." : "Les colis liés au stock en sortiront automatiquement."}</div>
      </div>
    </Panneau>
  );
};

// ---------------------------------------------------------------------------
// Échec
// ---------------------------------------------------------------------------

export const FormEchec = ({ contexte, onFermer }) => {
  const c = useLiv();
  const l = c.livraisons.find((x) => x.id === contexte.livraisonId);
  const [motif, setMotif] = useState("absent");
  const [note, setNote] = useState("");
  const [reprogrammer, setReprogrammer] = useState(true);
  if (!l) return null;
  const valider = async () => {
    const motifLib = L.MOTIFS_ECHEC.find((m) => m.id === motif)?.label;
    const fiche = await c.changerStatut(l, "echec", { echec: { motif, note: note.trim(), le: new Date().toISOString() }, note: [motifLib, note.trim()].filter(Boolean).join(" — ") });
    if (fiche && reprogrammer) await c.changerStatut(fiche, "a_planifier", { date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), note: "Reprogrammée au lendemain" });
    if (fiche) onFermer(true);
  };
  const pied = (
    <>
      <button type="button" className="lvBouton" data-variante="secondaire" onClick={onFermer}>Annuler</button>
      <span className="lvEspace" />
      <button type="button" className="lvBouton" data-variante="danger" disabled={c.occupe} onClick={valider}><Icon fafa="faCircleXmark" width={12} /> Enregistrer l'échec</button>
    </>
  );
  return (
    <Panneau titre="Livraison impossible" sousTitre={`${l.data.numero} · ${l.data.clientNom || l.data.contact}`} onFermer={onFermer} pied={pied}>
      <div className="lvForm">
        <div className="lvMotifs" role="radiogroup" aria-label="Motif">
          {L.MOTIFS_ECHEC.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={motif === m.id} data-actif={motif === m.id || undefined} onClick={() => setMotif(m.id)}>{m.label}</button>
          ))}
        </div>
        <Champ label="Précision (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Gardien absent, rappeler après 17 h" /></Champ>
        <label className="lvCaseLigne"><input type="checkbox" checked={reprogrammer} onChange={(e) => setReprogrammer(e.target.checked)} /> Reprogrammer automatiquement à demain</label>
      </div>
    </Panneau>
  );
};
