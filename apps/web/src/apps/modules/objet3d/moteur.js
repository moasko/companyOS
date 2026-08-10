// Moteur de rendu 3D — three.js, isolé derrière une façade minuscule.
//
// ─────────────────────────────────────────────────────────────────────────
// DEUX CHOIX QUI COMMANDENT TOUT LE RESTE
//
// 1. **three.js est chargé à la demande.** Le registre des modules importe
//    tous les manifestes au démarrage (`eager: true`) : un `import` statique
//    de three ferait entrer 600 Ko dans le premier chargement de l'OS, pour
//    une fenêtre que la plupart des gens n'ouvriront jamais. Chaque
//    fonction fait donc son `import()` dynamique, et Vite en fait un
//    fragment séparé.
//
// 2. **Tout ce qui est alloué est libéré.** WebGL ne ramasse pas ses
//    miettes : géométries, matériaux, textures et contexte restent en
//    mémoire tant qu'on ne les détruit pas explicitement. Ouvrir et fermer
//    dix modèles sans `detruire()` finit par faire perdre le contexte au
//    navigateur — l'écran devient noir et rien ne le dit.
// ─────────────────────────────────────────────────────────────────────────

/// Formats reconnus, et le chargeur qui va avec.
export const FORMATS = {
  glb: "GLTF",
  gltf: "GLTF",
  obj: "OBJ",
  stl: "STL",
  fbx: "FBX",
  ply: "PLY",
  dae: "Collada",
};

export const extensionDe = (nom = "") => {
  const point = nom.lastIndexOf(".");
  return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
};

/// Charge le chargeur correspondant à une extension. Les chargeurs vivent
/// dans `three/examples/jsm` : ils ne font pas partie du cœur, et chacun
/// pèse assez pour mériter son propre fragment.
const chargeurPour = async (ext) => {
  switch (FORMATS[ext]) {
    case "GLTF": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      return { loader: new GLTFLoader(), extraire: (r) => r.scene || r.scenes?.[0] };
    }
    case "OBJ": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      return { loader: new OBJLoader(), extraire: (r) => r };
    }
    case "STL": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const THREE = await import("three");
      return {
        loader: new STLLoader(),
        // Un STL ne porte qu'une géométrie : sans matériau, rien ne
        // s'affiche. On en pose un neutre, comme le font les visionneuses
        // d'impression 3D.
        extraire: (geometrie) =>
          new THREE.Mesh(
            geometrie,
            new THREE.MeshStandardMaterial({ color: 0xbfc6d1, metalness: 0.1, roughness: 0.7 }),
          ),
      };
    }
    case "FBX": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      return { loader: new FBXLoader(), extraire: (r) => r };
    }
    case "PLY": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const THREE = await import("three");
      return {
        loader: new PLYLoader(),
        extraire: (geometrie) => {
          geometrie.computeVertexNormals();
          return new THREE.Mesh(
            geometrie,
            new THREE.MeshStandardMaterial({
              color: 0xbfc6d1,
              vertexColors: !!geometrie.attributes.color,
              metalness: 0.1,
              roughness: 0.7,
            }),
          );
        },
      };
    }
    case "Collada": {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      return { loader: new ColladaLoader(), extraire: (r) => r.scene };
    }
    default:
      throw new Error(`Format 3D non pris en charge : .${ext}`);
  }
};

