// Campagnes.
//
// ─────────────────────────────────────────────────────────────────────────
// L'EMAIL MARKETING DE L'ENTREPRISE
//
// Le geste des grands ERP — Odoo en tête — ramené à ce qu'une PME en
// fait vraiment : choisir un public dans son CRM, écrire une fois,
// envoyer proprement. Une campagne se prépare en brouillon, se teste sur
// sa propre boîte, part tout de suite ou à l'heure programmée ; le
// serveur l'égrène par petits lots (voir server/src/campagnes.js), et la
// page suit la progression jusqu'aux chiffres finaux.
//
// Chaque message porte son lien de désinscription. Un désinscrit est
// marqué dans le CRM et ne reverra jamais une campagne — c'est la loi,
// et c'est surtout le seul moyen de rester lisible par ses clients.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import { appliquerModele } from "@companyos/shared/courrier";
import * as D from "@companyos/shared/campagnes";
import "./campagnes.scss";

export const manifest = {
  id: "campagnes",
  slug: "campagnes",
  name: "Campagnes",
  icon: "campagnes",
  action: "CAMPAGNESAPP",
  Window: CampagnesApp,
};

const STATUTS_CRM = {
  tous: "Tous les statuts",
  prospect: "Prospects",
  client: "Clients",
};

function CampagnesApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const peutLancer = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [campagnes, setCampagnes] = useState([]);
  const [clients, setClients] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [vue, setVue] = useState({ mode: "liste" }); // liste | edition {id?} | detail {id}
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [camp, cli, mod] = await Promise.all([
      api.records.list(manifest.slug, "campagnes"),
      api.records.list("crm", "clients").catch(() => []),
      api.records.list("courrier", "modeles").catch(() => []),
    ]);
    setCampagnes(camp.sort((a, b) => (b.data.creeLe || "").localeCompare(a.data.creeLe || "")));
    setClients(cli);
    setModeles(mod);
  }, []);
  const etat = useChargement(ouvert, charger);

  // Une campagne en cours d'envoi : la page se rafraîchit toute seule.
  useEffect(() => {
    if (!ouvert) return;
    if (!campagnes.some((c) => ["envoi", "programmee"].includes(c.data.statut))) return;
    const minuteur = setInterval(() => etat.rafraichir(), 6000);
    return () => clearInterval(minuteur);
  }, [ouvert, campagnes]);

  const desinscrits = useMemo(
    () => clients.filter((c) => c.data.emailDesinscrit).length,
    [clients],
  );

  // ---- Actions ------------------------------------------------------------

  const lancer = async (fiche, campagne, envoyerLe) => {
    const audience = D.audienceDe(clients, campagne.filtres);
    const ok = await modal.confirm({
      title: envoyerLe ? "Programmer la campagne ?" : "Lancer la campagne ?",
      message: `« ${campagne.nom} » partira vers ${audience.length} destinataire${audience.length > 1 ? "s" : ""}.`,
      detail: envoyerLe
        ? `L'envoi commencera le ${new Date(envoyerLe).toLocaleString("fr-FR")} — par petits lots, pour protéger votre réputation d'expéditeur.`
        : "L'envoi commence dans la minute, par petits lots — pour protéger votre réputation d'expéditeur.",
      confirmLabel: envoyerLe ? "Programmer" : "Lancer l'envoi",
    });
    if (!ok) return;

    setOccupe(true);
    try {
      const donnees = {
        ...campagne,
        statut: "programmee",
        envoyerLe: envoyerLe || "",
        destinataires: audience.map(D.destinataireDe),
        creeLe: campagne.creeLe || new Date().toISOString(),
      };
      if (fiche) {
        await api.records.update(manifest.slug, "campagnes", fiche.id, donnees);
      } else {
        await api.records.create(manifest.slug, "campagnes", donnees);
      }
      await etat.rafraichir();
      setVue({ mode: "liste" });
      notifier({
        titre: envoyerLe ? "Campagne programmée" : "Campagne lancée",
        message: `${audience.length} destinataire(s).`,
        app: "Campagnes",
        ton: "success",
      });
    } catch (e) {
      modal.alert({ title: "Lancement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrerBrouillon = async (fiche, campagne) => {
    setOccupe(true);
    try {
      const donnees = {
        ...campagne,
        statut: "brouillon",
        creeLe: campagne.creeLe || new Date().toISOString(),
      };
      if (fiche) {
        await api.records.update(manifest.slug, "campagnes", fiche.id, donnees);
      } else {
        await api.records.create(manifest.slug, "campagnes", donnees);
      }
      await etat.rafraichir();
      setVue({ mode: "liste" });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (fiche) => {
    const enCours = fiche.data.statut === "envoi";
    const ok = await modal.confirm({
      title: enCours ? "Arrêter et supprimer ?" : "Supprimer cette campagne ?",
      message: enCours
        ? `« ${fiche.data.nom} » est en cours d'envoi : les messages restants ne partiront pas.`
        : `« ${fiche.data.nom} » et ses résultats seront retirés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "campagnes", fiche.id);
    setVue({ mode: "liste" });
    await etat.rafraichir();
  };

  /// Le message tel qu'un destinataire le recevra — sur sa propre boîte.
  const testerSurSoi = async (campagne) => {
    const a = session.user?.email;
    if (!a) return;
    const exemple = D.audienceDe(clients, campagne.filtres)[0];
    const variables = exemple
      ? D.variablesPour(D.destinataireDe(exemple), session.tenant?.name || "")
      : { client: "Exemple Client", ville: "Abidjan", entreprise: session.tenant?.name || "" };
    setOccupe(true);
    try {
      await api.courrierEnvoyer({
        a,
        sujet: `[TEST] ${appliquerModele(campagne.sujet, variables)}`,
        texte: appliquerModele(campagne.texte, variables),
      });
      notifier({ titre: "Test envoyé", message: `Regardez la boîte ${a}.`, app: "Campagnes", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Test impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="cmpApp">
        <div className="cmpVerrou">Connectez-vous pour lancer des campagnes.</div>
      </ModuleWindow>
    );
  }

  const ficheOuverte = vue.id ? campagnes.find((c) => c.id === vue.id) : null;

  return (
    <ModuleWindow manifest={manifest} className="cmpApp">
      <div className="cmpShell">
        {vue.mode === "liste" ? (
          <Liste
            etat={etat}
            campagnes={campagnes}
            desinscrits={desinscrits}
            onNouvelle={() => setVue({ mode: "edition" })}
            onOuvrir={(c) =>
              setVue(c.data.statut === "brouillon" ? { mode: "edition", id: c.id } : { mode: "detail", id: c.id })
            }
          />
        ) : vue.mode === "edition" ? (
          <Editeur
            fiche={ficheOuverte}
            clients={clients}
            modeles={modeles}
            occupe={occupe}
            peutLancer={peutLancer}
            onRetour={() => setVue({ mode: "liste" })}
            onBrouillon={(c) => enregistrerBrouillon(ficheOuverte, c)}
            onTester={testerSurSoi}
            onLancer={(c, quand) => lancer(ficheOuverte, c, quand)}
            onSupprimer={ficheOuverte ? () => supprimer(ficheOuverte) : null}
          />
        ) : (
          <Detail
            fiche={ficheOuverte}
            onRetour={() => setVue({ mode: "liste" })}
            onSupprimer={() => supprimer(ficheOuverte)}
          />
        )}
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// La liste
// ---------------------------------------------------------------------------

const Liste = ({ etat, campagnes, desinscrits, onNouvelle, onOuvrir }) => (
  <div className="cmpListe cosScroll">
    <div className="cmpTete">
      <div>
        <h2>Campagnes</h2>
        <p className="cmpAide">
          Écrire à ses clients, proprement : audience du CRM, envoi cadencé,
          désinscription dans chaque message.
          {desinscrits ? ` ${desinscrits} contact(s) désinscrit(s), automatiquement écartés.` : ""}
        </p>
      </div>
      <Bouton icone="faPlus" onClick={onNouvelle}>
        Nouvelle campagne
      </Bouton>
    </div>

    <Contenu
      etat={etat}
      vide={!campagnes.length}
      lignes={4}
      rendreVide={() => (
        <Vide
          icone="faBullhorn"
          titre="Aucune campagne"
          aide="Nouvelle offre, fermeture annuelle, vœux : écrivez une fois, le CRM fournit les destinataires."
        >
          <Bouton icone="faPlus" onClick={onNouvelle}>
            Créer la première
          </Bouton>
        </Vide>
      )}
    >
      {campagnes.map((c) => {
        const bilan = D.resumeDe(c.data.destinataires);
        const s = D.STATUTS_CAMPAGNE[c.data.statut] || D.STATUTS_CAMPAGNE.brouillon;
        return (
          <div key={c.id} className="cmpCarte handcr" onClick={() => onOuvrir(c)}>
            <div className="cmpCarteHaut">
              <span className="cmpCarteNom">{c.data.nom || "(sans nom)"}</span>
              <span className="cmpEtat" data-ton={s.ton}>
                {s.label}
              </span>
            </div>
            <div className="cmpCarteSujet">{c.data.sujet}</div>
            {c.data.statut === "programmee" && c.data.envoyerLe ? (
              <div className="cmpCarteBas">
                Partira le {new Date(c.data.envoyerLe).toLocaleString("fr-FR")} —{" "}
                {bilan.total} destinataire(s)
              </div>
            ) : c.data.statut !== "brouillon" ? (
              <>
                <div className="cmpBarre">
                  <div className="cmpBarreFait" style={{ width: `${bilan.pourcent}%` }} />
                </div>
                <div className="cmpCarteBas">
                  {bilan.envoyes} envoyé(s)
                  {bilan.echecs ? ` · ${bilan.echecs} échec(s)` : ""}
                  {bilan.attente ? ` · ${bilan.attente} en attente` : ""} — sur {bilan.total}
                </div>
              </>
            ) : (
              <div className="cmpCarteBas">Brouillon — cliquez pour reprendre</div>
            )}
          </div>
        );
      })}
    </Contenu>
  </div>
);

// ---------------------------------------------------------------------------
// L'éditeur
// ---------------------------------------------------------------------------

const Editeur = ({
  fiche,
  clients,
  modeles,
  occupe,
  peutLancer,
  onRetour,
  onBrouillon,
  onTester,
  onLancer,
  onSupprimer,
}) => {
  const [c, setC] = useState({ ...D.CAMPAGNE_VIDE, ...(fiche?.data || {}) });
  const [quand, setQuand] = useState(""); // vide = tout de suite
  const maj = (patch) => setC((x) => ({ ...x, ...patch }));
  const majFiltres = (patch) => setC((x) => ({ ...x, filtres: { ...x.filtres, ...patch } }));

  const audience = useMemo(() => D.audienceDe(clients, c.filtres), [clients, c.filtres]);
  const villes = useMemo(() => D.valeursDe(clients, "ville"), [clients]);
  const secteurs = useMemo(() => D.valeursDe(clients, "secteur"), [clients]);
  const prete = D.prete({ ...c, destinataires: audience });

  const choisirModele = async () => {
    const m = await modal.open({
      title: "Partir d'un modèle",
      render: ({ close }) => (
        <div className="crrChoix cosScroll">
          {modeles.map((x) => (
            <div key={x.id} className="crrChoixLigne handcr" onClick={() => close(x)}>
              <div>
                <div className="crrChoixNom">{x.data.nom}</div>
                <div className="crrChoixChemin">{x.data.sujet}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    });
    if (m) maj({ sujet: m.data.sujet || "", texte: m.data.texte || "" });
  };

  return (
    <div className="cmpEditeur cosScroll">
      <div className="cmpBarreHaut">
        <Bouton variante="secondaire" icone="faArrowLeft" onClick={onRetour}>
          Campagnes
        </Bouton>
        <span className="cmpBarreTitre">{fiche ? "Reprendre la campagne" : "Nouvelle campagne"}</span>
        {onSupprimer ? (
          <Bouton variante="secondaire" icone="faTrashCan" onClick={onSupprimer}>
            Supprimer
          </Bouton>
        ) : null}
      </div>

      <div className="cmpSection">
        <h3>1 · La campagne</h3>
        <Champ label="Nom interne" aide="Pour vous y retrouver — le destinataire ne le voit pas">
          <input
            value={c.nom}
            placeholder="Offre de rentrée, Fermeture annuelle…"
            onChange={(e) => maj({ nom: e.target.value })}
            autoFocus
          />
        </Champ>
      </div>

      <div className="cmpSection">
        <h3>2 · L'audience</h3>
        <div className="cmpFiltres">
          <Champ label="Statut CRM">
            <select value={c.filtres.statut} onChange={(e) => majFiltres({ statut: e.target.value })}>
              {Object.entries(STATUTS_CRM).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Ville">
            <select value={c.filtres.ville} onChange={(e) => majFiltres({ ville: e.target.value })}>
              <option value="">Toutes</option>
              {villes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Secteur">
            <select value={c.filtres.secteur} onChange={(e) => majFiltres({ secteur: e.target.value })}>
              <option value="">Tous</option>
              {secteurs.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Champ>
        </div>
        <div className="cmpAudience" data-vide={!audience.length}>
          <Icon fafa="faUsers" width={13} />
          {audience.length
            ? `${audience.length} destinataire${audience.length > 1 ? "s" : ""} — adresses valides, désinscrits écartés`
            : "Personne ne correspond : élargissez les filtres, ou complétez les emails dans le CRM."}
        </div>
      </div>

      <div className="cmpSection">
        <h3>3 · Le message</h3>
        <div className="cmpMessageOutils">
          {modeles.length ? (
            <Bouton variante="secondaire" icone="faClone" onClick={choisirModele}>
              Partir d'un modèle
            </Bouton>
          ) : null}
          <span className="cmpAide">
            {"{{client}}"} et {"{{ville}}"} se remplissent pour chaque destinataire.
          </span>
        </div>
        <Champ label="Objet">
          <input
            value={c.sujet}
            placeholder="Du nouveau chez {{entreprise}}"
            onChange={(e) => maj({ sujet: e.target.value })}
          />
        </Champ>
        <Champ label="Message">
          <textarea
            rows={10}
            value={c.texte}
            placeholder={"Bonjour {{client}},\n\n…"}
            onChange={(e) => maj({ texte: e.target.value })}
          />
        </Champ>

        <div className="cmpCtaGrille">
          <Champ label="Bouton d'action" aide="Facultatif — c'est lui qui mesure les clics">
            <input
              value={c.cta?.label || ""}
              placeholder="Voir l'offre"
              onChange={(e) => maj({ cta: { ...c.cta, label: e.target.value } })}
            />
          </Champ>
          <Champ label="Lien du bouton">
            <input
              value={c.cta?.url || ""}
              placeholder="https://…"
              onChange={(e) => maj({ cta: { ...c.cta, url: e.target.value } })}
            />
          </Champ>
          <Champ label="Couleur" aide="Le bandeau et le bouton">
            <input
              type="color"
              value={c.couleur || "#e8590c"}
              onChange={(e) => maj({ couleur: e.target.value })}
            />
          </Champ>
        </div>
        <p className="cmpAide">
          Le message part en HTML habillé — bandeau, bouton, pied avec
          désinscription — et en version texte pour les boîtes austères.
          L'ouverture et le clic sont mesurés.
        </p>
      </div>

      <div className="cmpSection">
        <h3>Aperçu</h3>
        <ApercuMail campagne={c} />
      </div>

      <div className="cmpSection">
        <h3>4 · L'envoi</h3>
        <div className="cmpEnvoi">
          <Champ label="Quand" aide="Vide = dès maintenant">
            <input
              type="datetime-local"
              value={quand}
              onChange={(e) => setQuand(e.target.value)}
            />
          </Champ>
        </div>
        <div className="cmpActions">
          <Bouton variante="secondaire" icone="faFloppyDisk" off={occupe} onClick={() => onBrouillon(c)}>
            Garder en brouillon
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="faVial"
            off={occupe || !c.sujet.trim() || !c.texte.trim()}
            onClick={() => onTester(c)}
          >
            M'envoyer un test
          </Bouton>
          {peutLancer ? (
            <Bouton
              icone={quand ? "faClock" : "faPaperPlane"}
              off={occupe || !prete}
              onClick={() => onLancer(c, quand ? new Date(quand).toISOString() : "")}
            >
              {quand ? "Programmer" : "Lancer l'envoi"}
            </Bouton>
          ) : (
            <Notice>Seul un administrateur peut lancer l'envoi.</Notice>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// L'aperçu du mail, tel que le destinataire le recevra
// ---------------------------------------------------------------------------

const ApercuMail = ({ campagne }) => {
  const session = useSelector((state) => state.session);
  const variables = {
    client: "Koné Distribution",
    ville: "Abidjan",
    entreprise: session.tenant?.name || "Votre entreprise",
  };
  const html = D.htmlDe(
    {
      ...campagne,
      texte: appliquerModele(campagne.texte || "Votre message apparaîtra ici…", variables),
      sujet: appliquerModele(campagne.sujet || "", variables),
    },
    {
      entreprise: session.tenant?.name || "Votre entreprise",
      lienCta: campagne.cta?.url ? "#" : "",
      lienDesinscription: "#",
    },
  );
  return (
    <div className="cmpApercu">
      <div className="cmpApercuSujet">
        <Icon fafa="faEnvelope" width={12} />
        {appliquerModele(campagne.sujet, variables) || "(objet du message)"}
      </div>
      <iframe title="Aperçu du mail" srcDoc={html} sandbox="" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Le détail d'une campagne partie
// ---------------------------------------------------------------------------

const Detail = ({ fiche, onRetour, onSupprimer }) => {
  if (!fiche) return null;
  const c = fiche.data;
  const bilan = D.resumeDe(c.destinataires);
  const s = D.STATUTS_CAMPAGNE[c.statut] || D.STATUTS_CAMPAGNE.brouillon;

  return (
    <div className="cmpDetail cosScroll">
      <div className="cmpBarreHaut">
        <Bouton variante="secondaire" icone="faArrowLeft" onClick={onRetour}>
          Campagnes
        </Bouton>
        <span className="cmpBarreTitre">{c.nom}</span>
        <span className="cmpEtat" data-ton={s.ton}>
          {s.label}
        </span>
        <Bouton variante="secondaire" icone="faTrashCan" onClick={onSupprimer}>
          Supprimer
        </Bouton>
      </div>

      <div className="cmpChiffres">
        <div className="cmpChiffre">
          <b>{bilan.total}</b>
          <span>destinataires</span>
        </div>
        <div className="cmpChiffre" data-ton="ok">
          <b>{bilan.envoyes}</b>
          <span>envoyés</span>
        </div>
        <div className="cmpChiffre" data-ton={bilan.echecs ? "erreur" : undefined}>
          <b>{bilan.echecs}</b>
          <span>échecs</span>
        </div>
        <div className="cmpChiffre">
          <b>{bilan.attente}</b>
          <span>en attente</span>
        </div>
        <div className="cmpChiffre" data-ton="accent">
          <b>{bilan.tauxOuverture}%</b>
          <span>{bilan.ouverts} ouvert(s)</span>
        </div>
        <div className="cmpChiffre" data-ton="accent">
          <b>{bilan.tauxClic}%</b>
          <span>{bilan.cliques} clic(s)</span>
        </div>
        <div className="cmpChiffre" data-ton={bilan.desinscrits ? "erreur" : undefined}>
          <b>{bilan.desinscrits}</b>
          <span>désinscrit(s)</span>
        </div>
      </div>
      <p className="cmpAide" style={{ padding: "0 22px" }}>
        Les ouvertures reposent sur une image invisible : certaines boîtes la
        bloquent, le taux réel est donc au moins celui affiché.
      </p>

      {c.statut === "envoi" ? (
        <div className="cmpBarre cmpBarreGrande">
          <div className="cmpBarreFait" style={{ width: `${bilan.pourcent}%` }} />
        </div>
      ) : null}

      <div className="cmpSection">
        <h3>Le message</h3>
        <div className="cmpMessageLu">
          <div className="cmpMessageSujet">{c.sujet}</div>
          <div className="cmpMessageTexte">{c.texte}</div>
        </div>
      </div>

      <div className="cmpSection">
        <h3>Destinataires</h3>
        <div className="cmpDest">
          {c.destinataires.map((d) => (
            <div key={d.email} className="cmpDestLigne" data-statut={d.statut}>
              <span className="cmpDestNom">{d.nom}</span>
              <span className="cmpDestEmail">{d.email}</span>
              <span className="cmpDestBadges">
                {d.ouvert ? <span className="cmpBadge" title="A ouvert le message">ouvert</span> : null}
                {d.clique ? <span className="cmpBadge" data-fort="true" title="A cliqué sur le bouton">clic</span> : null}
                {d.desinscrit ? <span className="cmpBadge" data-negatif="true">désinscrit</span> : null}
              </span>
              <span className="cmpDestEtat">
                {d.statut === "envoye" ? (
                  <Icon fafa="faCircleCheck" width={11} />
                ) : d.statut === "echec" ? (
                  <span title={d.erreur || ""}>
                    <Icon fafa="faCircleXmark" width={11} />
                  </span>
                ) : (
                  <Icon fafa="faClock" width={11} />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
