import { Directive, ElementRef, inject, input, output } from '@angular/core';

export const HOLD_MS = 480;
export const SLOP_PX = 8;
export const SWIPE_MAX_PX = 110;

/** Long-press or right-click is `held`; a swipe left past a third of the row (at most 110px) is `swiped`. */
@Directive({
  selector: '[appRowGestures]',
  host: {
    style: 'touch-action: pan-y; user-select: none; -webkit-touch-callout: none',
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'up()',
    '(pointercancel)': 'cancel()',
    '(contextmenu)': 'menu($event)',
  },
})
export class RowGestures {
  readonly swipe = input(true);
  readonly held = output<void>();
  readonly swiped = output<void>();

  private readonly host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pressed = false;
  private mode: 'tap' | 'swipe' | 'none' = 'tap';
  private heldFired = false;
  private disarm: (() => void) | undefined;
  private x = 0;
  private y = 0;
  private dx = 0;

  protected down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.reset();
    this.host.classList.remove('snap');
    this.pressed = true;
    this.mode = 'tap';
    this.heldFired = false;
    this.x = e.clientX;
    this.y = e.clientY;
    this.timer = setTimeout(() => this.fireHeld(), HOLD_MS);
  }

  protected move(e: PointerEvent): void {
    if (!this.pressed) return;
    const dx = e.clientX - this.x;
    const dy = e.clientY - this.y;
    if (this.mode === 'tap' && (Math.abs(dx) > SLOP_PX || Math.abs(dy) > SLOP_PX)) {
      clearTimeout(this.timer);
      if (Math.abs(dx) > Math.abs(dy) && dx < 0 && this.swipe()) {
        this.mode = 'swipe';
        this.swallowNextClick();
        this.host.setPointerCapture(e.pointerId);
        this.host.classList.add('swiping');
      } else {
        this.mode = 'none';
      }
    }
    if (this.mode === 'swipe') {
      this.dx = Math.min(0, dx);
      this.host.style.translate = `${this.dx}px`;
    }
  }

  protected up(): void {
    if (!this.pressed) return;
    const swiping = this.mode === 'swipe';
    const past = swiping && -this.dx > Math.min(this.host.offsetWidth / 3, SWIPE_MAX_PX);
    this.reset();
    if (swiping) this.host.classList.add('snap');
    if (past) this.swiped.emit();
  }

  protected menu(e: Event): void {
    e.preventDefault();
    clearTimeout(this.timer);
    this.fireHeld();
  }

  protected cancel(): void {
    this.reset();
    this.disarm?.();
  }

  private reset(): void {
    clearTimeout(this.timer);
    this.pressed = false;
    this.mode = 'none';
    this.heldFired = false;
    this.dx = 0;
    this.host.style.translate = '';
    this.host.classList.remove('swiping');
  }

  private fireHeld(): void {
    // a long touch on Android sends contextmenu too: one `held` per press
    if (this.pressed) {
      if (this.heldFired) return;
      this.heldFired = true;
      this.swallowNextClick();
      this.mode = 'none';
    }
    this.held.emit();
  }

  /**
   * The click that ends a gesture may land on whatever replaced the row (a menu, an overlay, the next row),
   * or on nothing: swallow the next click on the document, until the next press.
   */
  private swallowNextClick(): void {
    this.disarm?.();
    const doc = this.host.ownerDocument;
    const off = () => {
      doc.removeEventListener('click', swallow, true);
      doc.removeEventListener('pointerdown', off, true);
      this.disarm = undefined;
    };
    const swallow = (e: Event) => {
      off();
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    doc.addEventListener('click', swallow, true);
    doc.addEventListener('pointerdown', off, true);
    this.disarm = off;
  }
}
