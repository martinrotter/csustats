import { t } from '../i18n/index.js';
import Papa from '../../vendor/papaparse/papaparse.min.js';
import { makeCube } from '../core/cube.js';
import { refreshTemporalDimensions } from '../core/dimensions.js';
import { validateSelection } from '../core/selection.js';

export const resourceName = (template, period) => template.replaceAll('{period}', String(period));
function parseCatalog(text, required) {
  const result = Papa.parse(text, {
    delimiter: ',',
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (value) =>
      value
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase(),
  });
  if (
    result.errors.length ||
    !result.data.length ||
    required.some((field) => !result.meta.fields.includes(field))
  )
    throw new Error(t('Číselník má neočekávanou strukturu.'));
  return result.data;
}
function dateBoundary(year, end = false) {
  const number = Number(year) + (end ? 1 : 0);
  return `${String(Math.min(9999, number)).padStart(4, '0')}-${number > 9999 ? '12-31' : '01-01'}T00:00:00Z`;
}

// Declarative reader for long-form CSV split into temporal partitions.
// Dataset names, indicator IDs, URLs, cache keys and classifications live in profiles.json.
export class PartitionedCsvSource {
  constructor({ client, cache, processor, profile, lookups = {} }) {
    Object.assign(this, { client, cache, processor, profile, lookups });
  }
  async descriptor({ signal, force = false, onProgress } = {}) {
    const profile = this.profile;
    let record = await this.cache.get(profile.catalogCacheKey);
    if (force || !record || Date.now() - record.savedAt > 7 * 86400000) {
      const previous = record;
      try {
        const texts = {};
        for (const [id, catalog] of Object.entries(profile.catalogs)) {
          const file = new URL(catalog.url).pathname.split('/').at(-1);
          const result = await this.client.request(catalog.url, {
            signal,
            maxBytes: 6 * 1024 * 1024,
            onProgress: (event) => onProgress?.({ ...event, file }),
          });
          texts[id] = await result.blob.text();
          parseCatalog(texts[id], catalog.required);
          onProgress?.({ phase: 'done', file });
        }
        record = {
          key: profile.catalogCacheKey,
          texts,
          savedAt: Date.now(),
          kind: 'metadata',
          title: t`Číselníky · ${profile.title}`,
          size: Object.values(texts).reduce((sum, text) => sum + text.length * 2, 0),
        };
        await this.cache.put(record);
      } catch (error) {
        if (!previous || force || error.name === 'AbortError') throw error;
        record = previous;
        onProgress?.({
          phase: 'cached',
          warning: t('Aktualizace číselníků není dostupná. Používám starší uloženou verzi.'),
        });
      }
    } else onProgress?.({ phase: 'cached', file: t('Číselníky') });
    const catalogs = Object.fromEntries(
      Object.entries(profile.catalogs).map(([id, catalog]) => [
        id,
        parseCatalog(record.texts[id], catalog.required),
      ]),
    );
    const metric = profile.metric,
      entity = profile.entity;
    const metrics = catalogs[metric.catalog].map((row) => ({
      id: String(row[metric.code] ?? '').trim(),
      label: row[metric.name],
      unit: row[metric.unit] || '',
      note: row[metric.note] || '',
      topic: row[metric.topic] || '',
      kind: metric.categorical?.includes(row[metric.code]) ? 'category' : 'number',
    }));
    const entities = new Map();
    for (const row of catalogs[entity.catalog]) {
      const id = String(row[entity.code] ?? '').trim();
      if (!id) throw new Error(t('Číselník obsahuje prázdný identifikátor.'));
      const groups = (entity.groups || []).flatMap((group) => {
        const raw = row[group.field];
        const value = group.lookup ? this.lookups[group.lookup]?.[raw] : raw;
        return value
          ? [{ id: `${group.label}:${value}`, label: `${t(group.label)}: ${value}` }]
          : [];
      });
      const version = {
        label: row[entity.name],
        groups,
        from: dateBoundary(row[entity.validFrom] || 1),
        to: dateBoundary(row[entity.validTo] || 9999, true),
      };
      if (!entities.has(id)) entities.set(id, { id, label: version.label, history: [] });
      entities.get(id).history.push(version);
    }
    const end =
      profile.time.end === 'previous-year'
        ? Math.max(profile.time.minimumEnd || 0, new Date().getFullYear() - 1)
        : Number(profile.time.end);
    const periods = (
      profile.time.items ||
      Array.from({ length: end - profile.time.start + 1 }, (_, index) => {
        const year = profile.time.start + index;
        return {
          id: String(year),
          label: String(year),
          from: dateBoundary(year),
          to: dateBoundary(year, true),
          resourceKey: resourceName(profile.file.cacheKey, year),
        };
      })
    ).map((item) => ({
      ...item,
      resourceKey: item.resourceKey || resourceName(profile.file.cacheKey, item.id),
    }));
    const entityCategories = [...entities.values()];
    const descriptor = {
      id: profile.id,
      title: t(profile.title),
      source: t(profile.source),
      code: profile.code,
      version: 'CSV',
      url: profile.url,
      description: t(profile.description),
      originalLanguage: profile.dataLanguage,
      initialPickerRole: profile.initialPickerRole,
      dimensions: [
        { id: metric.id, label: t(metric.label), role: 'metric', categories: metrics },
        {
          id: entity.id,
          label: t(entity.label),
          role: entity.role || 'category',
          categories: entityCategories,
          allCategories: entityCategories,
        },
        { id: profile.time.id, label: t(profile.time.label), role: 'time', categories: periods },
      ],
      defaults: {
        [metric.id]: [metric.default || metrics[0].id],
        [entity.id]: [],
        [profile.time.id]: [periods.at(-1).id],
      },
      profile,
    };
    refreshTemporalDimensions(descriptor, descriptor.defaults);
    return descriptor;
  }
  files(descriptor, selections, entries, force = false) {
    const known = new Set(entries.map((item) => item.key));
    return (selections[this.profile.time.id] || []).map((period) => ({
      name: new URL(resourceName(this.profile.file.url, period)).pathname.split('/').at(-1),
      cached: !force && known.has(resourceName(this.profile.file.cacheKey, period)),
    }));
  }
  async partition(
    period,
    descriptor,
    codes,
    indicators,
    { signal, force = false, onProgress } = {},
  ) {
    const fileProfile = this.profile.file;
    const url = resourceName(fileProfile.url, period),
      key = resourceName(fileProfile.cacheKey, period);
    const file = new URL(url).pathname.split('/').at(-1),
      indexKey = `${this.profile.id}:${period}`;
    const progress = (event) => onProgress?.({ ...event, file });
    let record = !force ? await this.cache.get(key) : null;
    if (!force && this.processor.indexKey === indexKey) {
      progress({ phase: 'cached' });
      return this.processor.request(
        { type: 'query-index', indexKey, codes, indicators },
        { signal, onProgress: progress },
      );
    }
    let downloaded = false;
    if (!record?.blob) {
      let expectedSize = 0;
      try {
        const head = await this.client.request(url, {
          method: 'HEAD',
          signal,
          retries: 0,
          onProgress: progress,
        });
        expectedSize = Number(head.headers['content-length']) || 0;
      } catch (error) {
        if (error.name === 'AbortError' || [403, 429].includes(error.status)) throw error;
      }
      const response = await this.client.request(url, {
        signal,
        onProgress: progress,
        expectedSize,
      });
      record = {
        key,
        partition: String(period),
        blob: response.blob,
        size: response.blob.size,
        savedAt: Date.now(),
        modified: response.headers['last-modified'],
        url,
        kind: 'partition',
        title: `${this.profile.title} · ${period}`,
      };
      downloaded = true;
    } else progress({ phase: 'cached' });
    try {
      const entities = descriptor.dimensions.find((dim) => dim.id === this.profile.entity.id);
      const slice = await this.processor.request(
        {
          type: 'index-csv',
          indexKey,
          period: String(period),
          schema: fileProfile.fields,
          delimiter: fileProfile.delimiter || ',',
          blob: record.blob,
          codes,
          indicators,
          knownCodes: (entities.allCategories || entities.categories).map((item) => item.id),
        },
        { signal, onProgress: progress },
      );
      if (downloaded) {
        progress({ phase: 'saving' });
        await this.cache.put(record);
      }
      progress({ phase: 'done', loaded: record.size });
      return slice;
    } catch (error) {
      if (!downloaded && error.name !== 'AbortError') await this.cache.remove(key);
      throw error;
    }
  }
  async load(descriptor, selections, options = {}) {
    validateSelection(descriptor, selections);
    const profile = this.profile,
      metrics = selections[profile.metric.id],
      codes = selections[profile.entity.id],
      periods = [...selections[profile.time.id]].sort();
    const values = new Array(metrics.length * codes.length * periods.length).fill(null),
      statuses = {},
      references = {};
    const metricCategories = descriptor.dimensions.find((dim) => dim.role === 'metric').categories;
    for (const id of profile.referenceMetrics || []) {
      const info = metricCategories.find((item) => item.id === id);
      if (info) references[id] = { id, label: info.label, unit: info.unit, values: {} };
    }
    for (let timeIndex = 0; timeIndex < periods.length; timeIndex++) {
      const period = periods[timeIndex];
      const slice = await this.partition(
        period,
        descriptor,
        codes,
        [...new Set([...metrics, ...Object.keys(references)])],
        options,
      );
      codes.forEach((code, entityIndex) => {
        for (const [id, reference] of Object.entries(references))
          reference.values[JSON.stringify([code, period])] =
            slice.values[id]?.[entityIndex] ?? null;
        metrics.forEach((id, metricIndex) => {
          const index = (metricIndex * codes.length + entityIndex) * periods.length + timeIndex;
          const raw = slice.values[id]?.[entityIndex];
          if (typeof raw === 'number') values[index] = raw;
          else if (raw) statuses[index] = String(raw);
        });
      });
    }
    const dimensions = descriptor.dimensions.map((dim) => ({
      ...dim,
      categories: (dim.role === 'time' ? periods : selections[dim.id]).map((id) =>
        dim.categories.find((item) => item.id === id),
      ),
    }));
    const units = Object.fromEntries(
      metrics.map((id) => [
        id,
        { label: metricCategories.find((item) => item.id === id)?.unit || '' },
      ]),
    );
    const metricTypes = Object.fromEntries(
      metrics.map((id) => [id, metricCategories.find((item) => item.id === id)?.kind]),
    );
    return makeCube({
      dimensions,
      values,
      statuses,
      units,
      metricTypes,
      title: descriptor.title,
      source: t(profile.provider),
      notes: (profile.notes || []).map((note) => t(note)),
      metadata: { references },
    });
  }
}
