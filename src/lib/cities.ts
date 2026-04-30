export const ITALIAN_CITIES = [
  'Agrigento','Alessandria','Ancona','Andria','Aosta','Arezzo','Ascoli Piceno','Asti',
  'Avellino','Bari','Barletta','Belluno','Benevento','Bergamo','Biella','Bologna',
  'Bolzano','Brescia','Brindisi','Cagliari','Caltanissetta','Campobasso','Caserta',
  'Catania','Catanzaro','Cesena','Chieti','Como','Cosenza','Cremona','Crotone',
  'Cuneo','Enna','Ferrara','Firenze','Foggia','Forlì','Frosinone','Genova',
  'Gorizia','Grosseto','Imperia','Isernia','La Spezia',"L'Aquila",'Latina',
  'Lecce','Lecco','Livorno','Lodi','Lucca','Macerata','Mantova','Massa',
  'Matera','Messina','Milano','Modena','Monza','Napoli','Novara','Nuoro',
  'Oristano','Padova','Palermo','Parma','Pavia','Perugia','Pesaro','Pescara',
  'Piacenza','Pisa','Pistoia','Pordenone','Potenza','Prato','Ragusa','Ravenna',
  'Reggio Calabria','Reggio Emilia','Rieti','Rimini','Roma','Rovigo','Salerno',
  'Sassari','Savona','Siena','Siracusa','Sondrio','Taranto','Teramo','Terni',
  'Torino','Trapani','Trento','Treviso','Trieste','Udine','Varese','Venezia',
  'Verbania','Vercelli','Verona','Vibo Valentia','Vicenza','Viterbo',
]

export function searchCities(query: string, limit = 6): string[] {
  if (!query || query.length < 1) return []
  const q = query.toLowerCase().trim()
  const starts = ITALIAN_CITIES.filter(c => c.toLowerCase().startsWith(q))
  const contains = ITALIAN_CITIES.filter(c => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q))
  return [...starts, ...contains].slice(0, limit)
}
