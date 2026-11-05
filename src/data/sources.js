import profiles from './profiles.json' with { type: 'json' };
import { PartitionedCsvSource } from './csv-source.js';
import { t } from '../i18n/index.js';

export class SourceRegistry {
  constructor({ datastat, client, cache, processor, lookups }) {
    this.datastat = datastat;
    this.profiles = profiles;
    this.csv = new Map(
      profiles.map((profile) => [
        profile.id,
        new PartitionedCsvSource({ client, cache, processor, lookups, profile }),
      ]),
    );
  }
  get builtins() {
    return this.profiles.map((profile) => ({
      id: profile.id,
      title: t(profile.title),
      code: profile.code,
      source: t(profile.source),
      sourceKey: 'csv',
      geoLevels:
        profile.entity.role === 'geo'
          ? [{ kodUrovne: profile.entity.level?.id || '', nazevUrovne: t(profile.entity.label) }]
          : [],
      timeLevels: [{ nazevUrovne: t(profile.time.label) }],
    }));
  }
  resolve(id) {
    const source = this.csv.get(id);
    if (source)
      return {
        descriptor: (options) => source.descriptor(options),
        prepare: async (descriptor) => descriptor.defaults,
        load: (...args) => source.load(...args),
        files: (...args) => source.files(...args),
      };
    if (/^csu:[\w-]{1,80}$/.test(id))
      return {
        descriptor: (options) => this.datastat.descriptor(id.slice(4), options),
        prepare: (...args) => this.datastat.populateDimensions(...args),
        load: (...args) => this.datastat.load(...args),
        files: () => [],
      };
    return null;
  }
  legacy(params) {
    for (const profile of this.profiles) {
      const link = profile.legacyLink;
      if (!link || !params.has(link.trigger)) continue;
      const selections = Object.fromEntries(
        Object.entries(link.dimensions).map(([id, rule]) => [
          id,
          (params.get(rule.param) || rule.default || '')
            .split(rule.separator || '\u0000')
            .filter(Boolean),
        ]),
      );
      return { id: profile.id, selections };
    }
    return null;
  }
}