/// Crée une scène dans un conteneur DOM.
///
/// Rend un objet de commande : `charger`, `cadrer`, `apparence`,
/// `capturer`, `detruire`. Le composant React n'a jamais à toucher three
/// directement — c'est ce qui permet de changer de moteur un jour sans
/// réécrire la fenêtre.
export const creerScene = async (conteneur, { onEtat } = {}) => {
  const THREE = await import("three");
  const { OrbitControls } = await import(
    "three/examples/jsm/controls/OrbitControls.js"
  );

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  camera.position.set(3, 2, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Plafonné à 2 : au-delà, on quadruple le nombre de pixels à calculer
  // pour une différence que personne ne voit, et les machines modestes
  // tombent à dix images par seconde.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  conteneur.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Trois lumières plutôt qu'une : une clé, un remplissage et un contre-jour.
  // Une seule source aplatit les volumes et rend tous les modèles laids,
  // quelle que soit leur qualité.
  const ambiante = new THREE.HemisphereLight(0xffffff, 0x444455, 1.1);
  const cle = new THREE.DirectionalLight(0xffffff, 2.2);
  cle.position.set(5, 8, 6);
  const contre = new THREE.DirectionalLight(0xffffff, 0.8);
  contre.position.set(-6, 3, -5);
  scene.add(ambiante, cle, contre);

  const grille = new THREE.GridHelper(10, 20, 0x8892a0, 0xd7dce3);
  grille.material.transparent = true;
  grille.material.opacity = 0.35;
  scene.add(grille);

  let objet = null;
  let animation = null;
  let mixer = null;
  let horloge = new THREE.Clock();
  let detruit = false;

  const dimensionner = () => {
    const { clientWidth: l, clientHeight: h } = conteneur;
    if (!l || !h) return;
    camera.aspect = l / h;
    camera.updateProjectionMatrix();
    renderer.setSize(l, h, false);
  };

  // `ResizeObserver` plutôt que l'événement `resize` de la fenêtre : le
  // conteneur change aussi de taille quand on redimensionne la fenêtre de
  // l'OS ou qu'on replie un panneau, sans que le navigateur ne bouge.
  const observateur = new ResizeObserver(dimensionner);
  observateur.observe(conteneur);
  dimensionner();

  const boucle = () => {
    if (detruit) return;
    animation = requestAnimationFrame(boucle);
    const dt = horloge.getDelta();
    if (mixer) mixer.update(dt);
    controls.update();
    renderer.render(scene, camera);
  };
  boucle();

  /// Libère un sous-arbre : géométries, matériaux et textures.
  const liberer = (racine) => {
    racine.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      const materiaux = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of materiaux) {
        if (!m) continue;
        for (const cle of Object.keys(m)) {
          const v = m[cle];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
  };

  const retirerObjet = () => {
    if (!objet) return;
    scene.remove(objet);
    liberer(objet);
    objet = null;
    mixer = null;
  };

  /// Place la caméra pour que le modèle tienne à l'écran, quelle que soit
  /// son échelle — un modèle exporté en millimètres et un autre en mètres
  /// doivent tous deux apparaître correctement sans réglage manuel.
  const cadrer = (marge = 1.35) => {
    if (!objet) return;
    const boite = new THREE.Box3().setFromObject(objet);
    if (boite.isEmpty()) return;

    const taille = boite.getSize(new THREE.Vector3());
    const centre = boite.getCenter(new THREE.Vector3());
    const rayon = Math.max(taille.x, taille.y, taille.z) / 2 || 1;

    const distance = (rayon * marge) / Math.tan((camera.fov * Math.PI) / 360);
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    camera.position.copy(centre).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
    controls.target.copy(centre);
    controls.update();

    // La grille suit l'échelle du modèle, sinon elle disparaît sous un
    // objet géant ou l'engloutit s'il est minuscule.
    grille.scale.setScalar((rayon * 2.5) / 5);
    grille.position.set(centre.x, boite.min.y, centre.z);
  };

  return {
    /// Charge un modèle depuis une URL. `nom` sert à choisir le chargeur.
    async charger(url, nom) {
      const ext = extensionDe(nom);
      onEtat?.({ chargement: true, progression: 0 });
      retirerObjet();

      const { loader, extraire } = await chargeurPour(ext);

      const resultat = await new Promise((resolve, reject) => {
        loader.load(
          url,
          resolve,
          (evt) =>
            evt.total &&
            onEtat?.({ chargement: true, progression: evt.loaded / evt.total }),
          () => reject(new Error("Le fichier n'a pas pu être lu.")),
        );
      });

      objet = extraire(resultat);
      if (!objet) throw new Error("Ce fichier ne contient aucun objet affichable.");

      // Normales manquantes : sans elles, l'éclairage rend zéro et l'objet
      // sort **noir** — l'utilisateur voit une fenêtre vide et croit à un
      // fichier corrompu. Le format glTF les dit facultatives, et certains
      // exportateurs les omettent ; on les recalcule plutôt que d'afficher
      // une silhouette invisible.
      objet.traverse((n) => {
        if (n.isMesh && n.geometry && !n.geometry.attributes.normal) {
          n.geometry.computeVertexNormals();
        }
      });

      scene.add(objet);

      // Les animations d'un glTF : sans mixer, un modèle animé reste figé
      // dans sa pose de repos, ce qui passe pour un bug d'affichage.
      const clips = resultat.animations || [];
      if (clips.length) {
        mixer = new THREE.AnimationMixer(objet);
        mixer.clipAction(clips[0]).play();
      }

      cadrer();

      // Statistiques utiles : un modèle à deux millions de triangles qui
      // rame n'a pas de bug, il est simplement trop lourd — encore
      // faut-il pouvoir le constater.
      let sommets = 0;
      let maillages = 0;
      objet.traverse((n) => {
        if (!n.isMesh) return;
        maillages += 1;
        sommets += n.geometry?.attributes?.position?.count || 0;
      });

      onEtat?.({
        chargement: false,
        progression: 1,
        maillages,
        sommets,
        animations: clips.length,
      });
    },

    cadrer,

    /// Grille et fond : ce qu'on montre autour de l'objet.
    apparence({ grille: visible, fond }) {
      if (visible !== undefined) grille.visible = visible;
      if (fond !== undefined) {
        scene.background = fond ? new THREE.Color(fond) : null;
      }
    },

    /// Image du rendu courant, pour l'enregistrer dans l'Explorateur.
    capturer() {
      renderer.render(scene, camera);
      return new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));
    },

    detruire() {
      detruit = true;
      if (animation) cancelAnimationFrame(animation);
      observateur.disconnect();
      retirerObjet();
      grille.geometry.dispose();
      grille.material.dispose();
      controls.dispose();
      // `forceContextLoss` rend le contexte WebGL tout de suite. Sans lui,
      // le navigateur le garde jusqu'à son propre ramasse-miettes, et il
      // n'en accorde qu'une poignée par page.
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
