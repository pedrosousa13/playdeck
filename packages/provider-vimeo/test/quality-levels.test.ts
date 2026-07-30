import { expect, test, vi } from 'vitest';
import type { ProviderStatePatch } from '@reely/core';
import {
  createVimeoQualityLevels,
  type VimeoQualityPlayer
} from '../src/quality-levels';

const createHarness = (attached = true) => {
  const patches: ProviderStatePatch[] = [];
  const player: VimeoQualityPlayer = {
    setQuality: vi.fn(async () => undefined)
  };
  const qualityLevels = createVimeoQualityLevels({
    emit: (patch) => patches.push(patch),
    getPlayer: () => (attached ? player : undefined)
  });
  return { patches, player, qualityLevels };
};

const rung = (id: string, active = false) => ({ id, label: id, active });

test('publishes a rung per level, with the height its id names', () => {
  const { qualityLevels } = createHarness();
  expect(qualityLevels.adopt([rung('1080p'), rung('540p')]).qualities).toEqual([
    { id: 'vimeo:1080p', height: 1080, width: null, bitrate: null },
    { id: 'vimeo:540p', height: 540, width: null, bitrate: null }
  ]);
});

test('leaves the height unknown for a rung id that names no resolution', () => {
  const { qualityLevels } = createHarness();
  expect(qualityLevels.adopt([rung('4k')]).qualities).toEqual([
    { id: 'vimeo:4k', height: null, width: null, bitrate: null }
  ]);
});

test('keeps auto out of the published ladder', () => {
  const { qualityLevels } = createHarness();
  const patch = qualityLevels.adopt([rung('auto', true), rung('720p')]);
  expect(patch.qualities).toEqual([
    { id: 'vimeo:720p', height: 720, width: null, bitrate: null }
  ]);
  // `auto` is the entry the player honours under adaptive playback, and the
  // rung actually rendering is not identified.
  expect(patch.selectedQualityId).toBeNull();
});

test('reports the active rung as the selection when one is pinned', () => {
  const { qualityLevels } = createHarness();
  expect(
    qualityLevels.adopt([rung('auto'), rung('720p', true)]).selectedQualityId
  ).toBe('vimeo:720p');
});

test('drops an answer that is not a list of rungs', () => {
  const { qualityLevels } = createHarness();
  const patch = qualityLevels.adopt(undefined);
  expect(patch.qualities).toEqual([]);
  expect(qualityLevels.selectQualityAvailability()).toEqual({
    status: 'unavailable',
    reason: 'source'
  });
});

test('drops list entries that carry no rung id', () => {
  const { qualityLevels } = createHarness();
  expect(
    qualityLevels.adopt([{ label: '720p', active: false }, rung('360p')])
      .qualities
  ).toEqual([{ id: 'vimeo:360p', height: 360, width: null, bitrate: null }]);
});

test('reports a ladder with rungs as selectable', () => {
  const { qualityLevels } = createHarness();
  qualityLevels.adopt([rung('720p')]);
  expect(qualityLevels.selectQualityAvailability()).toEqual({
    status: 'available'
  });
});

test('refuses a rung the player never offered without calling the SDK', async () => {
  const { qualityLevels, player, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p')]);
  await expect(qualityLevels.selectQuality('vimeo:2160p')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  expect(player.setQuality).not.toHaveBeenCalled();
  expect(patches).toEqual([]);
});

test('refuses auto when the ladder carries no auto entry', async () => {
  const { qualityLevels, player } = createHarness();
  qualityLevels.adopt([rung('720p')]);
  await expect(qualityLevels.selectQuality(null)).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
  expect(player.setQuality).not.toHaveBeenCalled();
});

test('selects a rung by its Vimeo id and publishes the selection', async () => {
  const { qualityLevels, player, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p')]);
  await expect(qualityLevels.selectQuality('vimeo:720p')).resolves.toEqual({
    ok: true
  });
  expect(player.setQuality).toHaveBeenCalledWith('720p');
  expect(patches).toEqual([{ selectedQualityId: 'vimeo:720p' }]);
});

test('selects auto through the ladder auto entry', async () => {
  const { qualityLevels, player, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p', true)]);
  await expect(qualityLevels.selectQuality(null)).resolves.toEqual({
    ok: true
  });
  expect(player.setQuality).toHaveBeenCalledWith('auto');
  expect(patches).toEqual([{ selectedQualityId: null }]);
});

test('leaves the selection alone when the SDK refuses the rung', async () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p', true)]);
  const failing = createVimeoQualityLevels({
    emit: (patch) => patches.push(patch),
    getPlayer: () => ({
      setQuality: () => Promise.reject(new Error('nope'))
    })
  });
  failing.adopt([rung('auto'), rung('720p')]);
  const result = await failing.selectQuality('vimeo:720p');
  expect(result.ok).toBe(false);
  expect(patches).toEqual([]);
});

test('is not ready to select a rung before a player is attached', async () => {
  const { qualityLevels } = createHarness(false);
  qualityLevels.adopt([rung('720p')]);
  await expect(qualityLevels.selectQuality('vimeo:720p')).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('adopts a rung pinned from the Vimeo settings menu', () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p')]);
  qualityLevels.handlers.onQualityChange({ quality: '720p' });
  expect(patches).toEqual([{ selectedQualityId: 'vimeo:720p' }]);
});

test('reports a menu switch back to auto as no pinned rung', () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p', true)]);
  qualityLevels.handlers.onQualityChange({ quality: 'auto' });
  expect(patches).toEqual([{ selectedQualityId: null }]);
});

test('ignores a quality change naming a rung the ladder does not carry', () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p')]);
  qualityLevels.handlers.onQualityChange({ quality: '2160p' });
  expect(patches).toEqual([]);
});

test('ignores a quality change that repeats the held selection', () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p', true)]);
  qualityLevels.handlers.onQualityChange({ quality: '720p' });
  expect(patches).toEqual([]);
});

test('ignores a quality change payload that names no quality', () => {
  const { qualityLevels, patches } = createHarness();
  qualityLevels.adopt([rung('auto'), rung('720p')]);
  qualityLevels.handlers.onQualityChange({});
  qualityLevels.handlers.onQualityChange(undefined);
  expect(patches).toEqual([]);
});
