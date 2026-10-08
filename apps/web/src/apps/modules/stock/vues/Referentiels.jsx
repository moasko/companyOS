// Stock — les référentiels : catégories (arbre libre) et fournisseurs.

import React, { useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../modalRequest";
import { api } from "../../../../api/client";
import { branche, chemin, parentsPossibles } from "../domaine";
import { Bouton, Carte, Entete, nombre, useS } from "../commun";

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export const Categories = () => {
  const s = useS();
  const { t, m, articles, categories, racines, stocks, couts, aller, enregistrerRecord, tache, rafraichir } = s;

  const compte = (id) => {
    const dans = new Set(branche(categories, id));
    const siens = articles.filter((a) => dans.has(a.data.categorieId));
    return { n: siens.length, valeur: siens.reduce((x, a) => x + Math.max(0, stocks[a.id] || 0) * (couts.get(a.id) || 0), 0) };
  };

  const nommer = async (noeud, parentId = null) => {
    const nom = await modal.prompt({
      title: noeud ? t("renommerCategorie") : parentId ? t("nouvelleSousCategorie") : t("nouvelleCategorie"),
      label: t("nom"),
      placeholder: t("exempleCategorie"),
      value: noeud?.data.nom || "",
      confirmLabel: noeud ? t("renommer") : t("creer"),
    });
    if (!nom?.trim()) return;
    await enregistrerRecord("categories", noeud?.id || null, noeud ? { ...noeud.data, nom: nom.trim() } : { nom: nom.trim(), parentId });
  };

  const deplacer = async (noeud) => {
    const possibles = parentsPossibles(categories, noeud.id);
    const choix = await modal.open({
      title: t("rangerCategorie", { nom: noeud.data.nom }),
      render: ({ close }) => (
        <div className="stoChoix">
          <button type="button" onClick={() => close({ id: null })}>{t("aLaRacine")}</button>
          {possibles.map((c) => (
            <button type="button" key={c.id} onClick={() => close({ id: c.id })}>{chemin(categories, c.id)}</button>
          ))}
        </div>
      ),
    });
    if (choix) await enregistrerRecord("categories", noeud.id, { ...noeud.data, parentId: choix.id });
  };

  const supprimer = async (noeud) => {
    const dans = new Set(branche(categories, noeud.id));
    const produits = articles.filter((a) => dans.has(a.data.categorieId));
    const ok = await modal.confirm({
      title: t("supprimerCategorie"),
      message: t("supprimerCategorieMessage", { nom: noeud.data.nom }),
      detail: dans.size > 1 || produits.length ? t("supprimerCategorieDetail", { s: dans.size - 1, n: produits.length }) : undefined,
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (!ok) return;
    // Les articles sont détachés, jamais supprimés : mal ranger un produit
    // ne doit pas pouvoir le faire disparaître du catalogue.
    await tache(async () => {
      for (const a of produits) await api.records.update("stock", "articles", a.id, { ...a.data, categorieId: "" });
      for (const id of dans) await api.records.remove("stock", "categories", id);
      await rafraichir();
    });
  };

  const Noeud = ({ n, niveau }) => {
    const c = compte(n.id);
    return (
      <>
        <div className="stoLigneT stoColsCat" role="row" style={{ "--niveau": niveau }}>
          <button type="button" className="stoLienTexte stoCatNom" onClick={() => aller("articles", { categorieId: n.id })}>
            <Icon fafa={n.enfants.length ? "faFolderOpen" : "faFolder"} width={12} />
            <span className="stoEllipse">{n.data.nom}</span>
          </button>
          <span className="stoMt stoDoux">{t("articlesN", { n: c.n })}</span>
          <span className="stoMt">{m(c.valeur)}</span>
          <span className="stoActionsLigne">
            <button type="button" className="stoIcone" title={t("nouvelleSousCategorie")} aria-label={t("nouvelleSousCategorie")} onClick={() => nommer(null, n.id)}><Icon fafa="faPlus" width={11} /></button>
            <button type="button" className="stoIcone" title={t("renommer")} aria-label={t("renommer")} onClick={() => nommer(n)}><Icon fafa="faPen" width={11} /></button>
            <button type="button" className="stoIcone" title={t("deplacer")} aria-label={t("deplacer")} onClick={() => deplacer(n)}><Icon fafa="faArrowsUpDownLeftRight" width={11} /></button>
            <button type="button" className="stoIcone" title={t("supprimer")} aria-label={t("supprimer")} onClick={() => supprimer(n)}><Icon fafa="faTrash" width={11} /></button>
          </span>
        </div>
        {n.enfants.map((e) => <Noeud key={e.id} n={e} niveau={niveau + 1} />)}
      </>
    );
  };

  return (
    <div className="stoVue">
      <Entete titre={t("navCategories")} sous={t("sousCategories", { n: categories.length })}>
        <Bouton variante="principal" icone="faPlus" onClick={() => nommer(null)}>{t("nouvelleCategorie")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <Carte>
          {racines.length ? (
            <div className="stoTableau" role="table">
              {racines.map((n) => <Noeud key={n.id} n={n} niveau={0} />)}
            </div>
          ) : (
            <p className="stoRien">{t("aucuneCategorie")}</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------

const CHAMPS_FOURNISSEUR = ["nom", "contact", "telephone", "email", "ville", "delai"];

const FormFournisseur = ({ t, initial, close }) => {
  const [v, setV] = useState({ nom: "", contact: "", telephone: "", email: "", ville: "", delai: "", ...initial });
  return (
    <div className="stoForm">
      {CHAMPS_FOURNISSEUR.map((k) => (
        <label key={k}>
          <span>{t(k === "delai" ? "delaiJours" : k)}</span>
          <input
            autoFocus={k === "nom"}
            type={k === "email" ? "email" : "text"}
            inputMode={k === "delai" ? "numeric" : k === "telephone" ? "tel" : undefined}
            value={v[k] ?? ""}
            onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))}
          />
        </label>
      ))}
      <div className="stoActionsForm">
        <Bouton onClick={() => close(null)}>{t("annuler")}</Bouton>
        <Bouton variante="principal" disabled={!String(v.nom).trim()} onClick={() => close({ ...v, nom: v.nom.trim(), delai: v.delai === "" ? "" : nombre(v.delai) })}>{t("enregistrer")}</Bouton>
      </div>
    </div>
  );
};

export const Fournisseurs = () => {
  const s = useS();
  const { t, m, fournisseurs, articles, commandes, suggestions, enregistrerRecord, supprimerRecord, aller } = s;

  const editer = async (f) => {
    const data = await modal.open({
      title: f ? f.data.nom : t("nouveauFournisseur"),
      render: ({ close }) => <FormFournisseur t={t} initial={f?.data || {}} close={close} />,
    });
    if (data) await enregistrerRecord("fournisseurs", f?.id || null, { ...(f?.data || {}), ...data });
  };

  const supprimer = async (f) => {
    const n = articles.filter((a) => a.data.fournisseurId === f.id).length;
    const ok = await modal.confirm({
      title: t("supprimerFournisseur"),
      message: t("supprimerFournisseurMessage", { nom: f.data.nom }),
      detail: n ? t("supprimerFournisseurDetail", { n }) : undefined,
      confirmLabel: t("supprimer"),
      danger: true,
    });
    if (ok) await supprimerRecord("fournisseurs", f.id);
  };

  const tries = [...fournisseurs].sort((a, b) => String(a.data.nom).localeCompare(String(b.data.nom)));

  return (
    <div className="stoVue">
      <Entete titre={t("navFournisseurs")} sous={t("sousFournisseurs", { n: fournisseurs.length })}>
        <Bouton variante="principal" icone="faPlus" onClick={() => editer(null)}>{t("nouveauFournisseur")}</Bouton>
      </Entete>
      <div className="stoConteneur">
        <Carte>
          {tries.length ? (
            <div className="stoTableau" role="table">
              <div className="stoLigneT stoEnteteT stoColsFour" role="row">
                <span>{t("nom")}</span>
                <span>{t("contact")}</span>
                <span className="stoMt">{t("navArticles")}</span>
                <span className="stoMt">{t("delaiJours")}</span>
                <span className="stoMt">{t("aCommander")}</span>
                <span />
              </div>
              {tries.map((f) => {
                const sugg = suggestions.filter((x) => x.fournisseurId === f.id);
                const ouvertes = commandes.filter((c) => c.data.fournisseurId === f.id && !["annulee", "recue"].includes(c.data.statut)).length;
                return (
                  <div key={f.id} className="stoLigneT stoColsFour" role="row">
                    <button type="button" className="stoQui stoLienTexte" onClick={() => editer(f)}>
                      <b className="stoEllipse">{f.data.nom}</b>
                      <small className="stoDoux">{[f.data.ville, ouvertes ? t("commandesOuvertes", { n: ouvertes }) : ""].filter(Boolean).join(" · ")}</small>
                    </button>
                    <span className="stoQui">
                      <span className="stoEllipse">{f.data.contact || "—"}</span>
                      <small className="stoDoux stoEllipse">{[f.data.telephone, f.data.email].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="stoMt">{articles.filter((a) => a.data.fournisseurId === f.id).length}</span>
                    <span className="stoMt stoDoux">{f.data.delai ? t("jours", { n: f.data.delai }) : "—"}</span>
                    <span className="stoMt">
                      {sugg.length ? (
                        <button type="button" className="stoLien" onClick={() => aller("reappro")}>{m(sugg.reduce((x, y) => x + y.montant, 0))}</button>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="stoActionsLigne">
                      <button type="button" className="stoIcone" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimer(f)}><Icon fafa="faTrash" width={11} /></button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="stoRien">{t("aucunFournisseur")}</p>
          )}
        </Carte>
      </div>
    </div>
  );
};
