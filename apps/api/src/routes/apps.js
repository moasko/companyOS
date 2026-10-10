import { z } from "zod";
import { prisma, serialize } from "../db.js";
import { authenticate, estExploitant, exigerRole } from "../auth.js";
import { journaliser } from "../audit.js";
import { MODES, MODES_ECRITURE, autoriseSelon, ecritureSelon, regleDe } from "../acces.js";

// Deux origines d'applications cohabitent :
//   - le catalogue global (tenantId null), offert à tous les espaces ;
//   - les applications créées dans le Studio, propres à un espace.
// Toute recherche par slug doit donc regarder les deux, jamais l'une sans
// l'autre, et jamais celles d'un autre client.

// ---------------------------------------------------------------------------
// Secrets dans les réglages d'application
// ---------------------------------------------------------------------------

/// Champs dont la valeur est un secret, quel que soit l'endroit où elle se
/// trouve dans l'objet.
const CHAMPS_SECRETS =
  /^(pass|password|motdepasse|secret|token|jeton|apikey|accesskey|secretkey|cle|key)$/i;

/// Retire les secrets d'un objet de réglages avant de le rendre au client.
///
/// L'app Courrier range le mot de passe SMTP dans `settings.smtp.pass`.
/// Cette route-ci est appelée au démarrage du shell par **tout** membre,
/// alors que la route dédiée `GET /courrier/reglages` est réservée aux
/// ADMIN et ne renvoie qu'un booléen `motDePasseDefini`. Sans ce filtre,
/// le soin pris là-bas était entièrement annulé ici.
///
/// Le tri se fait sur le **nom du champ**, pas sur le slug de l'app :
/// une liste blanche par app se périme silencieusement à la première app
/// qui range un jeton dans ses réglages, et le silence est précisément ce
/// qu'il ne faut pas ici. La contrepartie assumée est qu'un champ
/// légitimement nommé « cle » sera masqué ; c'est le bon sens du
/// compromis.
///
/// On conserve la **présence** du secret (`true`/`false`) : l'écran a
/// besoin de savoir qu'un relais est configuré, jamais avec quoi.
export const sansSecrets = (valeur) => {
  if (Array.isArray(valeur)) return valeur.map(sansSecrets);
  if (!valeur || typeof valeur !== "object") return valeur;
  return Object.fromEntries(
    Object.entries(valeur).map(([nom, v]) =>
      CHAMPS_SECRETS.test(nom) ? [nom, v ? true : false] : [nom, sansSecrets(v)],
    ),
  );
};

const visibleTo = (tenantId, extra = {}) => ({
  ...extra,
  OR: [{ tenantId: null }, { tenantId }],
});

const findVisibleApp = (tenantId, slug) =>
  prisma.app.findFirst({ where: visibleTo(tenantId, { slug }) });

const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "minuscules, chiffres et tirets uniquement");

// Les types de champ d'une application du Studio.
//
// La liste doit rester alignée sur `TYPES` dans
// src/apps/modules/studio/domaine.js — c'est le seul couplage entre les
// deux, et il est volontaire : le serveur ne fait confiance à rien de ce
// que le client lui envoie, y compris à un type de champ.
const champSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  type: z.enum([
    "texte",
    "zone",
    "nombre",
    "date",
    "choix",
    "booleen",
    "montant",
    "telephone",
    "email",
    "lien",
    "relation",
    "calcul",
  ]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  /// Collection visée par une relation.
  cible: z.string().max(40).optional(),
  /// Mise en page de la fiche : demi-largeur ou pleine largeur, et section
  /// nommée — des réglages d'affichage, sans effet sur les données.
  largeur: z.enum(["demi", "plein"]).optional(),
  section: z.string().max(60).optional(),
  /// Formule d'un champ calculé. Elle n'est jamais exécutée ici : le
  /// serveur ne fait que la stocker, c'est le client qui l'évalue avec son
  /// propre analyseur — voir `evaluer` dans le domaine du Studio.
  formule: z.string().max(200).optional(),
});

const collectionSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(80),
  icon: z.string().max(60).optional(),
  fields: z.array(champSchema).max(24),
  /// Comment la collection s'affiche : tableau, cartes, ou kanban groupé
  /// par un champ à choix.
  vue: z
    .object({
      mode: z.enum(["liste", "cartes", "kanban"]),
      groupePar: z.string().max(40).optional(),
      carte: z.array(z.string()).max(6).optional(),
    })
    .optional(),
});

/// Un pavé du tableau de bord d'une application.
const widgetSchema = z.object({
  type: z.enum(["compteur", "somme", "repartition"]),
  titre: z.string().max(60).optional(),
  collection: z.string().max(40),
  champ: z.string().max(40).optional(),
  filtre: z.object({ champ: z.string().max(40), valeur: z.string().max(80) }).optional(),
});

const automatisationSchema = z.object({
  id: z.string().min(1).max(60),
  nom: z.string().min(1).max(80),
  active: z.boolean().default(true),
  collection: z.string().min(1).max(40),
  declencheur: z.enum(["creation", "modification", "toujours"]),
  conditions: z
    .array(
      z.object({
        champ: z.string().min(1).max(40),
        operateur: z.enum([
          "egal",
          "different",
          "contient",
          "vide",
          "non-vide",
          "superieur",
        ]),
        valeur: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }),
    )
    .max(6),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("definir"),
          champ: z.string().min(1).max(40),
          valeur: z.union([z.string(), z.number(), z.boolean()]),
        }),
        z.object({
          type: z.literal("notifier"),
          titre: z.string().min(1).max(100),
          message: z.string().max(500).optional(),
        }),
      ]),
    )
    .min(1)
    .max(6),
});

/// Une application « site web » : une adresse, présentée comme une app.
///
/// Beaucoup d'outils que les équipes utilisent tous les jours sont déjà des
/// sites — un tableau de bord interne, un ERP hébergé, une documentation.
/// Leur donner une icône sur le bureau évite l'aller-retour permanent entre
/// l'OS et un onglet de navigateur perdu au milieu de trente autres.
///
/// `ouverture` retient ce qui a été constaté à la création :
///
///   • `cadre`   — le site accepte d'être affiché dans la fenêtre ;
///   • `fenetre` — il le refuse (`X-Frame-Options`, ou
///                 `frame-ancestors` dans sa politique de sécurité), et
///                 l'app ouvre alors un vrai onglet.
///
/// Ce refus n'est pas contournable, et ne doit pas l'être : c'est une
/// protection que le site a posée contre le détournement de clic. On le
/// constate au moment de créer l'app, on le dit franchement, et on propose
/// la seule alternative honnête. C'est le cas de vscode.dev, par exemple.
const webSchema = z.object({
  // http(s) uniquement : `javascript:` et `data:` dans un cadre servi par
  // nos soins reviendraient à exécuter le script de qui a créé l'app.
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (v) => /^https?:\/\//i.test(v),
      "L'adresse doit commencer par http:// ou https://",
    ),
  ouverture: z.enum(["cadre", "fenetre"]).default("cadre"),
});

