import { t, getLocale, getLanguage, normalizeLanguage } from '../i18n/index.js';
import { cachedResource } from './cache.js';
import { makeCube, observations } from '../core/cube.js';
import { validateSelection } from '../core/selection.js';

export const CATALOG_API = 'https://data.csu.gov.cz/api/katalog/v1';
export const DATA_API = 'https://data.csu.gov.cz/api/dotaz/v1';

export { validateSelection } from '../core/selection.js';

export function queryBody(descriptor, selections) {
  validateSelection(descriptor, selections);
  return {
    sloupce: descriptor.dimensions.map((dimension) => {
      const levels = new Map(dimension.categories.map((item) => [item.id, item.level]));
      return {
        kodDimenze: dimension.id,
        popis: 'nazev',
        filtr:
          dimension.levels?.length > 1
            ? dimension.levels.map((level) => ({
                urovenHierarchieKod: level.id,
                zobrazitPolozky: selections[dimension.id].filter(
                  (id) => levels.get(id) === level.id,
                ),
              }))
            : [{ zobrazitPolozky: selections[dimension.id] }],
      };
    }),
    radky: [],
    filtryTabulky: [],
  };
}

export function alignSelection(cube, descriptor, selections) {
  const dimensions = descriptor.dimensions.map((dim) => {
    const returned = cube.dimensions.find((item) => item.id === dim.id);
    if (!returned) throw new Error(t`Odpověď neobsahuje požadovanou dimenzi ${dim.label}.`);
    const allowed = new Set(selections[dim.id]);
    if (returned.categories.some((item) => !allowed.has(item.id)))
      throw new Error(t('Poskytovatel vrátil položky mimo požadovaný výběr.'));
    const returnedItems = new Map(returned.categories.map((item) => [item.id, item]));
    const knownItems = new Map(dim.categories.map((item) => [item.id, item]));
    return {
      ...returned,
      categories: selections[dim.id].map((id) => ({
        ...knownItems.get(id),
        ...returnedItems.get(id),
      })),
    };
  });
  if (cube.dimensions.length !== dimensions.length)
    throw new Error(t('Odpověď má neočekávané další dimenze.'));
  const positions = dimensions.map(
    (dim) => new Map(dim.categories.map((item, index) => [item.id, index])),
  );
  const values = {},
    statuses = {};
  for (const row of observations(cube)) {
    let index = 0;
    dimensions.forEach((dim, i) => {
      index = index * dim.categories.length + positions[i].get(row.coordinates[dim.id].id);
    });
    values[index] = row.value;
    if (row.status) statuses[index] = row.status;
  }
  return makeCube({ ...cube, dimensions, values, statuses });
}

