import { describe, expect, it } from 'vitest';
import { DeferredRequests } from './deferred-requests.js';

describe('deferred requests', () => {
  it('retains only the top candidate from a superseded batch', () => {
    const deferred = new DeferredRequests();

    deferred.rememberTop(['找一个地方', '找一个', '招一个']);

    expect(deferred.take(5, new Map())).toEqual(['找一个地方']);
  });

  it('serves deferred top candidates in waiting order without duplicates', () => {
    const deferred = new DeferredRequests();
    deferred.rememberTop(['第一批', '其他']);
    deferred.rememberTop(['第二批']);
    deferred.rememberTop(['第一批']);

    expect(deferred.take(1, new Map())).toEqual(['第一批']);
    deferred.complete(['第一批']);
    expect(deferred.take(5, new Map())).toEqual(['第二批']);
  });

  it('drops candidates that have since become cached', () => {
    const deferred = new DeferredRequests();
    deferred.rememberTop(['已经缓存']);
    deferred.rememberTop(['仍需翻译']);

    expect(
      deferred.take(5, new Map([['已经缓存', 'already cached']])),
    ).toEqual(['仍需翻译']);
  });
});