const definitionSchema = z
  .object({
    /// Version explicite du contrat déclaratif. Les définitions historiques
    /// n'en ont pas et sont donc interprétées comme la première version.
    schemaVersion: z.number().int().min(1).max(2).default(1),
    /// Le genre décide de tout le reste. Absent, c'est une app de données :
    /// c'est ce que contiennent toutes les définitions écrites avant que ce
    /// second genre existe, et elles doivent continuer de fonctionner.
    genre: z.enum(["donnees", "web"]).default("donnees"),
    collections: z.array(collectionSchema).max(8).default([]),
    /// Le tableau de bord de l'application — jusqu'à huit pavés.
    accueil: z.array(widgetSchema).max(8).optional(),
    automatisations: z.array(automatisationSchema).max(12).optional(),
    web: webSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.genre === "web") {
      if (!d.web) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["web"],
          message: "Une application web doit porter une adresse.",
        });
      }
      if (d.collections.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collections"],
          message: "Une application web ne doit pas contenir de collections actives.",
        });
      }
      return;
    }
    if (!d.collections.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collections"],
        message: "Une application de données doit avoir au moins une collection.",
      });
    }

    const clesCollections = d.collections.map((collection) => collection.key);
    if (new Set(clesCollections).size !== clesCollections.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collections"],
        message: "Chaque collection doit avoir un identifiant unique.",
      });
    }

    d.collections.forEach((collection, ci) => {
      if (!collection.fields.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collections", ci, "fields"],
          message: "Une collection doit contenir au moins un champ.",
        });
      }
      const clesChamps = collection.fields.map((champ) => champ.key);
      if (new Set(clesChamps).size !== clesChamps.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collections", ci, "fields"],
          message: "Chaque champ doit avoir un identifiant unique dans sa collection.",
        });
      }
      collection.fields.forEach((champ, fi) => {
        if (champ.type === "choix" && !champ.options?.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["collections", ci, "fields", fi, "options"],
            message: "Une liste de choix doit contenir au moins une option.",
          });
        }
        if (
          champ.type === "relation" &&
          (!champ.cible ||
            !clesCollections.includes(champ.cible) ||
            champ.cible === collection.key)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["collections", ci, "fields", fi, "cible"],
            message: "La relation doit viser une autre collection existante.",
          });
        }
        if (champ.type === "calcul") {
          const references = String(champ.formule || "").match(/[a-zA-Z_][\w-]*/g) || [];
          if (
            !champ.formule ||
            references.some((reference) => !clesChamps.includes(reference))
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["collections", ci, "fields", fi, "formule"],
              message:
                "La formule doit utiliser uniquement les champs de cette collection.",
            });
          }
        }
      });
      if (
        collection.vue?.mode === "kanban" &&
        !collection.fields.some(
          (champ) => champ.key === collection.vue.groupePar && champ.type === "choix",
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collections", ci, "vue", "groupePar"],
          message: "Un kanban doit être groupé par un champ de type liste de choix.",
        });
      }
    });

    for (const [wi, widget] of (d.accueil || []).entries()) {
      const collection = d.collections.find(
        (candidate) => candidate.key === widget.collection,
      );
      if (
        !collection ||
        (widget.champ && !collection.fields.some((champ) => champ.key === widget.champ))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accueil", wi],
          message: "Ce widget référence une collection ou un champ inexistant.",
        });
      }
    }

    for (const [ri, regle] of (d.automatisations || []).entries()) {
      const collection = d.collections.find((c) => c.key === regle.collection);
      const cles = new Set((collection?.fields || []).map((f) => f.key));
      if (
        !collection ||
        [...regle.conditions, ...regle.actions.filter((a) => a.type === "definir")].some(
          (element) => !cles.has(element.champ),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["automatisations", ri],
          message: "Une automatisation référence une collection ou un champ inexistant.",
        });
      }
    }
  });

const appSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(60),
  description: z.string().max(240).default(""),
  icon: z.string().min(1).max(60),
  category: z.string().min(1).max(40).default("Sur mesure"),
  definition: definitionSchema,
  published: z.boolean().optional(),
});

