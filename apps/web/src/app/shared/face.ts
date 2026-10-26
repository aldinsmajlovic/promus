import { Component, computed, inject, input } from '@angular/core';
import { Household } from '../core/household';

/** 0 is you; everyone else gets a tone from 1 to 5 that depends only on their id. */
export function faceTone(userId: string, you: boolean): number {
  if (you) return 0;
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.codePointAt(0)!) >>> 0;
  return 1 + (hash % 5);
}

export function initialOf(username: string): string {
  return String.fromCodePoint(username.codePointAt(0) ?? 63).toLocaleUpperCase();
}

@Component({
  selector: 'app-face',
  template: `{{ initial() }}@if (badge(); as b) {<span class="badge">{{ b }}</span>}`,
  host: { '[class]': '"face tone-" + tone()', 'aria-hidden': 'true' },
})
export class Face {
  private readonly household = inject(Household);
  readonly member = input.required<{ id: string; username: string }>();
  readonly badge = input<string | null>(null);
  protected readonly initial = computed(() => initialOf(this.member().username));
  protected readonly tone = computed(() => faceTone(this.member().id, this.member().id === this.household.you()));
}
