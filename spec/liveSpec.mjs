import { LiveSet, Rule } from '../models.mjs';
const { describe, beforeAll, afterAll, it, expect, expectAsync } = globalThis;

describe("LiveSet", function () {
  class Referencer {
    get live() {
      return new LiveSet();
    }
    get titleA() {
      return this.live.get('a')?.title || null;
    }
    get hasA() {
      return this.live.has('a');
    }
    get mappedTitles() {
      return this.live.map(element => element.title);
    }
    get collectedTitles() {
      const titles = [];
      this.live.forEach(element => titles.push(element.title));
      return titles;
    }
  }
  Rule.rulify(Referencer.prototype);
  class Titled {
    get title() {
      return 'x';
    }
  }
  Rule.rulify(Titled.prototype);
  let referencer, initiallyHasA;
  beforeAll(function () {
    referencer = new Referencer();
    initiallyHasA = referencer.hasA;
  });
  it('has tracks by set and delete.', function () {
    expect(initiallyHasA).toBeFalsy();
    referencer.live.set('a', 42);
    expect(referencer.hasA).toBeTruthy();
    referencer.live.delete('a');
    expect(referencer.hasA).toBeFalsy();
    referencer.live.set('a', new Titled());
    expect(referencer.hasA).toBeTruthy();    
  });
  it("get/at tracks keys by set().", function () {
    referencer.live.set('a', new Titled());
    // expect(referencer.title0).toBe('x');
    expect(referencer.titleA).toBe('x');    
    // Changes to the assigned value's own rules are tracked.
    referencer.live.get('a').title = 'y';
    expect(referencer.live.get('a').title).toBe('y');
    // Assigning a new value resets the referencing rule.
    referencer.live.set('a', new Titled());
    expect(referencer.titleA).toBe('x');
    // expect(referencer.title0).toBe('x');
  });
  it("get/at tracks keys that are nulled.", function () {
    referencer.live.set('a', new Titled());
    expect(referencer.titleA).toBe('x');
    // expect(referencer.title0).toBe('x');    
    referencer.live.delete('a');
    expect(referencer.titleA).toBe(null);
    // expect(referencer.title0).toBe(null);
  });
  it("tracks by map.", function () {
    referencer.live.set('a', new Titled());

    const b = new Titled();
    b.title = 'y';
    referencer.live.set('b', b);
    expect(referencer.mappedTitles).toEqual(['x', 'y']);
    expect(referencer.collectedTitles).toEqual(['x', 'y']);    

    b.title = 'z';
    expect(referencer.mappedTitles).toEqual(['x', 'z']);
    expect(referencer.collectedTitles).toEqual(['x', 'z']);    

    referencer.live.set('b', new Titled());
    expect(referencer.mappedTitles).toEqual(['x', 'x']);
    expect(referencer.collectedTitles).toEqual(['x', 'x']);    

    referencer.live.set('c', b);
    expect(referencer.mappedTitles).toEqual(['x', 'x', 'z']);
    expect(referencer.collectedTitles).toEqual(['x', 'x', 'z']);

    referencer.live.delete('b');
    expect(referencer.mappedTitles).toEqual(['x', 'z']);
    expect(referencer.collectedTitles).toEqual(['x', 'z']);
    
  });
});
