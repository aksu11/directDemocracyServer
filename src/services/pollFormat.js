/**
 * Korvaa vaihtoehtojen todelliset äänimäärät prosenttiosuuksilla.
 * Päättyneiden äänestysten todelliset äänimäärät ovat vain adminien nähtävissä
 * (ks. /api/admin/polls/ended), joten julkiset reitit eivät saa paljastaa niitä.
 */
function withPercentages(data) {
  const total = data.options.reduce((sum, o) => sum + (o.votes || 0), 0);
  return {
    ...data,
    options: data.options.map((o) => ({
      id: o.id,
      label: o.label,
      percentage: total > 0 ? Math.round((o.votes / total) * 100) : 0,
    })),
  };
}

module.exports = { withPercentages };
