import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { etatPaiement } from "@companyos/shared/facturation";
import { api } from "../../api/client";
import { cles, useAppsInstallees } from "../../api/queries";
import { ouvrirFenetre } from "../../apps/windows";
import { statistiques as statsStock } from "../../apps/modules/stock/domaine";
import { Icon } from "../../utils/general";
import "./aujourdhui.scss";
import { useDevise } from "../../utils/intl";

// « Aujourd'hui » — ce qui demande l'attention du jour, posé sur le bureau.
//
// Le bureau était un fond d'écran avec des icônes : on l'ouvrait pour aller
// ailleurs. Ce panneau répond à la question qu'un gérant se pose en
// arrivant — « qu'est-ce qui est rentré, qu'est-ce qui coince ? » — sans
// ouvrir quatre applications.
//
// Une ligne n'apparaît que si l'application est installée **et** que la
// personne a le droit de l'ouvrir : un vendeur ne voit pas les congés à
// valider, et le serveur refuserait de toute façon les données. Sans
// aucune ligne, le panneau ne s'affiche pas.
//
// Les modules lisent leurs données sans passer par le cache de requêtes :
// on ne peut donc pas compter sur leurs écritures pour invalider le nôtre.
// Il se recharge à intervalle régulier et au retour sur l'onglet.

const RAFRAICHIR = 2 * 60_000;
const CLE_REPLIE = "companyos-aujourdhui-replie";

const aujourdhui = () => new Date().toISOString().slice(0, 10);

export const dateDuJour = () =>
  new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

const useCollection = (module, collection, actif) =>
  useQuery({
    queryKey: [...cles.records(module, collection), "bureau"],
    queryFn: () => api.records.list(module, collection).catch(() => []),
    enabled: actif,
    staleTime: 60_000,
    refetchInterval: actif ? RAFRAICHIR : false,
  });

const lire = (cle, defaut) => {
  try {
    return localStorage.getItem(cle) ?? defaut;
  } catch {
    return defaut;
  }
};

export const Ligne = ({ icone, ton, titre, detail, app, libelle }) => (
  <button
    type="button"
    className="ajdLigne"
    data-ton={ton}
    onClick={() => ouvrirFenetre(app)}
    title={libelle}
  >
    <span className="ajdIcone">
      <Icon fafa={icone} width={13} />
    </span>
    <span className="ajdTexte">
      <b>{titre}</b>
      <small>{detail}</small>
    </span>
    <Icon fafa="faChevronRight" width={9} />
  </button>
);