export default async function appRoutes(app) {
  app.addHook("preHandler", authenticate);

  /// Catalogue de la Boutique, avec l'état d'installation pour cet espace
  /// de travail — le front n'a qu'un appel à faire pour rendre la page.
  /// Les brouillons du Studio (published = false) n'y figurent pas.
  app.get("/catalog", async (request) => {
    const [apps, installations] = await Promise.all([
      prisma.app.findMany({
        where: visibleTo(request.tenantId, { published: true }),
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      prisma.installation.findMany({ where: { tenantId: request.tenantId } }),
    ]);

    const versionInstallee = new Map(installations.map((i) => [i.appId, i.version]));

    return serialize(
      apps.map((a) => ({
        ...a,
        installed: versionInstallee.has(a.id),
        installedVersion: versionInstallee.get(a.id) ?? null,
      })),
    );
  });

  /// Les apps réellement disponibles dans le shell de cet espace.
  app.get("/installed", async (request) => {
    const installations = await prisma.installation.findMany({
      where: { tenantId: request.tenantId },
      include: { app: true },
      orderBy: { installedAt: "asc" },
    });

    // La console Plateforme n'est pas dans la Boutique et ne s'installe
    // pas : elle apparaît d'elle-même chez l'exploitant, quel que soit son
    // espace, et chez personne d'autre — même si une installation
    // ancienne traîne dans l'espace.
    const exploitant = estExploitant(request.user.email);
    const visibles = installations.filter((i) => i.app.slug !== "plateforme" || exploitant);
    if (exploitant && !visibles.some((i) => i.app.slug === "plateforme")) {
      const appConsole = await prisma.app.findFirst({
        where: { tenantId: null, slug: "plateforme" },
      });
      if (appConsole) {
        visibles.push({
          app: appConsole,
          settings: {},
          acces: null,
          installedAt: null,
          version: appConsole.version,
        });
      }
    }

    return serialize(
      visibles.map((i) => ({
        ...i.app,
        settings: sansSecrets(i.settings),
        // La règle d'accès et ce qu'elle donne pour cette personne : le
        // shell n'affiche que ce qu'elle peut ouvrir. Le contrôle qui
        // compte reste celui des routes de données.
        acces: regleDe(i.app.slug, i),
        // La console obéit à PLATFORM_ADMINS, pas au rôle dans l'espace.
        autorise:
          i.app.slug === "plateforme"
            ? exploitant
            : autoriseSelon(request.user, regleDe(i.app.slug, i)),
        // Peut-elle aussi modifier ? (sinon : lecture seule)
        ecrit: i.app.slug === "plateforme" ? exploitant : ecritureSelon(request.user, regleDe(i.app.slug, i)),
        installedAt: i.installedAt,
        // Ce qui est en place, à distinguer de `version` qui est ce que le
        // catalogue propose. C'est l'écart entre les deux qui fait une
        // mise à jour.
        installedVersion: i.version,
      })),
    );
  });

  // --- Applications créées dans le Studio ---------------------------------

  /// Les applications de cet espace, publiées ou non.
  app.get("/mine", async (request) => {
    const apps = await prisma.app.findMany({
      where: { tenantId: request.tenantId },
      orderBy: { publishedAt: "desc" },
    });
    return serialize(apps);
  });

  // Créer, modifier ou supprimer une application du Studio engage tout
  // l'espace, au même titre que l'installer : la définition d'une app est
  // le modèle de données que ses collègues remplissent, et la supprimer
  // la retire de leur bureau par cascade. Sans ce contrôle, un membre
  // contournait la réserve aux administrateurs posée plus bas en
  // supprimant au lieu de désinstaller.
  app.post("/", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = appSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Définition invalide", details: parsed.error.flatten() });
    }

    // Un slug du catalogue global est réservé : laisser un espace le
    // réutiliser rendrait l'application d'origine inatteignable.
    const conflict = await findVisibleApp(request.tenantId, parsed.data.slug);
    if (conflict) {
      return reply
        .code(409)
        .send({ error: `L'identifiant « ${parsed.data.slug} » est déjà utilisé` });
    }

    const created = await prisma.app.create({
      data: {
        ...parsed.data,
        tenantId: request.tenantId,
        kind: "CUSTOM",
        published: parsed.data.published ?? false,
      },
    });

    await journaliser(request, "studio.creation", created.name, { slug: created.slug });

    return reply.code(201).send(serialize(created));
  });

  app.put("/:slug", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const parsed = appSchema.partial({ slug: true }).safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Définition invalide", details: parsed.error.flatten() });
    }

    // deleteMany/updateMany filtrés sur le tenant : impossible de toucher
    // l'application d'un autre client, ni une app du catalogue global.
    const { count } = await prisma.app.updateMany({
      where: { tenantId: request.tenantId, slug: request.params.slug },
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        icon: parsed.data.icon,
        category: parsed.data.category,
        definition: parsed.data.definition,
        ...(parsed.data.published === undefined
          ? {}
          : { published: parsed.data.published }),
      },
    });

    if (count === 0) {
      return reply.code(404).send({ error: "Application introuvable" });
    }

    const updated = await prisma.app.findFirst({
      where: { tenantId: request.tenantId, slug: request.params.slug },
    });

    await journaliser(request, "studio.modification", updated.name, {
      slug: updated.slug,
      publiee: updated.published,
    });

    return serialize(updated);
  });

  app.delete("/:slug", { preHandler: exigerRole("ADMIN") }, async (request, reply) => {
    const target = await prisma.app.findFirst({
      where: { tenantId: request.tenantId, slug: request.params.slug },
    });
    if (!target) {
      return reply.code(404).send({ error: "Application introuvable" });
    }

    // Les installations partent avec l'application ; les enregistrements
    // saisis restent, pour qu'une suppression par erreur ne perde rien.
    await prisma.app.delete({ where: { id: target.id } });

    await journaliser(request, "studio.suppression", target.name, { slug: target.slug });

    return reply.code(204).send();
  });

  // --- Installation --------------------------------------------------------

  // Installer ou retirer une application engage tout l'espace de travail,
  // pas seulement celui qui clique : réservé aux administrateurs.
  app.post(
    "/:slug/install",
    { preHandler: exigerRole("ADMIN") },
    async (request, reply) => {
      const target = await findVisibleApp(request.tenantId, request.params.slug);
      if (!target) {
        return reply.code(404).send({ error: "Application introuvable" });
      }

      // La version est celle que le shell dit installer. C'est lui qui porte
      // le code, donc lui seul sait ce qu'il vient de mettre en place ; le
      // serveur, qui ne fait que l'enregistrer, retombe sur celle du
      // catalogue quand rien ne lui est transmis.
      const version = String(request.body?.version || target.version || "").slice(0, 20);

      const installation = await prisma.installation.upsert({
        where: { tenantId_appId: { tenantId: request.tenantId, appId: target.id } },
        update: { version },
        create: {
          tenantId: request.tenantId,
          userId: request.user.id,
          appId: target.id,
          version,
        },
        include: { app: true },
      });

      await journaliser(request, "app.installation", target.name, {
        slug: target.slug,
        version,
      });

      return reply
        .code(201)
        .send(
          serialize({ ...installation.app, installed: true, installedVersion: version }),
        );
    },
  );

  /// Enregistre une mise à jour appliquée.
  ///
  /// Route distincte de l'installation, pour deux raisons : le journal doit
  /// distinguer « a installé » de « a mis à jour », et une mise à jour n'a
  /// de sens que sur une application déjà en place — l'exiger évite qu'un
  /// appel de travers installe silencieusement autre chose.
  app.put(
    "/:slug/install",
    { preHandler: exigerRole("ADMIN") },
    async (request, reply) => {
      const target = await findVisibleApp(request.tenantId, request.params.slug);
      if (!target) {
        return reply.code(404).send({ error: "Application introuvable" });
      }

      const existante = await prisma.installation.findFirst({
        where: { tenantId: request.tenantId, appId: target.id },
      });
      if (!existante) {
        return reply.code(409).send({ error: "Cette application n'est pas installée." });
      }

      const version = String(request.body?.version || target.version || "").slice(0, 20);
      const avant = existante.version || null;

      const installation = await prisma.installation.update({
        where: { id: existante.id },
        data: { version },
        include: { app: true },
      });

      // Pas de trace quand il n'y a pas d'« avant » : ce n'est pas une mise à
      // jour, c'est l'enregistrement d'une version de référence pour une
      // installation antérieure au suivi. Treize lignes de bookkeeping
      // noieraient les vrais événements du journal.
      if (avant) {
        await journaliser(request, "app.miseajour", target.name, {
          slug: target.slug,
          avant,
          apres: version,
        });
      }

      return reply.send(
        serialize({ ...installation.app, installed: true, installedVersion: version }),
      );
    },
  );

  /// Régler qui peut ouvrir une application installée.
  ///
  /// `admins` et `selection` laissent toujours passer les administrateurs
  /// et le propriétaire : la règle restreint les membres, elle n'enferme
  /// pas ceux qui la règlent.
  app.put(
    "/:slug/acces",
    { preHandler: exigerRole("ADMIN") },
    async (request, reply) => {
      const parsed = z
        .object({
          mode: z.enum(MODES),
          membres: z.array(z.string().min(1).max(40)).max(500).optional(),
          ecriture: z
            .object({
              mode: z.enum(MODES_ECRITURE),
              membres: z.array(z.string().min(1).max(40)).max(500).optional(),
            })
            .optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Règle d'accès invalide." });
      }

      const target = await findVisibleApp(request.tenantId, request.params.slug);
      if (!target) return reply.code(404).send({ error: "Application introuvable" });
      if (target.isCore) {
        return reply
          .code(409)
          .send({ error: "Les applications du socle restent ouvertes à tous." });
      }

      const installation = await prisma.installation.findUnique({
        where: { tenantId_appId: { tenantId: request.tenantId, appId: target.id } },
      });
      if (!installation) {
        return reply.code(404).send({ error: "Cette application n'est pas installée." });
      }

      // Seuls des membres de cet espace peuvent figurer dans la sélection :
      // un identifiant étranger serait inoffensif, mais illisible au journal.
      let membres = [];
      if (parsed.data.mode === "selection") {
        const demandes = [...new Set(parsed.data.membres || [])];
        const trouves = await prisma.user.findMany({
          where: { id: { in: demandes }, tenantId: request.tenantId },
          select: { id: true, email: true },
        });
        membres = trouves.map((u) => u.id);
        if (membres.length !== demandes.length) {
          return reply
            .code(400)
            .send({ error: "La sélection contient une personne étrangère à l'espace." });
        }
      }

      // Qui peut modifier, parmi ceux qui ont accès.
      let ecriture = null;
      const e = parsed.data.ecriture;
      if (e && e.mode !== "tous") {
        let ecrivains = [];
        if (e.mode === "selection") {
          const demandes = [...new Set(e.membres || [])];
          const trouves = await prisma.user.findMany({
            where: { id: { in: demandes }, tenantId: request.tenantId },
            select: { id: true },
          });
          ecrivains = trouves.map((u) => u.id);
          if (ecrivains.length !== demandes.length) {
            return reply.code(400).send({ error: "La sélection contient une personne étrangère à l'espace." });
          }
        }
        ecriture = e.mode === "selection" ? { mode: "selection", membres: ecrivains } : { mode: e.mode };
      }

      const acces = {
        ...(parsed.data.mode === "selection" ? { mode: "selection", membres } : { mode: parsed.data.mode }),
        ...(ecriture ? { ecriture } : {}),
      };
      const avant = regleDe(target.slug, installation);

      await prisma.installation.update({
        where: { id: installation.id },
        data: { acces },
      });

      await journaliser(request, "app.acces", target.name, {
        slug: target.slug,
        avant: avant.mode,
        apres: acces.mode,
        membres: membres.length || undefined,
        ecriture: acces.ecriture?.mode || "tous",
      });

      return { slug: target.slug, acces };
    },
  );

  app.delete(
    "/:slug/install",
    { preHandler: exigerRole("ADMIN") },
    async (request, reply) => {
      const target = await findVisibleApp(request.tenantId, request.params.slug);
      if (!target) {
        return reply.code(404).send({ error: "Application introuvable" });
      }
      if (target.isCore) {
        return reply
          .code(409)
          .send({ error: "Une application du socle ne peut pas être désinstallée" });
      }

      await prisma.installation.deleteMany({
        where: { tenantId: request.tenantId, appId: target.id },
      });

      await journaliser(request, "app.desinstallation", target.name, {
        slug: target.slug,
      });

      return reply.code(204).send();
    },
  );
}
