import { inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import add from '@material-symbols/svg-400/rounded/add.svg';
import arrowBack from '@material-symbols/svg-400/rounded/arrow_back.svg';
import arrowDropDown from '@material-symbols/svg-400/rounded/arrow_drop_down.svg';
import check from '@material-symbols/svg-400/rounded/check.svg';
import chevronRight from '@material-symbols/svg-400/rounded/chevron_right.svg';
import close from '@material-symbols/svg-400/rounded/close.svg';
import contentCopy from '@material-symbols/svg-400/rounded/content_copy.svg';
import contrast from '@material-symbols/svg-400/rounded/contrast.svg';
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg';
import edit from '@material-symbols/svg-400/rounded/edit.svg';
import group from '@material-symbols/svg-400/rounded/group.svg';
import historyToggleOff from '@material-symbols/svg-400/rounded/history_toggle_off.svg';
import keyboardArrowDown from '@material-symbols/svg-400/rounded/keyboard_arrow_down.svg';
import keyboardArrowUp from '@material-symbols/svg-400/rounded/keyboard_arrow_up.svg';
import logout from '@material-symbols/svg-400/rounded/logout.svg';
import mobileArrowDown from '@material-symbols/svg-400/rounded/mobile_arrow_down.svg';
import moreVert from '@material-symbols/svg-400/rounded/more_vert.svg';
import personAdd from '@material-symbols/svg-400/rounded/person_add.svg';
import refresh from '@material-symbols/svg-400/rounded/refresh.svg';
import removeShoppingCart from '@material-symbols/svg-400/rounded/remove_shopping_cart.svg';
import share from '@material-symbols/svg-400/rounded/share.svg';
import shoppingBasket from '@material-symbols/svg-400/rounded/shopping_basket.svg';
import translate from '@material-symbols/svg-400/rounded/translate.svg';
import visibility from '@material-symbols/svg-400/rounded/visibility.svg';
import visibilityOff from '@material-symbols/svg-400/rounded/visibility_off.svg';
import promus from '../../../../../brand/promus-p.svg';

const ICONS: Record<string, string> = {
  add,
  check,
  more_vert: moreVert,
  // The package has no expand_more/expand_less; Material Symbols draws them as keyboard_arrow_down/up.
  expand_more: keyboardArrowDown,
  expand_less: keyboardArrowUp,
  arrow_back: arrowBack,
  arrow_drop_down: arrowDropDown,
  close,
  remove_shopping_cart: removeShoppingCart,
  history_toggle_off: historyToggleOff,
  logout,
  chevron_right: chevronRight,
  group,
  contrast,
  translate,
  mobile_arrow_down: mobileArrowDown,
  refresh,
  edit,
  delete: deleteIcon,
  content_copy: contentCopy,
  person_add: personAdd,
  share,
  shopping_basket: shoppingBasket,
  visibility,
  visibility_off: visibilityOff,
  promus,
};

export function registerIcons(): void {
  const registry = inject(MatIconRegistry);
  const sanitizer = inject(DomSanitizer);
  for (const [name, svg] of Object.entries(ICONS)) {
    // Safe: static first-party SVGs bundled from @material-symbols/svg-400, never user input.
    registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
  }
}
