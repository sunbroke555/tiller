// Focus return for Radix overlays (menus, dialogs, sheets).
//
// Radix hands focus back to an overlay's trigger in onCloseAutoFocus, which
// runs a tick after the content unmounts, i.e. at the end of its exit
// animation. If the user opened something else in the meantime (the same row
// menu again right after picking an item, or another menu or dialog), that
// late focus() pulls focus out of it, and a non-modal menu treats focus moving
// outside as a dismiss: it closes right after opening. So focus only goes back
// to the trigger when it was lost together with the closing overlay.

/** onCloseAutoFocus that keeps focus where it is when something else already took it. */
export function returnFocusIfLost<E extends Event>(handler?: (event: E) => void): (event: E) => void {
  return (event) => {
    handler?.(event)
    if (event.defaultPrevented) return
    const active = document.activeElement
    if (active && active !== document.body) event.preventDefault()
  }
}
