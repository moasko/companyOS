import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { saveAs } from "../../cloud";
import {
  Accueil,
  FenetreMedia,
  Vignette,
  formatBytes,
  sansExtension,
  useVisionneuse,
} from "../_visionneuse/commun";
import { creerScene, extensionDe } from "./moteur";
import "./objet3d.scss";
import { useNomApp } from "../../../utils/nomsApps";

/// Visionneuse 3D du socle.
///
/// Application système : elle fait partie de l'OS, comme les lecteurs
/// audio, vidéo et PDF. On ne l'installe pas, on ne la désinstalle pas, et
/// n'importe quel module peut lui envoyer un fichier — il suffit
/// d'appeler `ouvrirFichier(node)` de `src/apps/openRequest.js`, qui
/// choisit la visionneuse d'après l'extension.
export const manifest = {
  id: "objet3d",
  name: "Visionneuse 3D",
  icon: "objet3d",
  action: "OBJET3D",
  systeme: true,
  version: "1.0.0",
  Window: Objet3DApp,
};

const nf = new Intl.NumberFormat("fr-FR");

function Objet3DApp() {
  const nomApp = useNomApp();
  // Mode « flux » : un modèle 3D pèse souvent des dizaines de mégaoctets,
  // et les chargeurs de three.js prennent une URL. Inutile de le rapatrier
  // en mémoire avant de le donner au moteur.
  const v = useVisionneuse("objet3d", "OBJET3D", "objet3d", "flux");

  const [noeud, setNoeud] = useState(null);
  const moteur = useRef(null);
  const [etat, setEtat] = useState({});
  const [erreur, setErreur] = useState("");
  const [grille, setGrille] = useState(true);
  const [fond, setFond] = useState(false);

  // La scène vit aussi longtemps que la fenêtre, pas que le fichier :
  // recréer un contexte WebGL à chaque modèle en épuiserait le quota, que
  // les navigateurs limitent à une poignée par page.
  //
  // `noeud` est posé par une ref de rappel, pas lu depuis `conteneur.current` :
  // un effet ne peut pas dépendre de la valeur d'une ref, et il s'exécutait
  // avant que le conteneur n'existe — la scène n'était jamais créée.
  useEffect(() => {
    if (!noeud || v.wnapp?.hide) return;

    let vivant = true;
    creerScene(noeud, { onEtat: (e) => vivant && setEtat((a) => ({ ...a, ...e })) })
      .then((m) => {
        if (!vivant) {
          m.detruire();
          return;
        }
        moteur.current = m;
        setEtat({ pret: true });
      })
      .catch((e) => vivant && setErreur(e.message));

    return () => {
      vivant = false;
      moteur.current?.detruire();
      moteur.current = null;
    };
  }, [noeud, v.wnapp?.hide]);

  // Chargement du modèle courant.
  useEffect(() => {
    if (!moteur.current || !v.url || !v.courant) return;
    setErreur("");
    moteur.current
      .charger(v.url, v.courant.name)
      .catch((e) => setErreur(e.message));
  }, [v.url, v.courant?.id, etat.pret]);

  useEffect(() => {
    moteur.current?.apparence({ grille, fond: fond ? "#1a1a22" : null });
  }, [grille, fond]);

  const capturer = async () => {
    if (!moteur.current || !v.courant) return;
    const blob = await moteur.current.capturer();
    if (!blob) return;
    await saveAs(blob, `${sansExtension(v.courant.name)}.png`, { folder: "Captures" });
  };

  const chargement = v.chargement || etat.chargement;

  return (
    <FenetreMedia
      wnapp={v.wnapp}
      nom={v.courant ? sansExtension(v.courant.name) : nomApp("objet3d")}
      className="obj3App"
    >
      {/* Le conteneur de la scène est monté en permanence : c'est lui qui
          porte le contexte WebGL, et le recréer à chaque ouverture de
          fichier finirait par épuiser le quota du navigateur. L'accueil se
          pose par-dessus tant qu'aucun modèle n'est chargé. */}
      <div className="obj3Corps">
        <div className="obj3Scene" ref={setNoeud}>
          {!v.courant ? (
            <div className="obj3Accueil">
              <Accueil
                icone="faCube"
                titre="Visionneuse 3D"
                aide="Ouvrez un fichier .glb, .gltf, .obj, .stl, .fbx, .ply ou .dae depuis l'Explorateur."
              />
            </div>
          ) : null}
            {chargement ? (
              <div className="obj3Charge">
                <span>Chargement du modèle…</span>
                {etat.progression ? (
                  <span className="obj3Pourcent">
                    {Math.round(etat.progression * 100)} %
                  </span>
                ) : null}
              </div>
            ) : null}
            {erreur || v.erreur ? (
              <div className="obj3Erreur">
                <Icon fafa="faTriangleExclamation" width={20} />
                <span>{erreur || v.erreur}</span>
              </div>
            ) : null}
        </div>

        {v.courant ? (
          <div className="obj3Barre">
            <div className="obj3Info">
              <strong>{v.courant.name}</strong>
              <span>
                {[
                  `.${extensionDe(v.courant.name)}`,
                  formatBytes(Number(v.courant.size) || 0),
                  etat.maillages ? `${nf.format(etat.maillages)} maillages` : null,
                  // Le nombre de sommets explique à lui seul pourquoi un
                  // modèle rame : c'est l'information qu'on cherche quand
                  // l'affichage devient poussif.
                  etat.sommets ? `${nf.format(etat.sommets)} sommets` : null,
                  etat.animations ? `${etat.animations} animation(s)` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>

            <div className="obj3Actions">
              <span
                className="obj3Btn handcr"
                title="Recadrer sur l'objet"
                onClick={() => moteur.current?.cadrer()}
              >
                <Icon fafa="faExpand" width={12} />
              </span>
              <span
                className="obj3Btn handcr"
                data-actif={grille}
                title="Grille au sol"
                onClick={() => setGrille((g) => !g)}
              >
                <Icon fafa="faBorderAll" width={12} />
              </span>
              <span
                className="obj3Btn handcr"
                data-actif={fond}
                title="Fond sombre"
                onClick={() => setFond((f) => !f)}
              >
                <Icon fafa="faCircleHalfStroke" width={12} />
              </span>
              <span
                className="obj3Btn handcr"
                title="Enregistrer une capture dans l'Explorateur"
                onClick={capturer}
              >
                <Icon fafa="faCamera" width={12} />
              </span>
            </div>
          </div>
        ) : null}

        {v.courant && v.liste.length > 1 ? (
          <div className="obj3Bande cosScroll">
            {v.liste.map((n, i) => (
              <Vignette
                key={n.id}
                node={n}
                actif={i === v.index}
                onClick={() => v.allerA(i)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </FenetreMedia>
  );
}
