// Prototype isolé : noyau numérique pour le Classeur CompanyOS.
// Aucun code de production ne l'importe. Le buffer statique évite un
// allocateur et rend l'interface JavaScript/WASM volontairement minimale.

const CAPACITE: usize = 1_000_000;
var nombres: [CAPACITE]f64 = undefined;

export fn adresseBuffer() usize {
    return @intFromPtr(&nombres);
}

export fn capaciteBuffer() usize {
    return CAPACITE;
}

export fn somme(longueur: usize) f64 {
    const fin = @min(longueur, CAPACITE);
    var total: f64 = 0;
    for (nombres[0..fin]) |valeur| total += valeur;
    return total;
}

export fn sommeSiSuperieur(longueur: usize, seuil: f64) f64 {
    const fin = @min(longueur, CAPACITE);
    var total: f64 = 0;
    for (nombres[0..fin]) |valeur| {
        if (valeur > seuil) total += valeur;
    }
    return total;
}