/// Les lignes du jour, déjà filtrées par les droits de la personne.
/// Partagées par le panneau du bureau et le lanceur du téléphone.
export const useLignesDuJour = () => {
  const connecte = useSelector((s) => s.session.status === "authenticated");
  const { data: installees = [] } = useAppsInstallees();
  const { montant } = useDevise();

  const ouvrable = useMemo(() => {
    const ok = new Set(
      installees.filter((a) => a.autorise !== false).map((a) => a.slug),
    );
    return (slug) => connecte && ok.has(slug);
  }, [installees, connecte]);

  const factures = useCollection("facturation", "factures", ouvrable("facturation"));
  const reglements = useCollection("facturation", "reglements", ouvrable("facturation"));
  const tickets = useCollection("caisse", "tickets", ouvrable("caisse"));
  const articles = useCollection("stock", "articles", ouvrable("stock"));
  const mouvements = useCollection("stock", "mouvements", ouvrable("stock"));
  const absences = useCollection("rh", "absences", ouvrable("rh"));

  const lignes = useMemo(() => {
    const jour = aujourdhui();
    const l = [];
    // Une facture peut être libellée dans une autre devise : on n'additionne
    // que ce qui est en francs CFA, la monnaie de référence de l'espace,
    // plutôt que de mêler des euros et des francs dans un même total.
    const enFcfa = (d) => !d?.data?.devise || d.data.devise === "XOF";
    const docs = new Map((factures.data || []).map((d) => [d.id, d]));

    // Encaissé : les règlements de factures et les tickets de caisse du jour.
    if (ouvrable("facturation") || ouvrable("caisse")) {
      const parFacture = (reglements.data || [])
        .filter((r) => r.data?.date === jour && enFcfa(docs.get(r.data.documentId)))
        .reduce((s, r) => s + (Number(r.data.montant) || 0), 0);
      const ticketsJour = (tickets.data || []).filter(
        (t) => t.data?.date === jour && !t.data.annule,
      );
      const parCaisse = ticketsJour.reduce((s, t) => s + (Number(t.data.ttc) || 0), 0);
      const n = ticketsJour.length;
      l.push({
        cle: "encaisse",
        icone: "faCoins",
        ton: parFacture + parCaisse > 0 ? "ok" : "neutre",
        titre: montant(parFacture + parCaisse),
        detail:
          `encaissé aujourd'hui` +
          (n ? ` · ${n} ticket${n > 1 ? "s" : ""}` : ""),
        app: ouvrable("caisse") && parCaisse >= parFacture ? "caisse" : "facturation",
        libelle: "Voir les encaissements",
      });
    }

    if (ouvrable("facturation")) {
      const enRetard = (factures.data || [])
        .filter(enFcfa)
        .map((d) => etatPaiement(d, reglements.data || [], jour))
        .filter((e) => e.id === "retard");
      const reste = enRetard.reduce((s, e) => s + (e.reste || 0), 0);
      l.push({
        cle: "retard",
        icone: "faFileInvoice",
        ton: enRetard.length ? "alerte" : "ok",
        titre: enRetard.length
          ? `${enRetard.length} facture${enRetard.length > 1 ? "s" : ""} en retard`
          : "Aucune facture en retard",
        detail: enRetard.length ? `${montant(reste)} à relancer` : "tout est à jour",
        app: "facturation",
        libelle: "Ouvrir la Facturation",
      });
    }

    if (ouvrable("stock") && (articles.data || []).length) {
      const s = statsStock(articles.data || [], mouvements.data || []);
      const probleme = s.ruptures + s.alertes;
      l.push({
        cle: "stock",
        icone: "faBoxesStacked",
        ton: s.ruptures ? "alerte" : s.alertes ? "attention" : "ok",
        titre: probleme
          ? `${probleme} article${probleme > 1 ? "s" : ""} à réapprovisionner`
          : "Stock en ordre",
        detail: probleme
          ? `${s.ruptures} en rupture · ${s.alertes} sous le seuil`
          : `${s.total} article${s.total > 1 ? "s" : ""} suivis`,
        app: "stock",
        libelle: "Ouvrir le Stock",
      });
    }

    if (ouvrable("rh")) {
      const enAttente = (absences.data || []).filter((a) => a.data?.etat === "demande");
      if (enAttente.length) {
        l.push({
          cle: "conges",
          icone: "faUmbrellaBeach",
          ton: "attention",
          titre: `${enAttente.length} congé${enAttente.length > 1 ? "s" : ""} à valider`,
          detail: "demandes en attente de réponse",
          app: "rh",
          libelle: "Ouvrir les Ressources humaines",
        });
      }
    }

    return l;
  }, [
    ouvrable,
    montant,
    factures.data,
    reglements.data,
    tickets.data,
    articles.data,
    mouvements.data,
    absences.data,
  ]);

  return connecte ? lignes : [];
};

export const Aujourdhui = () => {
  const verrouille = useSelector((s) => s.wallpaper.locked);
  const lignes = useLignesDuJour();
  const [replie, setReplie] = useState(() => lire(CLE_REPLIE, "0") === "1");

  if (verrouille || !lignes.length) return null;

  const basculer = () => {
    const suivant = !replie;
    setReplie(suivant);
    try {
      localStorage.setItem(CLE_REPLIE, suivant ? "1" : "0");
    } catch {
      /* préférence de confort : sans stockage, le panneau reste ouvert */
    }
  };

  const date = dateDuJour();

  return (
    <aside className="ajdPanneau" data-replie={replie} aria-label="Aujourd'hui">
      <button
        type="button"
        className="ajdTete"
        onClick={basculer}
        aria-expanded={!replie}
      >
        <span>
          <b>Aujourd'hui</b>
          <small>{date}</small>
        </span>
        <Icon fafa={replie ? "faChevronDown" : "faChevronUp"} width={10} />
      </button>
      {replie ? null : (
        <div className="ajdLignes">
          {lignes.map(({ cle, ...ligne }) => (
            <Ligne key={cle} {...ligne} />
          ))}
        </div>
      )}
    </aside>
  );
};