export class DataStatSource {
  constructor({ client, cache, processor }) {
    Object.assign(this, { client, cache, processor });
  }
  async json(
    path,
    { signal, force = false, onProgress, ttl = 7 * 86400000, language = getLanguage() } = {},
  ) {
    language = normalizeLanguage(language);
    return cachedResource(
      this.cache,
      `csu-meta:${language}:${path}`,
      ttl,
      async () => {
        const response = await this.client.request(CATALOG_API + path, {
          signal,
          language,
          onProgress,
          maxBytes: 20 * 1024 * 1024,
        });
        const data = JSON.parse((await response.blob.text()).replace(/^\uFEFF/, ''));
        if (!data || typeof data !== 'object') throw new Error(t('ČSÚ vrátil neplatná metadata.'));
        if (data.error || (!Array.isArray(data) && !data.kod && !data.vyber))
          throw new Error(t('ČSÚ vrátil neúplnou definici metadat.'));
        const expectsArray =
          /^\/(?:sady$|sady\/[^/]+\/vybery$|dimenze\/[^/]+\/polozky(?:\?|$))/.test(path);
        if (expectsArray && (!Array.isArray(data) || data.some((item) => item?.kod == null)))
          throw new Error(t('Seznam metadat ČSÚ má neplatný formát.'));
        return data;
      },
      {
        signal,
        force,
        onCache: () => onProgress?.({ phase: 'cached', title: path }),
        onStale: () =>
          onProgress?.({
            phase: 'cached',
            title: path,
            warning: t('Aktualizace metadat není dostupná. Používám starší uložený číselník.'),
          }),
      },
    );
  }
  async catalog(options = {}) {
    const items = await this.json('/sady', { ...options, ttl: 86400000 });
    if (!Array.isArray(items) || items.some((item) => !item.kod || !item.nazev))
      throw new Error(t('Katalog ČSÚ má neočekávaný formát.'));
    return items.map((item) => ({
      id: `csu:${item.kod}`,
      code: item.kod,
      title: item.nazev,
      version: item.verze,
      source: t('ČSÚ DataStat'),
      sourceKey: 'datastat',
      timeLevels: item.urovneTypObdobi || [],
      geoLevels: item.urovneTypUzemi || [],
    }));
  }
  async descriptor(code, options = {}) {
    options = { ...options, language: normalizeLanguage(options.language || getLanguage()) };
    if (!/^[\w-]{1,80}$/.test(code)) throw new Error(t('Neplatný kód sady.'));
    const raw = await this.json(`/sady/${encodeURIComponent(code)}`, options);
    if (raw.kod !== code || !raw.ukazatele?.length || !Array.isArray(raw.variantyDimenze))
      throw new Error(t('Neúplná definice datové sady.'));
    const variants = new Map();
    for (const item of raw.variantyDimenze) {
      if (item.skrytaVariantaDimenze) continue;
      if (!variants.has(item.typDimenzeKod)) variants.set(item.typDimenzeKod, []);
      variants
        .get(item.typDimenzeKod)
        .push({ ...item, id: item.kod, label: item.nazev, version: item.verze });
    }
    // Official selections supply usable defaults, including the real data period.
    const selections = await this.json(`/sady/${code}/vybery`, options);
    const first = Array.isArray(selections) ? selections[0] : null;
    let preset = null;
    if (first) preset = (await this.json(`/vybery/${first.kod}`, options)).vyber;
    const presetDims = preset?.variantyDimenze || [];
    const selectedVariants = Object.fromEntries(
      [...variants].map(([type, list]) => [
        type,
        presetDims.find((dim) => dim.typDimenzeKod === type)?.kod ||
          list.find((dim) => dim.vychoziVariantaDimenze)?.kod ||
          list[0].kod,
      ]),
    );
    return {
      id: `csu:${code}`,
      language: options.language,
      code,
      title: raw.nazev,
      version: raw.verze,
      source: t('ČSÚ DataStat'),
      description: raw.popisy?.popis || raw.popisy?.metodika || '',
      variants,
      selectedVariants,
      activeTypes: [
        ...new Set([
          ...(raw.pravidlaVyberu?.povinneDimenze || []),
          ...presetDims.map((dim) => dim.typDimenzeKod),
        ]),
      ].filter((type) => variants.has(type)),
      raw,
      preset,
      requiredTypes:
        raw.pravidlaVyberu?.povinneDimenze || presetDims.map((item) => item.typDimenzeKod),
      constraints: {
        forbiddenPairs: (raw.pravidlaVyberu?.zakazaneDimenzeUkazatelu || []).map((rule) => ({
          metric: rule.ukazatelKod,
          dimensions: rule.zakazaneVariantyDimenze || [],
        })),
      },
      dimensions: [
        {
          id: 'IndicatorType',
          label: t('Ukazatel'),
          role: 'metric',
          categories: raw.ukazatele.map((item) => ({
            id: item.kod,
            label: item.nazev,
            note: item.definiceNahled,
          })),
        },
      ],
      url: `https://data.csu.gov.cz/datastat/data/SADA/${code}`,
    };
  }
  async populateDimensions(descriptor, options = {}) {
    options = { ...options, language: descriptor.language || getLanguage() };
    const dimensions = [descriptor.dimensions.find((dim) => dim.role === 'metric')];
    const presetBody = descriptor.preset?.obsahVyberu;
    const presetFilters = [
      ...(presetBody?.sloupce || []),
      ...(presetBody?.radky || []),
      ...(presetBody?.filtryTabulky || []),
    ];
    const defaults = {};
    const metricPreset = presetFilters.find((item) => item.kodDimenze === 'IndicatorType');
    const positive = metricPreset?.filtr?.flatMap((filter) => filter.zobrazitPolozky || []);
    const allowedMetrics = dimensions[0].categories.filter(
      (item) =>
        (!positive?.length || positive.includes(item.id)) &&
        !metricPreset?.filtr?.some((filter) => filter.nezobrazitPolozky?.includes(item.id)),
    );
    defaults.IndicatorType = [allowedMetrics[0]?.id || dimensions[0].categories[0].id];
    for (const [type, list] of descriptor.variants) {
      if (descriptor.activeTypes?.length && !descriptor.activeTypes.includes(type)) continue;
      const variant = list.find((item) => item.kod === descriptor.selectedVariants[type]);
      const params = new URLSearchParams({ verze: variant.verze });
      if (type === 'REF_CAS') {
        const actual = presetFilters
          .find((item) => item.kodDimenze === variant.kod)
          ?.filtr?.flatMap((filter) => filter.zobrazitPolozky || []);
        // Use published preset codes, not the global calendar's future categories.
        if (actual?.length) {
          const sorted = [...actual].sort((a, b) =>
            a.localeCompare(b, getLocale(), { numeric: true }),
          );
          params.set('kodPolozkyOd', sorted[0]);
          params.set('kodPolozkyDo', sorted.at(-1));
        } else params.set('casDo', new Date().toISOString());
      }
      const items = await this.json(
        `/dimenze/${encodeURIComponent(variant.kod)}/polozky?${params}`,
        options,
      );
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.length > 50000 ||
        items.some((item) => item.kod == null)
      )
        throw new Error(t`Číselník ${variant.nazev} nelze bezpečně načíst.`);
      const levels = (variant.urovneHierarchie || variant.urovneDimenze || []).map((level) => ({
        id: level.kodUrovne,
        label: level.nazevUrovne,
      }));
      const dim = {
        id: variant.kod,
        label: variant.nazev,
        type,
        role: type === 'REF_CAS' ? 'time' : type === 'VUZEMI' ? 'geo' : 'category',
        levels,
        categories: items.map((item) => ({
          id: String(item.kod),
          label: item.nazev || item.kod,
          level: item.kodUrovne,
          parent: item.nadrazenaPolozkaKod,
          aggregate: !!item.agregacniPolozka,
          from: item.casOd,
          to: item.casDo,
        })),
      };
      dimensions.push(dim);
      if (dim.role === 'time') {
        dim.categories.sort((a, b) =>
          (a.from || a.id).localeCompare(b.from || b.id, getLocale(), { numeric: true }),
        );
        defaults[dim.id] = dim.categories.slice(-3).map((item) => item.id);
      } else
        defaults[dim.id] = [
          dim.categories.find((item) => item.aggregate)?.id || dim.categories[0].id,
        ];
    }
    descriptor.dimensions = dimensions;
    return defaults;
  }
  async load(descriptor, selections, { signal, force = false, onProgress } = {}) {
    const language = descriptor.language || getLanguage();
    const body = queryBody(descriptor, selections);
    const key = `csu-data:${language}:${descriptor.code}:${descriptor.version}:${JSON.stringify(body)}`;
    const saved = await this.cache.get(key);
    if (!force && saved?.blob && Date.now() - saved.savedAt < 6 * 3600000) {
      try {
        const cube = alignSelection(
          await this.processor.request(
            { type: 'parse-jsonstat', text: await saved.blob.text() },
            { signal, onProgress },
          ),
          descriptor,
          selections,
        );
        onProgress?.({ phase: 'cached' });
        cube.metadata.cachedAt = saved.savedAt;
        return cube;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        await this.cache.remove(key);
      }
    }
    const result = await this.client.request(
      `${DATA_API}/data/sady/${descriptor.code}/vlastni?format=JSON_STAT&verzeSady=${encodeURIComponent(descriptor.version)}`,
      { method: 'POST', body, signal, onProgress, language, maxBytes: 35 * 1024 * 1024 },
    );
    onProgress?.({ phase: 'processing' });
    const cube = alignSelection(
      await this.processor.request(
        { type: 'parse-jsonstat', text: await result.blob.text() },
        { signal, onProgress },
      ),
      descriptor,
      selections,
    );
    onProgress?.({ phase: 'saving' });
    await this.cache.put({
      key,
      blob: result.blob,
      kind: 'selection',
      title: descriptor.title,
      savedAt: Date.now(),
      size: result.blob.size,
    });
    return cube;
  }
}
