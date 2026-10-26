import { inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import add from '@material-symbols/svg-400/rounded/add.svg';
import arrowBack from '@material-symbols/svg-400/rounded/arrow_back.svg';
import arrowDropDown from '@material-symbols/svg-400/rounded/arrow_drop_down.svg';
import arrowDropUp from '@material-symbols/svg-400/rounded/arrow_drop_up.svg';
import check from '@material-symbols/svg-400/rounded/check.svg';
import checkBox from '@material-symbols/svg-400/rounded/check_box-fill.svg';
import checkBoxOutlineBlank from '@material-symbols/svg-400/rounded/check_box_outline_blank.svg';
import close from '@material-symbols/svg-400/rounded/close.svg';
import contentCopy from '@material-symbols/svg-400/rounded/content_copy.svg';
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg';
import edit from '@material-symbols/svg-400/rounded/edit.svg';
import history from '@material-symbols/svg-400/rounded/history.svg';
import historyToggleOff from '@material-symbols/svg-400/rounded/history_toggle_off.svg';
import keyboardArrowDown from '@material-symbols/svg-400/rounded/keyboard_arrow_down.svg';
import keyboardArrowUp from '@material-symbols/svg-400/rounded/keyboard_arrow_up.svg';
import logout from '@material-symbols/svg-400/rounded/logout.svg';
import moreVert from '@material-symbols/svg-400/rounded/more_vert.svg';
import personAdd from '@material-symbols/svg-400/rounded/person_add.svg';
import playlistAdd from '@material-symbols/svg-400/rounded/playlist_add.svg';
import removeShoppingCart from '@material-symbols/svg-400/rounded/remove_shopping_cart.svg';
import settings from '@material-symbols/svg-400/rounded/settings.svg';
import share from '@material-symbols/svg-400/rounded/share.svg';
import visibility from '@material-symbols/svg-400/rounded/visibility.svg';
import visibilityOff from '@material-symbols/svg-400/rounded/visibility_off.svg';

const ICONS: Record<string, string> = {
  add,
  check,
  // filled, as in the approved mockups: a checked row reads at a glance
  check_box: checkBox,
  check_box_outline_blank: checkBoxOutlineBlank,
  more_vert: moreVert,
  // The package has no expand_more/expand_less; Material Symbols draws them as keyboard_arrow_down/up.
  expand_more: keyboardArrowDown,
  expand_less: keyboardArrowUp,
  arrow_back: arrowBack,
  arrow_drop_down: arrowDropDown,
  arrow_drop_up: arrowDropUp,
  close,
  history,
  remove_shopping_cart: removeShoppingCart,
  history_toggle_off: historyToggleOff,
  settings,
  logout,
  edit,
  delete: deleteIcon,
  playlist_add: playlistAdd,
  content_copy: contentCopy,
  person_add: personAdd,
  share,
  visibility,
  visibility_off: visibilityOff,
};

export function registerIcons(): void {
  const registry = inject(MatIconRegistry);
  const sanitizer = inject(DomSanitizer);
  for (const [name, svg] of Object.entries(ICONS)) {
    // Safe: static first-party SVGs bundled from @material-symbols/svg-400, never user input.
    registry.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
  }
}
