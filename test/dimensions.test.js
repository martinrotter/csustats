import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refreshTemporalDimensions,
  dimensionGroups,
  belongsToGroup,
} from '../src/core/dimensions.js';

test('historical membership and labels follow selected periods for any categorical dimension', () => {
  const entities = [
    {
      id: 'A',
      label: 'A',
      history: [
        {
          from: '2010-01-01',
          to: '9999-01-01',
          label: 'Nové',
          groups: [{ id: 'new', label: 'Nová skupina' }],
        },
        {
          from: '2000-01-01',
          to: '2010-01-01',
          label: 'Staré',
          groups: [{ id: 'old', label: 'Stará skupina' }],
        },
      ],
    },
    { id: 'B', label: 'B', history: [{ from: '2000-01-01', to: '2006-01-01', label: 'Zaniklé' }] },
  ];
  const descriptor = {
    dimensions: [
      { id: 'entity', role: 'category', allCategories: entities, categories: entities },
      {
        id: 'period',
        role: 'time',
        categories: [
          { id: 'past', from: '2004-01-01', to: '2005-01-01' },
          { id: 'now', from: '2025-01-01', to: '2026-01-01' },
        ],
      },
    ],
  };
  refreshTemporalDimensions(descriptor, { entity: [], period: ['now'] });
  assert.equal(descriptor.dimensions[0].categories.length, 1);
  assert.equal(descriptor.dimensions[0].categories[0].label, 'Nové');
  refreshTemporalDimensions(descriptor, { entity: [], period: ['past'] });
  assert.equal(descriptor.dimensions[0].categories.length, 2);
  assert.equal(descriptor.dimensions[0].categories[0].label, 'Staré');
  refreshTemporalDimensions(descriptor, { entity: ['B'], period: ['now'] });
  assert.equal(descriptor.dimensions[0].categories.find((item) => item.id === 'B').active, false);
});

test('the same bulk filter follows API hierarchies and explicit group memberships without source conditions', () => {
  const dimension = {
    levels: [{ id: 'region', label: 'Kraj' }],
    categories: [
      { id: 'R', label: 'Region', level: 'region' },
      { id: 'D', label: 'Okres', parent: 'R' },
      { id: 'A', label: 'Obec', parent: 'D' },
      { id: 'B', label: 'Jiná obec', groups: [{ id: 'county:other', label: 'Okres: Jiný' }] },
    ],
  };
  const groups = dimensionGroups(dimension);
  assert(groups.some((item) => item.id === 'tree:R'));
  assert(groups.some((item) => item.id === 'county:other'));
  assert(belongsToGroup(dimension.categories[2], dimension, 'tree:R'));
  assert(!belongsToGroup(dimension.categories[0], dimension, 'tree:R'));
  assert(belongsToGroup(dimension.categories[3], dimension, 'county:other'));
  assert(!belongsToGroup(dimension.categories[2], dimension, 'county:other'));
  const cyclic = {
    categories: [
      { id: 'A', parent: 'B' },
      { id: 'B', parent: 'A' },
    ],
  };
  assert.equal(belongsToGroup(cyclic.categories[0], cyclic, 'tree:missing'), false);
});
