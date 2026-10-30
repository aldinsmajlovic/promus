import { ApplicationRef, inject } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

/** Closes the bottom sheet, dialogs and snackbar, and waits until they and the saves they started are done. */
export function injectCloseOverlays(): () => Promise<void> {
  const sheet = inject(MatBottomSheet);
  const dialog = inject(MatDialog);
  const snackBar = inject(MatSnackBar);
  const app = inject(ApplicationRef);
  return async () => {
    // nothing of the list stays on screen over the page that follows. An item's options save what was typed in them
    // as they close, into this page's database: the page, and its database, wait for that save to end
    const sheetRef = sheet._openedBottomSheetRef;
    const closed = Promise.all([
      sheetRef && firstValueFrom(sheetRef.afterDismissed()),
      firstValueFrom(dialog.afterAllClosed),
    ]);
    sheet.dismiss();
    dialog.closeAll();
    snackBar.dismiss();
    await closed;
    // a save holds the app unstable until it has written every field: Actions.run makes it a pending task
    // ponytail: so when the cookie goes with an item's options open, Actions.run then offers that save's Undo, which
    // flashes for about 100 ms over the name step until the page change dismisses it. Upgrade path: skip the Undo
    // offer once this has stopped the guest's sync
    await app.whenStable();
  };
}
